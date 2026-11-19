// The effect on the mix, and the output level the meter reads.

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

#include "../tools/render.h"
#include "test_util.h"

using namespace snare::test;

namespace {

constexpr double kRate = 48000.0;
constexpr int kEffects[] = {SNARE_EFFECT_DELAY,  SNARE_EFFECT_REVERB, SNARE_EFFECT_FLANGER, SNARE_EFFECT_CHORUS,
                            SNARE_EFFECT_CRUSHER, SNARE_EFFECT_TAPE,  SNARE_EFFECT_PUMP,    SNARE_EFFECT_FILTER,
                            SNARE_EFFECT_VINYL,   SNARE_EFFECT_PHASER};
// The ones that work on the sound itself, where the others add something to it.
constexpr int kInserts[] = {SNARE_EFFECT_CRUSHER, SNARE_EFFECT_TAPE, SNARE_EFFECT_PUMP, SNARE_EFFECT_FILTER, SNARE_EFFECT_PHASER};

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

// A sine, as a sound for a slot.
std::vector<float> tone(double hz, double seconds, float level, double rate = kRate) {
  std::vector<float> samples(static_cast<std::size_t>(rate * seconds));
  for (std::size_t i = 0; i < samples.size(); ++i) {
    samples[i] = level * static_cast<float>(std::sin(2.0 * 3.14159265358979323846 * hz * static_cast<double>(i) / rate));
  }
  return samples;
}

// An engine whose first track plays that sound once, on the first step.
SnareEngine* soundEngine(const std::vector<float>& sound) {
  SnareEngine* engine = snare_engine_create(kRate);
  makeUnity(engine);
  giveSound(engine, 0, sound, kRate);
  SnarePattern pattern = shape(16);
  pattern.rows[1] = 0b1;
  snare_engine_set_pattern(engine, 0, &pattern);
  snare_engine_set_tempo(engine, 120.0);
  return engine;
}

// What a sound comes out as with an effect on, over one measure and a second more.
snare::io::Rendered through(const std::vector<float>& sound, int effect, double wet, int frames = 144000) {
  SnareEngine* engine = soundEngine(sound);
  if (effect != SNARE_EFFECT_NONE) CHECK_EQ(snare_engine_set_effect(engine, effect, wet), SNARE_OK);
  snare_engine_play_measures(engine, 1);
  auto out = snare::io::render(engine, frames, 256);
  snare_engine_destroy(engine);
  return out;
}

// How much of a signal is its top: the energy of the difference between neighbours.
double roughness(const std::vector<float>& samples, std::size_t from, std::size_t to) {
  double sum = 0.0;
  for (std::size_t i = from + 1; i < to && i < samples.size(); ++i) {
    const double step = static_cast<double>(samples[i]) - samples[i - 1];
    sum += step * step;
  }
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

SNARE_TEST(an_effect_with_its_knob_at_nothing_leaves_the_mix_as_it_was) {
  const auto sound = tone(220.0, 0.4, 0.5f);
  const auto plain = through(sound, SNARE_EFFECT_NONE, 0.0, 48000);
  for (int effect : kEffects) {
    const auto asked = through(sound, effect, 0.0, 48000);
    for (std::size_t i = 0; i < plain.left.size(); ++i) {
      CHECK(asked.left[i] == plain.left[i]);
      CHECK(asked.right[i] == plain.right[i]);
    }
  }
}

SNARE_TEST(an_effect_that_works_on_the_sound_makes_nothing_out_of_silence) {
  for (int effect : kInserts) {
    SnareEngine* engine = snare_engine_create(kRate);
    makeUnity(engine);
    snare_engine_set_effect(engine, effect, 1.0);
    snare_engine_play(engine);
    const auto out = snare::io::render(engine, 48000, 256);
    for (std::size_t i = 0; i < out.left.size(); ++i) CHECK(out.left[i] == 0.0f && out.right[i] == 0.0f);
    snare_engine_destroy(engine);
  }
}

SNARE_TEST(the_crusher_holds_each_sample_and_keeps_few_levels) {
  // Quick enough that rounding alone would not make neighbouring samples the same.
  const auto sound = tone(2777.0, 0.5, 0.5f);
  const auto out = through(sound, SNARE_EFFECT_CRUSHER, 1.0, 24000);
  // Held at a lower rate, most samples repeat the one before.
  int held = 0;
  std::vector<float> levels;
  // Counted once the effect has come all the way up to full.
  for (std::size_t i = 14400; i < 22000; ++i) {
    if (out.left[i] == out.left[i - 1]) ++held;
    if (std::find(levels.begin(), levels.end(), out.left[i]) == levels.end()) levels.push_back(out.left[i]);
  }
  CHECK(held > 5000);
  CHECK(levels.size() > 8 && levels.size() < 80);
}

SNARE_TEST(tape_dulls_the_top_and_rounds_off_what_is_loud) {
  // A square at 3 kHz: all edges.
  std::vector<float> edges(24000);
  for (std::size_t i = 0; i < edges.size(); ++i) edges[i] = (i % 16 < 8 ? 0.8f : -0.8f);
  const auto plain = through(edges, SNARE_EFFECT_NONE, 0.0, 48000);
  const auto taped = through(edges, SNARE_EFFECT_TAPE, 1.0, 48000);
  CHECK(roughness(taped.left, 2000, 22000) < 0.5 * roughness(plain.left, 2000, 22000));
  float peak = 0.0f;
  for (std::size_t i = 2000; i < 22000; ++i) peak = std::max(peak, std::fabs(taped.left[i]));
  CHECK(peak < 0.75f && peak > 0.2f);
}

SNARE_TEST(the_pump_lets_a_low_hit_through_and_then_ducks_under_it) {
  const auto low = tone(60.0, 1.0, 0.6f);
  const auto plain = through(low, SNARE_EFFECT_NONE, 0.0, 48000);
  const auto pumped = through(low, SNARE_EFFECT_PUMP, 1.0, 48000);
  // The first two milliseconds come through; a quarter of a second in, it is well down.
  CHECK(energy(pumped.left, 0, 96) > 0.8 * energy(plain.left, 0, 96));
  CHECK(energy(pumped.left, 12000, 24000) < 0.4 * energy(plain.left, 12000, 24000));
  CHECK(energy(pumped.left, 12000, 24000) > 0.02 * energy(plain.left, 12000, 24000));
}

SNARE_TEST(the_filter_closes_as_its_knob_is_turned_up) {
  std::vector<float> edges(24000);
  for (std::size_t i = 0; i < edges.size(); ++i) edges[i] = (i % 16 < 8 ? 0.4f : -0.4f);
  const double open = energy(through(edges, SNARE_EFFECT_NONE, 0.0, 48000).left, 2000, 22000);
  // A little open, its resonance may lift what passes; it is never far above the sound as it was.
  double last = open * 2.0;
  for (double knob : {0.3, 0.6, 1.0}) {
    const double heard = energy(through(edges, SNARE_EFFECT_FILTER, knob, 48000).left, 2000, 22000);
    CHECK(heard < last);
    last = heard;
  }
  // Fully up, a 3 kHz square is all but gone.
  CHECK(last < 0.01 * open);
}

SNARE_TEST(vinyl_crackles_under_the_beat_the_same_way_each_time_and_stops_after_it) {
  const auto sound = tone(220.0, 1.0, 0.3f);
  const auto plain = through(sound, SNARE_EFFECT_NONE, 0.0);
  const auto first = through(sound, SNARE_EFFECT_VINYL, 1.0);
  const auto again = through(sound, SNARE_EFFECT_VINYL, 1.0);
  CHECK(std::memcmp(first.left.data(), again.left.data(), sizeof(float) * first.left.size()) == 0);
  double added = 0.0;
  float loudest = 0.0f;
  for (std::size_t i = 0; i < 48000; ++i) {
    const float noise = first.left[i] - plain.left[i];
    added += static_cast<double>(noise) * noise;
    loudest = std::max(loudest, std::fabs(noise));
  }
  // There is noise, it has pops in it that stand well clear of the hiss, and none of it is loud.
  const double hiss = std::sqrt(added / 48000.0);
  CHECK(hiss > 0.0005 && hiss < 0.03);
  CHECK(loudest > 4.0 * hiss && loudest < 0.25f);
  // The two sides are not the same noise.
  CHECK(std::memcmp(first.left.data(), first.right.data(), sizeof(float) * 48000) != 0);
}

SNARE_TEST(the_phaser_moves) {
  // A steady tone through it changes in level as the sweep passes over it.
  const auto sound = tone(900.0, 4.0, 0.4f);
  SnareEngine* engine = soundEngine(sound);
  snare_engine_set_tempo(engine, 40.0);
  snare_engine_set_effect(engine, SNARE_EFFECT_PHASER, 1.0);
  snare_engine_play_measures(engine, 1);
  const auto out = snare::io::render(engine, 192000, 256);
  snare_engine_destroy(engine);
  double quietest = 1e9;
  double loudest = 0.0;
  for (std::size_t from = 4800; from + 4800 <= 187200; from += 4800) {
    const double heard = energy(out.left, from, from + 4800);
    quietest = std::min(quietest, heard);
    loudest = std::max(loudest, heard);
  }
  CHECK(quietest > 0.0);
  CHECK(loudest > 3.0 * quietest);
}

SNARE_TEST(bad_effect_settings_are_refused) {
  SnareEngine* engine = snare_engine_create(kRate);
  CHECK_EQ(snare_engine_set_effect(nullptr, SNARE_EFFECT_DELAY, 0.5), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_effect(engine, -1, 0.5), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_engine_set_effect(engine, SNARE_EFFECT_LAST + 1, 0.5), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(SNARE_EFFECT_LAST, SNARE_EFFECT_PHASER);
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
