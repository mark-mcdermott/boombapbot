// Choke groups: a hit in a group releases the voices already sounding in that
// group, with a short fade rather than a hard cut. The two hi-hats share one.

#include <vector>

#include "../tools/project_io.h"
#include "test_util.h"

using namespace snare::test;

namespace {

constexpr double kRate = 44100.0;
constexpr int kOpen = 10;    // tracks, as on the panel
constexpr int kClosed = 11;
constexpr int kKick = 1;

SnareEngine* makeEngine() {
  SnareEngine* engine = snare_engine_create(kRate);
  makeUnity(engine);
  snare_engine_set_track(engine, kOpen, SNARE_SOUND_OPEN_HAT, 0.0f, 1);
  snare_engine_set_track(engine, kClosed, SNARE_SOUND_CLOSED_HAT, 0.0f, 1);
  snare_engine_set_track(engine, kKick, SNARE_SOUND_KICK, 0.0f, 0);
  giveSound(engine, SNARE_SOUND_OPEN_HAT, constant(44100, 0.5f), kRate);
  giveSound(engine, SNARE_SOUND_CLOSED_HAT, constant(44100, 0.0f), kRate);  // silent on purpose
  giveSound(engine, SNARE_SOUND_KICK, constant(44100, 0.25f), kRate);
  return engine;
}

double out(double sample) { return sample * kHeadroom; }

}  // namespace

SNARE_TEST(closed_hat_chokes_open_hat) {
  SnareEngine* engine = makeEngine();
  snare_engine_trigger(engine, kOpen, 0);
  auto audio = snare::io::render(engine, 1024, 1024);
  CHECK_NEAR(audio.left[1000], out(0.5), 1e-6);

  snare_engine_trigger(engine, kClosed, 0);
  audio = snare::io::render(engine, 1024, 1024);
  const int fade = static_cast<int>(0.004 * kRate);
  CHECK(audio.left[0] > 0.4f);                  // still sounding as the fade begins
  CHECK(audio.left[fade / 2] < 0.27f);
  CHECK(audio.left[fade / 2] > 0.18f);          // half-way down, not cut dead
  CHECK_NEAR(audio.left[fade + 2], 0.0, 1e-6);  // silent once the fade ends
  for (int i = 1; i < fade; ++i) CHECK(audio.left[i] <= audio.left[i - 1]);
  snare_engine_destroy(engine);
}

SNARE_TEST(other_voices_are_not_choked) {
  SnareEngine* engine = makeEngine();
  snare_engine_trigger(engine, kKick, 0);
  snare_engine_trigger(engine, kOpen, 0);
  snare::io::render(engine, 1024, 1024);
  snare_engine_trigger(engine, kClosed, 0);
  const auto audio = snare::io::render(engine, 2048, 2048);
  CHECK_NEAR(audio.left[1500], out(0.25), 1e-6);  // the kick rings on
  snare_engine_destroy(engine);
}

SNARE_TEST(a_choke_lands_on_the_step_that_causes_it) {
  SnareEngine* engine = makeEngine();
  SnarePattern pattern = shape(4);
  pattern.rows[kOpen] = 0b0001;
  pattern.rows[kClosed] = 0b0100;
  snare_engine_set_pattern(engine, 0, &pattern);
  snare_engine_set_tempo(engine, 120.0);
  snare_engine_play_measures(engine, 1);
  const int step = static_cast<int>(snare_tick_frame(6.0, 120.0, kRate));
  const auto audio = snare::io::render(engine, step * 4, 333);
  CHECK_NEAR(audio.left[step * 2 - 1], out(0.5), 1e-6);
  CHECK(audio.left[step * 2 + 20] < audio.left[step * 2 - 1]);
  CHECK_NEAR(audio.left[step * 2 + 400], 0.0, 1e-6);
  snare_engine_destroy(engine);
}

SNARE_TEST_MAIN()
