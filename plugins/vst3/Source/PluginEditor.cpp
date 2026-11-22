#include "PluginEditor.h"

#include "ParameterIds.h"

namespace {

using namespace boombapbot::plugin;
using boombapbot::panel::Lamp;
using boombapbot::panel::StepKeys;
using boombapbot::panel::words;
namespace colours = boombapbot::panel::colours;

constexpr int kWidth = 920;
constexpr int kHeight = 624;
constexpr int kMargin = 16;
constexpr int kHeaderHeight = 62;
constexpr int kNameplateWidth = 200;
constexpr int kVoiceKeyWidth = 104;
constexpr int kMuteKeyWidth = 36;
constexpr int kStepsLeft = kMargin + kVoiceKeyWidth + 6 + kMuteKeyWidth + 12;
constexpr int kStepsTop = kMargin + kHeaderHeight + 14;
constexpr int kStripTop = kStepsTop + StepKeys::kHeight + 12;
constexpr int kStripHeight = 132;
constexpr int kKnobWidth = 78;
constexpr int kGroupPadding = 10;
constexpr int kGroupGap = 12;
constexpr int kGroupTitle = 20;
constexpr int kStatusHeight = 22;
constexpr int kRefreshHz = 30;

struct KnobWords {
  const char* word;
  const char* english;
};

constexpr KnobWords kPitchWords{"ПИТЧ", "Pitch"};
constexpr KnobWords kToneWords{"ТОН", "Tone"};
constexpr KnobWords kDecayWords{"ЗАТУХАНИЕ", "Decay"};
constexpr KnobWords kLevelWords{"УРОВЕНЬ", "Level"};
constexpr KnobWords kVolumeWords{"ГРОМКОСТЬ", "Volume"};
constexpr KnobWords kAccentWords{"АКЦЕНТ", "Accent"};
constexpr KnobWords kSwingWords{"СВИНГ", "Swing"};
constexpr KnobWords kMixWords{"СМЕСЬ", "Mix"};
constexpr std::array<const char*, 5> kEffectWords{{"ВЫКЛ", "ДИЛЭЙ", "РЕВЕРБ", "ФЛЭНЖЕР", "ХОР"}};

}  // namespace

class BoombapbotEditor::ChoiceKeys final {
 public:
  ChoiceKeys(juce::Component& parent, juce::RangedAudioParameter& parameter, const juce::StringArray& keyWords,
             const juce::StringArray& english, std::function<void(int)> chosen)
      : chosen_(std::move(chosen)),
        attachment_(parameter, [this](float value) { show(juce::roundToInt(value)); }) {
    for (int index = 0; index < keyWords.size(); ++index) {
      Key* const key = keys_.add(new Key(keyWords[index], english[index]));
      key->onClick = [this, index] { attachment_.setValueAsCompleteGesture(static_cast<float>(index)); };
      parent.addAndMakeVisible(key);
    }
    attachment_.sendInitialUpdate();
  }

  Key& key(int index) { return *keys_[index]; }
  int size() const { return keys_.size(); }

 private:
  void show(int choice) {
    for (int index = 0; index < keys_.size(); ++index) {
      keys_[index]->setToggleState(index == choice, juce::dontSendNotification);
    }
    if (chosen_) chosen_(choice);
  }

  juce::OwnedArray<Key> keys_;
  std::function<void(int)> chosen_;
  juce::ParameterAttachment attachment_;
};

