// The ids of the plugin's parameters. They are baked into host sessions and
// saved states. Never rename one.
#pragma once

#include <juce_core/juce_core.h>

#include "MachineRitm12.h"

namespace boombapbot::plugin::ids {

inline constexpr const char* kPitch = "pitch";
inline constexpr const char* kTone = "tone";
inline constexpr const char* kDecay = "decay";
inline constexpr const char* kLevel = "level";
inline constexpr const char* kMute = "mute";

inline constexpr const char* kVolume = "master_volume";
inline constexpr const char* kEffectKind = "effect_kind";
inline constexpr const char* kEffectMix = "effect_mix";
inline constexpr const char* kAccent = "accent";
inline constexpr const char* kSwing = "swing";
inline constexpr const char* kPattern = "pattern";
inline constexpr const char* kSequencer = "sequencer";

// A voice's knob: "kick_pitch", "closed_hat_mute".
inline juce::String ofVoice(const VoiceSpec& voice, const char* knob) { return juce::String(voice.id) + "_" + knob; }

}  // namespace boombapbot::plugin::ids
