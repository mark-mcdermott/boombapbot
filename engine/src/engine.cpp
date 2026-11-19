// boombapbot render core: pattern bank, scheduler, sampler voices and mix.
//
// Nothing in the render path allocates, locks or does I/O. Control messages
// arrive through a wait-free queue and are applied at buffer boundaries.

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <vector>

#include "sequencer.h"
#include "boombapbot/engine.h"
#include "spsc_queue.h"
#include "fx.h"
#include "timeline.h"

namespace snare {
namespace {

constexpr int kSounds = SNARE_SOUNDS;
constexpr int kTracks = SNARE_TRACKS;
constexpr int kCommandCapacity = 1024;
// Replaced sounds waiting for the control thread to free them. A knob drag
// replaces one sound at a time, so this is sized for a long drag.
constexpr int kRetiredCapacity = 256;
constexpr int kMeasureLogCapacity = 255;
// A song crosses the command queue in pieces this long.
constexpr int kSongChunk = 48;

// A choked voice fades over this long instead of stopping dead.
constexpr double kChokeSeconds = 0.004;
// A stolen voice leaves a residual that ramps to zero over this long.
constexpr double kDeclickSeconds = 0.0015;
// A level or volume knob reaches its new setting over about this long.
constexpr double kSmoothSeconds = 0.006;
// A knob that has come this close to its setting is on it. Without this a
// level turned to zero would fade for ever, through ever smaller numbers.
constexpr float kSettled = 1e-5f;
// Level ramps are worked out this many frames at a time.
constexpr int kChunk = 128;
// Room for a few loud voices landing on one step before the limiter acts.
constexpr float kHeadroom = 0.9f;
// The meter reads the output averaged over about this long.
constexpr double kMeterSeconds = 0.3;
// Below this the meter reads nothing, and stops decaying into tiny numbers.
constexpr float kQuiet = 1e-12f;

constexpr int kMaxSampleFrames = 192000 * 30;

constexpr double kPi = 3.14159265358979323846;

}  // namespace
}  // namespace snare

// One sound's samples. It is built on a control thread, handed to an engine
// slot, and freed on the control thread once no voice is still reading it.
struct SnareSound {
  std::vector<float> pcm;  // interleaved
  int frames = 0;
  int channels = 0;
  double sampleRate = 0.0;
  // Voices still reading these samples. Written by the audio thread.
  std::atomic<int> liveVoices{0};
};

namespace snare {
namespace {

enum class CommandType : std::int32_t {
  SetTempo,
  SetTrack,
  SetTrackLevel,
  SetAccent,
  SetMasterVolume,
  SetEffect,
  SetPattern,
  SetStep,
  CuePattern,
  SetPanel,
  ArmFill,
  SongBegin,
  SongChunk,
  SongCommit,
  Play,
  Stop,
  Trigger
};

struct Command {
  CommandType type{};
  std::int32_t a = 0;
  std::int32_t b = 0;
  std::int32_t c = 0;
  double value = 0.0;
  double value2 = 0.0;
  SnarePattern pattern{};
  SnarePanel panel{};
  std::uint8_t bytes[kSongChunk]{};
};

// How an instrument track plays. Audio thread only.
struct Track {
  int slot = -1;
  float pan = 0.0f;
  int chokeGroup = 0;
  float level = 1.0f;        // where the level knob is heading
  float smoothed = 1.0f;     // where it is now
  bool levelSet = false;     // the first setting is taken at once, not faded to
};

struct Voice {
  bool active = false;
  SnareSound* sound = nullptr;
  int track = 0;
  double position = 0.0;   // in source frames
  double increment = 1.0;  // source frames per output frame
  float gainLeft = 0.0f;
  float gainRight = 0.0f;
  float envelope = 1.0f;
  float envelopeStep = 0.0f;  // > 0 while fading out after a choke
  int chokeGroup = 0;
  std::uint64_t order = 0;  // start order, for deterministic stealing
  float lastLeft = 0.0f;
  float lastRight = 0.0f;
};

// One frame of a knob moving toward where it was turned to.
inline float approach(float value, float target, float coefficient) {
  const float next = value + (target - value) * coefficient;
  return std::fabs(target - next) < kSettled ? target : next;
}

// Keeps peaks inside [-1, 1] without touching ordinary levels.
inline float softLimit(float x) {
  constexpr float knee = 0.8f;
  const float magnitude = std::fabs(x);
  if (magnitude <= knee) return x;
  const float over = (magnitude - knee) / (1.0f - knee);
  const float shaped = knee + (1.0f - knee) * std::tanh(over);
  return x < 0.0f ? -shaped : shaped;
}

inline bool validPattern(const SnarePattern& pattern) {
  return validShape(pattern.len1, pattern.len2, pattern.steps_per_beat) && pattern.swing <= SNARE_SWING_MAX;
}

}  // namespace
}  // namespace snare

struct SnareEngine {
  explicit SnareEngine(double rate) : sampleRate(rate), effect(rate) {
    chokeStep = static_cast<float>(1.0 / std::max(1.0, snare::kChokeSeconds * rate));
    declickFrames = std::max(1, static_cast<int>(snare::kDeclickSeconds * rate));
    smoothing = static_cast<float>(1.0 - std::exp(-1.0 / (snare::kSmoothSeconds * rate)));
    meterCoefficient = static_cast<float>(1.0 - std::exp(-1.0 / (snare::kMeterSeconds * rate)));
    for (SnarePattern& empty : bank) {
      empty.len1 = SNARE_PART_STEPS;
      empty.steps_per_beat = 4;
    }
    for (int track = 1; track < snare::kTracks; ++track) tracks[track].slot = track - 1;
    latchShape();
    updateTempo();
  }

