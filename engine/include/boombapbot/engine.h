/*
 * boombapbot engine C ABI.
 *
 * One render core for every target: native apps, the VST3 wrapper and the
 * WebAssembly build used by the browser AudioWorklet and offline export.
 *
 * Threading contract
 *   - "control" functions may be called from one non-realtime thread.
 *   - snare_engine_render is the only function for the audio thread. It does
 *     not allocate, lock, touch files or call into the host.
 *   - Control calls that change playback are queued and applied at the start
 *     of the next rendered buffer.
 *
 * Buffer ownership
 *   - Sample data passed to snare_kit_set_voice is copied; the caller keeps
 *     ownership of its buffer.
 *   - Output buffers passed to snare_engine_render are owned by the caller.
 *   - A kit handed to snare_engine_commit_kit belongs to the engine.
 */
#ifndef BOOMBAPBOT_ENGINE_H
#define BOOMBAPBOT_ENGINE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define SNARE_ABI_VERSION 1
#define SNARE_MAX_ROLES 16
#define SNARE_STEPS 16
#define SNARE_MAX_VOICES 64
#define SNARE_MIDI_PPQ 480

/* Swing is the position of the second sixteenth inside each pair, as a
 * percentage of the pair. 50 is straight, 66.67 is a triplet feel. */
#define SNARE_SWING_MIN 50.0
#define SNARE_SWING_MAX 75.0
#define SNARE_BPM_MIN 30.0
#define SNARE_BPM_MAX 300.0

enum {
  SNARE_OK = 0,
  SNARE_ERR_QUEUE_FULL = -1,
  SNARE_ERR_BAD_ARGUMENT = -2,
  SNARE_ERR_TOO_LARGE = -3
};

typedef struct SnareEngine SnareEngine;
typedef struct SnareKit SnareKit;

/* A scheduled or auditioned hit, as recorded by the optional event log. */
typedef struct SnareEvent {
  double frame;      /* absolute output frame of the hit */
  int32_t step;      /* pattern step, or -1 for an audition trigger */
  int32_t role;
  int32_t velocity;
  int32_t reserved;
} SnareEvent;

uint32_t snare_abi_version(void);

/* ---- Timeline helpers shared by the scheduler and the exporters ---------- */

/* Musical time of a step, in sixteenth notes from the start of the loop. */
double snare_step_time(int step_index, double swing_percent);
/* Length of one sixteenth note in output frames. */
double snare_frames_per_step(double bpm, double sample_rate);
/* Frames in one loop of `steps` sixteenths. Independent of swing. */
int32_t snare_loop_frames(double bpm, double sample_rate, int steps);

/* ---- Kits (control thread) ---------------------------------------------- */

SnareKit* snare_kit_create(void);
/* Only for kits that were never committed to an engine. */
void snare_kit_destroy(SnareKit* kit);
/* Copies interleaved float PCM into the kit. choke_group 0 means no choke;
 * a hit in group N releases every sounding voice of group N. */
int32_t snare_kit_set_voice(SnareKit* kit, int32_t role, const float* pcm,
                            int32_t frames, int32_t channels,
                            double sample_rate, float gain, float pan,
                            int32_t choke_group);

/* ---- Engine lifecycle (control thread) ---------------------------------- */

SnareEngine* snare_engine_create(double sample_rate);
void snare_engine_destroy(SnareEngine* engine);

/* Hands a prepared kit to the engine. It becomes active at the next buffer
 * boundary. Voices already sounding finish on the samples they started with. */
int32_t snare_engine_commit_kit(SnareEngine* engine, SnareKit* kit);
/* Frees replaced kits whose tails have finished. Returns how many remain. */
int32_t snare_engine_collect(SnareEngine* engine);

/* ---- Queued control messages -------------------------------------------- */

int32_t snare_engine_set_tempo(SnareEngine* engine, double bpm);
int32_t snare_engine_set_swing(SnareEngine* engine, double swing_percent);
int32_t snare_engine_set_master_gain(SnareEngine* engine, double gain);
int32_t snare_engine_set_step(SnareEngine* engine, int32_t role, int32_t step,
                              int32_t velocity);
/* velocities is SNARE_STEPS bytes, 0 for off or 1..127. */
int32_t snare_engine_set_row(SnareEngine* engine, int32_t role,
                             const uint8_t* velocities);
int32_t snare_engine_clear_pattern(SnareEngine* engine);
/* Starts the loop from step 0 at the next buffer boundary. */
int32_t snare_engine_play(SnareEngine* engine);
/* Like play, but the scheduler stops itself after `loops` bars. Tails keep
 * ringing. Used for offline rendering, where no step of a later bar may fire. */
int32_t snare_engine_play_loops(SnareEngine* engine, int32_t loops);
int32_t snare_engine_stop(SnareEngine* engine);
/* Plays one hit outside the pattern, for audition and live pads. */
int32_t snare_engine_trigger(SnareEngine* engine, int32_t role,
                             int32_t velocity);

/* ---- Audio thread -------------------------------------------------------- */

void snare_engine_render(SnareEngine* engine, float* left, float* right,
                         int32_t frames);

/* ---- State, readable from any thread ------------------------------------ */

int32_t snare_engine_is_playing(const SnareEngine* engine);
/* Last step that fired, or -1 while stopped. */
int32_t snare_engine_current_step(const SnareEngine* engine);
double snare_engine_frames_rendered(const SnareEngine* engine);
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
 * velocities is roles * SNARE_STEPS bytes, row-major by role. notes holds one
 * MIDI note number per role. Returns the size of the file in bytes; data is
 * written only when capacity is large enough. Negative on bad arguments. */
int32_t snare_midi_export(const uint8_t* velocities, int32_t roles,
                          const uint8_t* notes, double bpm,
                          double swing_percent, uint8_t* out,
                          int32_t capacity);
/* Tick of a step at SNARE_MIDI_PPQ, using the same timeline as playback. */
int32_t snare_midi_step_tick(int step_index, double swing_percent);

#ifdef __cplusplus
}
#endif

#endif /* BOOMBAPBOT_ENGINE_H */
