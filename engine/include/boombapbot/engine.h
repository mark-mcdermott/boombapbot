/*
 * boombapbot engine C ABI.
 *
 * One render core for every target: native apps, the VST3 wrapper and the
 * WebAssembly build used by the browser AudioWorklet and offline export.
 *
 * The engine is a drum machine: a bank of patterns, twelve tracks (an accent
 * and eleven instruments), sixteen sound slots and a mix bus. A pattern is one
 * measure of up to 32 steps. Everything that decides when a hit sounds, and
 * which pattern follows which, happens inside snare_engine_render.
 *
 * Threading contract
 *   - "control" functions may be called from one non-realtime thread.
 *   - snare_engine_render is the only function for the audio thread. It does
 *     not allocate, lock, touch files or call into the host.
 *   - Control calls that change playback are queued and applied at the start
 *     of the next rendered buffer.
 *
 * Buffer ownership
 *   - Output buffers passed to snare_engine_render are owned by the caller.
 *   - A sound handed to snare_engine_set_sound belongs to the engine.
 */
#ifndef BOOMBAPBOT_ENGINE_H
#define BOOMBAPBOT_ENGINE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define SNARE_ABI_VERSION 2
/* Sound slots. A slot's number is also its sound number and role index. */
#define SNARE_SOUNDS 16
/* Rows of a pattern: track 0 is the accent, 1 to 11 are instruments. */
#define SNARE_TRACKS 12
#define SNARE_PART_STEPS 16
#define SNARE_MAX_STEPS 32
#define SNARE_PATTERNS 32
#define SNARE_MAX_VOICES 64
/* The timeline counts in ticks. Every step length is a whole number of them. */
#define SNARE_TICKS_PER_BEAT 24
#define SNARE_MIDI_PPQ 480
#define SNARE_BPM_MIN 40.0
#define SNARE_BPM_MAX 300.0

enum {
  SNARE_OK = 0,
  SNARE_ERR_QUEUE_FULL = -1,
  SNARE_ERR_BAD_ARGUMENT = -2,
  SNARE_ERR_TOO_LARGE = -3
};

typedef struct SnareEngine SnareEngine;
typedef struct SnareSound SnareSound;

/* One measure. Bit n of rows[t] is step n of track t. The 1st part plays its
 * len1 steps, then the 2nd part its len2 steps (step 16 onwards). */
typedef struct SnarePattern {
  uint32_t rows[SNARE_TRACKS];
  uint8_t len1;           /* 1..16 */
  uint8_t len2;           /* 0..16 */
  uint8_t steps_per_beat; /* 3, 4, 6 or 8 */
  uint8_t reserved;
} SnarePattern;

/* A scheduled or auditioned hit, as recorded by the optional event log. */
typedef struct SnareEvent {
  double frame;    /* absolute output frame of the hit */
  int32_t step;    /* step within the measure, or -1 for an audition */
  int32_t track;
  int32_t accent;  /* 1 when the hit was accented */
  int32_t pattern; /* pattern playing, or -1 for an audition */
} SnareEvent;

uint32_t snare_abi_version(void);

/* ---- Timeline helpers shared by the scheduler and the exporters ---------- */

/* Ticks in one step at `steps_per_beat`. 0 unless it is 3, 4, 6 or 8. */
int32_t snare_step_ticks(int32_t steps_per_beat);
/* Ticks in one measure of a pattern. Negative on a bad pattern. */
int32_t snare_pattern_ticks(const SnarePattern* pattern);
double snare_frames_per_tick(double bpm, double sample_rate);
/* Output frame of a tick position counted from where playback started, at a
 * constant tempo. Rounded as the scheduler rounds. */
double snare_tick_frame(double ticks, double bpm, double sample_rate);

/* ---- Sound synthesis (any non-realtime thread) --------------------------- */

/* The sounds of the 808 panel. A sound's number is also its slot. */
enum {
  SNARE_SOUND_KICK = 0,
  SNARE_SOUND_SNARE = 1,
  SNARE_SOUND_CLOSED_HAT = 2,
  SNARE_SOUND_OPEN_HAT = 3,
  SNARE_SOUND_LOW_TOM = 4,
  SNARE_SOUND_HIGH_TOM = 5,
  SNARE_SOUND_CLAP = 6,
  SNARE_SOUND_CYMBAL = 7,
  SNARE_SOUND_MID_TOM = 8,
  SNARE_SOUND_RIM_SHOT = 9,
  SNARE_SOUND_COWBELL = 10,
  SNARE_SOUND_LOW_CONGA = 11,
  SNARE_SOUND_MID_CONGA = 12,
  SNARE_SOUND_HIGH_CONGA = 13,
  SNARE_SOUND_CLAVES = 14,
  SNARE_SOUND_MARACAS = 15
};

/* Knob positions from 0 (fully left) to 1 (fully right). A sound ignores the
 * knobs its panel column does not have. seed 0 selects the sound's own. */
typedef struct SnareSoundParams {
  int32_t sound;
  float tune;
  float tone;
  float decay;
  float snappy;
  uint32_t seed;
} SnareSoundParams;

/* Length of a sound in frames at `sample_rate`. Negative on bad arguments. */
int32_t snare_synth_frames(const SnareSoundParams* params, double sample_rate);
/* Renders a sound as mono float PCM and returns the frames written. The same
 * arguments always produce the same samples. Pure: no engine is involved, so
 * it must be called off the audio thread and the result handed over as PCM. */
int32_t snare_synth_render(const SnareSoundParams* params, double sample_rate,
                           float* out, int32_t capacity);

/* ---- Sounds (control thread) --------------------------------------------- */

/* A sound is the samples one slot plays. Create it, fill its data, then hand
 * it to an engine. frames may be 0 for silence. NULL on bad arguments. */
