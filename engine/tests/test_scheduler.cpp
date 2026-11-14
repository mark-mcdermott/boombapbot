// Scheduler timing: sample-accurate steps, no dependence on buffer size, no
// drift over long runs, and correct behaviour across tempo changes.

#include <cstring>
#include <vector>

#include "../tools/project_io.h"
#include "test_util.h"

using namespace snare::test;

namespace {

constexpr double kRate = 44100.0;

// Four on the floor on role 0, off-beats on role 1.
SnareEngine* makeEngine(double rate, double bpm, double swing) {
  SnareEngine* engine = snare_engine_create(rate);
  SnareKit* kit = snare_kit_create();
  std::vector<float> click(600, 0.0f);
  for (int i = 0; i < 600; ++i) click[static_cast<std::size_t>(i)] = 0.5f - static_cast<float>(i) / 1200.0f;
  setVoice(kit, 0, click, rate);
  setVoice(kit, 1, click, rate, 0.5f, 0.4f);
  snare_engine_commit_kit(engine, kit);
  snare_engine_enable_event_log(engine, 200000);
  snare_engine_set_tempo(engine, bpm);
  snare_engine_set_swing(engine, swing);
  for (int step = 0; step < SNARE_STEPS; ++step) {
    if (step % 4 == 0) snare_engine_set_step(engine, 0, step, 120);
    if (step % 2 == 1) snare_engine_set_step(engine, 1, step, 90);
  }
  snare_engine_play(engine);
  return engine;
}

std::int64_t expectedFrame(std::int64_t absoluteStep, double bpm, double swing, double rate) {
  const double time = snare_step_time(static_cast<int>(absoluteStep), swing);
  return static_cast<std::int64_t>(std::floor(time * snare_frames_per_step(bpm, rate) + 0.5));
}

}  // namespace

SNARE_TEST(steps_land_on_the_computed_frames) {
  const double bpm = 123.0;
  const double swing = 58.0;
  SnareEngine* engine = makeEngine(kRate, bpm, swing);
  // Stop just before the first step of a fourth bar.
  snare::io::render(engine, static_cast<int>(expectedFrame(48, bpm, swing, kRate)), 128);
  const auto events = readEvents(engine);
  CHECK_EQ(events.size(), static_cast<std::size_t>(3 * 12));

  // Rebuild the absolute step of every event from its order.
  std::size_t index = 0;
  for (std::int64_t absolute = 0; absolute < 48; ++absolute) {
    const int step = static_cast<int>(absolute % SNARE_STEPS);
    const bool kick = step % 4 == 0;
    const bool off = step % 2 == 1;
    if (!kick && !off) continue;
    CHECK(index < events.size());
    if (index >= events.size()) break;
    CHECK_EQ(events[index].step, step);
    CHECK_EQ(events[index].role, kick ? 0 : 1);
    CHECK_EQ(static_cast<std::int64_t>(events[index].frame),
             expectedFrame(absolute, bpm, swing, kRate));
    ++index;
  }
  snare_engine_destroy(engine);
}

SNARE_TEST(output_does_not_depend_on_buffer_size) {
  const double bpm = 97.0;
  const double swing = 62.5;
  const int frames = snare_loop_frames(bpm, kRate, SNARE_STEPS) * 2;
  const int sizes[] = {1, 17, 64, 128, 441, 1024, 4096, frames};

  SnareEngine* reference = makeEngine(kRate, bpm, swing);
  const auto expected = snare::io::render(reference, frames, 128);
  const auto expectedEvents = readEvents(reference);
  snare_engine_destroy(reference);
  CHECK(!expectedEvents.empty());

  for (const int size : sizes) {
    SnareEngine* engine = makeEngine(kRate, bpm, swing);
    const auto actual = snare::io::render(engine, frames, size);
    const auto events = readEvents(engine);
    CHECK_EQ(events.size(), expectedEvents.size());
    bool sameEvents = events.size() == expectedEvents.size();
    for (std::size_t i = 0; sameEvents && i < events.size(); ++i) {
      sameEvents = events[i].frame == expectedEvents[i].frame &&
                   events[i].role == expectedEvents[i].role &&
                   events[i].velocity == expectedEvents[i].velocity;
    }
    CHECK(sameEvents);
    CHECK(std::memcmp(actual.left.data(), expected.left.data(),
                      sizeof(float) * expected.left.size()) == 0);
    CHECK(std::memcmp(actual.right.data(), expected.right.data(),
                      sizeof(float) * expected.right.size()) == 0);
    snare_engine_destroy(engine);
  }
}

