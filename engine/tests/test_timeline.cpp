// The tick timeline: every step length is a whole number of ticks, and the
// frame of a position is a closed form of its tick.

#include "test_util.h"

using namespace snare::test;

SNARE_TEST(a_step_is_a_whole_number_of_ticks_at_every_pre_scale) {
  CHECK_EQ(snare_step_ticks(3), 8);
  CHECK_EQ(snare_step_ticks(4), 6);
  CHECK_EQ(snare_step_ticks(6), 4);
  CHECK_EQ(snare_step_ticks(8), 3);
  for (int stepsPerBeat : {3, 4, 6, 8}) {
    CHECK_EQ(snare_step_ticks(stepsPerBeat) * stepsPerBeat, SNARE_TICKS_PER_BEAT);
  }
  for (int other : {0, 1, 2, 5, 7, 12, 16, -4}) CHECK_EQ(snare_step_ticks(other), 0);
}

SNARE_TEST(a_measure_is_its_step_count_times_its_step) {
  SnarePattern pattern = shape(16, 0, 4);
  CHECK_EQ(snare_pattern_ticks(&pattern), 96);  // four beats
  pattern = shape(12, 0, 3);
  CHECK_EQ(snare_pattern_ticks(&pattern), 96);  // four beats of triplets
  pattern = shape(12, 0, 4);
  CHECK_EQ(snare_pattern_ticks(&pattern), 72);  // three beats
  pattern = shape(16, 16, 8);
  CHECK_EQ(snare_pattern_ticks(&pattern), 96);
  pattern = shape(16, 4, 4);
  CHECK_EQ(snare_pattern_ticks(&pattern), 120);  // five beats
  pattern = shape(1, 0, 8);
  CHECK_EQ(snare_pattern_ticks(&pattern), 3);
}

SNARE_TEST(bad_shapes_are_refused) {
  CHECK_EQ(snare_pattern_ticks(nullptr), SNARE_ERR_BAD_ARGUMENT);
  for (const SnarePattern& pattern : {shape(0), shape(17), shape(16, 17), shape(16, 0, 5), shape(16, 0, 0)}) {
    CHECK_EQ(snare_pattern_ticks(&pattern), SNARE_ERR_BAD_ARGUMENT);
  }
}

SNARE_TEST(frames_follow_tempo_and_sample_rate) {
  CHECK_NEAR(snare_frames_per_tick(120.0, 48000.0), 1000.0, 1e-9);
  CHECK_NEAR(snare_frames_per_tick(60.0, 44100.0), 1837.5, 1e-9);
  // Tempo is held between 40 and 300.
  CHECK_NEAR(snare_frames_per_tick(1.0, 48000.0), snare_frames_per_tick(SNARE_BPM_MIN, 48000.0), 1e-9);
  CHECK_NEAR(snare_frames_per_tick(900.0, 48000.0), snare_frames_per_tick(SNARE_BPM_MAX, 48000.0), 1e-9);
  CHECK_EQ(snare_tick_frame(96.0, 120.0, 48000.0), 96000.0);
  // Rounded half up, like every step the scheduler places.
  CHECK_EQ(snare_tick_frame(1.0, 60.0, 44100.0), 1838.0);
  CHECK_EQ(snare_tick_frame(3.0, 133.7, 48000.0), std::floor(3.0 * 48000.0 * 60.0 / 133.7 / 24.0 + 0.5));
}

SNARE_TEST_MAIN()
