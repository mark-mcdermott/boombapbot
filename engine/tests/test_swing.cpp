// Swing: every second step of a measure of four or eight steps to the beat
// plays late by a fraction of a step, and nothing else moves.

#include <cstring>
#include <vector>

#include "../tools/render.h"
#include "test_util.h"

using namespace snare::test;

namespace {

constexpr double kRate = 48000.0;
constexpr double kBpm = 113.7;

// An engine whose first track clicks on every step of pattern 0.
SnareEngine* clickEngine(SnarePattern pattern) {
  SnareEngine* engine = snare_engine_create(kRate);
  makeUnity(engine);
  snare_engine_enable_event_log(engine, 4096);
  giveSound(engine, 0, constant(8, 0.25f), kRate);
  pattern.rows[1] = 0xffffffffu;
  snare_engine_set_pattern(engine, 0, &pattern);
  snare_engine_set_tempo(engine, kBpm);
  return engine;
}

SnarePattern swung(int length, int stepsPerBeat, int swing) {
  SnarePattern pattern = shape(length, 0, stepsPerBeat);
  pattern.swing = static_cast<std::uint8_t>(swing);
  return pattern;
}

double frameOf(double tick) { return snare_tick_frame(tick, kBpm, kRate); }

// Where step `index` of an endless run of `length`-step measures should land.
double expected(int index, int length, int stepsPerBeat, int swing) {
  const int stepTicks = snare_step_ticks(stepsPerBeat);
  const bool late = (index % length) % 2 == 1 && (stepsPerBeat == 4 || stepsPerBeat == 8);
  return frameOf(static_cast<double>(index) * stepTicks + (late ? stepTicks * swing / 256.0 : 0.0));
}

std::vector<SnareEvent> play(const SnarePattern& pattern, int steps, int block = 333) {
  SnareEngine* engine = clickEngine(pattern);
  snare_engine_play(engine);
  const int stepTicks = snare_step_ticks(pattern.steps_per_beat);
  snare::io::render(engine, static_cast<int>(frameOf(static_cast<double>(steps) * stepTicks)), block);
  std::vector<SnareEvent> events = readEvents(engine);
  snare_engine_destroy(engine);
  return events;
}

}  // namespace

SNARE_TEST(off_beat_steps_play_late_by_their_swing) {
  for (int stepsPerBeat : {4, 8}) {
    for (int swing : {0, 37, 64, SNARE_SWING_MAX}) {
      const std::vector<SnareEvent> events = play(swung(16, stepsPerBeat, swing), 48);
      CHECK_EQ(static_cast<int>(events.size()), 48);
      for (std::size_t i = 0; i < events.size(); ++i) {
        CHECK_EQ(events[i].frame, expected(static_cast<int>(i), 16, stepsPerBeat, swing));
      }
    }
  }
}

SNARE_TEST(full_swing_puts_the_off_beat_three_quarters_through_its_pair) {
  const std::vector<SnareEvent> events = play(swung(16, 4, SNARE_SWING_MAX), 4);
  const int stepTicks = snare_step_ticks(4);
  CHECK_EQ(events[1].frame, frameOf(1.5 * stepTicks));
  CHECK_EQ(events[2].frame, frameOf(2.0 * stepTicks));
}

SNARE_TEST(triplets_do_not_swing) {
  for (int stepsPerBeat : {3, 6}) {
    const std::vector<SnareEvent> events = play(swung(12, stepsPerBeat, SNARE_SWING_MAX), 36);
    CHECK_EQ(static_cast<int>(events.size()), 36);
    for (std::size_t i = 0; i < events.size(); ++i) {
      CHECK_EQ(events[i].frame, frameOf(static_cast<double>(i) * snare_step_ticks(stepsPerBeat)));
    }
  }
}

SNARE_TEST(the_bar_line_never_swings) {
  // Five steps: the bar line falls where a sixth, off-beat step would.
  const std::vector<SnareEvent> events = play(swung(5, 4, SNARE_SWING_MAX), 20);
  CHECK_EQ(static_cast<int>(events.size()), 20);
  for (std::size_t i = 0; i < events.size(); ++i) {
    CHECK_EQ(events[i].step, static_cast<int>(i % 5));
    CHECK_EQ(events[i].frame, expected(static_cast<int>(i), 5, 4, SNARE_SWING_MAX));
  }
}

SNARE_TEST(swung_output_does_not_depend_on_buffer_size) {
  const int total = 96000;
  std::vector<float> reference;
  std::vector<SnareEvent> referenceEvents;
  for (int block : {total, 1, 17, 128, 441, 4096}) {
    SnareEngine* engine = clickEngine(swung(16, 8, 90));
    giveSound(engine, 0, constant(900, 0.25f), kRate);
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

SNARE_TEST(a_swing_past_the_most_there_is_is_refused) {
  SnareEngine* engine = snare_engine_create(kRate);
  const SnarePattern tooFar = swung(16, 4, SNARE_SWING_MAX + 1);
  CHECK_EQ(snare_engine_set_pattern(engine, 0, &tooFar), SNARE_ERR_BAD_ARGUMENT);
  const SnarePattern most = swung(16, 4, SNARE_SWING_MAX);
  CHECK_EQ(snare_engine_set_pattern(engine, 0, &most), SNARE_OK);
  snare_engine_destroy(engine);
}

SNARE_TEST_MAIN()
