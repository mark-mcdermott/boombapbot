// The voices the engine's own tests are built with. The engine has none of
// its own and is only ever built for a machine, so its tests bring this one:
// two plain sounds, enough to prove that a machine's voices reach a slot and
// that the synthesis calls treat any voice table alike.

#include <cstdint>

#include "boombapbot/dsp.h"
#include "boombapbot/voices.h"

namespace {

using boombapbot::Knobs;
using boombapbot::Voice;
using namespace boombapbot::dsp;

constexpr int kVoiceCount = 2;

double ring(const Knobs& knobs) { return sweep(0.03, 0.3, knobs.decay); }
// Time for the decay to fall to a thousandth.
double seconds(const Knobs& knobs) { return 0.02 + 6.9 * ring(knobs); }

// A sine that dies away: tune is its pitch, decay how long it rings.
void renderTone(const Knobs& knobs, double rate, std::uint32_t, float* out, int frames) {
  const double hz = sweep(60.0, 240.0, knobs.tune);
  const double fall = decayCoefficient(ring(knobs), rate);
  double phase = 0.0, amplitude = 0.9;
  for (int i = 0; i < frames; ++i) {
    out[i] = static_cast<float>(amplitude * sine(phase));
    phase += hz / rate;
    phase -= static_cast<double>(static_cast<long long>(phase));
    amplitude *= fall;
  }
}

// Noise that dies away, from the voice's own seed.
void renderNoise(const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  const double fall = decayCoefficient(ring(knobs), rate);
  double amplitude = 0.6;
  for (int i = 0; i < frames; ++i) {
    out[i] = static_cast<float>(amplitude * noise.next());
    amplitude *= fall;
  }
}

constexpr Voice kVoices[kVoiceCount] = {
    {seconds, renderTone, 0u},
    {seconds, renderNoise, 0x7e57'0001u},
};

}  // namespace

const boombapbot::VoiceTable& boombapbot::machineVoices() {
  static constexpr VoiceTable table{kVoices, kVoiceCount};
  return table;
}
