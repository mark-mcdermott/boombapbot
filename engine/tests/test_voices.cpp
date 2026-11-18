// The voice pool: one voice to a track, sounds replaced one slot at a time,
// samples played at their own rate, and bounded, repeatable stealing.

#include <cstring>
#include <vector>

#include "../tools/render.h"
#include "test_util.h"

using namespace snare::test;

namespace {

constexpr double kRate = 48000.0;

SnareEngine* unityEngine() {
  SnareEngine* engine = snare_engine_create(kRate);
  makeUnity(engine);
  return engine;
}

double out(double sample) { return sample * kHeadroom; }

}  // namespace

SNARE_TEST(a_track_has_one_voice_and_a_new_hit_fades_the_old_one) {
  SnareEngine* engine = unityEngine();
  giveSound(engine, 0, constant(20000, 0.25f), kRate);
  snare_engine_trigger(engine, 1, 0);
  auto audio = snare::io::render(engine, 1000, 256);
  CHECK_NEAR(audio.left[500], out(0.25), 1e-6);

  snare_engine_trigger(engine, 1, 0);
  audio = snare::io::render(engine, 1000, 256);
  const int fade = static_cast<int>(0.004 * kRate);
  CHECK(audio.left[fade / 2] > out(0.25) + 0.05f);    // both for a moment
  CHECK(audio.left[fade / 2] < out(0.5) - 0.05f);     // but never doubled
  CHECK_NEAR(audio.left[fade + 2], out(0.25), 1e-6);  // then only the new hit
  CHECK_EQ(snare_engine_active_voices(engine), 1);
  snare_engine_destroy(engine);
}

SNARE_TEST(different_tracks_sound_together) {
  SnareEngine* engine = unityEngine();
  giveSound(engine, 0, constant(4000, 0.25f), kRate);
  giveSound(engine, 1, constant(4000, 0.125f), kRate);
  snare_engine_trigger(engine, 1, 0);
  snare_engine_trigger(engine, 2, 0);
  const auto audio = snare::io::render(engine, 1000, 256);
  CHECK_NEAR(audio.left[500], out(0.375), 1e-6);
  CHECK_EQ(snare_engine_active_voices(engine), 2);
  snare_engine_destroy(engine);
}

SNARE_TEST(samples_play_at_their_own_rate) {
  SnareEngine* engine = unityEngine();
  // 1000 frames recorded at half the engine's rate last 2000 output frames.
  giveSound(engine, 0, constant(1000, 0.25f), kRate / 2);
  snare_engine_trigger(engine, 1, 0);
  const auto audio = snare::io::render(engine, 3000, 256);
  CHECK_NEAR(audio.left[1900], out(0.25), 1e-6);
  CHECK_EQ(audio.left[2100], 0.0f);
  snare_engine_destroy(engine);
}

SNARE_TEST(one_sound_can_be_replaced_while_its_tail_rings) {
  SnareEngine* engine = unityEngine();
  // Two tracks on one slot, so the old sound and the new one can overlap.
  snare_engine_set_track(engine, 2, 0, 0.0f, 0);
  giveSound(engine, 0, constant(2000, 0.25f), kRate);
  snare_engine_trigger(engine, 1, 0);
  auto audio = snare::io::render(engine, 500, 500);
  CHECK_NEAR(audio.left[100], out(0.25), 1e-6);

  giveSound(engine, 0, constant(2000, -0.125f), kRate);
  snare_engine_trigger(engine, 2, 0);
  audio = snare::io::render(engine, 500, 500);
  CHECK_NEAR(audio.left[100], out(0.125), 1e-6);  // the old tail and the new hit
  CHECK_EQ(snare_engine_collect(engine), 1);      // the replaced sound still has a live voice

  audio = snare::io::render(engine, 2000, 500);
  CHECK_NEAR(audio.left[1200], out(-0.125), 1e-6);
  CHECK_EQ(snare_engine_collect(engine), 0);
  snare_engine_destroy(engine);
}

SNARE_TEST(a_staged_sound_replaced_before_it_is_taken_never_sounds) {
  SnareEngine* engine = unityEngine();
  giveSound(engine, 0, constant(1000, 0.5f), kRate);
  giveSound(engine, 0, constant(1000, 0.125f), kRate);
  snare_engine_trigger(engine, 1, 0);
  const auto audio = snare::io::render(engine, 500, 500);
  CHECK_NEAR(audio.left[100], out(0.125), 1e-6);
  CHECK_EQ(snare_engine_collect(engine), 0);
  snare_engine_destroy(engine);
}

