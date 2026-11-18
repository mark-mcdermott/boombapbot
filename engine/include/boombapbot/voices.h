#ifndef BOOMBAPBOT_VOICES_H
#define BOOMBAPBOT_VOICES_H

// The voices a machine brings to the engine. The engine core has none of its
// own: each binary is built for one machine, whose sources define
// `machineVoices()` once. A voice's place in the table is its sound number.

#include <cstdint>

namespace boombapbot {

// Knob positions of one sound, each 0 to 1.
struct Knobs {
  double tune;
  double tone;
  double decay;
  double snappy;
};

using Renderer = void (*)(const Knobs&, double rate, std::uint32_t seed, float* out, int frames);

struct Voice {
  double (*seconds)(const Knobs&);
  Renderer render;
  std::uint32_t seed;
};

struct VoiceTable {
  const Voice* voices;
  int count;
};

const VoiceTable& machineVoices();

}  // namespace boombapbot

#endif
