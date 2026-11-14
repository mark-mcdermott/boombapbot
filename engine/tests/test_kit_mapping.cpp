// Kit mapping: the shared kick/snare/hat fixture renders through all four
// kit manifests with identical timing and velocities, and different sound.

#include <cmath>
#include <string>
#include <vector>

#include "../tools/project_io.h"
#include "test_util.h"

using namespace snare::test;

namespace {

constexpr double kRate = 44100.0;
const char* const kKits[] = {"606", "707", "808", "909"};

struct KitRun {
  std::vector<SnareEvent> events;
  std::vector<float> left;
  snare::io::KitInfo info;
};

KitRun run(const std::string& kitId, const snare::io::Roles& roles,
           const snare::io::Project& project) {
  KitRun result;
  SnareEngine* engine = snare_engine_create(kRate);
  snare_engine_enable_event_log(engine, 4096);
  snare_engine_commit_kit(
      engine, snare::io::loadKit(SNARE_CONTRACTS_DIR, SNARE_ASSETS_DIR, kitId, roles, &result.info));
  snare::io::applyProject(engine, project);
  result.left = snare::io::renderLoop(engine, project.bpm, kRate).left;
  result.events = readEvents(engine);
  snare_engine_destroy(engine);
  return result;
}

double rms(const std::vector<float>& signal) {
  double sum = 0.0;
  for (const float sample : signal) sum += static_cast<double>(sample) * sample;
  return std::sqrt(sum / static_cast<double>(signal.size()));
}

}  // namespace

SNARE_TEST(roles_are_stable) {
  const snare::io::Roles roles = snare::io::loadRoles(SNARE_CONTRACTS_DIR);
  CHECK_EQ(roles.ids.size(), static_cast<std::size_t>(8));
  CHECK_EQ(roles.indexById.at("kick"), 0);
  CHECK_EQ(roles.indexById.at("snare"), 1);
  CHECK_EQ(roles.indexById.at("closed_hat"), 2);
  CHECK_EQ(roles.indexById.at("open_hat"), 3);
  CHECK_EQ(roles.indexById.at("low_tom"), 4);
  CHECK_EQ(roles.indexById.at("high_tom"), 5);
  CHECK_EQ(roles.indexById.at("clap"), 6);
  CHECK_EQ(roles.indexById.at("cymbal"), 7);
}

SNARE_TEST(same_rhythm_through_all_four_kits) {
  const snare::io::Roles roles = snare::io::loadRoles(SNARE_CONTRACTS_DIR);
  const snare::io::Project project = snare::io::loadProject(
      std::string(SNARE_CONTRACTS_DIR) + "/fixtures/kick-snare-hat.project.json", roles);

  // What the fixture says should happen in one bar.
  int hits = 0;
  for (int role = 0; role < SNARE_MAX_ROLES; ++role) {
    for (int step = 0; step < SNARE_STEPS; ++step) hits += project.velocities[role][step] > 0 ? 1 : 0;
  }
  CHECK_EQ(hits, 22);

  std::vector<KitRun> runs;
  for (const char* kit : kKits) runs.push_back(run(kit, roles, project));

  const KitRun& reference = runs.front();
  CHECK_EQ(reference.events.size(), static_cast<std::size_t>(hits * 2));  // two loops rendered
  for (const KitRun& kitRun : runs) {
    CHECK_EQ(kitRun.info.voiceCount, 8);
    CHECK_EQ(kitRun.events.size(), reference.events.size());
    CHECK_EQ(kitRun.left.size(), reference.left.size());
    bool same = kitRun.events.size() == reference.events.size();
    for (std::size_t i = 0; same && i < kitRun.events.size(); ++i) {
      same = kitRun.events[i].frame == reference.events[i].frame &&
             kitRun.events[i].step == reference.events[i].step &&
             kitRun.events[i].role == reference.events[i].role &&
             kitRun.events[i].velocity == reference.events[i].velocity;
    }
    CHECK(same);
    CHECK(rms(kitRun.left) > 0.01);  // audible
  }

  // Every pair of kits sounds different.
  for (std::size_t a = 0; a < runs.size(); ++a) {
    for (std::size_t b = a + 1; b < runs.size(); ++b) {
      std::vector<float> difference(runs[a].left.size());
      for (std::size_t i = 0; i < difference.size(); ++i) {
        difference[i] = runs[a].left[i] - runs[b].left[i];
      }
      CHECK(rms(difference) > 0.01);
    }
  }

  // Only kick, snare and closed hat are used, at the fixture's velocities.
  for (const SnareEvent& event : reference.events) {
    CHECK(event.role == 0 || event.role == 1 || event.role == 2);
    CHECK_EQ(event.velocity, static_cast<int>(project.velocities[event.role][event.step]));
  }
}

SNARE_TEST(substitutions_are_declared) {
  const snare::io::Roles roles = snare::io::loadRoles(SNARE_CONTRACTS_DIR);
  for (const char* kitId : kKits) {
    snare::io::KitInfo info;
    SnareKit* kit = snare::io::loadKit(SNARE_CONTRACTS_DIR, SNARE_ASSETS_DIR, kitId, roles, &info);
    snare_kit_destroy(kit);
    if (std::string(kitId) == "606") {
      CHECK_EQ(info.substitutedRoles.size(), static_cast<std::size_t>(1));
      if (!info.substitutedRoles.empty()) CHECK(info.substitutedRoles[0] == "clap");
    } else {
      CHECK(info.substitutedRoles.empty());
    }
  }
}

SNARE_TEST_MAIN()
