// The pattern bank: thirty-two measures, each with a 1st and a 2nd part, and
// the rules for when an edit, a new shape or another pattern takes over.

#include <vector>

#include "../tools/render.h"
#include "test_util.h"

using namespace snare::test;

namespace {

constexpr double kRate = 48000.0;
constexpr double kBpm = 120.0;  // a sixteenth is 6000 frames

SnareEngine* makeEngine() {
  SnareEngine* engine = snare_engine_create(kRate);
  makeUnity(engine);
  snare_engine_enable_event_log(engine, 4096);
  for (int slot = 0; slot < 3; ++slot) giveSound(engine, slot, constant(8, 0.25f), kRate);
  snare_engine_set_tempo(engine, kBpm);
  return engine;
}

std::vector<int> steps(const std::vector<SnareEvent>& events, int track = 1) {
  std::vector<int> out;
  for (const SnareEvent& event : events) {
    if (event.track == track) out.push_back(event.step);
  }
  return out;
}

void renderSteps(SnareEngine* engine, int count) { snare::io::render(engine, count * 6000, 500); }

}  // namespace

SNARE_TEST(the_first_part_plays_then_the_second) {
  SnareEngine* engine = makeEngine();
  SnarePattern pattern = shape(3, 2);
  pattern.rows[1] = 0xffffffffu;
  snare_engine_set_pattern(engine, 0, &pattern);
  snare_engine_play(engine);
  renderSteps(engine, 10);
  // The 2nd part keeps its own steps, 16 onwards, however short the 1st is.
  CHECK(steps(readEvents(engine)) == (std::vector<int>{0, 1, 2, 16, 17, 0, 1, 2, 16, 17}));
  snare_engine_destroy(engine);
}

SNARE_TEST(a_second_part_of_no_steps_is_skipped) {
  SnareEngine* engine = makeEngine();
  SnarePattern pattern = shape(4, 0);
  pattern.rows[1] = 0xffffffffu;
  snare_engine_set_pattern(engine, 0, &pattern);
  snare_engine_play(engine);
  renderSteps(engine, 8);
  CHECK(steps(readEvents(engine)) == (std::vector<int>{0, 1, 2, 3, 0, 1, 2, 3}));
  snare_engine_destroy(engine);
}

SNARE_TEST(a_new_length_waits_for_the_bar_line_but_a_step_edit_does_not) {
  SnareEngine* engine = makeEngine();
  SnarePattern pattern = shape(4);
  pattern.rows[1] = 0b0101;
  snare_engine_set_pattern(engine, 0, &pattern);
  snare_engine_play(engine);
  renderSteps(engine, 1);  // step 0 has sounded

  // Shorter, with step 1 added: the edit is heard this measure, the new
  // length from the next one.
  SnarePattern shorter = shape(2);
  shorter.rows[1] = 0b0111;
  snare_engine_set_pattern(engine, 0, &shorter);
  renderSteps(engine, 7);
  CHECK(steps(readEvents(engine)) == (std::vector<int>{0, 1, 2, 0, 1, 0, 1}));
  snare_engine_destroy(engine);
}

SNARE_TEST(a_single_step_can_be_switched_while_playing) {
  SnareEngine* engine = makeEngine();
  SnarePattern pattern = shape(4);
  snare_engine_set_pattern(engine, 0, &pattern);
  snare_engine_play(engine);
  renderSteps(engine, 4);
  CHECK(readEvents(engine).empty());
  snare_engine_set_step(engine, 0, 1, 2, 1);
  snare_engine_set_step(engine, 0, 2, 3, 1);
  renderSteps(engine, 4);
  snare_engine_set_step(engine, 0, 1, 2, 0);
  renderSteps(engine, 4);
  const std::vector<SnareEvent> events = readEvents(engine);
  CHECK(steps(events, 1) == (std::vector<int>{2}));
  CHECK(steps(events, 2) == (std::vector<int>{3, 3}));
  // An edit to a pattern that is not playing is not heard.
  snare_engine_set_step(engine, 5, 1, 0, 1);
  renderSteps(engine, 4);
  CHECK(steps(readEvents(engine), 1) == (std::vector<int>{2}));
  snare_engine_destroy(engine);
}

SNARE_TEST(a_cued_pattern_takes_over_at_the_bar_line) {
  SnareEngine* engine = makeEngine();
  SnarePattern first = shape(4);
  first.rows[1] = 0b1111;
  SnarePattern second = shape(3, 0, 3);  // another length and another step size
  second.rows[2] = 0b111;
  snare_engine_set_pattern(engine, 0, &first);
  snare_engine_set_pattern(engine, 7, &second);
  snare_engine_play(engine);
  renderSteps(engine, 1);
  CHECK_EQ(snare_engine_current_pattern(engine), 0);
  snare_engine_cue_pattern(engine, 7);
  renderSteps(engine, 2);
  CHECK_EQ(snare_engine_current_pattern(engine), 0);  // the measure is still finishing
  snare::io::render(engine, 6000 + 3 * 8000 + 100, 500);
  CHECK_EQ(snare_engine_current_pattern(engine), 7);
  CHECK_EQ(snare_engine_current_measure(engine), 3);

  const std::vector<SnareEvent> events = readEvents(engine);
  CHECK(steps(events, 1) == (std::vector<int>{0, 1, 2, 3}));
  // With nothing cued it repeats. Its triplet steps are 8000 frames apart.
  CHECK(steps(events, 2) == (std::vector<int>{0, 1, 2, 0}));
  CHECK_EQ(events[4].frame, 24000.0);
  CHECK_EQ(events[5].frame, 32000.0);
  CHECK_EQ(events[4].pattern, 7);
  CHECK_EQ(events[3].pattern, 0);
  snare_engine_destroy(engine);
}

SNARE_TEST(a_pattern_cued_while_stopped_plays_from_the_start) {
  SnareEngine* engine = makeEngine();
  SnarePattern pattern = shape(2);
  pattern.rows[2] = 0b11;
  snare_engine_set_pattern(engine, 31, &pattern);
  snare_engine_cue_pattern(engine, 31);
  snare::io::render(engine, 64, 64);
  CHECK_EQ(snare_engine_current_pattern(engine), 31);
  snare_engine_play(engine);
  renderSteps(engine, 3);
  const std::vector<SnareEvent> events = readEvents(engine);
  CHECK(steps(events, 2) == (std::vector<int>{0, 1, 0}));
  CHECK_EQ(events[0].frame, 64.0);
  snare_engine_stop(engine);
  snare::io::render(engine, 64, 64);
  CHECK_EQ(snare_engine_is_playing(engine), 0);
  CHECK_EQ(snare_engine_current_step(engine), -1);
  snare_engine_destroy(engine);
}

SNARE_TEST_MAIN()
