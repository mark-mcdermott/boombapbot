#include "PluginEditor.h"

namespace {

constexpr int kBarHeight = 52;
constexpr int kBarPadding = 10;
constexpr float kStatusFontHeight = 13.0f;
constexpr int kButtonWidth = 120;
constexpr int kWidthLeast = 420;

const juce::Colour kProblemColour{0xffff8a70};

}  // namespace

BoombapbotEditor::BoombapbotEditor(BoombapbotAudioProcessor& owner)
    : AudioProcessorEditor(owner), processor_(owner), parameters_(owner) {
  loadButton_.setTooltip("Load a beat saved from the site (.boombapbot.json)");
  loadButton_.onClick = [this] { chooseBeat(); };
  status_.setFont(juce::FontOptions(kStatusFontHeight));
  status_.setMinimumHorizontalScale(1.0f);
  addAndMakeVisible(loadButton_);
  addAndMakeVisible(status_);
  addAndMakeVisible(parameters_);

  processor_.addChangeListener(this);
  showBeat();
  setSize(juce::jmax(kWidthLeast, parameters_.getWidth()), kBarHeight + parameters_.getHeight());
}

BoombapbotEditor::~BoombapbotEditor() { processor_.removeChangeListener(this); }

void BoombapbotEditor::paint(juce::Graphics& graphics) {
  graphics.fillAll(getLookAndFeel().findColour(juce::ResizableWindow::backgroundColourId));
  graphics.setColour(getLookAndFeel().findColour(juce::Slider::trackColourId).withAlpha(0.35f));
  graphics.fillRect(0, kBarHeight - 1, getWidth(), 1);
}

void BoombapbotEditor::resized() {
  juce::Rectangle<int> area = getLocalBounds();
  juce::Rectangle<int> bar = area.removeFromTop(kBarHeight).reduced(kBarPadding);
  loadButton_.setBounds(bar.removeFromLeft(kButtonWidth));
  bar.removeFromLeft(kBarPadding);
  status_.setBounds(bar);
  parameters_.setBounds(area);
}

void BoombapbotEditor::changeListenerCallback(juce::ChangeBroadcaster*) { showBeat(); }

void BoombapbotEditor::chooseBeat() {
  chooser_ = std::make_unique<juce::FileChooser>("Load a beat saved from boombapbot", juce::File(), "*.json");
  const juce::Component::SafePointer<BoombapbotEditor> self(this);
  chooser_->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
                        [self](const juce::FileChooser& chooser) {
                          const juce::File file = chooser.getResult();
                          if (self != nullptr && file != juce::File()) self->loadBeat(file);
                        });
}

void BoombapbotEditor::loadBeat(const juce::File& file) {
  if (file.getSize() > boombapbot::plugin::kBeatFileBytesMost) {
    showProblem("That file is too large to be a beat file.");
    return;
  }
  const juce::Result loaded = processor_.loadBeat(file.loadFileAsString());
  if (loaded.failed()) showProblem(loaded.getErrorMessage());
}

void BoombapbotEditor::showBeat() {
  const juce::String name = processor_.beatName();
  status_.setColour(juce::Label::textColourId, getLookAndFeel().findColour(juce::Label::textColourId));
  status_.setText(name.isEmpty() ? "No beat loaded" : "Beat: " + name, juce::dontSendNotification);
}

void BoombapbotEditor::showProblem(const juce::String& problem) {
  status_.setColour(juce::Label::textColourId, kProblemColour);
  status_.setText(problem, juce::dontSendNotification);
}
