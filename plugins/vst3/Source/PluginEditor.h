// The plugin's window: РИТМ-12's panel, drawn for the plugin. The step keys of
// the pattern the panel is on, a key and a mute for each voice, the selected
// voice's knobs, the mix, the effect, and a key to load a beat saved from the
// site.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "Panel/PanelStyle.h"
#include "Panel/StepKeys.h"
#include "PluginProcessor.h"

#include <array>
#include <memory>

class BoombapbotEditor final : public juce::AudioProcessorEditor,
                               private juce::ChangeListener,
                               private juce::Timer {
 public:
  explicit BoombapbotEditor(BoombapbotAudioProcessor& owner);
  ~BoombapbotEditor() override;

  void paint(juce::Graphics& graphics) override;
  void resized() override;

 private:
  using Key = boombapbot::panel::Key;
  using Knob = boombapbot::panel::Knob;
  using SliderAttachment = juce::AudioProcessorValueTreeState::SliderAttachment;
  using ButtonAttachment = juce::AudioProcessorValueTreeState::ButtonAttachment;

  // A row of keys of which one is lit: the choices of one parameter.
  class ChoiceKeys;

  void changeListenerCallback(juce::ChangeBroadcaster* source) override;
  void timerCallback() override;
  void selectVoice(int voice);
  void chooseBeat();
  void loadBeat(const juce::File& file);
  void showState();
  void showProblem(const juce::String& problem);

  BoombapbotAudioProcessor& processor_;
  boombapbot::panel::StepKeys steps_;

  juce::OwnedArray<Key> voiceKeys_;
  juce::OwnedArray<Key> muteKeys_;
  juce::OwnedArray<ButtonAttachment> muteAttachments_;
  int selectedVoice_ = 0;

  std::unique_ptr<ChoiceKeys> patternKeys_;
  std::unique_ptr<ChoiceKeys> effectKeys_;
  Key sixteenKey_;
  Key twelveKey_;
  Key sequencerKey_;
  Key clearKey_;
  Key loadKey_;
  ButtonAttachment sequencerAttachment_;

  Knob pitch_;
  Knob tone_;
  Knob decay_;
  Knob level_;
  std::array<std::unique_ptr<SliderAttachment>, 4> voiceAttachments_;
  Knob volume_;
  Knob accent_;
  Knob swing_;
  Knob effectMix_;
  juce::OwnedArray<SliderAttachment> mixAttachments_;

  juce::Label status_;
  juce::Rectangle<int> voiceGroup_;
  juce::Rectangle<int> mixGroup_;
  juce::Rectangle<int> effectGroup_;
  std::unique_ptr<juce::FileChooser> chooser_;

  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BoombapbotEditor)
};
