#include "BeatDesk.h"

#include "BeatFile.h"
#include "PatternMidi.h"

namespace boombapbot::plugin {

namespace {

constexpr int kOpening = juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles;
constexpr int kSaving = juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles |
                        juce::FileBrowserComponent::warnAboutOverwriting;

juce::File inDocuments(const juce::String& name) {
  return juce::File::getSpecialLocation(juce::File::userDocumentsDirectory).getChildFile(name);
}

}  // namespace

BeatDesk::BeatDesk(BoombapbotAudioProcessor& processor, Say say) : processor_(processor), say_(std::move(say)) {}

void BeatDesk::choose(const juce::String& title, const juce::File& suggested, const juce::String& pattern, int mode,
                      void (BeatDesk::*then)(const juce::File&)) {
  chooser_ = std::make_unique<juce::FileChooser>(title, suggested, pattern);
  const juce::WeakReference<BeatDesk> self(this);
  chooser_->launchAsync(mode, [self, then](const juce::FileChooser& chooser) {
    const juce::File file = chooser.getResult();
    if (self != nullptr && file != juce::File()) (self.get()->*then)(file);
  });
}

void BeatDesk::chooseBeat() {
  choose("Load a beat saved from boombapbot", juce::File(), "*.json", kOpening, &BeatDesk::loadBeat);
}

void BeatDesk::chooseWhereToSave() {
  choose("Save this beat for boombapbot", inDocuments(beatFileName(processor_.beatName())), "*.json", kSaving,
         &BeatDesk::saveBeat);
}

void BeatDesk::chooseWhereToSaveMidi() {
  choose("Save this pattern as MIDI", inDocuments(shownPatternMidiName()), "*.mid", kSaving, &BeatDesk::saveMidi);
}

void BeatDesk::loadBeat(const juce::File& file) {
  if (file.getSize() > kBeatFileBytesMost) {
    say_("That file is too large to be a beat file.", Said::problem);
    return;
  }
  juce::String leftOut;
  const juce::Result loaded = processor_.loadBeat(file.loadFileAsString(), &leftOut);
  if (loaded.failed()) {
    say_(loaded.getErrorMessage(), Said::problem);
  } else if (leftOut.isNotEmpty()) {
    say_("Loaded " + file.getFileName() + " without its effect, " + leftOut + ", which comes with the upgrade.", Said::note);
  } else {
    say_("Loaded " + file.getFileName() + ".", Said::note);
  }
}

void BeatDesk::saveBeat(const juce::File& file) {
  const juce::File target = file.getFileName().endsWithIgnoreCase(".json") ? file : file.withFileExtension("json");
  if (target.replaceWithText(writeBeat(processor_.currentBeat(), newBeatStamp()), false, false, "\n")) {
    say_("Saved " + target.getFileName() + ". Open it on the site with its import.", Said::note);
  } else {
    say_("The beat could not be saved to " + target.getFullPathName() + ".", Said::problem);
  }
}

void BeatDesk::saveMidi(const juce::File& file) {
  const juce::File target = file.withFileExtension("mid");
  const juce::MemoryBlock midi = shownPatternMidi();
  if (target.replaceWithData(midi.getData(), midi.getSize())) {
    say_("Saved " + target.getFileName() + ".", Said::note);
  } else {
    say_("The pattern could not be saved to " + target.getFullPathName() + ".", Said::problem);
  }
}

// The file a drag carries has to be on disk before the drag starts.
void BeatDesk::dragMidiOut(juce::Component& from) {
  const juce::MemoryBlock midi = shownPatternMidi();
  const juce::File file = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile(shownPatternMidiName());
  if (!file.replaceWithData(midi.getData(), midi.getSize())) {
    say_("The pattern could not be written out to drag.", Said::problem);
    return;
  }
  juce::DragAndDropContainer::performExternalDragDropOfFiles({file.getFullPathName()}, false, &from);
}

juce::MemoryBlock BeatDesk::shownPatternMidi() const {
  const Beat beat = processor_.currentBeat();
  return writePatternMidi(beat, beat.pattern);
}

juce::String BeatDesk::shownPatternMidiName() const {
  return patternMidiFileName(processor_.beatName(), processor_.currentBeat().pattern);
}

}  // namespace boombapbot::plugin
