// The scheduler: steps land on frames computed from the tick timeline, at
// every pre-scale and length, whatever the buffer size, for as long as it runs.

#include <cstring>
#include <vector>

#include "../tools/render.h"
#include "test_util.h"

using namespace snare::test;

namespace {

constexpr double kRate = 48000.0;

// An engine whose first track clicks on every step of pattern 0.
SnareEngine* clickEngine(const SnarePattern& form, double bpm, double rate = kRate, int log = 4096) {
  SnareEngine* engine = snare_engine_create(rate);
  makeUnity(engine);
  snare_engine_enable_event_log(engine, log);
  giveSound(engine, 0, constant(8, 0.25f), rate);
  SnarePattern pattern = form;
  pattern.rows[1] = 0xffffffffu;
  snare_engine_set_pattern(engine, 0, &pattern);
  snare_engine_set_tempo(engine, bpm);
  return engine;
}

double frameOf(std::int64_t tick, double bpm, double rate = kRate) {
  return snare_tick_frame(static_cast<double>(tick), bpm, rate);
}

}  // namespace

SNARE_TEST(steps_land_on_the_computed_frames_at_every_pre_scale) {
  for (int stepsPerBeat : {3, 4, 6, 8}) {
    for (int length : {1, 5, 12, 16}) {
      const double bpm = 97.3;
      SnareEngine* engine = clickEngine(shape(length, 0, stepsPerBeat), bpm);
      snare_engine_play(engine);
      const int stepTicks = snare_step_ticks(stepsPerBeat);
      const int steps = length * 3;  // three measures
      snare::io::render(engine, static_cast<int>(frameOf(steps * stepTicks, bpm)), 333);
      const std::vector<SnareEvent> events = readEvents(engine);
      CHECK_EQ(static_cast<int>(events.size()), steps);
      for (int i = 0; i < static_cast<int>(events.size()) && i < steps; ++i) {
        CHECK_EQ(events[static_cast<std::size_t>(i)].frame, frameOf(static_cast<std::int64_t>(i) * stepTicks, bpm));
        CHECK_EQ(events[static_cast<std::size_t>(i)].step, i % length);
      }
      snare_engine_destroy(engine);
    }
  }
}

SNARE_TEST(output_does_not_depend_on_buffer_size) {
  const int total = 96000;
  std::vector<float> reference;
  std::vector<SnareEvent> referenceEvents;
  for (int block : {total, 1, 17, 64, 128, 441, 1024, 4096}) {
    // Twenty-one steps of sextuplets: two parts, an odd length, an odd tempo.
    SnareEngine* engine = clickEngine(shape(16, 5, 6), 171.3);
    giveSound(engine, 1, constant(3000, 0.125f), kRate);
    snare_engine_set_step(engine, 0, 2, 0, 1);
    snare_engine_set_step(engine, 0, 2, 19, 1);
    snare_engine_set_step(engine, 0, 0, 7, 1);
    snare_engine_set_accent(engine, 0.5, 1.0);
    snare_engine_set_track_level(engine, 2, 0.4);
    snare_engine_play(engine);
    const auto out = snare::io::render(engine, total, block);
    const std::vector<SnareEvent> events = readEvents(engine);
    if (reference.empty()) {
      reference = out.left;
      referenceEvents = events;
      CHECK(events.size() > 30);
    } else {
      CHECK(std::memcmp(reference.data(), out.left.data(), sizeof(float) * reference.size()) == 0);
      CHECK_EQ(events.size(), referenceEvents.size());
      CHECK(std::memcmp(referenceEvents.data(), events.data(), sizeof(SnareEvent) * events.size()) == 0);
    }
    snare_engine_destroy(engine);
  }
}

SNARE_TEST(ten_minutes_of_one_step_measures_do_not_drift) {
  // The shortest measure the machine has, at its fastest: 25 ms.
  const double bpm = SNARE_BPM_MAX;
  const int steps = 24000;  // ten minutes
  SnareEngine* engine = clickEngine(shape(1, 0, 8), bpm, kRate, steps + 8);
  snare_engine_play(engine);
  const int stepTicks = snare_step_ticks(8);
  snare::io::render(engine, static_cast<int>(frameOf(static_cast<std::int64_t>(steps) * stepTicks, bpm)), 4096);
  const std::vector<SnareEvent> events = readEvents(engine);
  CHECK_EQ(static_cast<int>(events.size()), steps);
  bool exact = true;
  for (std::size_t i = 0; i < events.size(); ++i) {
    exact = exact && events[i].frame == frameOf(static_cast<std::int64_t>(i) * stepTicks, bpm) && events[i].step == 0;
  }
  CHECK(exact);
  CHECK_EQ(events.back().frame, frameOf(static_cast<std::int64_t>(steps - 1) * stepTicks, bpm));
  CHECK_EQ(snare_engine_current_measure(engine), steps);
  snare_engine_destroy(engine);
}

