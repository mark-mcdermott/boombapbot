// The plugin's window: the panel, shown at whatever size the window is dragged
// to. The panel keeps its shape, so the window does too.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "Panel/Panel.h"
#include "PluginProcessor.h"

class BoombapbotEditor final : public juce::AudioProcessorEditor {
 public:
  explicit BoombapbotEditor(BoombapbotAudioProcessor& owner);

  void paint(juce::Graphics& graphics) override;
  void resized() override;

 private:
  BoombapbotAudioProcessor& processor_;
  BoombapbotPanel panel_;

  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BoombapbotEditor)
};
