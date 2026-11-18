// Renders one of the machine's sounds from its knob settings. The voices
// themselves come from the machine the binary is built for; what is here is
// the same for all of them: checking what was asked, how long a sound may
// be, and the fade that ends every one at exactly zero.

#include <algorithm>
#include <cstdint>

#include "boombapbot/engine.h"
#include "boombapbot/voices.h"

namespace {

using boombapbot::Knobs;
using boombapbot::Voice;
using boombapbot::machineVoices;

constexpr double kFadeSeconds = 0.006;
constexpr double kMaxSeconds = 6.0;
constexpr double kMinRate = 8000.0;
constexpr double kMaxRate = 192000.0;

double clamp01(double value) { return std::min(1.0, std::max(0.0, value)); }

bool valid(const SnareSoundParams* params, double rate) {
  return params != nullptr && params->sound >= 0 && params->sound < machineVoices().count &&
         params->sound < SNARE_SOUNDS && rate >= kMinRate && rate <= kMaxRate;
}

Knobs knobsOf(const SnareSoundParams& params) {
  return {clamp01(params.tune), clamp01(params.tone), clamp01(params.decay), clamp01(params.snappy)};
}

const Voice& voiceOf(const SnareSoundParams& params) { return machineVoices().voices[params.sound]; }

int framesOf(const SnareSoundParams& params, double rate) {
  const double seconds = std::min(kMaxSeconds, voiceOf(params).seconds(knobsOf(params)));
  return static_cast<int>(seconds * rate);
}

}  // namespace

extern "C" {

int32_t snare_synth_frames(const SnareSoundParams* params, double sample_rate) {
  if (!valid(params, sample_rate)) return SNARE_ERR_BAD_ARGUMENT;
  return framesOf(*params, sample_rate);
}

int32_t snare_synth_render(const SnareSoundParams* params, double sample_rate, float* out,
                           int32_t capacity) {
  if (!valid(params, sample_rate) || out == nullptr) return SNARE_ERR_BAD_ARGUMENT;
  const int frames = framesOf(*params, sample_rate);
  if (capacity < frames) return SNARE_ERR_TOO_LARGE;
  const Voice& voice = voiceOf(*params);
  voice.render(knobsOf(*params), sample_rate, params->seed == 0 ? voice.seed : params->seed, out, frames);
  // Every sound ends at exactly zero, whatever its envelope was doing.
  const int fade = std::min(frames, static_cast<int>(kFadeSeconds * sample_rate));
  for (int i = 0; i < fade; ++i) {
    out[frames - 1 - i] = static_cast<float>(static_cast<double>(out[frames - 1 - i]) * i / fade);
  }
  return frames;
}

}  // extern "C"
