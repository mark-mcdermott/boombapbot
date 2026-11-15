// What plays in each measure. The panel names a rhythm, where its variation
// switch stands, and an intro/fill-in; this decides, at every bar line, which
// pattern of the bank comes next. Pure: no allocation, no clock, no engine.
#pragma once

#include "boombapbot/engine.h"

namespace snare {

struct MeasureChoice {
  int pattern;
  int kind;  // SNARE_MEASURE_*
};

inline bool validPanel(const SnarePanel& panel) {
  return panel.rhythm < SNARE_RHYTHMS && panel.variation <= SNARE_VARIATION_B &&
         panel.fill_rhythm < SNARE_RHYTHMS &&
         (panel.fill_variation == SNARE_VARIATION_A || panel.fill_variation == SNARE_VARIATION_B) &&
         panel.first_beat_rule <= 1;
}

inline int patternOf(int rhythm, int version) { return rhythm * 2 + version; }

class Sequencer {
 public:
  // Play was pressed. An armed fill-in stays armed: it becomes the intro.
  void start() {
    started_ = false;
    counted_ = 0;
    lastVersion_ = -1;
  }

  // TAP: the fill-in plays once, at the next bar line or as the intro.
  void armFill(bool armed) { fillArmed_ = armed; }

  // The measure that begins now.
  MeasureChoice next(const SnarePanel& panel) {
    const bool first = !started_;
    started_ = true;
    if (fillArmed_) {
      fillArmed_ = false;
      // An intro is not one of the measures the automatic fill-in counts.
      if (!first) ++counted_;
      return fill(panel, first ? SNARE_MEASURE_INTRO : SNARE_MEASURE_FILL);
    }
    ++counted_;
    if (panel.auto_fill > 0 && counted_ % panel.auto_fill == 0) return fill(panel, SNARE_MEASURE_FILL);
    lastVersion_ = versionAfter(panel.variation);
    return {patternOf(panel.rhythm, lastVersion_), SNARE_MEASURE_BASIC};
  }

  // A rhythm chosen during the first beat of a measure takes over on the
  // second, in the version that measure began with.
  int takeover(const SnarePanel& panel) const { return patternOf(panel.rhythm, lastVersion_ < 0 ? 0 : lastVersion_); }

 private:
  static MeasureChoice fill(const SnarePanel& panel, int kind) {
    return {patternOf(panel.fill_rhythm, panel.fill_variation == SNARE_VARIATION_B ? 1 : 0), kind};
  }

  // AB alternates, beginning with A and carrying on from whichever played last.
  int versionAfter(int variation) const {
    if (variation == SNARE_VARIATION_A) return 0;
    if (variation == SNARE_VARIATION_B) return 1;
    return lastVersion_ < 0 ? 0 : 1 - lastVersion_;
  }

  bool started_ = false;
  bool fillArmed_ = false;
  int counted_ = 0;
  int lastVersion_ = -1;
};

}  // namespace snare
