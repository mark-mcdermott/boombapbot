// Swing moves only the off-beat sixteenths. The bar never changes length.

#include <vector>

#include "../tools/project_io.h"
#include "test_util.h"

using namespace snare::test;

namespace {

constexpr double kRate = 44100.0;
constexpr double kBpm = 110.0;

std::vector<SnareEvent> runWithSwing(double swing, int loops) {
  SnareEngine* engine = snare_engine_create(kRate);
  SnareKit* kit = snare_kit_create();
  setVoice(kit, 0, constant(64, 0.5f), kRate);
  snare_engine_commit_kit(engine, kit);
  snare_engine_enable_event_log(engine, 4096);
  snare_engine_set_tempo(engine, kBpm);
  snare_engine_set_swing(engine, swing);
  for (int step = 0; step < SNARE_STEPS; ++step) snare_engine_set_step(engine, 0, step, 100);
  snare_engine_play(engine);
  snare::io::render(engine, snare_loop_frames(kBpm, kRate, SNARE_STEPS) * loops, 128);
  auto events = readEvents(engine);
  snare_engine_destroy(engine);
  return events;
}

}  // namespace

SNARE_TEST(loop_length_ignores_swing) {
  const int loop = snare_loop_frames(kBpm, kRate, SNARE_STEPS);
  CHECK_EQ(loop, static_cast<int>(std::floor(kRate * 240.0 / kBpm + 0.5)));
  const auto straight = runWithSwing(50.0, 3);
  CHECK_EQ(straight.size(), static_cast<std::size_t>(48));

  for (const double swing : {54.0, 58.0, 62.0, 66.6667, 70.0, 75.0}) {
    const auto swung = runWithSwing(swing, 3);
    CHECK_EQ(swung.size(), straight.size());
    if (swung.size() != straight.size()) continue;
    const double expectedShift = (swing - 50.0) / 50.0 * snare_frames_per_step(kBpm, kRate);
    for (std::size_t i = 0; i < swung.size(); ++i) {
      if (i % 2 == 0) {
        // On-beat sixteenths, including every bar line, do not move.
        CHECK_EQ(swung[i].frame, straight[i].frame);
      } else {
        CHECK_NEAR(swung[i].frame - straight[i].frame, expectedShift, 1.0);
        CHECK(swung[i].frame < straight[i + 1 < straight.size() ? i + 1 : i].frame ||
              i + 1 == straight.size());
      }
    }
    // Bar lines: step 0 of loops two and three.
    CHECK_EQ(swung[16].frame, static_cast<double>(loop));
    CHECK_NEAR(swung[32].frame, 2.0 * snare_frames_per_step(kBpm, kRate) * SNARE_STEPS, 1.0);
  }
}

SNARE_TEST(swing_is_clamped_to_its_range) {
  CHECK_EQ(snare_step_time(1, 10.0), 1.0);
  CHECK_EQ(snare_step_time(1, 50.0), 1.0);
  CHECK_EQ(snare_step_time(1, 75.0), 1.5);
  CHECK_EQ(snare_step_time(1, 99.0), 1.5);
  CHECK_EQ(snare_step_time(2, 75.0), 2.0);
  CHECK_NEAR(snare_step_time(3, 66.6667), 3.0 + 1.0 / 3.0, 1e-4);
  const auto extreme = runWithSwing(500.0, 1);
  const auto maximum = runWithSwing(75.0, 1);
  CHECK_EQ(extreme.size(), maximum.size());
  for (std::size_t i = 0; i < extreme.size() && i < maximum.size(); ++i) {
    CHECK_EQ(extreme[i].frame, maximum[i].frame);
  }
}

SNARE_TEST(changing_swing_while_playing_keeps_the_bar) {
  SnareEngine* engine = snare_engine_create(kRate);
  SnareKit* kit = snare_kit_create();
  setVoice(kit, 0, constant(64, 0.5f), kRate);
  snare_engine_commit_kit(engine, kit);
  snare_engine_enable_event_log(engine, 4096);
  snare_engine_set_tempo(engine, kBpm);
  for (int step = 0; step < SNARE_STEPS; ++step) snare_engine_set_step(engine, 0, step, 100);
  snare_engine_play(engine);
  const int loop = snare_loop_frames(kBpm, kRate, SNARE_STEPS);
  snare::io::render(engine, loop / 2, 128);
  snare_engine_set_swing(engine, 70.0);
  snare::io::render(engine, loop * 2, 128);
  const auto events = readEvents(engine);
  CHECK(events.size() >= 33);
  if (events.size() >= 33) {
    CHECK_EQ(events[16].step, 0);
    CHECK_EQ(events[16].frame, static_cast<double>(loop));
    CHECK_EQ(events[32].step, 0);
  }
  snare_engine_destroy(engine);
}

SNARE_TEST_MAIN()