SNARE_TEST(ten_minutes_without_drift) {
  // A tempo whose step length is not a whole number of frames.
  const double bpm = 133.7;
  const double rate = 48000.0;
  SnareEngine* engine = makeEngine(rate, bpm, 50.0);
  const int total = static_cast<int>(rate * 600.0);
  std::vector<float> left(128), right(128);
  for (int done = 0; done < total; done += 128) {
    snare_engine_render(engine, left.data(), right.data(), 128);
  }
  const auto events = readEvents(engine);
  CHECK(events.size() > 4000);

  // Every kick is four steps after the previous one, to the frame.
  std::int64_t kicks = 0;
  for (const SnareEvent& event : events) {
    if (event.role != 0) continue;
    CHECK_EQ(static_cast<std::int64_t>(event.frame), expectedFrame(kicks * 4, bpm, 50.0, rate));
    ++kicks;
  }
  const double seconds = events.back().frame / rate;
  CHECK(seconds > 599.0);
  snare_engine_destroy(engine);
}

SNARE_TEST(play_starts_at_the_buffer_boundary) {
  SnareEngine* engine = snare_engine_create(kRate);
  SnareKit* kit = snare_kit_create();
  setVoice(kit, 0, constant(100, 0.5f), kRate);
  snare_engine_commit_kit(engine, kit);
  snare_engine_enable_event_log(engine, 64);
  snare_engine_set_step(engine, 0, 0, 100);
  snare::io::render(engine, 1000, 250);  // idle
  CHECK_EQ(snare_engine_event_count(engine), 0);
  CHECK_EQ(snare_engine_current_step(engine), -1);
  snare_engine_play(engine);
  snare::io::render(engine, 500, 250);
  const auto events = readEvents(engine);
  CHECK_EQ(events.size(), static_cast<std::size_t>(1));
  if (!events.empty()) CHECK_EQ(events[0].frame, 1000.0);
  CHECK_EQ(snare_engine_is_playing(engine), 1);
  CHECK_EQ(snare_engine_current_step(engine), 0);
  snare_engine_stop(engine);
  snare::io::render(engine, 250, 250);
  CHECK_EQ(snare_engine_is_playing(engine), 0);
  CHECK_EQ(snare_engine_current_step(engine), -1);
  snare_engine_destroy(engine);
}

SNARE_TEST(bounded_play_stops_after_its_bars) {
  // Tempos chosen so a bar is not a whole number of frames, in both rounding
  // directions. No step of a third bar may fire inside two rendered bars.
  for (const double bpm : {123.0, 127.3, 133.7, 97.0, 140.0}) {
    SnareEngine* engine = snare_engine_create(kRate);
    SnareKit* kit = snare_kit_create();
    setVoice(kit, 0, constant(64, 0.5f), kRate);
    snare_engine_commit_kit(engine, kit);
    snare_engine_enable_event_log(engine, 256);
    snare_engine_set_tempo(engine, bpm);
    for (int step = 0; step < SNARE_STEPS; ++step) snare_engine_set_step(engine, 0, step, 100);
    snare_engine_play_loops(engine, 2);
    const int loop = snare_loop_frames(bpm, kRate, SNARE_STEPS);
    snare::io::render(engine, loop * 2 + 4096, 128);
    CHECK_EQ(snare_engine_event_count(engine), 32);
    CHECK_EQ(snare_engine_is_playing(engine), 0);
    CHECK_EQ(snare_engine_current_step(engine), -1);
    snare_engine_destroy(engine);
  }
  SnareEngine* engine = snare_engine_create(kRate);
  CHECK_EQ(snare_engine_play_loops(engine, 0), SNARE_ERR_BAD_ARGUMENT);
  snare_engine_destroy(engine);
}

