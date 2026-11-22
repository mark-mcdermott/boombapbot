#include "PluginEditor.h"

namespace {

using boombapbot::plugin::kWindowScaleLeast;
using boombapbot::plugin::kWindowScaleMost;

int scaled(int length, float scale) { return juce::roundToInt(static_cast<float>(length) * scale); }

}  // namespace

BoombapbotEditor::BoombapbotEditor(BoombapbotAudioProcessor& owner)
    : AudioProcessorEditor(owner), processor_(owner), panel_(owner) {
  // Read first: setting the limits below resizes the window, and a resize is remembered.
  const float scale = processor_.windowScale();
  addAndMakeVisible(panel_);
  setResizable(true, true);
  setResizeLimits(scaled(BoombapbotPanel::kWidth, kWindowScaleLeast), scaled(BoombapbotPanel::kHeight, kWindowScaleLeast),
                  scaled(BoombapbotPanel::kWidth, kWindowScaleMost), scaled(BoombapbotPanel::kHeight, kWindowScaleMost));
  getConstrainer()->setFixedAspectRatio(static_cast<double>(BoombapbotPanel::kWidth) / BoombapbotPanel::kHeight);
  setSize(scaled(BoombapbotPanel::kWidth, scale), scaled(BoombapbotPanel::kHeight, scale));
}

void BoombapbotEditor::paint(juce::Graphics& graphics) { graphics.fillAll(boombapbot::panel::colours::paintDark); }

// The panel is laid out once, at its own size, and drawn through a scale. The
// size the window was left at is kept with the plugin, so it opens there again.
void BoombapbotEditor::resized() {
  const float scale = static_cast<float>(getWidth()) / BoombapbotPanel::kWidth;
  panel_.setTransform(juce::AffineTransform::scale(scale));
  panel_.setBounds(0, 0, BoombapbotPanel::kWidth, BoombapbotPanel::kHeight);
  processor_.setWindowScale(scale);
}
