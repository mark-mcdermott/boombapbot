// boombapbot render core: scheduler, sampler voices and mix.
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

#include "boombapbot/engine.h"
#include "spsc_queue.h"
#include "timeline.h"

namespace snare {
namespace {

constexpr int kMaxRoles = SNARE_MAX_ROLES;
constexpr int kSteps = SNARE_STEPS;
constexpr int kCommandCapacity = 1024;
// Replaced sounds waiting for the control thread to free them. A knob drag
// replaces one sound at a time, so this is sized for a long drag.
constexpr int kRetiredCapacity = 256;

// A choked voice fades over this long instead of stopping dead.
constexpr double kChokeSeconds = 0.004;
// A stolen voice leaves a residual that ramps to zero over this long.
constexpr double kDeclickSeconds = 0.0015;

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

// A set of sounds prepared together. Committing it fills every slot at once.
struct SnareKit {
  struct Entry {
    SnareSound* sound = nullptr;
    float gain = 1.0f;
    float pan = 0.0f;
    int chokeGroup = 0;
  };
  Entry entries[SNARE_MAX_ROLES];
  ~SnareKit() {
    for (Entry& entry : entries) delete entry.sound;
  }
};

namespace snare {
namespace {

enum class CommandType : std::int32_t {
  SetTempo,
  SetSwing,
  SetMasterGain,
  SetSlot,
  SetStep,
  SetRow,
  ClearPattern,
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
  std::uint8_t row[kSteps]{};
};

// What a sound slot plays, and how. Audio thread only.
struct Slot {
  SnareSound* sound = nullptr;
  float gain = 1.0f;
  float pan = 0.0f;
  int chokeGroup = 0;
};

struct Voice {
  bool active = false;
  SnareSound* sound = nullptr;
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

// Keeps peaks inside [-1, 1] without touching ordinary levels.
inline float softLimit(float x) {
  constexpr float knee = 0.8f;
  const float magnitude = std::fabs(x);
  if (magnitude <= knee) return x;
  const float over = (magnitude - knee) / (1.0f - knee);
  const float shaped = knee + (1.0f - knee) * std::tanh(over);
  return x < 0.0f ? -shaped : shaped;
}

}  // namespace
}  // namespace snare

struct SnareEngine {
  explicit SnareEngine(double rate) : sampleRate(rate) {
    for (int v = 0; v < 128; ++v) {
      velocityGain[v] =
          static_cast<float>(std::pow(static_cast<double>(v) / 127.0, 1.5));
    }
    chokeStep = static_cast<float>(1.0 / std::max(1.0, snare::kChokeSeconds * rate));
    declickFrames = std::max(1, static_cast<int>(snare::kDeclickSeconds * rate));
    updateTempo();
  }

  // ---- shared ------------------------------------------------------------
  const double sampleRate;
  snare::SpscQueue<snare::Command, snare::kCommandCapacity> commands;
  // A sound staged for each slot, and which slots have one or are to be
  // emptied. The audio thread takes them at the next buffer boundary.
  std::atomic<SnareSound*> pendingSound[SNARE_MAX_ROLES]{};
  std::atomic<std::uint32_t> stagedSlots{0};
  std::atomic<std::uint32_t> clearedSlots{0};
  snare::SpscQueue<SnareSound*, snare::kRetiredCapacity> retired;

  std::atomic<int> playingFlag{0};
  std::atomic<int> currentStep{-1};
  std::atomic<double> framesRendered{0.0};
  std::atomic<int> activeVoices{0};
  std::atomic<std::uint32_t> stolenVoices{0};

  // ---- control thread ----------------------------------------------------
  std::vector<SnareSound*> draining;  // replaced sounds that still have tails

  // ---- audio thread ------------------------------------------------------
  snare::Slot slots[SNARE_MAX_ROLES];
  std::uint8_t pattern[SNARE_MAX_ROLES][SNARE_STEPS]{};
  snare::Voice voices[SNARE_MAX_VOICES];
  std::uint64_t voiceCounter = 0;
  float velocityGain[128]{};
  float chokeStep = 0.0f;

  double bpm = 120.0;
  double swing = 50.0;
  double stepFrames = 0.0;
  // Leaves headroom for a few loud voices landing on the same step before
  // the soft limiter starts to act.
  float masterGain = 0.6f;

  bool playing = false;
  std::int64_t frame = 0;        // absolute frame at the start of this buffer
  std::int64_t anchorFrame = 0;  // frame where anchorPosition applies
  double anchorPosition = 0.0;   // musical position there, in sixteenths
  std::int64_t nextStep = 0;     // absolute index of the next step to fire
  std::int64_t stepLimit = 0;    // stop before this step; 0 plays forever
  std::int64_t nextStepFrame = 0;

