#include "WebPanelEditor.h"

#include "../BeatFile.h"
#include "../ParameterIds.h"

#include <BinaryData.h>

namespace {

using namespace boombapbot::plugin;

constexpr int kRefreshHz = 30;
constexpr double kShape = static_cast<double>(BoombapbotWebEditor::kWidth) / BoombapbotWebEditor::kHeight;
constexpr float kSmallest = 0.6f;
constexpr float kLargest = 2.0f;
// The page's own switch between its two views looks at the window's width. A
// plugin's window is the picture at any size.
constexpr const char* kPage = "index.html?panel=picture";

const juce::Identifier kBeatEvent{"beat"};
const juce::Identifier kReportEvent{"report"};

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

int scaled(int length, float scale) { return juce::roundToInt(static_cast<float>(length) * scale); }

}  // namespace

BoombapbotWebEditor::BoombapbotWebEditor(BoombapbotAudioProcessor& owner)
    : AudioProcessorEditor(owner),
      processor_(owner),
      page_(std::make_unique<juce::ZipFile>(
          new juce::MemoryInputStream(BinaryData::panel_zip, static_cast<std::size_t>(BinaryData::panel_zipSize), false),
          true)),
      browser_(options()) {
  addAndMakeVisible(browser_);
  setResizable(true, true);
  setResizeLimits(scaled(kWidth, kSmallest), scaled(kHeight, kSmallest), scaled(kWidth, kLargest),
                  scaled(kHeight, kLargest));
  getConstrainer()->setFixedAspectRatio(kShape);
  setSize(kWidth, kHeight);
  browser_.goToURL(juce::WebBrowserComponent::getResourceProviderRoot() + kPage);
  startTimerHz(kRefreshHz);
}

BoombapbotWebEditor::~BoombapbotWebEditor() { stopTimer(); }

void BoombapbotWebEditor::resized() { browser_.setBounds(getLocalBounds()); }

juce::WebBrowserComponent::Options BoombapbotWebEditor::options() {
  using Completion = juce::WebBrowserComponent::NativeFunctionCompletion;
  return juce::WebBrowserComponent::Options()
      .withNativeIntegrationEnabled()
      .withKeepPageLoadedWhenBrowserIsHidden()
      .withResourceProvider([this](const juce::String& path) { return resource(path); })
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
  static const BeatStamp stamp{"plugin", juce::Time(2000, 0, 1, 0, 0, 0, 0, false)};
  return writeBeat(processor_.currentBeat(), stamp);
}

// A beat from the page. What the plugin then holds is what the page is taken
// to have, so the page is not sent its own change back.
void BoombapbotWebEditor::takeBeat(const juce::String& json) {
  Beat beat;
  if (readBeat(json, beat).failed()) return;
  processor_.applyBeat(beat);
  pageBeat_ = beatText();
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
}
