#include "PatternMidi.h"

#include <cmath>

namespace boombapbot::plugin {

int plainVelocity(float accent) {
  const int asGain = static_cast<int>(std::lround(plainGain(accent) * kAccentedVelocity));
  return juce::jlimit(1, kAccentVelocity - 1, asGain);
}

juce::MemoryBlock writePatternMidi(const Beat& beat, int pattern) {
  if (pattern < 0 || pattern >= kPatternCount) return {};
  const BeatPattern& source = beat.patterns[static_cast<std::size_t>(pattern)];
  const int size = validSize(beat.size) ? beat.size : kSizeRest;

  // Track 0 holds the accents and each voice follows, as in the engine.
  SnarePattern measure{};
  std::uint8_t notes[SNARE_TRACKS] = {};
  measure.rows[0] = source.accents;
  for (int voice = 0; voice < kVoiceCount; ++voice) {
    const auto index = static_cast<std::size_t>(voice);
    measure.rows[voiceTrack(voice)] = source.hits[index];
    notes[voiceTrack(voice)] = static_cast<std::uint8_t>(kVoices[index].gmNote);
  }
  measure.len1 = static_cast<std::uint8_t>(size);
  measure.steps_per_beat = static_cast<std::uint8_t>(stepsPerBeat(size));
  measure.swing = static_cast<std::uint8_t>(engineSwing(beat.swing));

  const std::uint8_t sequence[] = {0};
  const auto write = [&](std::uint8_t* out, int capacity) {
    return snare_midi_export(&measure, 1, sequence, 1, notes, plainVelocity(beat.accent), kAccentedVelocity,
                             static_cast<double>(beat.tempo), out, capacity);
  };
  const int bytes = write(nullptr, 0);
  if (bytes <= 0) return {};
  juce::MemoryBlock file(static_cast<std::size_t>(bytes));
  write(static_cast<std::uint8_t*>(file.getData()), bytes);
  return file;
}

juce::String patternMidiFileName(const juce::String& beatName, int pattern) {
  return beatFileName(beatName).upToLastOccurrenceOf(kBeatFileSuffix, false, false) + "-" + juce::String(pattern + 1) +
         ".mid";
}

}  // namespace boombapbot::plugin