  // De-click residual left behind by stolen voices.
  float residualLeft = 0.0f;
  float residualRight = 0.0f;
  int residualRemaining = 0;
  int declickFrames = 1;

  // Event log. Allocated on the control thread before rendering.
  std::unique_ptr<SnareEvent[]> events;
  int eventCapacity = 0;
  std::atomic<int> eventCount{0};

  void updateTempo() { stepFrames = snare::framesPerStep(bpm, sampleRate); }

  void scheduleNextStep() {
    const double offset =
        (snare::stepTime(nextStep, swing) - anchorPosition) * stepFrames;
    nextStepFrame = anchorFrame + snare::roundFrame(offset);
  }

  // Moves the anchor to `at` so a tempo change does not shift past events.
  void reanchor(std::int64_t at) {
    if (stepFrames > 0.0) {
      anchorPosition += static_cast<double>(at - anchorFrame) / stepFrames;
    }
    anchorFrame = at;
  }

  void logEvent(std::int64_t at, int step, int role, int velocity) {
    if (!events) return;
    const int index = eventCount.load(std::memory_order_relaxed);
    if (index >= eventCapacity) return;
    events[index] = SnareEvent{static_cast<double>(at), step, role, velocity, 0};
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
    for (int index = 0; index < snare::kMaxRoles; ++index) {
      const std::uint32_t bit = 1u << index;
      if (((staged | cleared) & bit) == 0) continue;
      snare::Slot& slot = slots[index];
      if (slot.sound && retired.full()) {
        waiting |= bit;
        continue;
      }
      SnareSound* incoming = pendingSound[index].exchange(nullptr, std::memory_order_acq_rel);
      if (!incoming && (cleared & bit) == 0) continue;
      if (slot.sound) retired.push(slot.sound);
      slot.sound = incoming;
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

  void startVoice(int role, int velocity) {
    if (role < 0 || role >= snare::kMaxRoles) return;
    const snare::Slot& slot = slots[role];
    SnareSound* sound = slot.sound;
    if (!sound || sound->frames <= 0) return;
    velocity = std::clamp(velocity, 1, 127);

    if (slot.chokeGroup != 0) {
      for (auto& voice : voices) {
        if (voice.active && voice.chokeGroup == slot.chokeGroup &&
            voice.envelopeStep == 0.0f) {
          voice.envelopeStep = chokeStep;
        }
      }
    }

    snare::Voice& voice = allocateVoice();
    const double angle = (static_cast<double>(slot.pan) + 1.0) * snare::kPi / 4.0;
    const float amplitude = slot.gain * velocityGain[velocity];
    voice.active = true;
    voice.sound = sound;
    voice.position = 0.0;
    voice.increment = sound->sampleRate / sampleRate;
    // Centre is unity on both sides; the edges keep constant power.
    voice.gainLeft = amplitude * static_cast<float>(std::cos(angle) * std::sqrt(2.0));
    voice.gainRight = amplitude * static_cast<float>(std::sin(angle) * std::sqrt(2.0));
    voice.envelope = 1.0f;
    voice.envelopeStep = 0.0f;
    voice.chokeGroup = slot.chokeGroup;
    voice.order = ++voiceCounter;
    voice.lastLeft = 0.0f;
    voice.lastRight = 0.0f;
    sound->liveVoices.fetch_add(1, std::memory_order_relaxed);
  }

  void fireStep(std::int64_t at) {
    const int step = static_cast<int>(nextStep % snare::kSteps);
    for (int role = 0; role < snare::kMaxRoles; ++role) {
      const int velocity = pattern[role][step];
      if (velocity > 0) {
        logEvent(at, step, role, velocity);
        startVoice(role, velocity);
      }
    }
    currentStep.store(step, std::memory_order_relaxed);
    ++nextStep;
    scheduleNextStep();
  }

  void apply(const snare::Command& command) {
    using snare::CommandType;
    switch (command.type) {
      case CommandType::SetTempo:
        if (snare::clampBpm(command.value) == bpm) break;
        reanchor(frame);
        bpm = snare::clampBpm(command.value);
        updateTempo();
        scheduleNextStep();
        break;
      case CommandType::SetSwing:
        swing = snare::clampSwing(command.value);
        scheduleNextStep();
        break;
      case CommandType::SetMasterGain:
        masterGain = static_cast<float>(std::clamp(command.value, 0.0, 2.0));
        break;
      case CommandType::SetSlot:
        slots[command.a].gain = static_cast<float>(command.value);
        slots[command.a].pan = static_cast<float>(command.value2);
        slots[command.a].chokeGroup = command.b;
        break;
      case CommandType::SetStep:
        pattern[command.a][command.b] = static_cast<std::uint8_t>(command.c);
        break;
      case CommandType::SetRow:
        std::memcpy(pattern[command.a], command.row, snare::kSteps);
        break;
      case CommandType::ClearPattern:
        std::memset(pattern, 0, sizeof(pattern));
        break;
      case CommandType::Play:
        playing = true;
        anchorFrame = frame;
        anchorPosition = 0.0;
        nextStep = 0;
        stepLimit = static_cast<std::int64_t>(command.a) * snare::kSteps;
        scheduleNextStep();
        break;
      case CommandType::Stop:
        playing = false;
        currentStep.store(-1, std::memory_order_relaxed);
        break;
      case CommandType::Trigger:
        logEvent(frame, -1, command.a, command.b);
        startVoice(command.a, command.b);
        break;
    }
  }

  void renderVoices(float* left, float* right, int from, int to) {
    for (auto& voice : voices) {
      if (!voice.active) continue;
      const SnareSound& source = *voice.sound;
      const float* pcm = source.pcm.data();
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
        const float outLeft = sampleLeft * voice.gainLeft * envelope;
        const float outRight = sampleRight * voice.gainRight * envelope;
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
        while (playing && nextStepFrame <= now) {
          if (stepLimit > 0 && nextStep >= stepLimit) {
            playing = false;
            currentStep.store(-1, std::memory_order_relaxed);
          } else {
            fireStep(now);
          }
        }
        if (playing && nextStepFrame < frame + frames) {
          segmentEnd = static_cast<int>(nextStepFrame - frame);
        }
      }
      renderVoices(left, right, offset, segmentEnd);
      offset = segmentEnd;
    }

    for (int i = 0; i < frames; ++i) {
      left[i] = snare::softLimit(left[i] * masterGain);
      right[i] = snare::softLimit(right[i] * masterGain);
    }

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

double snare_step_time(int step_index, double swing_percent) {
  return snare::stepTime(step_index, swing_percent);
}

double snare_frames_per_step(double bpm, double sample_rate) {
  return snare::framesPerStep(bpm, sample_rate);
}

int32_t snare_loop_frames(double bpm, double sample_rate, int steps) {
  return static_cast<int32_t>(
      snare::roundFrame(snare::framesPerStep(bpm, sample_rate) * steps));
}

namespace {

bool validSoundShape(int32_t frames, int32_t channels, double sample_rate) {
  return (channels == 1 || channels == 2) && frames >= 0 && frames <= snare::kMaxSampleFrames &&
         sample_rate >= 8000.0 && sample_rate <= 192000.0;
}

bool validSlotSettings(float gain, float pan, int32_t choke_group) {
  return gain >= 0.0f && gain <= 4.0f && pan >= -1.0f && pan <= 1.0f && choke_group >= 0;
}

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

int32_t queueSlot(SnareEngine* engine, int32_t slot, float gain, float pan, int32_t choke_group) {
  snare::Command command;
  command.type = snare::CommandType::SetSlot;
  command.a = slot;
  command.b = choke_group;
  command.value = static_cast<double>(gain);
  command.value2 = static_cast<double>(pan);
  return engine->enqueue(command);
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

SnareKit* snare_kit_create(void) { return new SnareKit(); }

void snare_kit_destroy(SnareKit* kit) { delete kit; }

int32_t snare_kit_set_voice(SnareKit* kit, int32_t role, const float* pcm,
                            int32_t frames, int32_t channels,
                            double sample_rate, float gain, float pan,
                            int32_t choke_group) {
  if (!kit || !pcm) return SNARE_ERR_BAD_ARGUMENT;
  if (role < 0 || role >= SNARE_MAX_ROLES) return SNARE_ERR_BAD_ARGUMENT;
  if (frames > snare::kMaxSampleFrames) return SNARE_ERR_TOO_LARGE;
  if (frames <= 0 || !validSoundShape(frames, channels, sample_rate)) return SNARE_ERR_BAD_ARGUMENT;
  if (!validSlotSettings(gain, pan, choke_group)) return SNARE_ERR_BAD_ARGUMENT;

  SnareSound* sound = snare_sound_create(frames, channels, sample_rate);
  std::copy(pcm, pcm + static_cast<std::size_t>(frames) * channels, sound->pcm.begin());
  SnareKit::Entry& entry = kit->entries[role];
  delete entry.sound;
  entry = {sound, gain, pan, choke_group};
  return SNARE_OK;
}

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
  for (snare::Slot& slot : engine->slots) delete slot.sound;
  delete engine;
}

int32_t snare_engine_set_sound(SnareEngine* engine, int32_t slot, SnareSound* sound) {
  if (!engine || slot < 0 || slot >= SNARE_MAX_ROLES) return SNARE_ERR_BAD_ARGUMENT;
  stageSound(engine, slot, sound);
  // Each new sound retires one, so free what has finished ringing as we go.
  snare_engine_collect(engine);
  return SNARE_OK;
}

int32_t snare_engine_set_slot(SnareEngine* engine, int32_t slot, float gain, float pan,
                              int32_t choke_group) {
  if (!engine || slot < 0 || slot >= SNARE_MAX_ROLES || !validSlotSettings(gain, pan, choke_group)) {
    return SNARE_ERR_BAD_ARGUMENT;
  }
  return queueSlot(engine, slot, gain, pan, choke_group);
}

int32_t snare_engine_commit_kit(SnareEngine* engine, SnareKit* kit) {
  if (!engine || !kit) return SNARE_ERR_BAD_ARGUMENT;
  int32_t result = SNARE_OK;
  for (int32_t slot = 0; slot < SNARE_MAX_ROLES; ++slot) {
    SnareKit::Entry& entry = kit->entries[slot];
    stageSound(engine, slot, entry.sound);
    if (entry.sound) {
      const int32_t queued = queueSlot(engine, slot, entry.gain, entry.pan, entry.chokeGroup);
      if (queued != SNARE_OK) result = queued;
    }
    entry.sound = nullptr;
  }
  delete kit;
  return result;
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

int32_t snare_engine_set_swing(SnareEngine* engine, double swing_percent) {
  if (!engine) return SNARE_ERR_BAD_ARGUMENT;
  snare::Command command;
  command.type = snare::CommandType::SetSwing;
  command.value = swing_percent;
  return engine->enqueue(command);
}

int32_t snare_engine_set_master_gain(SnareEngine* engine, double gain) {
  if (!engine || !(gain >= 0.0)) return SNARE_ERR_BAD_ARGUMENT;
  snare::Command command;
  command.type = snare::CommandType::SetMasterGain;
  command.value = gain;
  return engine->enqueue(command);
}

int32_t snare_engine_set_step(SnareEngine* engine, int32_t role, int32_t step,
                              int32_t velocity) {
  if (!engine || role < 0 || role >= SNARE_MAX_ROLES || step < 0 ||
      step >= SNARE_STEPS || velocity < 0 || velocity > 127) {
    return SNARE_ERR_BAD_ARGUMENT;
  }
  snare::Command command;
  command.type = snare::CommandType::SetStep;
  command.a = role;
  command.b = step;
  command.c = velocity;
  return engine->enqueue(command);
}

int32_t snare_engine_set_row(SnareEngine* engine, int32_t role,
                             const uint8_t* velocities) {
  if (!engine || !velocities || role < 0 || role >= SNARE_MAX_ROLES) {
    return SNARE_ERR_BAD_ARGUMENT;
  }
  snare::Command command;
  command.type = snare::CommandType::SetRow;
  command.a = role;
  for (int step = 0; step < SNARE_STEPS; ++step) {
    command.row[step] = velocities[step] > 127 ? 127 : velocities[step];
  }
  return engine->enqueue(command);
}

int32_t snare_engine_clear_pattern(SnareEngine* engine) {
  if (!engine) return SNARE_ERR_BAD_ARGUMENT;
  snare::Command command;
  command.type = snare::CommandType::ClearPattern;
  return engine->enqueue(command);
}

int32_t snare_engine_play(SnareEngine* engine) {
  if (!engine) return SNARE_ERR_BAD_ARGUMENT;
  snare::Command command;
  command.type = snare::CommandType::Play;
  return engine->enqueue(command);
}

int32_t snare_engine_play_loops(SnareEngine* engine, int32_t loops) {
  if (!engine || loops < 1 || loops > 1000000) return SNARE_ERR_BAD_ARGUMENT;
  snare::Command command;
  command.type = snare::CommandType::Play;
  command.a = loops;
  return engine->enqueue(command);
}

int32_t snare_engine_stop(SnareEngine* engine) {
  if (!engine) return SNARE_ERR_BAD_ARGUMENT;
  snare::Command command;
  command.type = snare::CommandType::Stop;
  return engine->enqueue(command);
}

int32_t snare_engine_trigger(SnareEngine* engine, int32_t role,
                             int32_t velocity) {
  if (!engine || role < 0 || role >= SNARE_MAX_ROLES || velocity < 1 ||
      velocity > 127) {
    return SNARE_ERR_BAD_ARGUMENT;
  }
  snare::Command command;
  command.type = snare::CommandType::Trigger;
  command.a = role;
  command.b = velocity;
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

double snare_engine_frames_rendered(const SnareEngine* engine) {
  return engine ? engine->framesRendered.load(std::memory_order_relaxed) : 0.0;
}

int32_t snare_engine_active_voices(const SnareEngine* engine) {
  return engine ? engine->activeVoices.load(std::memory_order_relaxed) : 0;
}

uint32_t snare_engine_stolen_voices(const SnareEngine* engine) {
  return engine ? engine->stolenVoices.load(std::memory_order_relaxed) : 0;
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
