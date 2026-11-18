// The effect on the mix, and the output level the meter reads.

#include <cmath>
#include <cstring>
#include <vector>

#include "../tools/project_io.h"
#include "test_util.h"

using namespace snare::test;

namespace {

constexpr double kRate = 48000.0;
constexpr int kEffects[] = {SNARE_EFFECT_DELAY, SNARE_EFFECT_REVERB, SNARE_EFFECT_FLANGER, SNARE_EFFECT_CHORUS};

// An engine whose first track plays a short burst on the first step of a measure.
SnareEngine* burstEngine(double rate = kRate) {
  SnareEngine* engine = snare_engine_create(rate);
  makeUnity(engine);
  std::vector<float> burst(static_cast<std::size_t>(rate * 0.02));
  for (std::size_t i = 0; i < burst.size(); ++i) burst[i] = (i % 16 < 8 ? 0.4f : -0.4f);
  giveSound(engine, 0, burst, rate);
  SnarePattern pattern = shape(16);
  pattern.rows[1] = 0b1;
  snare_engine_set_pattern(engine, 0, &pattern);
  snare_engine_set_tempo(engine, 120.0);
  return engine;
}

double energy(const std::vector<float>& samples, std::size_t from, std::size_t to) {
  double sum = 0.0;
  for (std::size_t i = from; i < to && i < samples.size(); ++i) sum += static_cast<double>(samples[i]) * samples[i];
  return sum;
}

}  // namespace

SNARE_TEST(no_effect_leaves_the_mix_exactly_as_it_was) {
  SnareEngine* plain = burstEngine();
  SnareEngine* asked = burstEngine();
  CHECK_EQ(snare_engine_set_effect(asked, SNARE_EFFECT_NONE, 1.0), SNARE_OK);
  snare_engine_play(plain);
  snare_engine_play(asked);
  const auto a = snare::io::render(plain, 48000, 256);
  const auto b = snare::io::render(asked, 48000, 256);
  CHECK(std::memcmp(a.left.data(), b.left.data(), sizeof(float) * a.left.size()) == 0);
  CHECK(std::memcmp(a.right.data(), b.right.data(), sizeof(float) * a.right.size()) == 0);
  snare_engine_destroy(plain);
  snare_engine_destroy(asked);
}

SNARE_TEST(every_effect_adds_sound_and_stays_bounded) {
  SnareEngine* dry = burstEngine();
  snare_engine_play(dry);
  const auto plain = snare::io::render(dry, 96000, 256);
  snare_engine_destroy(dry);
  for (int effect : kEffects) {
    SnareEngine* engine = burstEngine();
    CHECK_EQ(snare_engine_set_effect(engine, effect, 1.0), SNARE_OK);
    snare_engine_play(engine);
    const auto wet = snare::io::render(engine, 96000, 256);
    CHECK(std::memcmp(plain.left.data(), wet.left.data(), sizeof(float) * plain.left.size()) != 0);
    for (std::size_t i = 0; i < wet.left.size(); ++i) {
      CHECK(std::isfinite(wet.left[i]) && std::fabs(wet.left[i]) <= 1.0f);
      CHECK(std::isfinite(wet.right[i]) && std::fabs(wet.right[i]) <= 1.0f);
    }
    snare_engine_destroy(engine);
  }
}

SNARE_TEST(the_echo_comes_back_a_dotted_eighth_later_and_keeps_time) {
  for (double bpm : {90.0, 120.0, 174.0}) {
    SnareEngine* engine = burstEngine();
    snare_engine_set_tempo(engine, bpm);
    snare_engine_set_effect(engine, SNARE_EFFECT_DELAY, 1.0);
    snare_engine_play_measures(engine, 1);
    const auto out = snare::io::render(engine, 96000, 512);
    const std::size_t echo = static_cast<std::size_t>(0.75 * 60.0 / bpm * kRate);
    const std::size_t burst = static_cast<std::size_t>(kRate * 0.02);
    // Quiet between the hit and its echo; the echo arrives when it should.
    CHECK(energy(out.left, burst + 200, echo - 200) < 1e-6);
    CHECK(energy(out.left, echo, echo + burst) > 0.05);
    snare_engine_destroy(engine);
  }
}

