// The plugin's window for now: a bar to load a beat saved from the site, over
// JUCE's own slider for each parameter. A designed panel is a later slice.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "PluginProcessor.h"

#include <memory>

class BoombapbotEditor final : public juce::AudioProcessorEditor, private juce::ChangeListener {
 public:
  explicit BoombapbotEditor(BoombapbotAudioProcessor& owner);
  ~BoombapbotEditor() override;

  void paint(juce::Graphics& graphics) override;
  void resized() override;

 private:
  void changeListenerCallback(juce::ChangeBroadcaster* source) override;
  void chooseBeat();
  void loadBeat(const juce::File& file);
  void showBeat();
  void showProblem(const juce::String& problem);

  BoombapbotAudioProcessor& processor_;
  juce::TextButton loadButton_{"Load beat..."};
  juce::Label status_;
  juce::GenericAudioProcessorEditor parameters_;
  std::unique_ptr<juce::FileChooser> chooser_;

  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BoombapbotEditor)
};
