// The synthesis calls, with the test machine's two voices: a sound is
// deterministic, lasts the same time at every sample rate, follows its
// knobs, and the calls refuse what they cannot do. What a real machine's
// voices sound like is tested with that machine.

#include <cmath>
#include <cstring>
#include <vector>

#include "test_util.h"

using namespace snare::test;

namespace {

constexpr int kVoices = 2;
const double kRates[] = {44100.0, 48000.0, 96000.0};

SnareSoundParams params(int sound, float tune = 0.5f, float decay = 0.5f) {
  return SnareSoundParams{sound, tune, 0.5f, decay, 0.5f, 0};
}

std::vector<float> render(const SnareSoundParams& sound, double rate) {
  const int frames = snare_synth_frames(&sound, rate);
  CHECK(frames > 0);
  std::vector<float> out(static_cast<std::size_t>(frames > 0 ? frames : 0));
  CHECK_EQ(snare_synth_render(&sound, rate, out.data(), frames), frames);
  return out;
}

double peak(const std::vector<float>& pcm, std::size_t from = 0) {
  double value = 0.0;
  for (std::size_t i = from; i < pcm.size(); ++i) value = std::fmax(value, std::fabs(static_cast<double>(pcm[i])));
  return value;
}

}  // namespace

SNARE_TEST(every_voice_of_the_table_renders_the_same_twice_and_ends_in_silence) {
  for (int sound = 0; sound < kVoices; ++sound) {
    for (double rate : kRates) {
      const std::vector<float> first = render(params(sound), rate);
      const std::vector<float> second = render(params(sound), rate);
      CHECK_EQ(first.size(), second.size());
      CHECK(std::memcmp(first.data(), second.data(), first.size() * sizeof(float)) == 0);
      CHECK(peak(first) > 0.3);
      CHECK(peak(first) <= 1.0);
      // The engine fades the last of a sound, so it ends at nothing.
      CHECK_EQ(first.back(), 0.0f);
      CHECK(peak(first, first.size() - first.size() / 50) < 0.01);
    }
  }
}

SNARE_TEST(a_sound_lasts_the_same_time_at_every_sample_rate) {
  for (int sound = 0; sound < kVoices; ++sound) {
    const SnareSoundParams settings = params(sound);
    const double seconds = snare_synth_frames(&settings, 48000.0) / 48000.0;
    for (double rate : kRates) CHECK_NEAR(snare_synth_frames(&settings, rate) / rate, seconds, 2.0 / rate);
  }
}

SNARE_TEST(the_knobs_reach_the_voice) {
  const SnareSoundParams shortSound = params(0, 0.5f, 0.0f);
  const SnareSoundParams longSound = params(0, 0.5f, 1.0f);
  CHECK(snare_synth_frames(&longSound, 48000.0) > 2 * snare_synth_frames(&shortSound, 48000.0));
  const std::vector<float> low = render(params(0, 0.0f), 48000.0);
  const std::vector<float> high = render(params(0, 1.0f), 48000.0);
  CHECK(std::memcmp(low.data(), high.data(), 1000 * sizeof(float)) != 0);
}

SNARE_TEST(out_of_range_knobs_are_clamped_and_bad_arguments_refused) {
  const std::vector<float> full = render(SnareSoundParams{0, 1.0f, 1.0f, 1.0f, 1.0f, 0}, 48000.0);
  const std::vector<float> over = render(SnareSoundParams{0, 9.0f, 9.0f, 9.0f, 9.0f, 0}, 48000.0);
  CHECK_EQ(full.size(), over.size());
  CHECK(std::memcmp(full.data(), over.data(), full.size() * sizeof(float)) == 0);

  const SnareSoundParams known = params(0);
  // One past the table: a slot the engine has, with no voice of this machine in it.
  const SnareSoundParams voiceless = params(kVoices);
  const SnareSoundParams unknown = params(SNARE_SOUNDS);
  const SnareSoundParams negative = params(-1);
  std::vector<float> out(16);
  CHECK_EQ(snare_synth_frames(nullptr, 48000.0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_synth_frames(&voiceless, 48000.0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_synth_frames(&unknown, 48000.0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_synth_frames(&negative, 48000.0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_synth_frames(&known, 100.0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_synth_render(&known, 48000.0, nullptr, 1 << 20), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_synth_render(&known, 48000.0, out.data(), 16), SNARE_ERR_TOO_LARGE);
}

SNARE_TEST_MAIN()