  // ---- shared ------------------------------------------------------------
  const double sampleRate;
  snare::SpscQueue<snare::Command, snare::kCommandCapacity> commands;
  // A sound staged for each slot, and which slots have one or are to be
  // emptied. The audio thread takes them at the next buffer boundary.
  std::atomic<SnareSound*> pendingSound[SNARE_SOUNDS]{};
  std::atomic<std::uint32_t> stagedSlots{0};
  std::atomic<std::uint32_t> clearedSlots{0};
  snare::SpscQueue<SnareSound*, snare::kRetiredCapacity> retired;
  snare::SpscQueue<SnareMeasure, snare::kMeasureLogCapacity> measureLog;

  std::atomic<int> playingFlag{0};
  std::atomic<int> currentStep{-1};
  std::atomic<int> currentPattern{0};
  std::atomic<int> currentMeasure{0};
  std::atomic<double> framesRendered{0.0};
  std::atomic<double> stopFrame{-1.0};
  std::atomic<int> activeVoices{0};
  std::atomic<std::uint32_t> stolenVoices{0};
  std::atomic<float> outputMeanSquare{0.0f};

  // ---- control thread ----------------------------------------------------
  std::vector<SnareSound*> draining;  // replaced sounds that still have tails

  // ---- audio thread ------------------------------------------------------
  SnareSound* sounds[SNARE_SOUNDS]{};
  snare::Track tracks[SNARE_TRACKS];
  SnarePattern bank[SNARE_PATTERNS]{};
  snare::Voice voices[SNARE_MAX_VOICES];
  std::uint64_t voiceCounter = 0;
  float chokeStep = 0.0f;
  float smoothing = 1.0f;
  float plainGain = 1.0f;
  float accentGain = 1.0f;
  float masterVolume = 1.0f;
  float masterSmoothed = 1.0f;
  bool masterSet = false;
  snare::Effect effect;
  float meterCoefficient = 1.0f;
  float meanSquare = 0.0f;
  float levelRamp[SNARE_TRACKS][snare::kChunk];

  double bpm = 120.0;
  double tickFrames = 0.0;

  bool playing = false;
  std::int64_t frame = 0;        // absolute frame at the start of this buffer
  std::int64_t anchorFrame = 0;  // frame where anchorTick applies
  double anchorTick = 0.0;       // position there; whole unless the tempo changed
  int pattern = 0;               // pattern playing
  int cued = -1;                 // pattern to loop from the next measure
  bool followPanel = false;      // the panel, not a cued pattern, says what plays
  SnarePanel panel{};
  snare::Sequencer sequencer;
  int measureKind = SNARE_MEASURE_BASIC;
  bool takeoverDue = false;      // a rhythm chosen in the first beat waits for the second
  std::uint8_t song[SNARE_SONG_MEASURES]{};    // the rhythm of each measure
  std::uint8_t arriving[SNARE_SONG_MEASURES]{};  // a song crossing the queue piece by piece
  int songCount = 0;
  int arrivingCount = 0;
  bool arrivingLoop = false;
  bool songLoop = false;
  int songNext = 0;              // the song measure the next bar line begins
  int songPosition = -1;         // the song measure playing
  bool songOverridden = false;   // a rhythm chosen on the panel has taken the song's place
  std::int64_t measureTick = 0;  // where the measure playing began
  int measureFirst = SNARE_PART_STEPS;  // steps in its 1st part, its length and
  int measureSteps = SNARE_PART_STEPS;  // its step size, all fixed for the
  int measureStepTicks = 6;             // measure when it began
  int measureStepsPerBeat = 4;
  int measureSwing = 0;
  int nextStep = 0;              // steps played so far; measureSteps is the bar line
  std::int64_t nextEventFrame = 0;
  std::int64_t measures = 0;     // measures started since play
  std::int64_t measureLimit = 0; // stop when this many have ended; 0 plays on

  // De-click residual left behind by stolen voices.
  float residualLeft = 0.0f;
  float residualRight = 0.0f;
  int residualRemaining = 0;
  int declickFrames = 1;

  // Event log. Allocated on the control thread before rendering.
  std::unique_ptr<SnareEvent[]> events;
  int eventCapacity = 0;
  std::atomic<int> eventCount{0};

  void updateTempo() {
    tickFrames = snare::framesPerTick(bpm, sampleRate);
    effect.setTempo(snare::clampBpm(bpm));
  }

  std::int64_t tickToFrame(std::int64_t tick) const {
    return anchorFrame + snare::roundFrame((static_cast<double>(tick) - anchorTick) * tickFrames);
  }

  // The next step, late by its swing, or the bar line, which never swings.
  void scheduleNextEvent() {
    const std::int64_t tick = measureTick + static_cast<std::int64_t>(nextStep) * measureStepTicks;
    const double late = nextStep < measureSteps
                            ? snare::swingTicks(nextStep, measureStepTicks, measureStepsPerBeat, measureSwing)
                            : 0.0;
    nextEventFrame = anchorFrame + snare::roundFrame((static_cast<double>(tick) + late - anchorTick) * tickFrames);
  }

  // Moves the anchor to `at` so a tempo change does not shift past events.
  void reanchor(std::int64_t at) {
    if (tickFrames > 0.0) anchorTick += static_cast<double>(at - anchorFrame) / tickFrames;
    anchorFrame = at;
  }

  // Fixes the playing pattern's length and step size for the measure ahead.
  void latchShape() {
    const SnarePattern& shape = bank[pattern];
    measureFirst = shape.len1;
    measureSteps = shape.len1 + shape.len2;
    measureStepTicks = snare::stepTicks(shape.steps_per_beat);
    measureStepsPerBeat = shape.steps_per_beat;
    measureSwing = shape.swing;
  }

