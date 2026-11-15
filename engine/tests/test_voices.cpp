// Voice pool: overlap, determinism, stealing, resampling and kit swaps.

#include <cstring>
#include <vector>

#include "../tools/project_io.h"
#include "test_util.h"

using namespace snare::test;

namespace {

constexpr double kRate = 48000.0;
// Velocity 127 maps to unity gain, and the engine's default master gain is
// applied on top. Tests set master to 1 so sample values pass straight through.
SnareEngine* unityEngine() {
  SnareEngine* engine = snare_engine_create(kRate);
  snare_engine_set_master_gain(engine, 1.0);
  return engine;
}

}  // namespace

SNARE_TEST(hits_overlap_instead_of_cutting) {
  SnareEngine* engine = unityEngine();
  SnareKit* kit = snare_kit_create();
  setVoice(kit, 0, constant(1000, 0.25f), kRate);
  snare_engine_commit_kit(engine, kit);

  snare_engine_trigger(engine, 0, 127);
  auto first = snare::io::render(engine, 400, 400);
  snare_engine_trigger(engine, 0, 127);
  auto second = snare::io::render(engine, 400, 400);
  auto third = snare::io::render(engine, 400, 400);
  auto fourth = snare::io::render(engine, 400, 400);

  CHECK_NEAR(first.left[200], 0.25, 1e-6);
  CHECK_NEAR(second.left[200], 0.5, 1e-6);   // both voices sounding
  CHECK_NEAR(third.left[100], 0.5, 1e-6);    // first ends at frame 1000
  CHECK_NEAR(third.left[300], 0.25, 1e-6);
  CHECK_NEAR(fourth.left[300], 0.0, 1e-6);   // second ends at frame 1400
  CHECK_NEAR(first.right[200], first.left[200], 1e-6);
  snare_engine_destroy(engine);
}

SNARE_TEST(velocity_scales_level) {
  SnareEngine* engine = unityEngine();
  SnareKit* kit = snare_kit_create();
  setVoice(kit, 0, constant(200, 0.5f), kRate);
  snare_engine_commit_kit(engine, kit);
  snare_engine_trigger(engine, 0, 127);
  const auto loud = snare::io::render(engine, 300, 300);
  snare_engine_trigger(engine, 0, 64);
  const auto soft = snare::io::render(engine, 300, 300);
  CHECK_NEAR(loud.left[50], 0.5, 1e-6);
  CHECK(soft.left[50] > 0.05f);
  CHECK(soft.left[50] < loud.left[50] * 0.6f);
  snare_engine_destroy(engine);
}

SNARE_TEST(pan_moves_level_between_channels) {
  SnareEngine* engine = unityEngine();
  SnareKit* kit = snare_kit_create();
  setVoice(kit, 0, constant(200, 0.4f), kRate, 1.0f, -1.0f);
  setVoice(kit, 1, constant(200, 0.4f), kRate, 1.0f, 1.0f);
  snare_engine_commit_kit(engine, kit);
  snare_engine_trigger(engine, 0, 127);
  const auto leftOnly = snare::io::render(engine, 300, 300);
  snare_engine_trigger(engine, 1, 127);
  const auto rightOnly = snare::io::render(engine, 300, 300);
  CHECK(leftOnly.left[50] > 0.4f);
  CHECK_NEAR(leftOnly.right[50], 0.0, 1e-6);
  CHECK(rightOnly.right[50] > 0.4f);
  CHECK_NEAR(rightOnly.left[50], 0.0, 1e-6);
  snare_engine_destroy(engine);
}

SNARE_TEST(samples_play_at_their_own_rate) {
  SnareEngine* engine = unityEngine();
  SnareKit* kit = snare_kit_create();
  // 1000 frames at half the engine rate last 2000 output frames.
  setVoice(kit, 0, constant(1000, 0.3f), kRate / 2.0);
  snare_engine_commit_kit(engine, kit);
  snare_engine_trigger(engine, 0, 127);
  const auto out = snare::io::render(engine, 2400, 256);
  CHECK_NEAR(out.left[1900], 0.3, 1e-6);
  CHECK_NEAR(out.left[2100], 0.0, 1e-6);
  snare_engine_destroy(engine);
}

