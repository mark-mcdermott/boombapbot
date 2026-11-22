// The step keys: a row of sixteen for the accents and one for each voice,
// showing the pattern the panel is on, with a lamp over the step the
// sequencer is playing. A click turns a step on or off, and a drag along a
// row carries that on.
#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

#include "../PluginProcessor.h"

#include <array>

namespace boombapbot::panel {

class StepKeys final : public juce::Component {
 public:
  static constexpr int kRows = boombapbot::plugin::kVoiceCount + 1;
  static constexpr int kKeyWidth = 40;
  static constexpr int kKeyGap = 5;
  static constexpr int kBeatGap = 10;
  static constexpr int kLampsHeight = 14;
  static constexpr int kRowHeight = 30;
  static constexpr int kRowGap = 6;
  // After the accents' row, before the voices'.
  static constexpr int kAccentsGap = 10;
  static constexpr int kWidth = 16 * kKeyWidth + 12 * kKeyGap + 3 * kBeatGap;
  static constexpr int kHeight = kLampsHeight + kRows * (kRowHeight + kRowGap) + kAccentsGap;

  explicit StepKeys(BoombapbotAudioProcessor& processor);

  // Where a row's keys start, from the top of this component: row 0 is the
  // accents and rows 1 to 8 the voices, in the machine's order.
  static int rowTop(int row);
  static juce::Rectangle<int> keyBounds(int row, int step);

  // Looks at the processor again and repaints if what it shows has changed.
  void refresh();
  void setPattern(int pattern);

  void paint(juce::Graphics& graphics) override;
  void mouseDown(const juce::MouseEvent& event) override;
  void mouseDrag(const juce::MouseEvent& event) override;

 private:
  struct Shown {
    std::array<boombapbot::plugin::StepRow, kRows> rows{};
    int size = 0;
    int playingStep = -1;
    bool operator==(const Shown&) const = default;
  };

  struct Cell {
    int row = -1;
    int step = -1;
  };

  // A screen row is the accents first; the processor keeps them last.
  static int processorRow(int row);
  Cell cellAt(juce::Point<int> position) const;
  Shown look() const;

  BoombapbotAudioProcessor& processor_;
  int pattern_ = 0;
  Shown shown_;
  Cell dragFrom_;
  bool dragTurnsOn_ = false;

  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(StepKeys)
};

}  // namespace boombapbot::panel