  std::int64_t measureTicks() const { return static_cast<std::int64_t>(measureSteps) * measureStepTicks; }

  // The measure log is for the control thread; a full one drops the entry.
  void logMeasure() {
    measureLog.push(SnareMeasure{static_cast<double>(tickToFrame(measureTick)), static_cast<std::int32_t>(measures),
                                 pattern, measureKind, songPosition});
    currentPattern.store(pattern, std::memory_order_relaxed);
  }

  void beginMeasure() {
    measureKind = SNARE_MEASURE_BASIC;
    songPosition = -1;
    if (followPanel) {
      int songRhythm = -1;
      if (songCount > 0) {
        songPosition = songNext++;
        songRhythm = songOverridden ? panel.rhythm : song[songPosition];
      }
      const snare::MeasureChoice choice = sequencer.next(panel, songRhythm);
      pattern = choice.pattern;
      measureKind = choice.kind;
    } else if (cued >= 0) {
      pattern = cued;
      cued = -1;
    }
    takeoverDue = false;
    latchShape();
    nextStep = 0;
    ++measures;
    currentMeasure.store(static_cast<int>(measures), std::memory_order_relaxed);
    logMeasure();
  }

  // Whether the frame now being rendered is inside the first beat of the measure playing.
  bool inFirstBeat() const {
    if (!playing || tickFrames <= 0.0) return false;
    const double tick = anchorTick + static_cast<double>(frame - anchorFrame) / tickFrames;
    return tick - static_cast<double>(measureTick) < SNARE_TICKS_PER_BEAT;
  }

  // The second beat of a measure whose rhythm was changed during the first:
  // the new rhythm carries on from its own second beat. A rhythm no longer
  // than a beat has no second beat, so it waits for the bar line.
  void takeOver() {
    takeoverDue = false;
    const int incoming = sequencer.takeover(panel);
    const SnarePattern& shape = bank[incoming];
    const int ticks = (shape.len1 + shape.len2) * snare::stepTicks(shape.steps_per_beat);
    if (incoming == pattern || ticks <= SNARE_TICKS_PER_BEAT) return;
    pattern = incoming;
    latchShape();
    nextStep = SNARE_TICKS_PER_BEAT / measureStepTicks;
    logMeasure();
    scheduleNextEvent();
  }

  bool takeoverNow() const {
    return takeoverDue && static_cast<std::int64_t>(nextStep) * measureStepTicks >= SNARE_TICKS_PER_BEAT &&
           measureTicks() > SNARE_TICKS_PER_BEAT;
  }

  void halt(std::int64_t at, bool bounded) {
    playing = false;
    currentStep.store(-1, std::memory_order_relaxed);
    currentMeasure.store(0, std::memory_order_relaxed);
    if (bounded) stopFrame.store(static_cast<double>(at), std::memory_order_relaxed);
  }

  void logEvent(std::int64_t at, int step, int track, bool accent, int playingPattern) {
    if (!events) return;
    const int index = eventCount.load(std::memory_order_relaxed);
    if (index >= eventCapacity) return;
    events[index] = SnareEvent{static_cast<double>(at), step, track, accent ? 1 : 0, playingPattern};
    eventCount.store(index + 1, std::memory_order_release);
  }

  void releaseVoice(snare::Voice& voice) {
    if (!voice.active) return;
    voice.active = false;
    if (voice.sound) voice.sound->liveVoices.fetch_sub(1, std::memory_order_release);
    voice.sound = nullptr;
  }

  // Takes staged sounds at the buffer boundary. A replaced sound goes to the
  // control thread to be freed once its tails end; if that hand-off queue is
  // full the slot waits for snare_engine_collect. Nothing is freed here.
  void takeStagedSounds() {
    if (stagedSlots.load(std::memory_order_acquire) == 0 &&
        clearedSlots.load(std::memory_order_acquire) == 0) {
      return;
    }
    const std::uint32_t staged = stagedSlots.exchange(0, std::memory_order_acq_rel);
    const std::uint32_t cleared = clearedSlots.exchange(0, std::memory_order_acq_rel);
    std::uint32_t waiting = 0;
    for (int index = 0; index < snare::kSounds; ++index) {
      const std::uint32_t bit = 1u << index;
      if (((staged | cleared) & bit) == 0) continue;
      if (sounds[index] && retired.full()) {
        waiting |= bit;
        continue;
      }
      SnareSound* incoming = pendingSound[index].exchange(nullptr, std::memory_order_acq_rel);
      if (!incoming && (cleared & bit) == 0) continue;
      if (sounds[index]) retired.push(sounds[index]);
      sounds[index] = incoming;
    }
    if (waiting != 0) {
      stagedSlots.fetch_or(waiting & staged, std::memory_order_release);
      clearedSlots.fetch_or(waiting & cleared, std::memory_order_release);
    }
  }

  // Picks a free voice, or steals one: a voice that is already fading first,
  // otherwise the oldest. The choice depends only on engine state.
  snare::Voice& allocateVoice() {
    snare::Voice* victim = nullptr;
    for (auto& voice : voices) {
      if (!voice.active) return voice;
      if (!victim) {
        victim = &voice;
        continue;
      }
      const bool voiceFading = voice.envelopeStep > 0.0f;
      const bool victimFading = victim->envelopeStep > 0.0f;
      if (voiceFading != victimFading) {
        if (voiceFading) victim = &voice;
      } else if (voiceFading) {
        if (voice.envelope < victim->envelope) victim = &voice;
      } else if (voice.order < victim->order) {
        victim = &voice;
      }
    }
    // Carry the stolen voice's last output into the de-click ramp.
    const float scale = residualRemaining > 0
                            ? static_cast<float>(residualRemaining) /
                                  static_cast<float>(declickFrames)
                            : 0.0f;
    residualLeft = residualLeft * scale + victim->lastLeft;
    residualRight = residualRight * scale + victim->lastRight;
    residualRemaining = declickFrames;
    stolenVoices.fetch_add(1, std::memory_order_relaxed);
    releaseVoice(*victim);
    return *victim;
  }

