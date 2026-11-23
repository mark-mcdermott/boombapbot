// A trial: the plugin's window as a web view showing the painted panel the
// site, the phone app and the desktop app show (packages/machine-ritm12's
// Panel, built into a page by plugins/vst3/web). The page is served from
// inside the plugin; nothing comes from the network.
//
// The beat crosses whole, as the project document a beat file holds. The page
// sends its beat when a control on it changes one; the plugin sends its own
// when a host's automation or a recalled project changes it.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include "../PluginProcessor.h"

#include <memory>

class BoombapbotWebEditor final : public juce::AudioProcessorEditor, private juce::Timer {
 public:
  // The picture is three wide to two high.
  static constexpr int kWidth = 960;
  static constexpr int kHeight = 640;

  explicit BoombapbotWebEditor(BoombapbotAudioProcessor& owner);
  ~BoombapbotWebEditor() override;

  void resized() override;

  // For the check that opens this window: the web view, and whether its page has said it is up.
  juce::WebBrowserComponent& browser() { return browser_; }
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
  // The plugin's beat as the text of a beat file, with a stamp that never changes,
  // so that two of them are the same text exactly when the beat is the same.
  juce::String beatText() const;
  void takeBeat(const juce::String& json);
  Position positionNow() const;

  BoombapbotAudioProcessor& processor_;
  std::unique_ptr<juce::ZipFile> page_;
  // The beat the page was last known to have, as text.
  juce::String pageBeat_;
  Position pagePosition_;
  bool pageReady_ = false;
  juce::WebBrowserComponent browser_;

  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BoombapbotWebEditor)
};
