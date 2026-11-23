#include "WebPanelEditor.h"

#include "../BeatFile.h"
#include "../ParameterIds.h"

#include <BinaryData.h>

#include <cmath>

namespace {

using namespace boombapbot::plugin;

constexpr int kRefreshHz = 30;
constexpr double kShape = static_cast<double>(BoombapbotWebEditor::kWidth) / BoombapbotWebEditor::kHeight;
// The page's own switch between its two views looks at the window's width. A
// plugin's window is the picture at any size.
constexpr const char* kPage = "index.html?panel=picture";

const juce::Identifier kBeatEvent{"beat"};
const juce::Identifier kReportEvent{"report"};
const juce::Identifier kUndoEvent{"undo"};
const juce::Identifier kSaidEvent{"said"};
// A meter is not told of a change it could not show.
constexpr float kLevelStep = 0.001f;

bool samePatterns(const Beat& a, const Beat& b) {
  if (a.size != b.size) return false;
  for (std::size_t index = 0; index < a.patterns.size(); ++index) {
    if (a.patterns[index].hits != b.patterns[index].hits || a.patterns[index].accents != b.patterns[index].accents) {
      return false;
    }
  }
  return true;
}

juce::String mimeOf(const juce::String& path) {
  const juce::String extension = path.fromLastOccurrenceOf(".", false, false).toLowerCase();
  if (extension == "html") return "text/html";
  if (extension == "js") return "text/javascript";
  if (extension == "css") return "text/css";
  if (extension == "json") return "application/json";
  if (extension == "svg") return "image/svg+xml";
  if (extension == "png") return "image/png";
  if (extension == "webp") return "image/webp";
  if (extension == "woff2") return "font/woff2";
  if (extension == "wasm") return "application/wasm";
  return "application/octet-stream";
}

// A stamp that never changes, so that two beats written with it are the same
// text exactly when they are the same beat.
const BeatStamp& pageStamp() {
  static const BeatStamp stamp{"plugin", juce::Time(2000, 0, 1, 0, 0, 0, 0, false)};
  return stamp;
}

int scaled(int length, float scale) { return juce::roundToInt(static_cast<float>(length) * scale); }

}  // namespace

BoombapbotWebEditor::BoombapbotWebEditor(BoombapbotAudioProcessor& owner)
    : AudioProcessorEditor(owner),
      processor_(owner),
      page_(std::make_unique<juce::ZipFile>(std::make_unique<juce::MemoryInputStream>(
          BinaryData::panel_zip, static_cast<std::size_t>(BinaryData::panel_zipSize), false))),
      desk_(owner, [this](const juce::String& words, BeatDesk::Said kind) { tell(words, kind); }),
      browser_(options()) {
  // Read first: setting the limits below resizes the window, and a resize is remembered.
  const float scale = processor_.windowScale();
  addAndMakeVisible(browser_);
  setResizable(true, true);
  setResizeLimits(scaled(kWidth, kWindowScaleLeast), scaled(kHeight, kWindowScaleLeast),
                  scaled(kWidth, kWindowScaleMost), scaled(kHeight, kWindowScaleMost));
  getConstrainer()->setFixedAspectRatio(kShape);
  setSize(scaled(kWidth, scale), scaled(kHeight, scale));
  browser_.goToURL(juce::WebBrowserComponent::getResourceProviderRoot() + kPage);
  startTimerHz(kRefreshHz);
}

BoombapbotWebEditor::~BoombapbotWebEditor() { stopTimer(); }

// The size the window was left at is kept with the plugin, so it opens there again.
void BoombapbotWebEditor::resized() {
  browser_.setBounds(getLocalBounds());
  processor_.setWindowScale(static_cast<float>(getWidth()) / kWidth);
}

juce::WebBrowserComponent::Options BoombapbotWebEditor::options() {
  using Completion = juce::WebBrowserComponent::NativeFunctionCompletion;
  return juce::WebBrowserComponent::Options()
      .withNativeIntegrationEnabled()
      .withKeepPageLoadedWhenBrowserIsHidden()
      .withResourceProvider([this](const juce::String& path) { return resource(path); })
      .withNativeFunction("licenseFile",
                          [this](const juce::Array<juce::var>&, Completion done) {
                            done(juce::String(processor_.licenseFile()));
                          })
      .withNativeFunction("getBeat",
                          [this](const juce::Array<juce::var>&, Completion done) {
                            pageBeat_ = beatText();
                            done(pageBeat_);
                          })
      .withNativeFunction("setBeat",
                          [this](const juce::Array<juce::var>& arguments, Completion done) {
                            takeBeat(arguments[0].toString());
                            done(juce::var());
                          })
      .withNativeFunction("trigger",
                          [this](const juce::Array<juce::var>& arguments, Completion done) {
                            // The page counts engine tracks; track 0 is the accents.
                            processor_.audition(static_cast<int>(arguments[0]) - 1);
                            done(juce::var());
                          })
      .withNativeFunction("setSequencer",
                          [this](const juce::Array<juce::var>& arguments, Completion done) {
                            if (auto* const sequencer = processor_.parameters().getParameter(ids::kSequencer)) {
                              sequencer->setValueNotifyingHost(static_cast<bool>(arguments[0]) ? 1.0f : 0.0f);
                            }
                            done(juce::var());
                          })
      .withNativeFunction("sequencerOn",
                          [this](const juce::Array<juce::var>&, Completion done) {
                            done(processor_.parameters().getRawParameterValue(ids::kSequencer)->load() >= 0.5f);
                          })
      .withNativeFunction("sampleRate",
                          [this](const juce::Array<juce::var>&, Completion done) {
                            const double rate = processor_.getSampleRate();
                            done(rate > 0.0 ? rate : 48000.0);
                          })
      .withNativeFunction("holdKnob",
                          [this](const juce::Array<juce::var>& arguments, Completion done) {
                            if (static_cast<bool>(arguments[0])) {
                              processor_.holdKnob();
                            } else {
                              processor_.letGoOfKnob();
                            }
                            done(juce::var());
                          })
      .withNativeFunction("loadBeat",
                          [this](const juce::Array<juce::var>&, Completion done) {
                            desk_.chooseBeat();
                            done(juce::var());
                          })
      .withNativeFunction("saveBeat",
                          [this](const juce::Array<juce::var>&, Completion done) {
                            desk_.chooseWhereToSave();
                            done(juce::var());
                          })
      .withNativeFunction("saveMidi",
                          [this](const juce::Array<juce::var>&, Completion done) {
                            desk_.chooseWhereToSaveMidi();
                            done(juce::var());
                          })
      .withNativeFunction("dragMidi",
                          [this](const juce::Array<juce::var>&, Completion done) {
                            startMidiDrag();
                            done(juce::var());
                          })
      .withNativeFunction("undo",
                          [this](const juce::Array<juce::var>&, Completion done) {
                            done(processor_.undoPatterns());
                          })
      .withNativeFunction("pageReady", [this](const juce::Array<juce::var>&, Completion done) {
        pageReady_ = true;
        done(juce::var());
      });
}

