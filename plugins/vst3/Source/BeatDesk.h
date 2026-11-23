// A beat's way in and out of the plugin as files: a beat saved from the site
// loaded, the plugin's beat saved for the site, and the shown pattern as a
// MIDI file, saved or dragged out of the window. Whichever window the plugin
// has asks for these and is told, in words for a person, how each went.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "PluginProcessor.h"

#include <functional>
#include <memory>

namespace boombapbot::plugin {

class BeatDesk final {
 public:
  enum class Said { note, problem };
  using Say = std::function<void(const juce::String& words, Said kind)>;

  BeatDesk(BoombapbotAudioProcessor& processor, Say say);

  // Each asks where, in the system's own dialog, and returns at once.
  void chooseBeat();
  void chooseWhereToSave();
  void chooseWhereToSaveMidi();

  void loadBeat(const juce::File& file);
  void saveBeat(const juce::File& file);
  void saveMidi(const juce::File& file);
  // Starts a drag that carries the shown pattern's MIDI file out of the
  // window `from` is in. The mouse has to be held down on it.
  void dragMidiOut(juce::Component& from);

 private:
  // The pattern the panel is on, as a MIDI file.
  juce::MemoryBlock shownPatternMidi() const;
  juce::String shownPatternMidiName() const;
  void choose(const juce::String& title, const juce::File& suggested, const juce::String& pattern, int mode,
              void (BeatDesk::*then)(const juce::File&));

  BoombapbotAudioProcessor& processor_;
  Say say_;
  std::unique_ptr<juce::FileChooser> chooser_;

  JUCE_DECLARE_WEAK_REFERENCEABLE(BeatDesk)
  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BeatDesk)
};

}  // namespace boombapbot::plugin