SNARE_TEST(play_starts_at_the_buffer_boundary) {
  SnareEngine* engine = clickEngine(shape(16), 120.0);
  snare::io::render(engine, 1000, 256);
  CHECK_EQ(snare_engine_is_playing(engine), 0);
  CHECK_EQ(snare_engine_current_step(engine), -1);
  CHECK_EQ(snare_engine_current_measure(engine), 0);
  snare_engine_play(engine);
  snare::io::render(engine, 100, 100);
  const std::vector<SnareEvent> events = readEvents(engine);
  CHECK_EQ(events.size(), 1u);
  CHECK_EQ(events[0].frame, 1000.0);
  CHECK_EQ(snare_engine_is_playing(engine), 1);
  CHECK_EQ(snare_engine_current_step(engine), 0);
  CHECK_EQ(snare_engine_current_measure(engine), 1);
  snare_engine_destroy(engine);
}

SNARE_TEST(a_bounded_play_stops_on_the_bar_line) {
  const double bpm = 140.0;
  SnareEngine* engine = clickEngine(shape(16, 4, 4), bpm);
  snare::io::render(engine, 500, 500);
  snare_engine_play_measures(engine, 2);
  CHECK_EQ(snare_engine_stop_frame(engine), -1.0);
  snare::io::render(engine, 210000, 777);
  const std::vector<SnareEvent> events = readEvents(engine);
  CHECK_EQ(events.size(), 40u);  // twenty steps, twice; no step of a third measure
  CHECK_EQ(snare_engine_is_playing(engine), 0);
  CHECK_EQ(snare_engine_stop_frame(engine), 500.0 + frameOf(2 * 20 * 6, bpm));
  CHECK_EQ(snare_engine_current_step(engine), -1);
  snare_engine_destroy(engine);
}

SNARE_TEST(a_tempo_change_keeps_every_step_and_only_moves_later_ones) {
  SnareEngine* engine = clickEngine(shape(16), 120.0);
  snare_engine_play(engine);
  snare::io::render(engine, 29000, 512);  // steps at 0, 6000, ..., 24000 so far
  snare_engine_set_tempo(engine, 60.0);
  snare::io::render(engine, 60000, 512);
  const std::vector<SnareEvent> events = readEvents(engine);
  CHECK(events.size() >= 8);
  for (int i = 0; i <= 4; ++i) CHECK_EQ(events[static_cast<std::size_t>(i)].frame, 6000.0 * i);
  // The step due at 30000 was 1000 frames away when the tempo halved, so it
  // is now 2000 away.
  CHECK_EQ(events[5].frame, 31000.0);
  CHECK_EQ(events[6].frame - events[5].frame, 12000.0);
  for (std::size_t i = 1; i < events.size(); ++i) CHECK_EQ(events[i].step, static_cast<int>(i % 16));
  snare_engine_destroy(engine);
}

SNARE_TEST(control_calls_check_their_arguments) {
  SnareEngine* engine = snare_engine_create(kRate);
  const SnarePattern good = shape(16);
  const SnarePattern bad = shape(0);
  CHECK(snare_engine_create(100.0) == nullptr);
  CHECK_EQ(snare_engine_set_tempo(engine, 0.0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_tempo(nullptr, 120.0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_pattern(engine, SNARE_PATTERNS, &good), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_pattern(engine, 0, &bad), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_pattern(engine, 0, nullptr), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_step(engine, 0, SNARE_TRACKS, 0, 1), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_step(engine, 0, 0, SNARE_MAX_STEPS, 1), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_step(engine, -1, 0, 0, 1), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_cue_pattern(engine, -1), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_play_measures(engine, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_trigger(engine, 0, 0), SNARE_ERR_BAD_ARGUMENT);  // the accent has no sound
  CHECK_EQ(snare_engine_trigger(engine, SNARE_TRACKS, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_track(engine, 0, 0, 0.0f, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_track(engine, 1, SNARE_SOUNDS, 0.0f, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_track(engine, 1, 0, 2.0f, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_track_level(engine, 1, 5.0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_accent(engine, -1.0, 1.0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_master_volume(engine, 1.5), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_pattern(engine, 0, &good), SNARE_OK);

  // The queue holds 1024 messages until audio is pulled.
  int result = SNARE_OK;
  for (int i = 0; i < 2000 && result == SNARE_OK; ++i) result = snare_engine_set_tempo(engine, 100.0 + i);
  CHECK_EQ(result, SNARE_ERR_QUEUE_FULL);
  snare::io::render(engine, 16, 16);
  CHECK_EQ(snare_engine_set_tempo(engine, 100.0), SNARE_OK);
  snare_engine_destroy(engine);
}

SNARE_TEST_MAIN()