SNARE_TEST(tempo_change_keeps_every_step) {
  const double slow = 90.0;
  const double fast = 150.0;
  SnareEngine* engine = makeEngine(kRate, slow, 50.0);
  // Change tempo part-way through the first loop, at a buffer boundary.
  const int changeAt = 128 * 300;
  snare::io::render(engine, changeAt, 128);
  snare_engine_set_tempo(engine, fast);
  snare::io::render(engine, static_cast<int>(kRate * 6), 128);
  const auto events = readEvents(engine);

  // Steps still arrive in order with none skipped or repeated, and the gap
  // between two events is their distance in sixteenths at the tempo in force.
  std::int64_t absolute = 0;
  std::int64_t previousAbsolute = 0;
  double previous = -1.0;
  const double slowStep = snare_frames_per_step(slow, kRate);
  const double fastStep = snare_frames_per_step(fast, kRate);
  int checkedSlow = 0;
  int checkedFast = 0;
  for (const SnareEvent& event : events) {
    while (!(absolute % 4 == 0 || absolute % 2 == 1)) ++absolute;
    CHECK_EQ(event.step, static_cast<int>(absolute % SNARE_STEPS));
    const double steps = static_cast<double>(absolute - previousAbsolute);
    if (previous >= changeAt) {
      CHECK_NEAR(event.frame - previous, steps * fastStep, 1.0);
      ++checkedFast;
    } else if (previous >= 0.0 && event.frame < changeAt) {
      CHECK_NEAR(event.frame - previous, steps * slowStep, 1.0);
      ++checkedSlow;
    }
    previous = event.frame;
    previousAbsolute = absolute;
    ++absolute;
  }
  CHECK(checkedSlow > 3);
  CHECK(checkedFast > 20);
  CHECK(events.size() > 30);
  snare_engine_destroy(engine);
}

SNARE_TEST(arguments_are_validated) {
  SnareEngine* engine = snare_engine_create(kRate);
  CHECK(snare_engine_create(100.0) == nullptr);
  CHECK_EQ(snare_engine_set_step(engine, SNARE_MAX_ROLES, 0, 100), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_step(engine, 0, SNARE_STEPS, 100), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_step(engine, 0, 0, 128), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_trigger(engine, 0, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_tempo(engine, 0.0), SNARE_ERR_BAD_ARGUMENT);
  SnareKit* kit = snare_kit_create();
  const float sample[4] = {0, 0, 0, 0};
  CHECK_EQ(snare_kit_set_voice(kit, 0, sample, 4, 3, kRate, 1, 0, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_kit_set_voice(kit, 0, sample, 0, 1, kRate, 1, 0, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_kit_set_voice(kit, 0, sample, 4, 1, kRate, 1, 2.0f, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_kit_set_voice(kit, 0, sample, 4, 1, kRate, 1, 0, 0), SNARE_OK);
  snare_kit_destroy(kit);

  // The command queue reports when it is full instead of blocking.
  int result = SNARE_OK;
  for (int i = 0; i < 5000 && result == SNARE_OK; ++i) result = snare_engine_set_step(engine, 0, 0, 1);
  CHECK_EQ(result, SNARE_ERR_QUEUE_FULL);
  float left[8], right[8];
  snare_engine_render(engine, left, right, 8);
  CHECK_EQ(snare_engine_set_step(engine, 0, 0, 1), SNARE_OK);
  snare_engine_destroy(engine);
}

SNARE_TEST_MAIN()
