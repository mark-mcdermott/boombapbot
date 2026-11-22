// Reads a beat saved from the site: a РИТМ-12 project document, the
// `.boombapbot.json` file its "save" writes. The schema it checks against is
// packages/machine-ritm12/src/document/project.ts, which is the source of
// truth.
#pragma once

#include <juce_core/juce_core.h>

#include "MachineRitm12.h"

#include <array>
#include <cstdint>

namespace boombapbot::plugin {

// Bit n is step n.
using StepRow = std::uint16_t;

struct BeatPattern {
  std::array<StepRow, kVoiceCount> hits{};
  StepRow accents = 0;
};

struct BeatVoice {
  float pitch = kSoundKnobRest;
  float tone = kSoundKnobRest;
  float decay = kSoundKnobRest;
  float level = kLevelRest;
  bool muted = false;
};

struct Beat {
  juce::String name;
  int tempo = static_cast<int>(kTempoRest);
  float swing = kSwingRest;
  int size = kSizeRest;
  std::array<BeatPattern, kPatternCount> patterns{};
  int pattern = 0;  // the one the panel was on
  float volume = kVolumeRest;
  float accent = kAccentRest;
  std::array<BeatVoice, kVoiceCount> voices{};
  int effect = kEffectRest;
  float effectMix = kEffectMixRest;
};

inline constexpr int kBeatSchemaVersion = 3;
// Far more than a beat file ever is. Anything larger is not one.
inline constexpr int kBeatFileBytesMost = 1 << 20;

// A row as the document writes it: 'x' on, '.' off.
juce::String rowText(StepRow row);
// Reads a row leniently: an 'x' is a hit, anything else or nothing is not.
StepRow rowFromText(const juce::String& text);

// Fills `beat` from the text of a beat file. On failure `beat` is left as it
// was and the result says what is wrong in words a person can act on.
juce::Result readBeat(const juce::String& json, Beat& beat);

}  // namespace boombapbot::plugin