SNARE_TEST(null_empties_a_slot_and_an_empty_sound_is_silent) {
  SnareEngine* engine = unityEngine();
  giveSound(engine, 0, constant(300, 0.5f), kRate);
  snare_engine_trigger(engine, 1, 0);
  auto audio = snare::io::render(engine, 500, 500);
  CHECK_NEAR(audio.left[100], out(0.5), 1e-6);

  snare_engine_set_sound(engine, 0, nullptr);
  snare_engine_trigger(engine, 1, 0);
  audio = snare::io::render(engine, 500, 500);
  CHECK_EQ(audio.left[100], 0.0f);
  CHECK_EQ(snare_engine_active_voices(engine), 0);

  snare_engine_set_sound(engine, 0, snare_sound_create(0, 1, kRate));
  snare_engine_trigger(engine, 1, 0);
  audio = snare::io::render(engine, 500, 500);
  CHECK_EQ(audio.left[100], 0.0f);
  snare_engine_destroy(engine);
}

SNARE_TEST(the_engine_can_synthesise_a_sound_into_its_slot) {
  SnareEngine* engine = unityEngine();
  const SnareSoundParams kick{SNARE_SOUND_KICK, 0.5f, 0.5f, 0.5f, 0.5f, 0};
  CHECK_EQ(snare_engine_synth_sound(engine, &kick), SNARE_OK);
  snare_engine_trigger(engine, 1, 1);
  const auto audio = snare::io::render(engine, 4000, 256);
  float peak = 0.0f;
  for (float sample : audio.left) peak = std::max(peak, std::fabs(sample));
  CHECK(peak > 0.3f);
  const SnareSoundParams unknown{SNARE_SOUNDS, 0.5f, 0.5f, 0.5f, 0.5f, 0};
  CHECK_EQ(snare_engine_synth_sound(engine, &unknown), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_synth_sound(engine, nullptr), SNARE_ERR_BAD_ARGUMENT);
  snare_engine_destroy(engine);
}

SNARE_TEST(stealing_is_bounded_and_repeatable) {
  std::vector<float> runs[2];
  for (auto& run : runs) {
    SnareEngine* engine = unityEngine();
    for (int slot = 0; slot < 11; ++slot) giveSound(engine, slot, constant(4000, 0.02f), kRate);
    // Every track retriggered every other frame: far more fading voices than
    // the pool holds.
    for (int pass = 0; pass < 400; ++pass) {
      for (int track = 1; track < SNARE_TRACKS; ++track) snare_engine_trigger(engine, track, pass & 1);
      const auto audio = snare::io::render(engine, 2, 2);
      run.insert(run.end(), audio.left.begin(), audio.left.end());
    }
    CHECK(snare_engine_stolen_voices(engine) > 0u);
    CHECK(snare_engine_active_voices(engine) <= SNARE_MAX_VOICES);
    snare_engine_destroy(engine);
  }
  for (float sample : runs[0]) CHECK(std::fabs(sample) <= 1.0f);
  CHECK(std::memcmp(runs[0].data(), runs[1].data(), sizeof(float) * runs[0].size()) == 0);
}

SNARE_TEST(sound_arguments_are_checked) {
  SnareEngine* engine = unityEngine();
  CHECK(snare_sound_create(10, 3, kRate) == nullptr);
  CHECK(snare_sound_create(-1, 1, kRate) == nullptr);
  CHECK(snare_sound_create(10, 1, 100.0) == nullptr);
  CHECK(snare_sound_data(nullptr) == nullptr);
  SnareSound* unused = snare_sound_create(10, 2, kRate);
  CHECK(snare_sound_data(unused) != nullptr);
  CHECK_EQ(snare_sound_data(unused)[19], 0.0f);
  CHECK_EQ(snare_engine_set_sound(engine, SNARE_SOUNDS, unused), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_sound(nullptr, 0, unused), SNARE_ERR_BAD_ARGUMENT);
  snare_sound_destroy(unused);
  snare_engine_destroy(engine);
}

SNARE_TEST_MAIN()