  // One hit of an instrument track. As on the machine, a track has one voice:
  // its new hit fades the old one, and so does a hit in its choke group.
  void startHit(int trackIndex, bool accent) {
    if (trackIndex < 1 || trackIndex >= snare::kTracks) return;
    const snare::Track& track = tracks[trackIndex];
    if (track.slot < 0 || track.slot >= snare::kSounds) return;
    SnareSound* sound = sounds[track.slot];
    if (!sound || sound->frames <= 0) return;

    for (auto& voice : voices) {
      if (!voice.active || voice.envelopeStep != 0.0f) continue;
      if (voice.track == trackIndex ||
          (track.chokeGroup != 0 && voice.chokeGroup == track.chokeGroup)) {
        voice.envelopeStep = chokeStep;
      }
    }

    snare::Voice& voice = allocateVoice();
    const double angle = (static_cast<double>(track.pan) + 1.0) * snare::kPi / 4.0;
    const float amplitude = accent ? accentGain : plainGain;
    voice.active = true;
    voice.sound = sound;
    voice.track = trackIndex;
    voice.position = 0.0;
    voice.increment = sound->sampleRate / sampleRate;
    // Centre is unity on both sides; the edges keep constant power.
    voice.gainLeft = amplitude * static_cast<float>(std::cos(angle) * std::sqrt(2.0));
    voice.gainRight = amplitude * static_cast<float>(std::sin(angle) * std::sqrt(2.0));
    voice.envelope = 1.0f;
    voice.envelopeStep = 0.0f;
    voice.chokeGroup = track.chokeGroup;
    voice.order = ++voiceCounter;
    voice.lastLeft = 0.0f;
    voice.lastRight = 0.0f;
    sound->liveVoices.fetch_add(1, std::memory_order_relaxed);
  }

  void fireStep(std::int64_t at) {
    const SnarePattern& playingPattern = bank[pattern];
    // The 2nd part has its own sixteen steps, whatever the 1st part's length.
    const int step = snare::stepPosition(nextStep, measureFirst);
    const std::uint32_t bit = 1u << step;
    const bool accent = (playingPattern.rows[0] & bit) != 0;
    for (int track = 1; track < snare::kTracks; ++track) {
      if ((playingPattern.rows[track] & bit) == 0) continue;
      logEvent(at, step, track, accent, pattern);
      startHit(track, accent);
    }
    currentStep.store(step, std::memory_order_relaxed);
    ++nextStep;
    scheduleNextEvent();
  }

  // The bar line: the measure that was playing has ended.
  void endMeasure(std::int64_t at) {
    const bool songOver = followPanel && songCount > 0 && songNext >= songCount;
    if ((measureLimit > 0 && measures >= measureLimit) || (songOver && !songLoop)) {
      // The bar line itself, which may be earlier than the frame being rendered.
      halt(std::min(at, nextEventFrame), true);
      return;
    }
    if (songOver) songNext = 0;
    measureTick += measureTicks();
    beginMeasure();
    scheduleNextEvent();
  }

  void apply(const snare::Command& command) {
    using snare::CommandType;
    switch (command.type) {
      case CommandType::SetTempo:
        if (snare::clampBpm(command.value) == bpm) break;
        reanchor(frame);
        bpm = snare::clampBpm(command.value);
        updateTempo();
        scheduleNextEvent();
        break;
      case CommandType::SetTrack:
        tracks[command.a].slot = command.b;
        tracks[command.a].chokeGroup = command.c;
        tracks[command.a].pan = static_cast<float>(command.value);
        break;
      case CommandType::SetTrackLevel: {
        snare::Track& track = tracks[command.a];
        track.level = static_cast<float>(command.value);
        if (!track.levelSet) track.smoothed = track.level;
        track.levelSet = true;
        break;
      }
      case CommandType::SetAccent:
        plainGain = static_cast<float>(command.value);
        accentGain = static_cast<float>(command.value2);
        break;
      case CommandType::SetMasterVolume:
        masterVolume = static_cast<float>(command.value);
        if (!masterSet) masterSmoothed = masterVolume;
        masterSet = true;
        break;
      case CommandType::SetEffect:
        effect.set(command.a, static_cast<float>(command.value));
        break;
      case CommandType::SetPattern:
        bank[command.a] = command.pattern;
        // Stopped, a new shape is taken at once. Playing, it waits for the
        // bar line, so the measure that is sounding keeps its length.
        if (!playing && command.a == pattern) latchShape();
        break;
      case CommandType::SetStep: {
        std::uint32_t& row = bank[command.a].rows[command.b];
        const std::uint32_t bit = 1u << command.c;
        row = command.value != 0.0 ? (row | bit) : (row & ~bit);
        break;
      }
      case CommandType::SetPanel:
        // A new rhythm chosen while the first beat of a basic measure plays
        // starts on the second beat. Anything else waits for the bar line.
        if (followPanel && command.panel.rhythm != panel.rhythm) {
          takeoverDue = command.panel.first_beat_rule != 0 && measureKind == SNARE_MEASURE_BASIC &&
                        (takeoverDue || inFirstBeat());
        }
        // Chosen while a song plays, a rhythm takes the song's place from here on.
        if (playing && followPanel && songCount > 0 && command.panel.rhythm != panel.rhythm) songOverridden = true;
        panel = command.panel;
        followPanel = true;
        cued = -1;
        if (!playing) {
          pattern = snare::patternOf(panel.rhythm, panel.variation == SNARE_VARIATION_B ? 1 : 0);
          latchShape();
          currentPattern.store(pattern, std::memory_order_relaxed);
        }
        break;
      case CommandType::ArmFill:
        sequencer.armFill(command.a != 0);
        break;
      case CommandType::SongBegin:
        arrivingCount = command.a;
        arrivingLoop = command.b != 0;
        break;
      case CommandType::SongChunk:
        std::memcpy(arriving + command.a, command.bytes, static_cast<std::size_t>(command.b));
        break;
      case CommandType::SongCommit:
        std::memcpy(song, arriving, static_cast<std::size_t>(arrivingCount));
        songCount = arrivingCount;
        songLoop = arrivingLoop;
        // A song that got shorter while playing ends at the next bar line.
        songNext = std::min(songNext, songCount);
        break;
      case CommandType::CuePattern:
        followPanel = false;
        takeoverDue = false;
        cued = command.a;
        if (!playing) {
          pattern = cued;
          cued = -1;
          latchShape();
          currentPattern.store(pattern, std::memory_order_relaxed);
        }
        break;
      case CommandType::Play:
        playing = true;
        anchorFrame = frame;
        anchorTick = 0.0;
        measureTick = 0;
        measures = 0;
        measureLimit = command.a;
        stopFrame.store(-1.0, std::memory_order_relaxed);
        songNext = 0;
        songOverridden = false;
        sequencer.start();
        beginMeasure();
        scheduleNextEvent();
        break;
      case CommandType::Stop:
        halt(frame, false);
        break;
      case CommandType::Trigger:
        logEvent(frame, -1, command.a, command.b != 0, -1);
        startHit(command.a, command.b != 0);
        break;
    }
  }