BoombapbotEditor::BoombapbotEditor(BoombapbotAudioProcessor& owner)
    : AudioProcessorEditor(owner),
      processor_(owner),
      steps_(owner),
      sixteenKey_("16", ""),
      twelveKey_("12", ""),
      sequencerKey_(words("СЕКВЕНСЕР"), "Sequencer"),
      clearKey_(words("СБРОС"), "Clear"),
      loadKey_(words("ЗАГРУЗКА"), "Load beat"),
      sequencerAttachment_(owner.parameters(), ids::kSequencer, sequencerKey_),
      pitch_(words(kPitchWords.word), kPitchWords.english),
      tone_(words(kToneWords.word), kToneWords.english),
      decay_(words(kDecayWords.word), kDecayWords.english),
      level_(words(kLevelWords.word), kLevelWords.english),
      volume_(words(kVolumeWords.word), kVolumeWords.english),
      accent_(words(kAccentWords.word), kAccentWords.english),
      swing_(words(kSwingWords.word), kSwingWords.english),
      effectMix_(words(kMixWords.word), kMixWords.english) {
  juce::AudioProcessorValueTreeState& parameters = processor_.parameters();
  addAndMakeVisible(steps_);

  for (int voice = 0; voice < kVoiceCount; ++voice) {
    const VoiceSpec& spec = kVoices[static_cast<std::size_t>(voice)];
    Key* const key = voiceKeys_.add(new Key(words(spec.label), spec.name));
    key->setTriggeredOnMouseDown(true);
    key->onClick = [this, voice] {
      selectVoice(voice);
      processor_.audition(voice);
    };
    addAndMakeVisible(key);

    Key* const mute = muteKeys_.add(new Key(words("М"), "", Lamp::red));
    mute->setTitle(juce::String("Mute ") + spec.name);
    mute->setClickingTogglesState(true);
    addAndMakeVisible(mute);
    muteAttachments_.add(new ButtonAttachment(parameters, ids::ofVoice(spec, ids::kMute), *mute));
  }

  juce::StringArray patternWords;
  juce::StringArray patternEnglish;
  for (const char* name : kPatternNames) {
    patternWords.add(words(name));
    patternEnglish.add({});
  }
  patternKeys_ = std::make_unique<ChoiceKeys>(*this, *parameters.getParameter(ids::kPattern), patternWords,
                                              patternEnglish, [this](int pattern) { steps_.setPattern(pattern); });
  for (int index = 0; index < patternKeys_->size(); ++index) {
    patternKeys_->key(index).setTitle("Pattern " + patternWords[index]);
  }
  juce::StringArray effectWords;
  juce::StringArray effectEnglish;
  for (std::size_t index = 0; index < kEffectWords.size(); ++index) {
    effectWords.add(words(kEffectWords[index]));
    effectEnglish.add(kEffectNames[index]);
  }
  effectKeys_ = std::make_unique<ChoiceKeys>(*this, *parameters.getParameter(ids::kEffectKind), effectWords,
                                             effectEnglish, nullptr);

  sixteenKey_.setTitle("Sixteen steps to the measure");
  twelveKey_.setTitle("Twelve triplet steps to the measure");
  sixteenKey_.onClick = [this] { processor_.setMeasureSize(16); };
  twelveKey_.onClick = [this] { processor_.setMeasureSize(12); };
  sequencerKey_.setClickingTogglesState(true);
  clearKey_.onClick = [this] {
    processor_.clearPattern(juce::roundToInt(processor_.parameters().getRawParameterValue(ids::kPattern)->load()));
    steps_.refresh();
  };
  loadKey_.onClick = [this] { chooseBeat(); };
  for (Key* key : {&sixteenKey_, &twelveKey_, &sequencerKey_, &clearKey_, &loadKey_}) addAndMakeVisible(key);

  for (Knob* knob : {&pitch_, &tone_, &decay_, &level_, &volume_, &accent_, &swing_, &effectMix_}) {
    addAndMakeVisible(knob);
  }
  mixAttachments_.add(new SliderAttachment(parameters, ids::kVolume, volume_));
  mixAttachments_.add(new SliderAttachment(parameters, ids::kAccent, accent_));
  mixAttachments_.add(new SliderAttachment(parameters, ids::kSwing, swing_));
  mixAttachments_.add(new SliderAttachment(parameters, ids::kEffectMix, effectMix_));

  status_.setFont(boombapbot::panel::lettering(12.0f));
  status_.setMinimumHorizontalScale(1.0f);
  addAndMakeVisible(status_);

  selectVoice(0);
  showState();
  processor_.addChangeListener(this);
  setSize(kWidth, kHeight);
  startTimerHz(kRefreshHz);
}

BoombapbotEditor::~BoombapbotEditor() {
  stopTimer();
  processor_.removeChangeListener(this);
}

