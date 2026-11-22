#include "PanelStyle.h"

#include <cmath>

namespace boombapbot::panel {
namespace {

constexpr float kKeyCorner = 5.0f;
constexpr float kKnobLabelHeight = 28.0f;
constexpr float kKnobSweep = 2.35f;  // radians either side of straight up

juce::ColourGradient lampGlow(juce::Rectangle<float> bounds, Lamp lamp) {
  const bool red = lamp == Lamp::red;
  juce::ColourGradient glow(red ? colours::redCore : colours::amberCore, bounds.getCentreX(),
                            bounds.getY() + bounds.getHeight() * 0.42f, red ? colours::red : colours::amberDeep,
                            bounds.getX(), bounds.getBottom(), true);
  glow.addColour(0.5, red ? colours::red.brighter(0.25f) : colours::amber);
  return glow;
}

}  // namespace

juce::Font lettering(float height, bool bold) {
  return juce::Font(juce::FontOptions(height, bold ? juce::Font::bold : juce::Font::plain));
}

juce::String words(const char* utf8) { return juce::String::fromUTF8(utf8); }

void paintPlate(juce::Graphics& graphics, juce::Rectangle<float> bounds) {
  graphics.setGradientFill(juce::ColourGradient(colours::paintLight, bounds.getTopLeft(), colours::paintDark,
                                                bounds.getBottomRight(), false));
  graphics.fillRect(bounds);
  // The paint is darker toward the edges, as on the picture.
  juce::ColourGradient shade(juce::Colours::transparentBlack, bounds.getCentre(), juce::Colour(0x8a0e0902),
                             bounds.getTopLeft(), true);
  shade.addColour(0.7, juce::Colours::transparentBlack);
  graphics.setGradientFill(shade);
  graphics.fillRect(bounds);
  graphics.setColour(colours::edge);
  graphics.drawRect(bounds, 2.0f);
  graphics.setColour(juce::Colour(0x33ffe8b4));
  graphics.drawRect(bounds.reduced(2.0f), 1.0f);
}

void paintGroup(juce::Graphics& graphics, juce::Rectangle<int> bounds, const juce::String& name) {
  const juce::Rectangle<float> area = bounds.toFloat();
  graphics.setColour(juce::Colour(0x38000000));
  graphics.fillRoundedRectangle(area, 8.0f);
  graphics.setColour(juce::Colour(0x2affe8b4));
  graphics.drawRoundedRectangle(area.reduced(0.5f), 8.0f, 1.0f);
  graphics.setColour(colours::engraved);
  graphics.setFont(lettering(10.0f, true));
  graphics.drawText(name, bounds.withHeight(18).translated(10, 3), juce::Justification::centredLeft);
}

void paintKey(juce::Graphics& graphics, juce::Rectangle<float> bounds, Lamp lamp, bool pressed, bool dimmed) {
  const juce::Rectangle<float> cap = bounds.reduced(1.0f).translated(0.0f, pressed ? 1.0f : 0.0f);
  if (lamp != Lamp::off) {
    graphics.setColour((lamp == Lamp::red ? colours::red : colours::amber).withAlpha(0.28f));
    graphics.fillRoundedRectangle(cap.expanded(3.0f), kKeyCorner + 3.0f);
  } else {
    graphics.setColour(juce::Colour(0x99000000));
    graphics.fillRoundedRectangle(cap.translated(0.0f, 1.5f), kKeyCorner);
  }

  if (lamp != Lamp::off) {
    graphics.setGradientFill(lampGlow(cap, lamp));
  } else {
    graphics.setGradientFill(juce::ColourGradient(colours::keyFaceLight, cap.getTopLeft(), colours::keyFace,
                                                  cap.getBottomLeft(), false));
  }
  graphics.setOpacity(dimmed ? 0.35f : 1.0f);
  graphics.fillRoundedRectangle(cap, kKeyCorner);
  graphics.setOpacity(1.0f);
  graphics.setColour(juce::Colour(lamp != Lamp::off ? 0x55fff6d0 : 0x26ffe8b4).withMultipliedAlpha(dimmed ? 0.4f : 1.0f));
  graphics.drawRoundedRectangle(cap.reduced(0.5f), kKeyCorner, 1.0f);
}

Key::Key(const juce::String& word, const juce::String& english, Lamp litAs)
    : Button(english), word_(word), english_(english), litAs_(litAs) {
  setTitle(english);
}

void Key::paintButton(juce::Graphics& graphics, bool highlighted, bool down) {
  const bool lit = getToggleState();
  const juce::Rectangle<float> bounds = getLocalBounds().toFloat();
  paintKey(graphics, bounds, lit ? litAs_ : Lamp::off, down, !isEnabled());
  if (highlighted && !lit) {
    graphics.setColour(juce::Colour(0x14ffffff));
    graphics.fillRoundedRectangle(bounds.reduced(1.0f), kKeyCorner);
  }
  if (hasKeyboardFocus(true)) {
    graphics.setColour(colours::cream.withAlpha(0.8f));
    graphics.drawRoundedRectangle(bounds.reduced(1.5f), kKeyCorner, 1.0f);
  }

  juce::Rectangle<int> text = getLocalBounds().translated(0, down ? 1 : 0);
  const bool twoLines = english_.isNotEmpty() && getHeight() >= 30;
  graphics.setColour(lit ? colours::ink : colours::cream.withAlpha(isEnabled() ? 1.0f : 0.4f));
  graphics.setFont(lettering(twoLines ? 12.0f : 12.5f, true));
  if (!twoLines) {
    graphics.drawText(word_, text, juce::Justification::centred);
    return;
  }
  graphics.drawText(word_, text.removeFromTop(getHeight() / 2 + 3).withTrimmedTop(4), juce::Justification::centred);
  graphics.setColour((lit ? colours::ink : colours::cream).withAlpha(lit ? 0.75f : 0.55f));
  graphics.setFont(lettering(9.0f));
  graphics.drawText(english_, text.withTrimmedBottom(4), juce::Justification::centred);
}

Knob::Knob(const juce::String& word, const juce::String& english)
    : Slider(juce::Slider::RotaryHorizontalVerticalDrag, juce::Slider::NoTextBox), word_(word), english_(english) {
  setTitle(english);
  setRotaryParameters(juce::MathConstants<float>::twoPi - kKnobSweep, juce::MathConstants<float>::twoPi + kKnobSweep,
                      true);
  setDoubleClickReturnValue(true, 0.5);
}

void Knob::paint(juce::Graphics& graphics) {
  juce::Rectangle<float> area = getLocalBounds().toFloat();
  juce::Rectangle<float> label = area.removeFromBottom(kKnobLabelHeight);
  const float size = juce::jmin(area.getWidth(), area.getHeight()) - 18.0f;
  const juce::Rectangle<float> body = juce::Rectangle<float>(size, size).withCentre(area.getCentre());
  const juce::Point<float> centre = body.getCentre();
  const float radius = size * 0.5f;
  const auto proportion = static_cast<float>(valueToProportionOfLength(getValue()));
  const float angle = (proportion * 2.0f - 1.0f) * kKnobSweep;

  // The scale around the knob: engraved, and lit as far as the knob is turned.
  juce::Path scale;
  scale.addCentredArc(centre.x, centre.y, radius + 4.0f, radius + 4.0f, 0.0f, -kKnobSweep, kKnobSweep, true);
  graphics.setColour(colours::engraved.withMultipliedAlpha(0.6f));
  graphics.strokePath(scale, juce::PathStrokeType(2.0f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
  juce::Path turned;
  turned.addCentredArc(centre.x, centre.y, radius + 4.0f, radius + 4.0f, 0.0f, -kKnobSweep, angle, true);
  graphics.setColour(colours::amber.withAlpha(isEnabled() ? 0.95f : 0.3f));
  graphics.strokePath(turned, juce::PathStrokeType(2.0f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));

  graphics.setColour(juce::Colour(0xaa000000));
  graphics.fillEllipse(body.translated(0.0f, 2.0f));
  graphics.setGradientFill(juce::ColourGradient(juce::Colour(0xff3b3524), centre.x, body.getY(),
                                                juce::Colour(0xff0d0a05), centre.x, body.getBottom(), false));
  graphics.fillEllipse(body);
  graphics.setColour(juce::Colour(0x40ffe8b4));
  graphics.drawEllipse(body.reduced(0.5f), 1.0f);

  juce::Path pointer;
  pointer.addRoundedRectangle(-1.5f, -radius + 4.0f, 3.0f, radius * 0.55f, 1.5f);
  graphics.setColour(colours::cream.withAlpha(isEnabled() ? 1.0f : 0.4f));
  graphics.fillPath(pointer, juce::AffineTransform::rotation(angle).translated(centre));
  if (hasKeyboardFocus(true)) {
    graphics.setColour(colours::cream.withAlpha(0.8f));
    graphics.drawEllipse(body.expanded(1.5f), 1.0f);
  }

  graphics.setColour(colours::cream);
  graphics.setFont(lettering(11.0f, true));
  graphics.drawText(word_, label.removeFromTop(15.0f), juce::Justification::centred);
  graphics.setColour(colours::cream.withAlpha(0.55f));
  graphics.setFont(lettering(9.0f));
  graphics.drawText(english_, label, juce::Justification::centredTop);
}

}  // namespace boombapbot::panel
