// One pattern of a beat as a Standard MIDI File, written by the engine's own
// exporter, the one behind the site's MIDI export: one measure, the drums on
// channel 10 on the voices' General MIDI notes, at the beat's tempo and swing.
#pragma once

#include <juce_core/juce_core.h>

#include "BeatFile.h"

namespace boombapbot::plugin {

// The velocities a hit is written at. An accented step is at full velocity. A
// plain one is at the accent knob's gain, as the site writes it, but never as
// high as the velocity this plugin takes for an accent: played back into the
// plugin, a plain hit has to stay one.
inline constexpr int kAccentedVelocity = 127;
int plainVelocity(float accent);

// Empty if the pattern is not one the beat has.
juce::MemoryBlock writePatternMidi(const Beat& beat, int pattern);
// "sunday-at-the-garage-2.mid" for the second pattern of that beat.
juce::String patternMidiFileName(const juce::String& beatName, int pattern);

}  // namespace boombapbot::plugin
