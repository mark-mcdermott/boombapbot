// РИТМ-12's voices: there are eight; each is deterministic, finite, bounded,
// audible and ends in silence at every sample rate and across its knobs'
// travel; and the knobs do what their names say.

#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

#include "test_util.h"

using namespace snare::test;

namespace {

constexpr int kVoices = 8;
const double kRates[] = {44100.0, 48000.0, 96000.0};
const float kTravel[] = {0.0f, 0.5f, 1.0f};
const char* const kNames[kVoices] = {"kick", "snare", "clap", "closed hat", "open hat", "tom", "rim", "perc"};
// The voices with a pitch that a count of zero crossings can follow.
const int kPitched[] = {0, 5, 6, 7};

SnareSoundParams params(int sound, float pitch = 0.5f, float tone = 0.5f, float decay = 0.5f, float unused = 0.5f) {
  return SnareSoundParams{sound, pitch, tone, decay, unused, 0};
}

std::vector<float> render(const SnareSoundParams& sound, double rate) {
  const int frames = snare_synth_frames(&sound, rate);
  CHECK(frames > 0);
  std::vector<float> out(static_cast<std::size_t>(frames > 0 ? frames : 0));
  CHECK_EQ(snare_synth_render(&sound, rate, out.data(), frames), frames);
  return out;
}

double peak(const std::vector<float>& pcm) {
  double value = 0.0;
  for (float sample : pcm) value = std::fmax(value, std::fabs(static_cast<double>(sample)));
  return value;
}

double rms(const std::vector<float>& pcm, std::size_t from, std::size_t to) {
  double sum = 0.0;
  for (std::size_t i = from; i < to && i < pcm.size(); ++i) sum += static_cast<double>(pcm[i]) * pcm[i];
  return std::sqrt(sum / static_cast<double>(to - from));
}

// How often the signal changes sign per second: a cheap stand-in for pitch.
double crossingsPerSecond(const std::vector<float>& pcm, double rate, double seconds) {
  const auto count = static_cast<std::size_t>(seconds * rate);
  int crossings = 0;
  for (std::size_t i = 1; i < count && i < pcm.size(); ++i) {
    if ((pcm[i - 1] < 0.0f) != (pcm[i] < 0.0f)) ++crossings;
  }
  return crossings / seconds;
}

bool same(const std::vector<float>& a, const std::vector<float>& b) {
  return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
}

}  // namespace

SNARE_TEST(the_machine_has_eight_voices_and_no_more) {
  for (int sound = 0; sound < kVoices; ++sound) {
    const SnareSoundParams settings = params(sound);
    CHECK(snare_synth_frames(&settings, 48000.0) > 0);
  }
  const SnareSoundParams ninth = params(kVoices);
  CHECK_EQ(snare_synth_frames(&ninth, 48000.0), SNARE_ERR_BAD_ARGUMENT);
  float sample = 0.0f;
  CHECK_EQ(snare_synth_render(&ninth, 48000.0, &sample, 1), SNARE_ERR_BAD_ARGUMENT);
}

SNARE_TEST(every_voice_is_finite_bounded_audible_and_ends_in_silence) {
  for (int sound = 0; sound < kVoices; ++sound) {
    for (double rate : kRates) {
      for (float knob : kTravel) {
        const std::vector<float> pcm = render(params(sound, knob, knob, knob), rate);
        bool finite = true;
        for (float sample : pcm) finite = finite && std::isfinite(sample);
        const double loudest = peak(pcm);
        if (!finite || loudest > 1.0 || loudest < 0.2 || pcm.back() != 0.0f) {
          std::printf("  %s at %g Hz, knobs %g: finite %d, peak %g, last %g\n", kNames[sound], rate,
                      static_cast<double>(knob), finite, loudest, static_cast<double>(pcm.back()));
        }
        CHECK(finite);
        CHECK(loudest <= 1.0);
        CHECK(loudest >= 0.2);
        CHECK_EQ(pcm.back(), 0.0f);
        // Nothing left but the last few milliseconds of the tail.
        const auto tail = static_cast<std::size_t>(0.004 * rate);
        CHECK(rms(pcm, pcm.size() - tail, pcm.size()) < 0.02);
      }
    }
  }
}

SNARE_TEST(the_same_settings_render_the_same_samples) {
  for (int sound = 0; sound < kVoices; ++sound) {
    const SnareSoundParams settings = params(sound, 0.3f, 0.7f, 0.6f);
    CHECK(same(render(settings, 48000.0), render(settings, 48000.0)));
  }
}

SNARE_TEST(a_voice_lasts_the_same_time_at_every_sample_rate) {
  for (int sound = 0; sound < kVoices; ++sound) {
    const SnareSoundParams settings = params(sound);
    const double seconds = snare_synth_frames(&settings, 48000.0) / 48000.0;
    for (double rate : kRates) CHECK_NEAR(snare_synth_frames(&settings, rate) / rate, seconds, 2.0 / rate);
  }
}

SNARE_TEST(the_decay_knob_lengthens_every_voice) {
  for (int sound = 0; sound < kVoices; ++sound) {
    const SnareSoundParams tight = params(sound, 0.5f, 0.5f, 0.0f);
    const SnareSoundParams loose = params(sound, 0.5f, 0.5f, 1.0f);
    const int shortFrames = snare_synth_frames(&tight, 48000.0);
    const int longFrames = snare_synth_frames(&loose, 48000.0);
    if (longFrames <= shortFrames * 2) std::printf("  %s: %d then %d frames\n", kNames[sound], shortFrames, longFrames);
    CHECK(longFrames > shortFrames * 2);
    // More of the sound is left a little way in.
    const std::vector<float> a = render(tight, 48000.0);
    const std::vector<float> b = render(loose, 48000.0);
    const auto from = static_cast<std::size_t>(shortFrames / 2);
    CHECK(rms(b, from, from + 480) > rms(a, from, from + 480));
  }
}

SNARE_TEST(the_pitch_knob_raises_the_pitch) {
  for (int sound : kPitched) {
    const std::vector<float> low = render(params(sound, 0.0f, 0.2f, 1.0f), 48000.0);
    const std::vector<float> high = render(params(sound, 1.0f, 0.2f, 1.0f), 48000.0);
    const double seconds = sound == 6 ? 0.03 : 0.1;
    const double below = crossingsPerSecond(low, 48000.0, seconds);
    const double above = crossingsPerSecond(high, 48000.0, seconds);
    if (above <= below * 1.4) std::printf("  %s: %g then %g crossings a second\n", kNames[sound], below, above);
    CHECK(above > below * 1.4);
  }
  // Every voice answers its pitch knob, whether or not crossings can follow it.
  for (int sound = 0; sound < kVoices; ++sound) {
    CHECK(!same(render(params(sound, 0.2f), 48000.0), render(params(sound, 0.8f), 48000.0)));
  }
}

SNARE_TEST(the_tone_knob_changes_every_voice_and_the_spare_knob_none) {
  for (int sound = 0; sound < kVoices; ++sound) {
    CHECK(!same(render(params(sound, 0.5f, 0.1f), 48000.0), render(params(sound, 0.5f, 0.9f), 48000.0)));
    CHECK(same(render(params(sound, 0.5f, 0.5f, 0.5f, 0.0f), 48000.0),
               render(params(sound, 0.5f, 0.5f, 0.5f, 1.0f), 48000.0)));
  }
}

SNARE_TEST_MAIN()