namespace {

struct Overload {
  std::vector<float> left;
  std::uint32_t stolen = 0;
  int active = 0;
};

// Triggers far more long voices than the pool holds.
Overload overload(int blockSize) {
  SnareEngine* engine = unityEngine();
  SnareKit* kit = snare_kit_create();
  for (int role = 0; role < 8; ++role) {
    setVoice(kit, role, constant(48000, 0.01f * static_cast<float>(role + 1)), kRate);
  }
  snare_engine_commit_kit(engine, kit);
  snare_engine_set_tempo(engine, 300.0);
  for (int role = 0; role < 8; ++role) {
    for (int step = 0; step < SNARE_STEPS; ++step) snare_engine_set_step(engine, role, step, 127);
  }
  snare_engine_play(engine);
  Overload result;
  result.left = snare::io::render(engine, 30000, blockSize).left;
  result.stolen = snare_engine_stolen_voices(engine);
  result.active = snare_engine_active_voices(engine);
  snare_engine_destroy(engine);
  return result;
}

}  // namespace

SNARE_TEST(stealing_is_bounded_and_repeatable) {
  const Overload a = overload(128);
  const Overload b = overload(128);
  const Overload c = overload(333);
  CHECK(a.stolen > 0);
  CHECK_EQ(a.active, SNARE_MAX_VOICES);
  CHECK_EQ(a.stolen, b.stolen);
  CHECK_EQ(a.stolen, c.stolen);
  CHECK(std::memcmp(a.left.data(), b.left.data(), sizeof(float) * a.left.size()) == 0);
  CHECK(std::memcmp(a.left.data(), c.left.data(), sizeof(float) * a.left.size()) == 0);
  for (const float sample : a.left) {
    CHECK(std::isfinite(sample));
    CHECK(sample <= 1.0f && sample >= -1.0f);
    if (!std::isfinite(sample)) break;
  }
}

SNARE_TEST(the_oldest_voice_is_stolen_first) {
  SnareEngine* engine = unityEngine();
  SnareKit* kit = snare_kit_create();
  setVoice(kit, 0, constant(48000, 0.5f), kRate);     // the old, loud voice
  setVoice(kit, 1, constant(48000, 0.001f), kRate);   // quiet fillers
  snare_engine_commit_kit(engine, kit);

  snare_engine_trigger(engine, 0, 127);
  auto out = snare::io::render(engine, 64, 64);
  CHECK_NEAR(out.left[32], 0.5, 1e-6);
  for (int i = 0; i < SNARE_MAX_VOICES - 1; ++i) snare_engine_trigger(engine, 1, 127);
  out = snare::io::render(engine, 64, 64);
  CHECK_EQ(snare_engine_stolen_voices(engine), 0u);
  CHECK(out.left[32] > 0.5f);

  // One more hit must take the oldest voice, which is the loud one.
  snare_engine_trigger(engine, 1, 127);
  out = snare::io::render(engine, 2048, 2048);
  CHECK_EQ(snare_engine_stolen_voices(engine), 1u);
  CHECK_NEAR(out.left[2000], 0.064, 1e-4);
  // The stolen voice ramps out; it does not jump to silence in one frame.
  CHECK(out.left[0] > 0.3f);
  CHECK(out.left[1] < out.left[0]);
  snare_engine_destroy(engine);
}

SNARE_TEST(kit_swap_lets_tails_finish) {
  SnareEngine* engine = unityEngine();
  SnareKit* first = snare_kit_create();
  setVoice(first, 0, constant(2000, 0.25f), kRate);
  snare_engine_commit_kit(engine, first);
  snare_engine_trigger(engine, 0, 127);
  auto out = snare::io::render(engine, 500, 500);
  CHECK_NEAR(out.left[100], 0.25, 1e-6);

  SnareKit* second = snare_kit_create();
  setVoice(second, 0, constant(2000, -0.125f), kRate);
  snare_engine_commit_kit(engine, second);
  snare_engine_trigger(engine, 0, 127);
  out = snare::io::render(engine, 500, 500);
  // Old tail (0.25) and the new kit's hit (-0.125) sound together.
  CHECK_NEAR(out.left[100], 0.125, 1e-6);
  CHECK_EQ(snare_engine_collect(engine), 1);  // old kit still has a live voice

  out = snare::io::render(engine, 2000, 500);
  CHECK_NEAR(out.left[1200], -0.125, 1e-6);   // only the new kit remains
  CHECK_EQ(snare_engine_collect(engine), 0);  // old kit released
  snare_engine_destroy(engine);
}