  // Where each track's level knob is, frame by frame, for the chunk ahead.
  // It moves the same way however the buffer is cut up.
  void rampLevels(int count) {
    for (int trackIndex = 1; trackIndex < snare::kTracks; ++trackIndex) {
      snare::Track& track = tracks[trackIndex];
      float value = track.smoothed;
      const float target = track.level;
      float* ramp = levelRamp[trackIndex];
      for (int i = 0; i < count; ++i) {
        value = snare::approach(value, target, smoothing);
        ramp[i] = value;
      }
      track.smoothed = value;
    }
  }

  void renderVoiceChunk(float* left, float* right, int from, int to) {
    rampLevels(to - from);
    for (auto& voice : voices) {
      if (!voice.active) continue;
      const SnareSound& source = *voice.sound;
      const float* pcm = source.pcm.data();
      const float* level = levelRamp[voice.track];
      const int frames = source.frames;
      const bool stereo = source.channels == 2;
      double position = voice.position;
      float envelope = voice.envelope;
      bool finished = false;

      for (int i = from; i < to; ++i) {
        const int index = static_cast<int>(position);
        if (index >= frames) {
          finished = true;
          break;
        }
        const float fraction = static_cast<float>(position - index);
        const int next = index + 1 < frames ? index + 1 : index;
        float sampleLeft;
        float sampleRight;
        if (stereo) {
          const float l0 = pcm[index * 2];
          const float r0 = pcm[index * 2 + 1];
          const float l1 = index + 1 < frames ? pcm[next * 2] : 0.0f;
          const float r1 = index + 1 < frames ? pcm[next * 2 + 1] : 0.0f;
          sampleLeft = l0 + (l1 - l0) * fraction;
          sampleRight = r0 + (r1 - r0) * fraction;
        } else {
          const float s0 = pcm[index];
          const float s1 = index + 1 < frames ? pcm[next] : 0.0f;
          sampleLeft = sampleRight = s0 + (s1 - s0) * fraction;
        }
        const float gain = envelope * level[i - from];
        const float outLeft = sampleLeft * voice.gainLeft * gain;
        const float outRight = sampleRight * voice.gainRight * gain;
        left[i] += outLeft;
        right[i] += outRight;
        voice.lastLeft = outLeft;
        voice.lastRight = outRight;
        position += voice.increment;
        if (voice.envelopeStep > 0.0f) {
          envelope -= voice.envelopeStep;
          if (envelope <= 0.0f) {
            // Faded to silence; nothing left to de-click.
            voice.lastLeft = 0.0f;
            voice.lastRight = 0.0f;
            finished = true;
            break;
          }
        }
      }

      voice.position = position;
      voice.envelope = envelope;
      if (finished || static_cast<int>(position) >= frames) releaseVoice(voice);
    }

    if (residualRemaining > 0) {
      for (int i = from; i < to && residualRemaining > 0; ++i) {
        const float scale = static_cast<float>(residualRemaining) /
                            static_cast<float>(declickFrames);
        left[i] += residualLeft * scale;
        right[i] += residualRight * scale;
        --residualRemaining;
      }
    }
  }

  void renderVoices(float* left, float* right, int from, int to) {
    for (int start = from; start < to; start += snare::kChunk) {
      renderVoiceChunk(left, right, start, std::min(to, start + snare::kChunk));
    }
  }

