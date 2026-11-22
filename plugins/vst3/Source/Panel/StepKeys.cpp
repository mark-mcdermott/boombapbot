#include "StepKeys.h"

#include "PanelStyle.h"

namespace boombapbot::panel {

using boombapbot::plugin::kSteps;

StepKeys::StepKeys(BoombapbotAudioProcessor& processor) : processor_(processor) {
  setTitle("Step keys");
  setSize(kWidth, kHeight);
  shown_ = look();
}

int StepKeys::rowTop(int row) {
  return kLampsHeight + row * (kRowHeight + kRowGap) + (row > 0 ? kAccentsGap : 0);
}

juce::Rectangle<int> StepKeys::keyBounds(int row, int step) {
  const int x = step * kKeyWidth + (step - step / 4) * kKeyGap + (step / 4) * kBeatGap;
  return {x, rowTop(row), kKeyWidth, kRowHeight};
}

int StepKeys::processorRow(int row) { return row == 0 ? BoombapbotAudioProcessor::kAccentsRow : row - 1; }

StepKeys::Cell StepKeys::cellAt(juce::Point<int> position) const {
  for (int row = 0; row < kRows; ++row) {
    for (int step = 0; step < shown_.size; ++step) {
      if (keyBounds(row, step).contains(position)) return {row, step};
    }
  }
  return {};
}

StepKeys::Shown StepKeys::look() const {
  Shown seen;
  for (int row = 0; row < kRows; ++row) {
    boombapbot::plugin::StepRow steps = 0;
    for (int step = 0; step < kSteps; ++step) {
      if (processor_.stepOn(pattern_, processorRow(row), step)) {
        steps = static_cast<boombapbot::plugin::StepRow>(steps | (1u << step));
      }
    }
    seen.rows[static_cast<std::size_t>(row)] = steps;
  }
  seen.size = processor_.measureSize();
  seen.playingStep = processor_.playingPattern() == pattern_ ? processor_.playingStep() : -1;
  return seen;
}

void StepKeys::refresh() {
  const Shown seen = look();
  if (seen == shown_) return;
  shown_ = seen;
  repaint();
}

void StepKeys::setPattern(int pattern) {
  pattern_ = pattern;
  refresh();
}

void StepKeys::paint(juce::Graphics& graphics) {
  for (int step = 0; step < kSteps; ++step) {
    const bool inMeasure = step < shown_.size;
    const juce::Rectangle<float> lamp =
        juce::Rectangle<float>(7.0f, 7.0f).withCentre(keyBounds(0, step).toFloat().getCentre().withY(5.0f));
    const bool playing = step == shown_.playingStep;
    if (playing) {
      graphics.setColour(colours::red.withAlpha(0.35f));
      graphics.fillEllipse(lamp.expanded(3.0f));
    }
    graphics.setColour(playing ? colours::red.brighter(0.3f) : colours::well.withAlpha(inMeasure ? 1.0f : 0.4f));
    graphics.fillEllipse(lamp);

    for (int row = 0; row < kRows; ++row) {
      const bool on = ((shown_.rows[static_cast<std::size_t>(row)] >> step) & 1) != 0;
      const Lamp lit = !on ? Lamp::off : row == 0 ? Lamp::red : Lamp::amber;
      paintKey(graphics, keyBounds(row, step).toFloat(), inMeasure ? lit : Lamp::off, false, !inMeasure);
    }
  }
}

void StepKeys::mouseDown(const juce::MouseEvent& event) {
  dragFrom_ = cellAt(event.getPosition());
  if (dragFrom_.row < 0) return;
  dragTurnsOn_ = !processor_.stepOn(pattern_, processorRow(dragFrom_.row), dragFrom_.step);
  processor_.setStep(pattern_, processorRow(dragFrom_.row), dragFrom_.step, dragTurnsOn_);
  refresh();
}

void StepKeys::mouseDrag(const juce::MouseEvent& event) {
  if (dragFrom_.row < 0) return;
  const Cell over = cellAt({event.x, keyBounds(dragFrom_.row, 0).getCentreY()});
  if (over.row < 0) return;
  processor_.setStep(pattern_, processorRow(over.row), over.step, dragTurnsOn_);
  refresh();
}

}  // namespace boombapbot::panel
