// How the plugin's panel is painted: РИТМ-12's olive paint, cream lettering
// and amber lamps, drawn here rather than cut from the picture of the machine.
#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

namespace boombapbot::panel {

namespace colours {
inline const juce::Colour paintLight{0xff4d4729};
inline const juce::Colour paintDark{0xff332e1b};
inline const juce::Colour edge{0xff6b5631};
inline const juce::Colour cream{0xffdccaa4};
inline const juce::Colour engraved{0x6bdccaa4};
inline const juce::Colour ink{0xff261e12};
inline const juce::Colour well{0xff17130b};
inline const juce::Colour keyFace{0xff2b2618};
inline const juce::Colour keyFaceLight{0xff3a3422};
inline const juce::Colour amberCore{0xfffff2a8};
inline const juce::Colour amber{0xffffc437};
inline const juce::Colour amberDeep{0xfff08c0c};
inline const juce::Colour red{0xffe3260e};
inline const juce::Colour redCore{0xffffd9c8};
inline const juce::Colour lcd{0xffb4bd4e};
inline const juce::Colour lcdInk{0xff1b2206};
inline const juce::Colour problem{0xffff8a70};
}  // namespace colours

juce::Font lettering(float height, bool bold = false);
// The panel's words are the machine's, in Russian, which are not ASCII.
juce::String words(const char* utf8);

void paintPlate(juce::Graphics& graphics, juce::Rectangle<float> bounds);
// A sunk strip the controls of one group sit in, with its name engraved above.
void paintGroup(juce::Graphics& graphics, juce::Rectangle<int> bounds, const juce::String& name);

enum class Lamp { off, amber, red };
// A key cap. A lit one glows the colour of its lamp.
void paintKey(juce::Graphics& graphics, juce::Rectangle<float> bounds, Lamp lamp, bool pressed, bool dimmed = false);

// A key with a word on it and, under that, the same in English.
class Key final : public juce::Button {
 public:
  Key(const juce::String& word, const juce::String& english, Lamp litAs = Lamp::amber);
  void paintButton(juce::Graphics& graphics, bool highlighted, bool down) override;

 private:
  juce::String word_;
  juce::String english_;
  Lamp litAs_;
};

// A knob: a dark body with a cream pointer, and its name under it.
class Knob final : public juce::Slider {
 public:
  Knob(const juce::String& word, const juce::String& english);
  void paint(juce::Graphics& graphics) override;

 private:
  juce::String word_;
  juce::String english_;
};

}  // namespace boombapbot::panel
