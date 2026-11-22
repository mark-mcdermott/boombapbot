// РИТМ-12 as the plugin plays it: its voices, the MIDI note each answers to,
// where each sits in the mix, and the arithmetic of its knobs.
//
// The voice table mirrors packages/machine-ritm12/data/ritm12.machine.json,
// which is the source of truth; the self-test compares the two. The knob
// arithmetic and resting positions follow src/document/machine.ts and
// createProject in src/document/project.ts of the same package.
#pragma once

#include <boombapbot/engine.h>

#include <array>
#include <cmath>
#include <cstdint>

namespace boombapbot::plugin {

// A voice's place in kVoices is its sound number and sound slot, and one less
// than its engine track: track 0 holds the accents.
struct VoiceSpec {
  const char* id;
  const char* name;
  const char* label;  // as it is lettered on the panel, in UTF-8
  int gmNote;
  float trim;
  float pan;
  int chokeGroup;
};

inline constexpr int kVoiceCount = 8;

// The two hats share choke group 1, so a closed hat cuts a ringing open hat.
inline constexpr std::array<VoiceSpec, kVoiceCount> kVoices{{
    {"kick", "Kick", "БАС", 36, 0.9f, 0.0f, 0},
    {"snare", "Snare", "МАЛЫЙ", 38, 0.75f, 0.0f, 0},
    {"clap", "Clap", "ХЛОП", 39, 0.7f, 0.0f, 0},
    {"closed_hat", "Closed hat", "ХЭТ З", 42, 0.4f, 0.2f, 1},
    {"open_hat", "Open hat", "ХЭТ О", 46, 0.4f, 0.2f, 1},
    {"tom", "Tom", "ТОМ", 45, 0.7f, -0.2f, 0},
    {"rim", "Rim", "РИМ", 37, 0.6f, 0.15f, 0},
    {"perc", "Perc", "ПЕРК", 56, 0.55f, -0.15f, 0},
}};

constexpr int voiceTrack(int voice) { return voice + 1; }

// Where the knobs of a new project stand.
inline constexpr float kSoundKnobRest = 0.5f;
inline constexpr float kLevelRest = 0.75f;
inline constexpr float kVolumeRest = 0.8f;
inline constexpr float kAccentRest = 0.6f;
inline constexpr float kEffectMixRest = 0.0f;
inline constexpr double kTempoRest = 104.0;

// The engine's sound parameters are named for its first machine. This one has
// no fourth knob, and the editor sends its centre.
inline constexpr float kUnusedSnappy = 0.5f;

inline double levelGain(const VoiceSpec& voice, float level) {
  const double turned = static_cast<double>(level) / static_cast<double>(kLevelRest);
  return static_cast<double>(voice.trim) * turned * turned;
}

inline double masterGain(float volume) { return std::pow(static_cast<double>(volume), 1.5); }

inline constexpr double kAccentedGain = 1.0;

// The machine has two loudnesses, so a note is an accented hit from this
// velocity up. It is halfway between the velocities the editor's MIDI export
// writes with the accent knob at rest: 81 for a plain hit and 127 for an
// accented one.
inline constexpr int kAccentVelocity = 104;

// ---- Patterns ----------------------------------------------------------------

inline constexpr int kPatternCount = 4;
inline constexpr int kSteps = 16;
// Lettered as on the panel.
inline constexpr std::array<const char*, kPatternCount> kPatternNames{{"А", "Б", "В", "Г"}};
inline constexpr float kSwingRest = 0.0f;

// A measure plays sixteen sixteenths or twelve triplet eighths. Either way it
// is four beats long.
inline constexpr int kSizeRest = 16;
constexpr bool validSize(int size) { return size == 16 || size == 12; }
constexpr int stepsPerBeat(int size) { return size == 16 ? 4 : 3; }

// How likely the dice are to put a hit on a step: likelier on the beat. As in
// src/session.ts of the machine's package.
constexpr double diceChance(int step, int size) {
  if (step % stepsPerBeat(size) == 0) return 0.55;
  return step % 2 == 0 ? 0.3 : 0.14;
}

// The swing knob in the engine's units: fully right is the most there is.
inline int engineSwing(float swing) { return static_cast<int>(std::lround(static_cast<double>(swing) * SNARE_SWING_MAX)); }

// A plain hit's gain for where the accent knob stands; an accented hit is at 1.
inline double plainGain(float accent) { return 1.0 - 0.6 * static_cast<double>(accent); }

// How much larger or smaller than its own size the panel may be shown.
inline constexpr float kWindowScaleRest = 1.0f;
inline constexpr float kWindowScaleLeast = 0.7f;
inline constexpr float kWindowScaleMost = 2.0f;

// The effect choices in the order the parameter lists them. A choice's index
// is the engine's number for it.
inline constexpr std::array<const char*, 5> kEffectNames{{"Off", "Delay", "Reverb", "Flanger", "Chorus"}};
inline constexpr int kEffectRest = SNARE_EFFECT_DELAY;

static_assert(SNARE_EFFECT_NONE == 0 && SNARE_EFFECT_DELAY == 1 && SNARE_EFFECT_REVERB == 2 &&
              SNARE_EFFECT_FLANGER == 3 && SNARE_EFFECT_CHORUS == 4);

}  // namespace boombapbot::plugin
