// Loads an engine setup, as the editor writes it (EngineSetup in
// packages/editor/src/engine/setup.ts), into engine structures. It knows no
// machine: a machine's own code turns its project into a setup, and this
// applies that setup with the same calls, in the same order, as the editor.
#pragma once

#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

#include "boombapbot/engine.h"
#include "json_min.h"

namespace snare::io {

struct SetupTrack {
  int track = 0;
  int slot = 0;
  float pan = 0.0f;
  int chokeGroup = 0;
  double gain = 1.0;
};

struct Setup {
  double tempo = 120.0;
  std::vector<SnareSoundParams> sounds;
  std::vector<SetupTrack> tracks;
  double plain = 1.0;
  double accented = 1.0;
  double master = 1.0;
  std::vector<SnarePattern> patterns;
  int effect = SNARE_EFFECT_NONE;
  double wet = 0.0;
};

inline int effectNamed(const std::string& name) {
  if (name == "none") return SNARE_EFFECT_NONE;
  if (name == "delay") return SNARE_EFFECT_DELAY;
  if (name == "reverb") return SNARE_EFFECT_REVERB;
  if (name == "flanger") return SNARE_EFFECT_FLANGER;
  if (name == "chorus") return SNARE_EFFECT_CHORUS;
  throw std::runtime_error("no such effect: " + name);
}

inline SnarePattern readPattern(const json::Value& value) {
  SnarePattern pattern{};
  const auto& rows = value.at("rows").array;
  if (rows.size() != SNARE_TRACKS) throw std::runtime_error("a pattern has a row for every track");
  for (std::size_t track = 0; track < rows.size(); ++track) {
    pattern.rows[track] = static_cast<std::uint32_t>(rows[track].number);
  }
  pattern.len1 = static_cast<std::uint8_t>(value.at("firstLength").asInt());
  pattern.len2 = static_cast<std::uint8_t>(value.at("secondLength").asInt());
  pattern.steps_per_beat = static_cast<std::uint8_t>(value.at("stepsPerBeat").asInt());
  pattern.swing = static_cast<std::uint8_t>(value.at("swing").asInt());
  return pattern;
}

inline Setup readSetup(const json::Value& value) {
  Setup setup;
  setup.tempo = value.at("tempo").number;
  for (const auto& sound : value.at("sounds").array) {
    setup.sounds.push_back(SnareSoundParams{sound.at("sound").asInt(), static_cast<float>(sound.at("tune").number),
                                            static_cast<float>(sound.at("tone").number),
                                            static_cast<float>(sound.at("decay").number),
                                            static_cast<float>(sound.at("snappy").number), 0});
  }
  for (const auto& track : value.at("tracks").array) {
    setup.tracks.push_back(SetupTrack{track.at("track").asInt(), track.at("slot").asInt(),
                                      static_cast<float>(track.at("pan").number), track.at("chokeGroup").asInt(),
                                      track.at("gain").number});
  }
  setup.plain = value.at("accent").at("plain").number;
  setup.accented = value.at("accent").at("accented").number;
  setup.master = value.at("master").number;
  for (const auto& pattern : value.at("patterns").array) setup.patterns.push_back(readPattern(pattern));
  if (setup.patterns.size() > SNARE_PATTERNS) throw std::runtime_error("more patterns than the bank holds");
  if (value.has("effect")) {
    setup.effect = effectNamed(value.at("effect").at("kind").string);
    setup.wet = value.at("effect").at("wet").number;
  }
  return setup;
}

inline void must(int result, const char* what) {
  if (result != SNARE_OK) throw std::runtime_error(std::string("the engine refused ") + what);
}

// The same calls as applySetup in the editor.
inline void applySetup(SnareEngine* engine, const Setup& setup) {
  for (const SnareSoundParams& sound : setup.sounds) must(snare_engine_synth_sound(engine, &sound), "a sound");
  for (const SetupTrack& track : setup.tracks) {
    must(snare_engine_set_track(engine, track.track, track.slot, track.pan, track.chokeGroup), "a track");
    must(snare_engine_set_track_level(engine, track.track, track.gain), "a track's level");
  }
  must(snare_engine_set_accent(engine, setup.plain, setup.accented), "the accent");
  must(snare_engine_set_master_volume(engine, setup.master), "the volume");
  must(snare_engine_set_tempo(engine, setup.tempo), "the tempo");
  for (std::size_t index = 0; index < setup.patterns.size(); ++index) {
    must(snare_engine_set_pattern(engine, static_cast<int>(index), &setup.patterns[index]), "a pattern");
  }
  if (setup.effect != SNARE_EFFECT_NONE) must(snare_engine_set_effect(engine, setup.effect, setup.wet), "the effect");
}

}  // namespace snare::io
