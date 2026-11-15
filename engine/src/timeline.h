// The single musical timeline. Playback, offline rendering and MIDI export
// all derive event positions from these functions, so they cannot disagree.
//
// Time is counted in ticks, 24 to the quarter note, so a step at any pre-scale
// is a whole number of them: 8, 6, 4 or 3 for three, four, six or eight steps
// to the beat. Positions are integers; only the conversion to frames rounds.
#pragma once

#include <cmath>
#include <cstdint>

#include "boombapbot/engine.h"

namespace snare {

inline double clampBpm(double bpm) {
  if (!(bpm >= SNARE_BPM_MIN)) return SNARE_BPM_MIN;
  if (bpm > SNARE_BPM_MAX) return SNARE_BPM_MAX;
  return bpm;
}

// Ticks in one step. 0 for a step size the machine does not have.
inline int stepTicks(int stepsPerBeat) {
  switch (stepsPerBeat) {
    case 3:
    case 4:
    case 6:
    case 8:
      return SNARE_TICKS_PER_BEAT / stepsPerBeat;
    default:
      return 0;
  }
}

inline bool validShape(int len1, int len2, int stepsPerBeat) {
  return len1 >= 1 && len1 <= SNARE_PART_STEPS && len2 >= 0 && len2 <= SNARE_PART_STEPS &&
         stepTicks(stepsPerBeat) != 0;
}

// Where the nth step played in a measure is stored: the 1st part uses steps 0
// to 15 and the 2nd part steps 16 to 31, however long the 1st part is.
inline int stepPosition(int played, int firstLength) {
  return played < firstLength ? played : SNARE_PART_STEPS + (played - firstLength);
}

inline double framesPerTick(double bpm, double sampleRate) {
  return sampleRate * 60.0 / clampBpm(bpm) / SNARE_TICKS_PER_BEAT;
}

// Round half up. Used for every time-to-frame conversion.
inline std::int64_t roundFrame(double frames) {
  return static_cast<std::int64_t>(std::floor(frames + 0.5));
}

}  // namespace snare