  void render(float* left, float* right, int frames) {
    takeStagedSounds();

    // Commands queued after a sound was staged see that sound.
    snare::Command command;
    while (commands.pop(command)) apply(command);

    if (frames <= 0) return;
    std::fill(left, left + frames, 0.0f);
    std::fill(right, right + frames, 0.0f);

    int offset = 0;
    while (offset < frames) {
      int segmentEnd = frames;
      if (playing) {
        const std::int64_t now = frame + offset;
        while (playing && nextEventFrame <= now) {
          if (takeoverNow()) {
            takeOver();
          } else if (nextStep >= measureSteps) {
            endMeasure(now);
          } else {
            fireStep(now);
          }
        }
        if (playing && nextEventFrame < frame + frames) {
          segmentEnd = static_cast<int>(nextEventFrame - frame);
        }
      }
      renderVoices(left, right, offset, segmentEnd);
      offset = segmentEnd;
    }

    effect.process(left, right, frames, smoothing);

    for (int i = 0; i < frames; ++i) {
      masterSmoothed = snare::approach(masterSmoothed, masterVolume, smoothing);
      left[i] = snare::softLimit(left[i] * snare::kHeadroom) * masterSmoothed;
      right[i] = snare::softLimit(right[i] * snare::kHeadroom) * masterSmoothed;
      meanSquare += (0.5f * (left[i] * left[i] + right[i] * right[i]) - meanSquare) * meterCoefficient;
    }
    if (meanSquare < snare::kQuiet) meanSquare = 0.0f;
    outputMeanSquare.store(meanSquare, std::memory_order_relaxed);

    frame += frames;
    int active = 0;
    for (const auto& voice : voices) active += voice.active ? 1 : 0;
    activeVoices.store(active, std::memory_order_relaxed);
    playingFlag.store(playing ? 1 : 0, std::memory_order_relaxed);
    framesRendered.store(static_cast<double>(frame), std::memory_order_relaxed);
  }

  int enqueue(const snare::Command& command) {
    return commands.push(command) ? SNARE_OK : SNARE_ERR_QUEUE_FULL;
  }
};

// ---------------------------------------------------------------------------
// C ABI
// ---------------------------------------------------------------------------