SNARE_TEST(every_effect_dies_away_inside_the_tail_it_reports) {
  for (int effect : kEffects) {
    const double bpm = 120.0;
    SnareEngine* engine = burstEngine();
    snare_engine_set_effect(engine, effect, 1.0);
    snare_engine_play_measures(engine, 1);
    const double tail = snare_effect_tail_seconds(effect, bpm);
    CHECK(tail > 0.0);
    // One measure is two seconds. After it and the tail, the output is silent.
    const std::size_t from = static_cast<std::size_t>((0.02 + tail) * kRate);
    const auto out = snare::io::render(engine, static_cast<int>(from + 48000), 512);
    double peak = 0.0;
    for (std::size_t i = from; i < out.left.size(); ++i) {
      peak = std::max(peak, static_cast<double>(std::max(std::fabs(out.left[i]), std::fabs(out.right[i]))));
    }
    CHECK(peak < 0.4 * 0.0015);
    snare_engine_destroy(engine);
  }
  CHECK_EQ(snare_effect_tail_seconds(SNARE_EFFECT_NONE, 120.0), 0.0);
}

SNARE_TEST(output_with_an_effect_does_not_depend_on_buffer_size) {
  for (int effect : kEffects) {
    const int total = 72000;
    std::vector<float> left, right;
    for (int block : {total, 1, 17, 128, 441, 4096}) {
      SnareEngine* engine = burstEngine();
      snare_engine_set_effect(engine, effect, 0.7);
      snare_engine_play(engine);
      const auto out = snare::io::render(engine, total, block);
      if (left.empty()) {
        left = out.left;
        right = out.right;
      } else {
        CHECK(std::memcmp(left.data(), out.left.data(), sizeof(float) * left.size()) == 0);
        CHECK(std::memcmp(right.data(), out.right.data(), sizeof(float) * right.size()) == 0);
      }
      snare_engine_destroy(engine);
    }
  }
}

SNARE_TEST(a_change_of_effect_fades_one_out_before_the_next_begins) {
  SnareEngine* engine = burstEngine();
  snare_engine_set_effect(engine, SNARE_EFFECT_REVERB, 1.0);
  snare_engine_play(engine);
  snare::io::render(engine, 24000, 256);
  snare_engine_set_effect(engine, SNARE_EFFECT_DELAY, 1.0);
  const auto out = snare::io::render(engine, 96000, 256);
  for (std::size_t i = 1; i < out.left.size(); ++i) {
    CHECK(std::isfinite(out.left[i]));
    // No click: nothing jumps by more than the burst itself can.
    CHECK(std::fabs(out.left[i] - out.left[i - 1]) < 0.9f);
  }
  snare_engine_destroy(engine);
}

SNARE_TEST(an_effect_runs_at_every_sample_rate) {
  for (double rate : {8000.0, 44100.0, 96000.0, 192000.0}) {
    for (int effect : kEffects) {
      SnareEngine* engine = burstEngine(rate);
      snare_engine_set_effect(engine, effect, 1.0);
      snare_engine_play(engine);
      const auto out = snare::io::render(engine, static_cast<int>(rate), 512);
      CHECK(energy(out.left, 0, out.left.size()) > 0.0);
      for (float sample : out.left) CHECK(std::isfinite(sample));
      snare_engine_destroy(engine);
    }
  }
}

SNARE_TEST(bad_effect_settings_are_refused) {
  SnareEngine* engine = snare_engine_create(kRate);
  CHECK_EQ(snare_engine_set_effect(nullptr, SNARE_EFFECT_DELAY, 0.5), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_effect(engine, -1, 0.5), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_effect(engine, SNARE_EFFECT_CHORUS + 1, 0.5), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_effect(engine, SNARE_EFFECT_DELAY, 1.5), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_effect(engine, SNARE_EFFECT_DELAY, -0.1), SNARE_ERR_BAD_ARGUMENT);
  snare_engine_destroy(engine);
}

SNARE_TEST(the_output_level_follows_the_sound_and_falls_back_to_nothing) {
  SnareEngine* engine = snare_engine_create(kRate);
  makeUnity(engine);
  CHECK_EQ(snare_engine_output_level(engine), 0.0);
  CHECK_EQ(snare_engine_output_level(nullptr), 0.0);
  // A second of a steady half-scale level on every step.
  giveSound(engine, 0, constant(static_cast<int>(kRate), 0.5f), kRate);
  SnarePattern pattern = shape(16);
  pattern.rows[1] = 0xffff;
  snare_engine_set_pattern(engine, 0, &pattern);
  snare_engine_play_measures(engine, 1);
  snare::io::render(engine, 96000, 256);
  const double loud = snare_engine_output_level(engine);
  CHECK(loud > 0.3 && loud < 0.6);
  // Louder master, louder reading: the meter is after the volume.
  snare_engine_set_master_volume(engine, 0.25);
  snare_engine_play_measures(engine, 1);
  snare::io::render(engine, 96000, 256);
  CHECK(snare_engine_output_level(engine) < loud * 0.5);
  snare::io::render(engine, 480000, 4096);
  CHECK_EQ(snare_engine_output_level(engine), 0.0);
  snare_engine_destroy(engine);
}

SNARE_TEST_MAIN()