// The page is one zip inside the plugin. A path is a file in it; the address's
// root is the page itself, and anything after a question mark is the page's own.
std::optional<juce::WebBrowserComponent::Resource> BoombapbotWebEditor::resource(const juce::String& path) {
  juce::String name = path.upToFirstOccurrenceOf("?", false, false).trimCharactersAtStart("/");
  if (name.isEmpty()) name = "index.html";
  const int index = page_->getIndexOfFileName(name);
  if (index < 0) return std::nullopt;
  const std::unique_ptr<juce::InputStream> stream(page_->createStreamForEntry(index));
  if (stream == nullptr) return std::nullopt;
  juce::MemoryBlock bytes;
  stream->readIntoMemoryBlock(bytes);
  const auto* const first = static_cast<const std::byte*>(bytes.getData());
  return juce::WebBrowserComponent::Resource{std::vector<std::byte>(first, first + bytes.getSize()), mimeOf(name)};
}

juce::String BoombapbotWebEditor::beatText() const {
  return writeBeat(processor_.currentBeat(), pageStamp());
}

// A beat from the page. What the page sent is what it is taken to have, so
// it is not sent its own change back, and is sent whatever the plugin did not
// take: the tempo, which is the host's. A change to the patterns is one step
// of the plugin's undo, as a press on the panel drawn here is.
void BoombapbotWebEditor::takeBeat(const juce::String& json) {
  Beat beat;
  if (readBeat(json, beat).failed()) return;
  if (!samePatterns(beat, processor_.currentBeat())) processor_.rememberPatterns();
  processor_.applyBeat(beat);
  pageBeat_ = writeBeat(beat, pageStamp());
}

void BoombapbotWebEditor::tell(const juce::String& words, BeatDesk::Said kind) {
  juce::DynamicObject::Ptr said = new juce::DynamicObject();
  said->setProperty("words", words);
  said->setProperty("problem", kind == BeatDesk::Said::problem);
  browser_.emitEventIfBrowserIsVisible(kSaidEvent, said.get());
}

// The page asks for this as its MIDI key is dragged. A drag out of the window
// is the system's, and it starts from the mouse button that is down; with
// none down there is nothing to start it from.
void BoombapbotWebEditor::startMidiDrag() {
  if (!juce::ModifierKeys::getCurrentModifiersRealtime().isLeftButtonDown()) return;
  desk_.dragMidiOut(browser_);
}

BoombapbotWebEditor::Position BoombapbotWebEditor::positionNow() const {
  return {processor_.playingStep(), processor_.playingPattern(),
          processor_.parameters().getRawParameterValue(ids::kSequencer)->load() >= 0.5f};
}

// What changed in the plugin without the page: a host's automation, a project
// recalled, the sequencer moving on.
void BoombapbotWebEditor::timerCallback() {
  if (!pageReady_) return;
  if (const juce::String beat = beatText(); beat != pageBeat_) {
    pageBeat_ = beat;
    browser_.emitEventIfBrowserIsVisible(kBeatEvent, beat);
  }
  if (const Position position = positionNow(); !(position == pagePosition_)) {
    pagePosition_ = position;
    juce::DynamicObject::Ptr report = new juce::DynamicObject();
    report->setProperty("type", "position");
    report->setProperty("step", position.step);
    report->setProperty("pattern", position.pattern);
    report->setProperty("playing", position.playing);
    browser_.emitEventIfBrowserIsVisible(kReportEvent, report.get());
  }
  if (const float level = processor_.outputLevel(); !pageLevel_ || std::abs(level - *pageLevel_) >= kLevelStep) {
    pageLevel_ = level;
    juce::DynamicObject::Ptr report = new juce::DynamicObject();
    report->setProperty("type", "level");
    report->setProperty("level", level);
    browser_.emitEventIfBrowserIsVisible(kReportEvent, report.get());
  }
  if (const bool canUndo = processor_.canUndoPatterns(); pageCanUndo_ != canUndo) {
    pageCanUndo_ = canUndo;
    browser_.emitEventIfBrowserIsVisible(kUndoEvent, canUndo);
  }
}