extern "C" {

uint32_t snare_abi_version(void) { return SNARE_ABI_VERSION; }

int32_t snare_step_ticks(int32_t steps_per_beat) { return snare::stepTicks(steps_per_beat); }

int32_t snare_pattern_ticks(const SnarePattern* pattern) {
  if (!pattern || !snare::validPattern(*pattern)) return SNARE_ERR_BAD_ARGUMENT;
  return (pattern->len1 + pattern->len2) * snare::stepTicks(pattern->steps_per_beat);
}

double snare_frames_per_tick(double bpm, double sample_rate) {
  return snare::framesPerTick(bpm, sample_rate);
}

double snare_tick_frame(double ticks, double bpm, double sample_rate) {
  return static_cast<double>(snare::roundFrame(ticks * snare::framesPerTick(bpm, sample_rate)));
}

namespace {

bool validSoundShape(int32_t frames, int32_t channels, double sample_rate) {
  return (channels == 1 || channels == 2) && frames >= 0 && frames <= snare::kMaxSampleFrames &&
         sample_rate >= 8000.0 && sample_rate <= 192000.0;
}

bool validTrack(int32_t track) { return track >= 1 && track < SNARE_TRACKS; }

bool validPatternIndex(int32_t index) { return index >= 0 && index < SNARE_PATTERNS; }

void stageSound(SnareEngine* engine, int32_t slot, SnareSound* sound) {
  const std::uint32_t bit = 1u << slot;
  // A sound that was staged but never picked up is replaced before it sounds.
  delete engine->pendingSound[slot].exchange(sound, std::memory_order_acq_rel);
  if (sound) {
    engine->clearedSlots.fetch_and(~bit, std::memory_order_release);
    engine->stagedSlots.fetch_or(bit, std::memory_order_release);
  } else {
    engine->clearedSlots.fetch_or(bit, std::memory_order_release);
  }
}

}  // namespace

SnareSound* snare_sound_create(int32_t frames, int32_t channels, double sample_rate) {
  if (!validSoundShape(frames, channels, sample_rate)) return nullptr;
  auto* sound = new SnareSound();
  sound->pcm.assign(static_cast<std::size_t>(frames) * channels, 0.0f);
  sound->frames = frames;
  sound->channels = channels;
  sound->sampleRate = sample_rate;
  return sound;
}

float* snare_sound_data(SnareSound* sound) { return sound ? sound->pcm.data() : nullptr; }

void snare_sound_destroy(SnareSound* sound) { delete sound; }

SnareEngine* snare_engine_create(double sample_rate) {
  if (!(sample_rate >= 8000.0 && sample_rate <= 192000.0)) return nullptr;
  return new SnareEngine(sample_rate);
}

void snare_engine_destroy(SnareEngine* engine) {
  if (!engine) return;
  SnareSound* retiredSound = nullptr;
  while (engine->retired.pop(retiredSound)) delete retiredSound;
  for (SnareSound* sound : engine->draining) delete sound;
  for (auto& pending : engine->pendingSound) delete pending.exchange(nullptr);
  for (SnareSound* sound : engine->sounds) delete sound;
  delete engine;
}

int32_t snare_engine_set_sound(SnareEngine* engine, int32_t slot, SnareSound* sound) {
  if (!engine || slot < 0 || slot >= SNARE_SOUNDS) return SNARE_ERR_BAD_ARGUMENT;
  stageSound(engine, slot, sound);
  // Each new sound retires one, so free what has finished ringing as we go.
  snare_engine_collect(engine);
  return SNARE_OK;
}

int32_t snare_engine_synth_sound(SnareEngine* engine, const SnareSoundParams* params) {
  if (!engine || !params) return SNARE_ERR_BAD_ARGUMENT;
  const int32_t frames = snare_synth_frames(params, engine->sampleRate);
  if (frames < 0) return frames;
  SnareSound* sound = snare_sound_create(frames, 1, engine->sampleRate);
  snare_synth_render(params, engine->sampleRate, snare_sound_data(sound), frames);
  return snare_engine_set_sound(engine, params->sound, sound);
}

int32_t snare_engine_collect(SnareEngine* engine) {
  if (!engine) return 0;
  SnareSound* retiredSound = nullptr;
  while (engine->retired.pop(retiredSound)) engine->draining.push_back(retiredSound);
  auto& draining = engine->draining;
  for (auto it = draining.begin(); it != draining.end();) {
    if ((*it)->liveVoices.load(std::memory_order_acquire) == 0) {
      delete *it;
      it = draining.erase(it);
    } else {
      ++it;
    }
  }
  return static_cast<int32_t>(draining.size());
}

int32_t snare_engine_set_tempo(SnareEngine* engine, double bpm) {
  if (!engine || !(bpm > 0.0)) return SNARE_ERR_BAD_ARGUMENT;
  snare::Command command;
  command.type = snare::CommandType::SetTempo;
  command.value = bpm;
  return engine->enqueue(command);
}

int32_t snare_engine_set_track(SnareEngine* engine, int32_t track, int32_t slot, float pan,
                               int32_t choke_group) {
  if (!engine || !validTrack(track) || slot < 0 || slot >= SNARE_SOUNDS || !(pan >= -1.0f && pan <= 1.0f) ||
      choke_group < 0) {
    return SNARE_ERR_BAD_ARGUMENT;
  }
  snare::Command command;
  command.type = snare::CommandType::SetTrack;
  command.a = track;
  command.b = slot;
  command.c = choke_group;
  command.value = static_cast<double>(pan);
  return engine->enqueue(command);
}

int32_t snare_engine_set_track_level(SnareEngine* engine, int32_t track, double gain) {
  if (!engine || !validTrack(track) || !(gain >= 0.0 && gain <= 4.0)) return SNARE_ERR_BAD_ARGUMENT;
  snare::Command command;
  command.type = snare::CommandType::SetTrackLevel;
  command.a = track;
  command.value = gain;
  return engine->enqueue(command);
}

int32_t snare_engine_set_accent(SnareEngine* engine, double plain_gain, double accent_gain) {
  if (!engine || !(plain_gain >= 0.0 && plain_gain <= 4.0) || !(accent_gain >= 0.0 && accent_gain <= 4.0)) {
    return SNARE_ERR_BAD_ARGUMENT;
  }
  snare::Command command;
  command.type = snare::CommandType::SetAccent;
  command.value = plain_gain;
  command.value2 = accent_gain;
  return engine->enqueue(command);
}

int32_t snare_engine_set_master_volume(SnareEngine* engine, double volume) {
  if (!engine || !(volume >= 0.0 && volume <= 1.0)) return SNARE_ERR_BAD_ARGUMENT;
  snare::Command command;
  command.type = snare::CommandType::SetMasterVolume;
  command.value = volume;
  return engine->enqueue(command);
}

int32_t snare_engine_set_effect(SnareEngine* engine, int32_t effect, double wet) {
  if (!engine || effect < SNARE_EFFECT_NONE || effect > SNARE_EFFECT_LAST || !(wet >= 0.0 && wet <= 1.0)) {
    return SNARE_ERR_BAD_ARGUMENT;
  }
  snare::Command command;
  command.type = snare::CommandType::SetEffect;
  command.a = effect;
  command.value = wet;
  return engine->enqueue(command);
}

double snare_effect_tail_seconds(int32_t effect, double bpm) { return snare::effectTailSeconds(effect, bpm); }

int32_t snare_engine_set_pattern(SnareEngine* engine, int32_t index, const SnarePattern* pattern) {
  if (!engine || !pattern || !validPatternIndex(index) || !snare::validPattern(*pattern)) {
    return SNARE_ERR_BAD_ARGUMENT;
  }
  snare::Command command;
  command.type = snare::CommandType::SetPattern;
  command.a = index;
  command.pattern = *pattern;
  return engine->enqueue(command);
}

int32_t snare_engine_set_step(SnareEngine* engine, int32_t pattern, int32_t track, int32_t step,
                              int32_t on) {
  if (!engine || !validPatternIndex(pattern) || track < 0 || track >= SNARE_TRACKS || step < 0 ||
      step >= SNARE_MAX_STEPS) {
    return SNARE_ERR_BAD_ARGUMENT;
  }
  snare::Command command;
  command.type = snare::CommandType::SetStep;
  command.a = pattern;
  command.b = track;
  command.c = step;
  command.value = on != 0 ? 1.0 : 0.0;
  return engine->enqueue(command);
}

int32_t snare_engine_cue_pattern(SnareEngine* engine, int32_t index) {
  if (!engine || !validPatternIndex(index)) return SNARE_ERR_BAD_ARGUMENT;
  snare::Command command;
  command.type = snare::CommandType::CuePattern;
  command.a = index;
  return engine->enqueue(command);
}

int32_t snare_engine_set_panel(SnareEngine* engine, const SnarePanel* panel) {
  if (!engine || !panel || !snare::validPanel(*panel)) return SNARE_ERR_BAD_ARGUMENT;
  snare::Command command;
  command.type = snare::CommandType::SetPanel;
  command.panel = *panel;
  return engine->enqueue(command);
}

namespace {

bool validSong(const uint8_t* rhythms, int32_t count) {
  if (count < 0 || count > SNARE_SONG_MEASURES || (count > 0 && !rhythms)) return false;
  for (int32_t i = 0; i < count; ++i) {
    if (rhythms[i] >= SNARE_RHYTHMS) return false;
  }
  return true;
}

}  // namespace

int32_t snare_engine_set_song(SnareEngine* engine, const uint8_t* rhythms, int32_t count, int32_t loop) {
  if (!engine || !validSong(rhythms, count)) return SNARE_ERR_BAD_ARGUMENT;
  snare::Command command;
  command.type = snare::CommandType::SongBegin;
  command.a = count;
  command.b = loop != 0 ? 1 : 0;
  // A song cut short by a full queue is never committed; the next call starts it again.
  if (engine->enqueue(command) != SNARE_OK) return SNARE_ERR_QUEUE_FULL;
  command.type = snare::CommandType::SongChunk;
  for (int32_t offset = 0; offset < count; offset += snare::kSongChunk) {
    command.a = offset;
    command.b = std::min<int32_t>(snare::kSongChunk, count - offset);
    std::memcpy(command.bytes, rhythms + offset, static_cast<std::size_t>(command.b));
    if (engine->enqueue(command) != SNARE_OK) return SNARE_ERR_QUEUE_FULL;
  }
  command.type = snare::CommandType::SongCommit;
  return engine->enqueue(command);
}

int32_t snare_song_patterns(const SnarePanel* panel, const uint8_t* rhythms, int32_t count, uint8_t* out) {
  if (!panel || !out || !snare::validPanel(*panel) || !validSong(rhythms, count)) return SNARE_ERR_BAD_ARGUMENT;
  snare::Sequencer sequencer;
  sequencer.start();
  for (int32_t i = 0; i < count; ++i) out[i] = static_cast<uint8_t>(sequencer.next(*panel, rhythms[i]).pattern);
  return count;
}

int32_t snare_engine_arm_fill(SnareEngine* engine, int32_t armed) {
  if (!engine) return SNARE_ERR_BAD_ARGUMENT;
  snare::Command command;
  command.type = snare::CommandType::ArmFill;
  command.a = armed != 0 ? 1 : 0;
  return engine->enqueue(command);
}

int32_t snare_engine_play(SnareEngine* engine) {
  if (!engine) return SNARE_ERR_BAD_ARGUMENT;
  snare::Command command;
  command.type = snare::CommandType::Play;
  return engine->enqueue(command);
}

int32_t snare_engine_play_measures(SnareEngine* engine, int32_t measures) {
  if (!engine || measures < 1 || measures > 1000000) return SNARE_ERR_BAD_ARGUMENT;
  snare::Command command;
  command.type = snare::CommandType::Play;
  command.a = measures;
  return engine->enqueue(command);
}

int32_t snare_engine_stop(SnareEngine* engine) {
  if (!engine) return SNARE_ERR_BAD_ARGUMENT;
  snare::Command command;
  command.type = snare::CommandType::Stop;
  return engine->enqueue(command);
}

int32_t snare_engine_trigger(SnareEngine* engine, int32_t track, int32_t accent) {
  if (!engine || !validTrack(track)) return SNARE_ERR_BAD_ARGUMENT;
  snare::Command command;
  command.type = snare::CommandType::Trigger;
  command.a = track;
  command.b = accent != 0 ? 1 : 0;
  return engine->enqueue(command);
}

void snare_engine_render(SnareEngine* engine, float* left, float* right,
                         int32_t frames) {
  if (!engine) return;
  engine->render(left, right, frames);
}

int32_t snare_engine_is_playing(const SnareEngine* engine) {
  return engine ? engine->playingFlag.load(std::memory_order_relaxed) : 0;
}

int32_t snare_engine_current_step(const SnareEngine* engine) {
  return engine ? engine->currentStep.load(std::memory_order_relaxed) : -1;
}

int32_t snare_engine_current_pattern(const SnareEngine* engine) {
  return engine ? engine->currentPattern.load(std::memory_order_relaxed) : 0;
}

int32_t snare_engine_current_measure(const SnareEngine* engine) {
  return engine ? engine->currentMeasure.load(std::memory_order_relaxed) : 0;
}

double snare_engine_frames_rendered(const SnareEngine* engine) {
  return engine ? engine->framesRendered.load(std::memory_order_relaxed) : 0.0;
}

double snare_engine_stop_frame(const SnareEngine* engine) {
  return engine ? engine->stopFrame.load(std::memory_order_relaxed) : -1.0;
}

int32_t snare_engine_active_voices(const SnareEngine* engine) {
  return engine ? engine->activeVoices.load(std::memory_order_relaxed) : 0;
}

uint32_t snare_engine_stolen_voices(const SnareEngine* engine) {
  return engine ? engine->stolenVoices.load(std::memory_order_relaxed) : 0;
}

double snare_engine_output_level(const SnareEngine* engine) {
  return engine ? std::sqrt(static_cast<double>(engine->outputMeanSquare.load(std::memory_order_relaxed))) : 0.0;
}

int32_t snare_engine_read_measures(SnareEngine* engine, SnareMeasure* out, int32_t max_measures) {
  if (!engine || !out || max_measures <= 0) return 0;
  int32_t count = 0;
  while (count < max_measures && engine->measureLog.pop(out[count])) ++count;
  return count;
}

int32_t snare_engine_enable_event_log(SnareEngine* engine, int32_t capacity) {
  if (!engine || capacity <= 0) return SNARE_ERR_BAD_ARGUMENT;
  engine->events = std::make_unique<SnareEvent[]>(static_cast<std::size_t>(capacity));
  engine->eventCapacity = capacity;
  engine->eventCount.store(0, std::memory_order_release);
  return SNARE_OK;
}

int32_t snare_engine_event_count(const SnareEngine* engine) {
  return engine ? engine->eventCount.load(std::memory_order_acquire) : 0;
}

int32_t snare_engine_read_events(const SnareEngine* engine, SnareEvent* out,
                                 int32_t max_events) {
  if (!engine || !out || max_events <= 0 || !engine->events) return 0;
  const int count =
      std::min(engine->eventCount.load(std::memory_order_acquire), max_events);
  std::memcpy(out, engine->events.get(), sizeof(SnareEvent) * static_cast<std::size_t>(count));
  return count;
}

}  // extern "C"