SnareSound* snare_sound_create(int32_t frames, int32_t channels,
                               double sample_rate);
/* Interleaved float PCM, frames * channels long, zeroed at creation. */
float* snare_sound_data(SnareSound* sound);
/* Only for sounds that were never handed to an engine. */
void snare_sound_destroy(SnareSound* sound);

/* ---- Engine lifecycle (control thread) ---------------------------------- */

SnareEngine* snare_engine_create(double sample_rate);
void snare_engine_destroy(SnareEngine* engine);

/* Gives one slot a new sound from the next buffer boundary. Voices already
 * sounding finish on the samples they started with. NULL empties the slot. */
int32_t snare_engine_set_sound(SnareEngine* engine, int32_t slot,
                               SnareSound* sound);
/* Synthesises a sound and gives it to its slot. For native hosts and offline
 * rendering; a browser synthesises on its main thread instead. */
int32_t snare_engine_synth_sound(SnareEngine* engine,
                                 const SnareSoundParams* params);
/* Frees replaced sounds whose tails have finished. Returns how many remain. */
int32_t snare_engine_collect(SnareEngine* engine);

/* ---- Queued control messages: the mix ----------------------------------- */

int32_t snare_engine_set_tempo(SnareEngine* engine, double bpm);
/* Which slot an instrument track plays, where it sits in the stereo field,
 * and its choke group: a hit in group N fades every sounding voice of group
 * N. 0 is no group. A track always cuts its own previous hit. */
int32_t snare_engine_set_track(SnareEngine* engine, int32_t track, int32_t slot,
                               float pan, int32_t choke_group);
/* Linear gain of an instrument track. Changes are smoothed, and reach a hit
 * that is still ringing. */
int32_t snare_engine_set_track_level(SnareEngine* engine, int32_t track,
                                     double gain);
/* Gains of a hit on a plain step and on an accented step. */
int32_t snare_engine_set_accent(SnareEngine* engine, double plain_gain,
                                double accent_gain);
/* Output volume from 0 to 1, applied after the limiter and smoothed. */
int32_t snare_engine_set_master_volume(SnareEngine* engine, double volume);

/* ---- Queued control messages: the pattern bank --------------------------- */

/* Replaces a pattern. Its steps apply from the next buffer. If it is the
 * pattern playing, a new length or step size waits for the next measure. */
int32_t snare_engine_set_pattern(SnareEngine* engine, int32_t index,
                                 const SnarePattern* pattern);
int32_t snare_engine_set_step(SnareEngine* engine, int32_t pattern,
                              int32_t track, int32_t step, int32_t on);

/* ---- Queued control messages: playing ------------------------------------ */

/* The pattern to play from the next measure, or from the start when stopped.
 * With nothing cued the pattern playing repeats. */
int32_t snare_engine_cue_pattern(SnareEngine* engine, int32_t index);
/* Starts from the first step at the next buffer boundary. */
int32_t snare_engine_play(SnareEngine* engine);
/* Like play, but the scheduler stops itself after `measures` measures. Tails
 * keep ringing. Used for offline rendering, where no step of a later measure
 * may fire. */
int32_t snare_engine_play_measures(SnareEngine* engine, int32_t measures);
int32_t snare_engine_stop(SnareEngine* engine);
/* Plays one hit of an instrument track outside the pattern. */
int32_t snare_engine_trigger(SnareEngine* engine, int32_t track,
                             int32_t accent);

/* ---- Audio thread -------------------------------------------------------- */

void snare_engine_render(SnareEngine* engine, float* left, float* right,
                         int32_t frames);

/* ---- State, readable from any thread ------------------------------------ */

int32_t snare_engine_is_playing(const SnareEngine* engine);
/* Last step that fired within its measure, or -1 while stopped. */
int32_t snare_engine_current_step(const SnareEngine* engine);
/* Pattern playing, or the one that will play from the start. */
int32_t snare_engine_current_pattern(const SnareEngine* engine);
/* Measures started since play: 1 during the first. 0 while stopped. */
int32_t snare_engine_current_measure(const SnareEngine* engine);
double snare_engine_frames_rendered(const SnareEngine* engine);
/* Frame at which a bounded play ended, or -1 if it has not. */
double snare_engine_stop_frame(const SnareEngine* engine);
int32_t snare_engine_active_voices(const SnareEngine* engine);
uint32_t snare_engine_stolen_voices(const SnareEngine* engine);

/* ---- Event log, for tests and alignment checks (control thread) ---------- */

/* Allocates a log of `capacity` events. Call before rendering starts. */
int32_t snare_engine_enable_event_log(SnareEngine* engine, int32_t capacity);
int32_t snare_engine_event_count(const SnareEngine* engine);
int32_t snare_engine_read_events(const SnareEngine* engine, SnareEvent* out,
                                 int32_t max_events);

/* ---- Standard MIDI File export ------------------------------------------ */

/* Writes a Type 1 file: a tempo track and one drum track on channel 10.
 * `sequence` names the pattern played in each of `measures` measures, as
 * indexes into `patterns`. `track_notes` holds a MIDI note per track; the
 * accent track's entry is ignored. A hit is written at `accent_velocity` on an
 * accented step and `plain_velocity` otherwise. Returns the size of the file
 * in bytes; data is written only when capacity is large enough. Negative on
 * bad arguments. */
int32_t snare_midi_export(const SnarePattern* patterns, int32_t pattern_count,
                          const uint8_t* sequence, int32_t measures,
                          const uint8_t* track_notes, int32_t plain_velocity,
                          int32_t accent_velocity, double bpm, uint8_t* out,
                          int32_t capacity);

#ifdef __cplusplus
}
#endif

#endif /* BOOMBAPBOT_ENGINE_H */
