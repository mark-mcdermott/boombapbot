// When each step of a pattern falls, counted in the host's beats. Steps are
// numbered from the start of the host's timeline, so a position in the song
// is enough to know which step comes next: nothing has to be counted from
// where playback began.
//
// The arithmetic is the engine's own (engine/src/timeline.h): steps are evenly
// spaced, and with swing every second step of a sixteen-step measure plays
// late by swing/256 of a step.
#pragma once

#include "MachineRitm12.h"

#include <cmath>
#include <cstdint>

namespace boombapbot::plugin {

// The furthest from the start of the timeline a host's position is believed.
// At the fastest tempo this is years of music, and steps this far out are
// still told apart by a wide margin. Beyond it a position is somebody's
// mistake, and turning one into a step number would overflow.
inline constexpr double kSongBeatsMost = 1.0e9;

struct StepGrid {
  int size = kSizeRest;
  int stepsPerBeat = 4;
  double lateSteps = 0.0;  // how late an odd step plays, in steps

  StepGrid() = default;
  StepGrid(int measureSize, float swing)
      : size(validSize(measureSize) ? measureSize : kSizeRest),
        stepsPerBeat(boombapbot::plugin::stepsPerBeat(size)),
        lateSteps(stepsPerBeat == 4 ? static_cast<double>(engineSwing(swing)) / 256.0 : 0.0) {}

  // The beat a step falls on.
  double beatOf(std::int64_t step) const {
    const double late = (step & 1) != 0 ? lateSteps : 0.0;
    return (static_cast<double>(step) + late) / stepsPerBeat;
  }

  // The first step that falls on or after a beat, which is no further out
  // than kSongBeatsMost.
  std::int64_t firstStepFrom(double beat) const {
    std::int64_t step = static_cast<std::int64_t>(std::floor(beat * stepsPerBeat)) - 1;
    while (beatOf(step) < beat) ++step;
    return step;
  }

  // A step's place in its measure, 0 to size - 1, for steps before beat 0 too.
  int placeOf(std::int64_t step) const {
    const std::int64_t place = step % size;
    return static_cast<int>(place < 0 ? place + size : place);
  }
};

}  // namespace boombapbot::plugin
