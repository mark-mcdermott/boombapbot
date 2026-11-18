// Accent, levels and the mix: the accent track sounds nothing itself, a hit
// is louder on an accented step, and level and volume knobs move smoothly.

#include <cstring>
#include <vector>

#include "../tools/render.h"
#include "test_util.h"

using namespace snare::test;

namespace {

constexpr double kRate = 48000.0;

SnareEngine* makeEngine() {
  SnareEngine* engine = snare_engine_create(kRate);
  makeUnity(engine);
  snare_engine_enable_event_log(engine, 1024);
  giveSound(engine, 0, constant(24000, 0.5f), kRate);
  giveSound(engine, 1, constant(24000, 0.25f), kRate);
  return engine;
}

double out(double sample) { return sample * kHeadroom; }

}  // namespace

SNARE_TEST(the_accent_track_starts_no_voice) {
  SnareEngine* engine = makeEngine();
  SnarePattern pattern = shape(4);
  pattern.rows[0] = 0b1111;
  snare_engine_set_pattern(engine, 0, &pattern);
  snare_engine_play(engine);
  const auto audio = snare::io::render(engine, 24000, 256);
  CHECK(readEvents(engine).empty());
  CHECK_EQ(snare_engine_active_voices(engine), 0);
  for (float sample : audio.left) CHECK_EQ(sample, 0.0f);
  snare_engine_destroy(engine);
}

SNARE_TEST(a_hit_on_an_accented_step_is_louder) {
  SnareEngine* engine = makeEngine();
  snare_engine_set_accent(engine, 0.5, 1.0);
  SnarePattern pattern = shape(2);
  pattern.rows[0] = 0b10;
  pattern.rows[1] = 0b11;
  snare_engine_set_pattern(engine, 0, &pattern);
  snare_engine_set_tempo(engine, 120.0);
  snare_engine_play_measures(engine, 1);
  const auto audio = snare::io::render(engine, 12000, 256);
  CHECK_NEAR(audio.left[3000], out(0.25), 1e-6);
  CHECK_NEAR(audio.left[9000], out(0.5), 1e-6);
  const std::vector<SnareEvent> events = readEvents(engine);
  CHECK_EQ(events.size(), 2u);
  CHECK_EQ(events[0].accent, 0);
  CHECK_EQ(events[1].accent, 1);
  snare_engine_destroy(engine);
}

SNARE_TEST(an_audition_can_be_accented) {
  SnareEngine* engine = makeEngine();
  snare_engine_set_accent(engine, 0.5, 1.0);
  snare_engine_trigger(engine, 2, 0);
  auto audio = snare::io::render(engine, 1000, 256);
  CHECK_NEAR(audio.left[500], out(0.125), 1e-6);
  snare_engine_trigger(engine, 2, 1);
  audio = snare::io::render(engine, 1000, 256);
  CHECK_NEAR(audio.left[900], out(0.25), 1e-6);  // the first hit has faded
  const std::vector<SnareEvent> events = readEvents(engine);
  CHECK_EQ(events[0].step, -1);
  CHECK_EQ(events[0].pattern, -1);
  snare_engine_destroy(engine);
}

SNARE_TEST(a_level_knob_reaches_a_hit_that_is_still_ringing_without_a_jump) {
  SnareEngine* engine = makeEngine();
  snare_engine_trigger(engine, 1, 0);
  auto audio = snare::io::render(engine, 4000, 256);
  CHECK_NEAR(audio.left[3999], out(0.5), 1e-6);

  snare_engine_set_track_level(engine, 1, 0.5);
  audio = snare::io::render(engine, 4000, 256);
  CHECK(audio.left[0] > out(0.49));                       // it starts from where it was
  for (std::size_t i = 1; i < audio.left.size(); ++i) {
    CHECK(audio.left[i] <= audio.left[i - 1]);            // and only ever falls
  }
  CHECK(audio.left[0] - audio.left[1] < 0.002f);          // a frame at a time
  CHECK_NEAR(audio.left[3999], out(0.25), 1e-4);          // to the new level
  // Turned fully left it arrives at silence, not at ever smaller numbers.
  snare_engine_set_track_level(engine, 1, 0.0);
  audio = snare::io::render(engine, 4000, 256);
  CHECK_EQ(audio.left[3999], 0.0f);
  snare_engine_destroy(engine);
}

