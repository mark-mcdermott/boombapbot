// The single musical timeline. Playback, offline rendering and MIDI export
// all derive event positions from these functions, so they cannot disagree.
#pragma once

#include <cmath>
#include <cstdint>

#include "boombapbot/engine.h"

namespace snare {

inline double clampSwing(double swing) {
  if (!(swing >= SNARE_SWING_MIN)) return SNARE_SWING_MIN;
  if (swing > SNARE_SWING_MAX) return SNARE_SWING_MAX;
  return swing;
}

inline double clampBpm(double bpm) {
  if (!(bpm >= SNARE_BPM_MIN)) return SNARE_BPM_MIN;
  if (bpm > SNARE_BPM_MAX) return SNARE_BPM_MAX;
  return bpm;
}

// Time of an absolute step index in sixteenths. Steps are grouped in pairs;
// swing moves only the second step of each pair, so every pair, and therefore
// the loop, keeps its length.
inline double stepTime(std::int64_t stepIndex, double swing) {
  const double base = static_cast<double>(stepIndex);
  if ((stepIndex & 1) == 0) return base;
  return base + (clampSwing(swing) - 50.0) / 50.0;
}

inline double framesPerStep(double bpm, double sampleRate) {
  return sampleRate * 60.0 / clampBpm(bpm) / 4.0;
}

// Round half up. Used for every time-to-frame conversion.
inline std::int64_t roundFrame(double frames) {
  return static_cast<std::int64_t>(std::floor(frames + 0.5));
}

}  // namespace snare
