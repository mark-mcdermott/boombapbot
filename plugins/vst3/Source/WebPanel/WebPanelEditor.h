// The plugin's window: a web view showing the painted panel the site, the
// phone app and the desktop app show (packages/machine-ritm12's Panel, built
// into a page by plugins/vst3/web), with a bar under it for what a plugin has
// and the picture does not: the beat's name, its files, and undo. The page is
// served from inside the plugin; nothing comes from the network.
//
// The beat crosses whole, as the project document a beat file holds. The page
// sends its beat when a control on it changes one; the plugin sends its own
// when a host's automation or a recalled project changes it.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include "../BeatDesk.h"
#include "../PluginProcessor.h"

#include <memory>
#include <optional>

class BoombapbotWebEditor final : public juce::AudioProcessorEditor, private juce::Timer {
 public:
  // The picture is three wide to two high, and the bar lies under it.
  static constexpr int kWidth = 960;
  static constexpr int kPictureHeight = 640;
  static constexpr int kBarHeight = 44;
  static constexpr int kHeight = kPictureHeight + kBarHeight;

  explicit BoombapbotWebEditor(BoombapbotAudioProcessor& owner);
  ~BoombapbotWebEditor() override;

  void resized() override;

  // For the check that opens this window: the web view, whether its page has
  // said it is up, and the desk its file keys work.
  juce::WebBrowserComponent& browser() { return browser_; }
  boombapbot::plugin::BeatDesk& desk() { return desk_; }
  bool pageIsReady() const { return pageReady_; }

 private:
  struct Position {
    int step = -2;
    int pattern = -1;
    bool playing = false;
    bool operator==(const Position&) const = default;
  };

  void timerCallback() override;
  juce::WebBrowserComponent::Options options();
  std::optional<juce::WebBrowserComponent::Resource> resource(const juce::String& path);
  // The plugin's beat as the text of a beat file.
  juce::String beatText() const;
  void takeBeat(const juce::String& json);
  Position positionNow() const;
  void tell(const juce::String& words, boombapbot::plugin::BeatDesk::Said kind);
  void startMidiDrag();

  BoombapbotAudioProcessor& processor_;
  std::unique_ptr<juce::ZipFile> page_;
  // The beat the page was last known to have, as text.
  juce::String pageBeat_;
  Position pagePosition_;
  // What the page was last told of the meter and of undo. Nothing, until it has been told.
  std::optional<float> pageLevel_;
  std::optional<bool> pageCanUndo_;
  bool pageReady_ = false;
  boombapbot::plugin::BeatDesk desk_;
  juce::WebBrowserComponent browser_;

  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BoombapbotWebEditor)
};
