// РИТМ-12's panel, drawn for the plugin, at the one size it is laid out for.
// The window (PluginEditor.h) shows it larger or smaller. The step keys of
// the pattern the panel is on, a key and a mute for each voice, the selected
// voice's knobs, the mix, the effect, and keys to load a beat saved from the
// site and to save one the site opens.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "../PatternMidi.h"
#include "../PluginProcessor.h"
#include "PanelStyle.h"
#include "StepKeys.h"

#include <array>
#include <memory>

class BoombapbotPanel final : public juce::Component, private juce::ChangeListener, private juce::Timer {
 public:
  static constexpr int kWidth = 920;
  static constexpr int kHeight = 624;

  explicit BoombapbotPanel(BoombapbotAudioProcessor& owner);
  ~BoombapbotPanel() override;

  void paint(juce::Graphics& graphics) override;
  void resized() override;
  void mouseDrag(const juce::MouseEvent& event) override;

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
  int shownPattern() const;
  void chooseBeat();
  void loadBeat(const juce::File& file);
  void chooseWhereToSave();
  void saveBeat(const juce::File& file);
  void showNote(const juce::String& note);
  // The pattern the panel is on, as a MIDI file.
  juce::MemoryBlock shownPatternMidi() const;
  juce::String shownPatternMidiName() const;
  void chooseWhereToSaveMidi();
  void dragMidiOut();
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
  Key saveKey_;
  Key midiKey_;
  Key diceKey_;
  Key undoKey_;
  juce::Random dice_;
  bool midiKeyDragged_ = false;
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

  juce::Label nameLabel_;
  juce::Label name_;
  juce::Label status_;
  juce::Rectangle<int> voiceGroup_;
  juce::Rectangle<int> mixGroup_;
  juce::Rectangle<int> effectGroup_;
  std::unique_ptr<juce::FileChooser> chooser_;
  juce::TooltipWindow tooltips_{this};

  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BoombapbotPanel)
};