namespace {

SnareSound* makeSound(const std::vector<float>& pcm) {
  SnareSound* sound = snare_sound_create(static_cast<int>(pcm.size()), 1, kRate);
  std::copy(pcm.begin(), pcm.end(), snare_sound_data(sound));
  return sound;
}

}  // namespace

SNARE_TEST(one_sound_can_be_replaced_while_its_tail_rings) {
  SnareEngine* engine = unityEngine();
  snare_engine_set_sound(engine, 0, makeSound(constant(2000, 0.25f)));
  snare_engine_set_sound(engine, 1, makeSound(constant(4000, 0.0625f)));
  snare_engine_trigger(engine, 0, 127);
  snare_engine_trigger(engine, 1, 127);
  auto out = snare::io::render(engine, 500, 500);
  CHECK_NEAR(out.left[100], 0.3125, 1e-6);

  snare_engine_set_sound(engine, 0, makeSound(constant(2000, -0.125f)));
  snare_engine_trigger(engine, 0, 127);
  out = snare::io::render(engine, 500, 500);
  // The old tail, the new hit and the untouched slot sound together.
  CHECK_NEAR(out.left[100], 0.1875, 1e-6);
  CHECK_EQ(snare_engine_collect(engine), 1);  // the replaced sound still has a live voice

  out = snare::io::render(engine, 2000, 500);
  CHECK_NEAR(out.left[1200], -0.0625, 1e-6);  // the new sound and the other slot remain
  CHECK_EQ(snare_engine_collect(engine), 0);
  snare_engine_destroy(engine);
}

SNARE_TEST(a_staged_sound_replaced_before_it_is_taken_never_sounds) {
  SnareEngine* engine = unityEngine();
  snare_engine_set_sound(engine, 0, makeSound(constant(1000, 0.5f)));
  snare_engine_set_sound(engine, 0, makeSound(constant(1000, 0.125f)));
  snare_engine_trigger(engine, 0, 127);
  const auto out = snare::io::render(engine, 500, 500);
  CHECK_NEAR(out.left[100], 0.125, 1e-6);
  CHECK_EQ(snare_engine_collect(engine), 0);
  snare_engine_destroy(engine);
}

SNARE_TEST(null_empties_a_slot_and_an_empty_sound_is_silent) {
  SnareEngine* engine = unityEngine();
  snare_engine_set_sound(engine, 0, makeSound(constant(300, 0.5f)));
  snare_engine_trigger(engine, 0, 127);
  auto out = snare::io::render(engine, 500, 500);
  CHECK_NEAR(out.left[100], 0.5, 1e-6);

  snare_engine_set_sound(engine, 0, nullptr);
  snare_engine_trigger(engine, 0, 127);
  out = snare::io::render(engine, 500, 500);
  CHECK_EQ(out.left[100], 0.0f);
  CHECK_EQ(snare_engine_active_voices(engine), 0);

  snare_engine_set_sound(engine, 0, snare_sound_create(0, 1, kRate));
  snare_engine_trigger(engine, 0, 127);
  out = snare::io::render(engine, 500, 500);
  CHECK_EQ(out.left[100], 0.0f);
  snare_engine_destroy(engine);
}