SNARE_TEST(the_first_setting_of_a_level_or_the_volume_is_taken_at_once) {
  SnareEngine* engine = snare_engine_create(kRate);
  snare_engine_set_accent(engine, 1.0, 1.0);
  snare_engine_set_track(engine, 1, 0, 0.0f, 0);
  snare_engine_set_track_level(engine, 1, 0.5);
  snare_engine_set_master_volume(engine, 0.5);
  giveSound(engine, 0, constant(8000, 0.5f), kRate);
  snare_engine_trigger(engine, 1, 0);
  auto audio = snare::io::render(engine, 2000, 256);
  CHECK_NEAR(audio.left[0], out(0.25) * 0.5, 1e-6);  // no fade down from full level
  CHECK_NEAR(audio.left[1999], out(0.25) * 0.5, 1e-6);

  // Volume turned to zero ends in exact silence while the hit still rings.
  snare_engine_set_master_volume(engine, 0.0);
  audio = snare::io::render(engine, 4000, 256);
  CHECK(audio.left[0] > 0.05f);
  CHECK_EQ(audio.left[3999], 0.0f);
  CHECK_EQ(snare_engine_active_voices(engine), 1);
  snare_engine_destroy(engine);
}

SNARE_TEST(knob_moves_sound_the_same_at_every_buffer_size) {
  std::vector<float> reference;
  for (int block : {4000, 1, 64, 333}) {
    SnareEngine* engine = makeEngine();
    snare_engine_trigger(engine, 1, 0);
    snare_engine_trigger(engine, 2, 1);
    snare::io::render(engine, 2048, 2048);
    snare_engine_set_track_level(engine, 1, 0.2);
    snare_engine_set_track_level(engine, 2, 1.5);
    snare_engine_set_master_volume(engine, 0.3);
    const auto audio = snare::io::render(engine, 4000, block);
    if (reference.empty()) {
      reference = audio.left;
    } else {
      CHECK(std::memcmp(reference.data(), audio.left.data(), sizeof(float) * reference.size()) == 0);
    }
    snare_engine_destroy(engine);
  }
}

SNARE_TEST(master_volume_comes_after_the_limiter) {
  SnareEngine* engine = makeEngine();
  giveSound(engine, 2, constant(24000, 1.0f), kRate);
  snare_engine_set_track_level(engine, 3, 4.0);
  snare_engine_trigger(engine, 3, 0);
  auto audio = snare::io::render(engine, 4000, 256);
  const float limited = audio.left[3999];
  CHECK(limited > 0.8f);
  CHECK(limited <= 1.0f);  // 3.6 before the limiter, held under full scale by it

  snare_engine_set_master_volume(engine, 0.5);
  audio = snare::io::render(engine, 4000, 256);
  CHECK_NEAR(audio.left[3999], limited * 0.5, 1e-4);
  snare_engine_destroy(engine);
}

SNARE_TEST(a_track_plays_the_slot_it_is_given_and_sits_where_it_is_panned) {
  SnareEngine* engine = makeEngine();
  snare_engine_trigger(engine, 1, 0);
  auto audio = snare::io::render(engine, 1000, 256);
  CHECK_NEAR(audio.left[500], out(0.5), 1e-6);

  // The same track, switched to the other sound and panned hard left.
  snare_engine_set_track(engine, 1, 1, -1.0f, 0);
  snare_engine_trigger(engine, 1, 0);
  audio = snare::io::render(engine, 1000, 256);
  CHECK_NEAR(audio.left[900], out(0.25 * std::sqrt(2.0)), 1e-6);
  CHECK_NEAR(audio.right[900], 0.0, 1e-6);
  snare_engine_destroy(engine);
}

SNARE_TEST_MAIN()
