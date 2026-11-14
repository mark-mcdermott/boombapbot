// Loads the shared contract files (roles, kit manifests, projects) into
// engine structures. Used by tools and tests; the render core never parses.
#pragma once

#include <cstdint>
#include <cstring>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

#include "json_min.h"
#include "boombapbot/engine.h"
#include "wav_io.h"

namespace snare::io {

struct Roles {
  std::map<std::string, int> indexById;
  std::vector<std::string> ids;       // by index
  std::vector<std::uint8_t> gmNotes;  // by index
};

inline Roles loadRoles(const std::string& contractsDir) {
  const json::Value doc = json::parseFile(contractsDir + "/data/roles.json");
  Roles roles;
  const auto& list = doc.at("roles").array;
  roles.ids.resize(list.size());
  roles.gmNotes.resize(list.size());
  for (const auto& role : list) {
    const int index = role.at("index").asInt();
    if (index < 0 || index >= static_cast<int>(list.size()) || index >= SNARE_MAX_ROLES) {
      throw std::runtime_error("role index out of range");
    }
    roles.indexById[role.at("id").string] = index;
    roles.ids[static_cast<std::size_t>(index)] = role.at("id").string;
    roles.gmNotes[static_cast<std::size_t>(index)] =
        static_cast<std::uint8_t>(role.at("gmNote").asInt());
  }
  return roles;
}

struct KitInfo {
  std::string id;
  std::string version;
  int voiceCount = 0;
  std::vector<std::string> substitutedRoles;
};

// Builds a kit from its manifest. The caller owns the result until it is
// committed to an engine.
inline SnareKit* loadKit(const std::string& contractsDir, const std::string& assetsDir,
                         const std::string& kitId, const Roles& roles, KitInfo* info = nullptr) {
  const json::Value doc = json::parseFile(contractsDir + "/data/kits/" + kitId + ".kit.json");
  if (doc.at("id").string != kitId) throw std::runtime_error("kit id mismatch in " + kitId);
  const std::string base = assetsDir + "/" + doc.at("assetBase").string;

  SnareKit* kit = snare_kit_create();
  int count = 0;
  const json::Value& voices = doc.at("voices");
  for (std::size_t i = 0; i < voices.keys.size(); ++i) {
    const std::string& roleId = voices.keys[i];
    const auto role = roles.indexById.find(roleId);
    if (role == roles.indexById.end()) {
      snare_kit_destroy(kit);
      throw std::runtime_error("kit " + kitId + " maps unknown role " + roleId);
    }
    const json::Value& voice = voices.values[i];
    const wav::Audio audio = wav::readFile(base + "/" + voice.at("file").string);
    const int result = snare_kit_set_voice(
        kit, role->second, audio.pcm.data(), audio.frames, audio.channels, audio.sampleRate,
        static_cast<float>(voice.at("gain").number), static_cast<float>(voice.at("pan").number),
        voice.at("chokeGroup").asInt());
    if (result != SNARE_OK) {
      snare_kit_destroy(kit);
      throw std::runtime_error("kit " + kitId + " rejected voice " + roleId);
    }
    if (info && voice.has("substitute")) info->substitutedRoles.push_back(roleId);
    ++count;
  }
  if (info) {
    info->id = kitId;
    info->version = doc.at("version").string;
    info->voiceCount = count;
  }
  return kit;
}

struct Project {
  std::string name;
  std::string kitId;
  double bpm = 120.0;
  double swing = 50.0;
  std::uint8_t velocities[SNARE_MAX_ROLES][SNARE_STEPS]{};
};

inline Project loadProject(const std::string& path, const Roles& roles) {
  const json::Value doc = json::parseFile(path);
  if (doc.at("format").string != "boombapbot.project" || doc.at("schemaVersion").asInt() != 1) {
    throw std::runtime_error("unsupported project document: " + path);
  }
  Project project;
  project.name = doc.at("name").string;
  project.kitId = doc.at("kit").at("id").string;
  project.bpm = doc.at("bpm").number;
  project.swing = doc.at("swing").number;
  const json::Value& pattern = doc.at("pattern");
  if (pattern.at("stepCount").asInt() != SNARE_STEPS) {
    throw std::runtime_error("unsupported step count");
  }
  for (const auto& lane : pattern.at("lanes").array) {
    const auto role = roles.indexById.find(lane.at("role").string);
    if (role == roles.indexById.end()) throw std::runtime_error("unknown role in project");
    const auto& steps = lane.at("steps").array;
    if (steps.size() != SNARE_STEPS) throw std::runtime_error("lane must have 16 steps");
    for (int step = 0; step < SNARE_STEPS; ++step) {
      const int velocity = steps[static_cast<std::size_t>(step)].asInt();
      if (velocity < 0 || velocity > 127) throw std::runtime_error("velocity out of range");
      project.velocities[role->second][step] = static_cast<std::uint8_t>(velocity);
    }
  }
  return project;
}

// Sends a project's pattern, tempo and swing to an engine.
inline void applyProject(SnareEngine* engine, const Project& project) {
  snare_engine_set_tempo(engine, project.bpm);
  snare_engine_set_swing(engine, project.swing);
  for (int role = 0; role < SNARE_MAX_ROLES; ++role) {
    snare_engine_set_row(engine, role, project.velocities[role]);
  }
}

struct Rendered {
  std::vector<float> left;
  std::vector<float> right;
};

// Renders `frames` frames in blocks of `blockSize`.
inline Rendered render(SnareEngine* engine, int frames, int blockSize = 256) {
  Rendered out;
  out.left.resize(static_cast<std::size_t>(frames));
  out.right.resize(static_cast<std::size_t>(frames));
  int done = 0;
  while (done < frames) {
    const int count = frames - done < blockSize ? frames - done : blockSize;
    snare_engine_render(engine, out.left.data() + done, out.right.data() + done, count);
    done += count;
  }
  return out;
}

// One seamless loop: plays two loops and returns the second, so tails from
// the end of the bar wrap into its start.
inline Rendered renderLoop(SnareEngine* engine, double bpm, double sampleRate) {
  const int loopFrames = snare_loop_frames(bpm, sampleRate, SNARE_STEPS);
  snare_engine_play_loops(engine, 2);
  Rendered both = render(engine, loopFrames * 2);
  Rendered out;
  out.left.assign(both.left.begin() + loopFrames, both.left.end());
  out.right.assign(both.right.begin() + loopFrames, both.right.end());
  return out;
}

}  // namespace snare::io
