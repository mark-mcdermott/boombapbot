// Hat chokes: a hit in a choke group releases the voices already sounding in
// that group, with a short fade rather than a hard cut.

#include <vector>

#include "../tools/project_io.h"
#include "test_util.h"

using namespace snare::test;

namespace {

constexpr double kRate = 44100.0;
constexpr int kOpen = 3;
constexpr int kClosed = 2;
constexpr int kKick = 0;

SnareEngine* makeEngine() {
  SnareEngine* engine = snare_engine_create(kRate);
  snare_engine_set_master_gain(engine, 1.0);
  SnareKit* kit = snare_kit_create();
  setVoice(kit, kOpen, constant(44100, 0.5f), kRate, 1.0f, 0.0f, 1);
  setVoice(kit, kClosed, constant(44100, 0.0f), kRate, 1.0f, 0.0f, 1);  // silent on purpose
  setVoice(kit, kKick, constant(44100, 0.25f), kRate);
  snare_engine_commit_kit(engine, kit);
  return engine;
}

}  // namespace

SNARE_TEST(closed_hat_chokes_open_hat) {
  SnareEngine* engine = makeEngine();
  snare_engine_trigger(engine, kOpen, 127);
  auto out = snare::io::render(engine, 1024, 1024);
  CHECK_NEAR(out.left[1000], 0.5, 1e-6);

  snare_engine_trigger(engine, kClosed, 127);
  out = snare::io::render(engine, 1024, 1024);
  const int fade = static_cast<int>(0.004 * kRate);
  CHECK(out.left[0] > 0.45f);                 // still sounding as the fade begins
  CHECK(out.left[fade / 2] < 0.3f);
  CHECK(out.left[fade / 2] > 0.2f);           // half-way down, not cut dead
  CHECK_NEAR(out.left[fade + 2], 0.0, 1e-6);  // silent once the fade ends
  for (int i = 1; i < fade; ++i) CHECK(out.left[i] <= out.left[i - 1]);
  snare_engine_destroy(engine);
}

SNARE_TEST(open_hat_retrigger_replaces_the_previous_one) {
  SnareEngine* engine = makeEngine();
  snare_engine_trigger(engine, kOpen, 127);
  snare::io::render(engine, 1024, 1024);
  snare_engine_trigger(engine, kOpen, 127);
  const auto out = snare::io::render(engine, 2048, 2048);
  // After the fade only the new open hat remains, not a doubled level.
  CHECK_NEAR(out.left[1500], 0.5, 1e-6);
  snare_engine_destroy(engine);
}

SNARE_TEST(other_voices_are_not_choked) {
  SnareEngine* engine = makeEngine();
  snare_engine_trigger(engine, kKick, 127);
  snare_engine_trigger(engine, kOpen, 127);
  snare::io::render(engine, 512, 512);
  snare_engine_trigger(engine, kClosed, 127);
  const auto out = snare::io::render(engine, 2048, 2048);
  CHECK_NEAR(out.left[1500], 0.25, 1e-6);  // the kick carries on alone
  snare_engine_destroy(engine);
}

SNARE_TEST(pattern_steps_choke_at_the_step_frame) {
  SnareEngine* engine = makeEngine();
  const double bpm = 120.0;
  snare_engine_set_tempo(engine, bpm);
  snare_engine_set_step(engine, kOpen, 0, 127);
  snare_engine_set_step(engine, kClosed, 1, 127);
  snare_engine_play(engine);
  const int stepFrames = static_cast<int>(snare_frames_per_step(bpm, kRate) + 0.5);
  const auto out = snare::io::render(engine, stepFrames * 3, 256);
  CHECK_NEAR(out.left[static_cast<std::size_t>(stepFrames - 1)], 0.5, 1e-6);
  CHECK(out.left[static_cast<std::size_t>(stepFrames + 20)] < 0.5f);
  CHECK_NEAR(out.left[static_cast<std::size_t>(stepFrames + 400)], 0.0, 1e-6);
  snare_engine_destroy(engine);
}

SNARE_TEST_MAIN()