SNARE_TEST(a_slot_keeps_its_settings_when_its_sound_changes) {
  SnareEngine* engine = unityEngine();
  snare_engine_set_slot(engine, 0, 0.5f, -1.0f, 0);  // half level, hard left
  snare_engine_set_sound(engine, 0, makeSound(constant(300, 0.5f)));
  snare_engine_trigger(engine, 0, 127);
  auto out = snare::io::render(engine, 500, 500);
  CHECK_NEAR(out.left[100], 0.5 * 0.5 * std::sqrt(2.0), 1e-6);
  CHECK_NEAR(out.right[100], 0.0, 1e-6);

  snare_engine_set_sound(engine, 0, makeSound(constant(300, 0.25f)));
  snare_engine_trigger(engine, 0, 127);
  out = snare::io::render(engine, 500, 500);
  CHECK_NEAR(out.left[100], 0.25 * 0.5 * std::sqrt(2.0), 1e-6);
  CHECK_NEAR(out.right[100], 0.0, 1e-6);
  snare_engine_destroy(engine);
}

SNARE_TEST(a_full_retire_queue_holds_new_sounds_back_until_collect) {
  SnareEngine* engine = unityEngine();
  // Committing a kit retires sixteen sounds and frees none of them.
  const auto commit = [engine](float level) {
    SnareKit* kit = snare_kit_create();
    for (int role = 0; role < SNARE_MAX_ROLES; ++role) setVoice(kit, role, constant(8, level), kRate);
    snare_engine_commit_kit(engine, kit);
    snare::io::render(engine, 64, 64);
  };
  for (int swap = 0; swap <= 16; ++swap) commit(0.01f * static_cast<float>(swap + 1));
  // 256 replaced sounds now fill the queue, so the next kit has to wait.
  commit(0.5f);
  snare_engine_trigger(engine, 0, 127);
  auto out = snare::io::render(engine, 64, 64);
  CHECK_NEAR(out.left[2], 0.17, 1e-6);

  CHECK_EQ(snare_engine_collect(engine), 0);
  snare_engine_trigger(engine, 0, 127);
  out = snare::io::render(engine, 64, 64);
  CHECK_NEAR(out.left[2], 0.5, 1e-6);
  snare_engine_destroy(engine);
}

SNARE_TEST(sound_and_slot_arguments_are_checked) {
  SnareEngine* engine = unityEngine();
  CHECK(snare_sound_create(10, 3, kRate) == nullptr);
  CHECK(snare_sound_create(-1, 1, kRate) == nullptr);
  CHECK(snare_sound_create(10, 1, 100.0) == nullptr);
  CHECK(snare_sound_data(nullptr) == nullptr);
  SnareSound* unused = snare_sound_create(10, 2, kRate);
  CHECK(snare_sound_data(unused) != nullptr);
  CHECK_EQ(snare_sound_data(unused)[19], 0.0f);
  CHECK_EQ(snare_engine_set_sound(engine, SNARE_MAX_ROLES, unused), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_sound(nullptr, 0, unused), SNARE_ERR_BAD_ARGUMENT);
  snare_sound_destroy(unused);
  CHECK_EQ(snare_engine_set_slot(engine, 0, 5.0f, 0.0f, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_slot(engine, 0, 1.0f, 2.0f, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_slot(engine, 0, 1.0f, 0.0f, -1), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_slot(engine, -1, 1.0f, 0.0f, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_slot(engine, 3, 1.0f, 0.5f, 2), SNARE_OK);
  snare_engine_destroy(engine);
}

SNARE_TEST(identical_input_gives_identical_output) {
  const snare::io::Roles roles = snare::io::loadRoles(SNARE_CONTRACTS_DIR);
  const snare::io::Project project = snare::io::loadProject(
      std::string(SNARE_CONTRACTS_DIR) + "/fixtures/kick-snare-hat.project.json", roles);
  std::vector<float> runs[2];
  for (auto& run : runs) {
    SnareEngine* engine = snare_engine_create(44100.0);
    snare_engine_commit_kit(engine, snare::io::loadKit(SNARE_CONTRACTS_DIR, SNARE_ASSETS_DIR, "909", roles));
    snare::io::applyProject(engine, project);
    run = snare::io::renderLoop(engine, project.bpm, 44100.0).left;
    snare_engine_destroy(engine);
  }
  CHECK(!runs[0].empty());
  CHECK(std::memcmp(runs[0].data(), runs[1].data(), sizeof(float) * runs[0].size()) == 0);
}

SNARE_TEST_MAIN()
