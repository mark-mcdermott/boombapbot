// Reads and writes a beat as the site saves one: a РИТМ-12 project document,
// the `.boombapbot.json` file its "save" writes. The schema it checks against is
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
  int selectedVoice = 0;
  float volume = kVolumeRest;
  float accent = kAccentRest;
  std::array<BeatVoice, kVoiceCount> voices{};
  int effect = kEffectRest;
  float effectMix = kEffectMixRest;
  // The effect a read beat named, as the document names it, when it is one
  // of the upgrade's. The plugin does not have those yet: such a beat is read
  // with its effect off, and what it named is here to be said. It is not
  // written back.
  juce::String upgradeEffect;
};

inline constexpr int kBeatSchemaVersion = 3;
// Far more than a beat file ever is. Anything larger is not one.
inline constexpr int kBeatFileBytesMost = 1 << 20;

// A row as the document writes it: 'x' on, '.' off.
juce::String rowText(StepRow row);
// Reads a row leniently: an 'x' is a hit, anything else or nothing is not.
StepRow rowFromText(const juce::String& text);

inline constexpr const char* kBeatFileSuffix = ".boombapbot.json";
inline constexpr const char* kUntitledBeat = "Untitled beat";
inline constexpr int kBeatNameLongest = 80;
// A name as a beat keeps one: no space at either end, and no longer than the site takes.
juce::String tidyBeatName(const juce::String& name);

// Which beat a file is and when it was written. The site tells beats apart by id.
struct BeatStamp {
  juce::String id;
  juce::Time written;
};

// A stamp for a beat saved now, with an id no other beat has.
BeatStamp newBeatStamp();

// The text of a beat file the site opens. Knob positions are written to six
// places, which is finer than a hand or a host sets them. The document has no
// "no effect": that is an effect with none of it mixed in, so a beat whose
// effect is off is written as the delay at 0.
juce::String writeBeat(const Beat& beat, const BeatStamp& stamp);
// A file name for a beat: its name in lower case with dashes, as the site makes one.
juce::String beatFileName(const juce::String& beatName);

// Fills `beat` from the text of a beat file. On failure `beat` is left as it
// was and the result says what is wrong in words a person can act on.
juce::Result readBeat(const juce::String& json, Beat& beat);

}  // namespace boombapbot::plugin