// The four knobs of a voice work whichever voice's key was pressed last.
void BoombapbotEditor::selectVoice(int voice) {
  selectedVoice_ = voice;
  for (int index = 0; index < voiceKeys_.size(); ++index) {
    voiceKeys_[index]->setToggleState(index == voice, juce::dontSendNotification);
  }
  const VoiceSpec& spec = kVoices[static_cast<std::size_t>(voice)];
  juce::AudioProcessorValueTreeState& parameters = processor_.parameters();
  for (auto& attachment : voiceAttachments_) attachment.reset();
  voiceAttachments_[0] = std::make_unique<SliderAttachment>(parameters, ids::ofVoice(spec, ids::kPitch), pitch_);
  voiceAttachments_[1] = std::make_unique<SliderAttachment>(parameters, ids::ofVoice(spec, ids::kTone), tone_);
  voiceAttachments_[2] = std::make_unique<SliderAttachment>(parameters, ids::ofVoice(spec, ids::kDecay), decay_);
  voiceAttachments_[3] = std::make_unique<SliderAttachment>(parameters, ids::ofVoice(spec, ids::kLevel), level_);
  level_.setDoubleClickReturnValue(true, static_cast<double>(kLevelRest));
  repaint(voiceGroup_);
}

void BoombapbotEditor::paint(juce::Graphics& graphics) {
  boombapbot::panel::paintPlate(graphics, getLocalBounds().toFloat());

  juce::Rectangle<int> nameplate(kMargin, kMargin, kNameplateWidth, kHeaderHeight);
  graphics.setColour(colours::cream);
  graphics.setFont(boombapbot::panel::lettering(30.0f, true));
  graphics.drawText(words("РИТМ-12"), nameplate.removeFromTop(38), juce::Justification::bottomLeft);
  graphics.setColour(colours::engraved);
  graphics.setFont(boombapbot::panel::lettering(10.0f, true));
  graphics.drawText(words("РИТМИЧЕСКИЙ КОМПЬЮТЕР"), nameplate, juce::Justification::centredLeft);

  const juce::Rectangle<int> accents(kMargin, kStepsTop + StepKeys::rowTop(0), kVoiceKeyWidth + 6 + kMuteKeyWidth,
                                     StepKeys::kRowHeight);
  graphics.setColour(colours::cream);
  graphics.setFont(boombapbot::panel::lettering(12.0f, true));
  graphics.drawText(words("АКЦЕНТЫ"), accents.withTrimmedLeft(8), juce::Justification::centredLeft);
  graphics.setColour(colours::cream.withAlpha(0.55f));
  graphics.setFont(boombapbot::panel::lettering(9.0f));
  graphics.drawText("Accents", accents.withTrimmedRight(8), juce::Justification::centredRight);

  const VoiceSpec& voice = kVoices[static_cast<std::size_t>(selectedVoice_)];
  boombapbot::panel::paintGroup(graphics, voiceGroup_,
                                words("ГОЛОС: ") + words(voice.label) + "  " + juce::String(voice.name).toUpperCase());
  boombapbot::panel::paintGroup(graphics, mixGroup_, words("МИКС") + "  MIX");
  boombapbot::panel::paintGroup(graphics, effectGroup_, words("ЭФФЕКТ") + "  EFFECT");
}

void BoombapbotEditor::resized() {
  // The header: the nameplate, then the keys, with the load key at the far end.
  juce::Rectangle<int> header(kMargin, kMargin, getWidth() - 2 * kMargin, kHeaderHeight);
  header.removeFromLeft(kNameplateWidth);
  juce::Rectangle<int> keys = header.withSizeKeepingCentre(header.getWidth(), 40);
  for (int index = 0; index < patternKeys_->size(); ++index) {
    patternKeys_->key(index).setBounds(keys.removeFromLeft(42));
    keys.removeFromLeft(4);
  }
  keys.removeFromLeft(12);
  sixteenKey_.setBounds(keys.removeFromLeft(40));
  keys.removeFromLeft(4);
  twelveKey_.setBounds(keys.removeFromLeft(40));
  keys.removeFromLeft(16);
  sequencerKey_.setBounds(keys.removeFromLeft(100));
  keys.removeFromLeft(12);
  clearKey_.setBounds(keys.removeFromLeft(70));
  loadKey_.setBounds(keys.removeFromRight(100));

  steps_.setTopLeftPosition(kStepsLeft, kStepsTop);
  for (int voice = 0; voice < kVoiceCount; ++voice) {
    juce::Rectangle<int> row(kMargin, kStepsTop + StepKeys::rowTop(voice + 1), kVoiceKeyWidth + 6 + kMuteKeyWidth,
                             StepKeys::kRowHeight);
    voiceKeys_[voice]->setBounds(row.removeFromLeft(kVoiceKeyWidth));
    muteKeys_[voice]->setBounds(row.removeFromRight(kMuteKeyWidth));
  }

  // The strip of knobs: the voice's four, the mix's three, then the effect.
  juce::Rectangle<int> strip(kMargin, kStripTop, getWidth() - 2 * kMargin, kStripHeight);
  const auto group = [&](int width) {
    const juce::Rectangle<int> bounds = strip.removeFromLeft(width);
    strip.removeFromLeft(kGroupGap);
    return bounds;
  };
  const auto inside = [](juce::Rectangle<int> bounds) {
    return bounds.reduced(kGroupPadding, 0).withTrimmedTop(kGroupTitle).withTrimmedBottom(4);
  };
  voiceGroup_ = group(4 * kKnobWidth + 2 * kGroupPadding);
  mixGroup_ = group(3 * kKnobWidth + 2 * kGroupPadding);
  effectGroup_ = strip;

  juce::Rectangle<int> voiceKnobs = inside(voiceGroup_);
  for (Knob* knob : {&pitch_, &tone_, &decay_, &level_}) knob->setBounds(voiceKnobs.removeFromLeft(kKnobWidth));
  juce::Rectangle<int> mixKnobs = inside(mixGroup_);
  for (Knob* knob : {&volume_, &accent_, &swing_}) knob->setBounds(mixKnobs.removeFromLeft(kKnobWidth));

  juce::Rectangle<int> effect = inside(effectGroup_);
  effectMix_.setBounds(effect.removeFromRight(kKnobWidth));
  effect.removeFromRight(8);
  // Off on a row of its own, then the four effects two by two.
  juce::Rectangle<int> rows = effect.withSizeKeepingCentre(effect.getWidth(), 3 * 30 + 2 * 5);
  const int half = (rows.getWidth() - 5) / 2;
  effectKeys_->key(0).setBounds(rows.removeFromTop(30).withWidth(half));
  for (int index = 1; index < effectKeys_->size(); index += 2) {
    rows.removeFromTop(5);
    juce::Rectangle<int> row = rows.removeFromTop(30);
    effectKeys_->key(index).setBounds(row.removeFromLeft(half));
    effectKeys_->key(index + 1).setBounds(row.removeFromRight(half));
  }

  status_.setBounds(kMargin, getHeight() - kStatusHeight - 6, getWidth() - 2 * kMargin, kStatusHeight);
}

void BoombapbotEditor::changeListenerCallback(juce::ChangeBroadcaster*) { showState(); }

void BoombapbotEditor::timerCallback() { steps_.refresh(); }

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
  if (file.getSize() > kBeatFileBytesMost) {
    showProblem("That file is too large to be a beat file.");
    return;
  }
  const juce::Result loaded = processor_.loadBeat(file.loadFileAsString());
  if (loaded.failed()) showProblem(loaded.getErrorMessage());
}

void BoombapbotEditor::showState() {
  const juce::String name = processor_.beatName();
  status_.setColour(juce::Label::textColourId, colours::cream.withAlpha(0.75f));
  status_.setText(name.isEmpty() ? "No beat loaded. Press the step keys to write a pattern, or load a beat saved from the site."
                                 : "Beat: " + name,
                  juce::dontSendNotification);
  const int size = processor_.measureSize();
  sixteenKey_.setToggleState(size == 16, juce::dontSendNotification);
  twelveKey_.setToggleState(size == 12, juce::dontSendNotification);
  steps_.refresh();
}

void BoombapbotEditor::showProblem(const juce::String& problem) {
  status_.setColour(juce::Label::textColourId, colours::problem);
  status_.setText(problem, juce::dontSendNotification);
}
