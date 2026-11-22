// Self-test for the plugin's AudioProcessor. It drives processBlock the way a
// host would, without the VST3 wrapper. Prints one line per check and exits
// non-zero if any check fails.
//
//   ctest --test-dir build/vst3 --output-on-failure

#include "BeatFile.h"
#include "HeapTrap.h"
#include "MachineRitm12.h"
#include "Panel/StepKeys.h"
#include "PluginProcessor.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace {

using boombapbot::plugin::Beat;
using boombapbot::plugin::kAccentVelocity;
using boombapbot::plugin::kEffectNames;
using boombapbot::plugin::kVoiceCount;
using boombapbot::plugin::kVoices;
using boombapbot::plugin::VoiceSpec;

int failures = 0;
int checks = 0;

void check(bool passed, const std::string& context, const std::string& what) {
  ++checks;
  if (!passed) ++failures;
  std::printf("%s [%s] %s\n", passed ? "ok  " : "FAIL", context.c_str(), what.c_str());
}

#if defined(__GNUC__) || defined(__clang__)
std::string text(const char* format, ...) __attribute__((format(printf, 1, 2)));
#endif

std::string text(const char* format, ...) {
  char line[320];
  va_list arguments;
  va_start(arguments, format);
  std::vsnprintf(line, sizeof(line), format, arguments);
  va_end(arguments);
  return line;
}

// ---- MIDI -------------------------------------------------------------------

constexpr int kKick = 36;
constexpr int kSnare = 38;
constexpr int kClosedHat = 42;
constexpr int kTom = 45;
constexpr int kOpenHat = 46;

// A three-byte MIDI message at an absolute frame of the rendered timeline.
struct Event {
  int frame;
  std::array<juce::uint8, 3> bytes;
};

// channel is 1..16.
Event noteOn(int frame, int note, int velocity, int channel = 1) {
  return {frame,
          {static_cast<juce::uint8>(0x90 | (channel - 1)), static_cast<juce::uint8>(note),
           static_cast<juce::uint8>(velocity)}};
}

Event noteOff(int frame, int note, int channel = 1) {
  return {frame,
          {static_cast<juce::uint8>(0x80 | (channel - 1)), static_cast<juce::uint8>(note),
           static_cast<juce::uint8>(0)}};
}

// ---- Parameters ---------------------------------------------------------------

struct Setting {
  std::string id;
  float value;  // as the host shows it
};

juce::RangedAudioParameter* findParameter(juce::AudioProcessor& processor, const std::string& id) {
  for (juce::AudioProcessorParameter* parameter : processor.getParameters()) {
    auto* const ranged = dynamic_cast<juce::RangedAudioParameter*>(parameter);
    if (ranged != nullptr && ranged->paramID == juce::String(id)) return ranged;
  }
  return nullptr;
}

void set(juce::AudioProcessor& processor, const Setting& setting) {
  juce::RangedAudioParameter* const parameter = findParameter(processor, setting.id);
  if (parameter == nullptr) {
    check(false, "parameters", text("the plugin has a parameter called %s", setting.id.c_str()));
    return;
  }
  parameter->setValueNotifyingHost(parameter->convertTo0to1(setting.value));
}

float valueOf(juce::AudioProcessor& processor, const std::string& id) {
  const juce::RangedAudioParameter* const parameter = findParameter(processor, id);
  return parameter != nullptr ? parameter->convertFrom0to1(parameter->getValue()) : std::nanf("");
}

std::string voiceParameter(const VoiceSpec& voice, const char* knob) { return std::string(voice.id) + "_" + knob; }

// ---- Rendering --------------------------------------------------------------

struct Stereo {
  std::vector<float> left;
  std::vector<float> right;
};

enum class Clock { offline, realtime };

// An offline processor makes its sounds inside processBlock, so what it
// renders does not depend on when another thread got to run. Every check but
// the ones about the sound thread uses one.
std::unique_ptr<juce::AudioProcessor> makeProcessor(double rate, int blockSize, Clock clock = Clock::offline) {
  std::unique_ptr<juce::AudioProcessor> processor(createPluginFilter());
  processor->setNonRealtime(clock == Clock::offline);
  processor->setPlayConfigDetails(0, 2, rate, blockSize);
  processor->prepareToPlay(rate, blockSize);
  return processor;
}

// Runs `totalFrames` through the processor in host-sized blocks. Each event is
// handed over in the block that contains its frame, at its offset inside that
// block. The buffer is filled with junk before every call, so anything the
// processor does not write shows up.
Stereo render(juce::AudioProcessor& processor, const std::vector<Event>& events, int totalFrames, int blockSize) {
  Stereo out;
  out.left.reserve(static_cast<std::size_t>(totalFrames));
  out.right.reserve(static_cast<std::size_t>(totalFrames));

  juce::AudioBuffer<float> buffer(2, blockSize);
  juce::MidiBuffer midi;
  for (int start = 0; start < totalFrames; start += blockSize) {
    const int frames = std::min(blockSize, totalFrames - start);
    buffer.setSize(2, frames, false, false, true);
    for (int channel = 0; channel < 2; ++channel) {
      std::fill_n(buffer.getWritePointer(channel), frames, 9.0f);
    }
    midi.clear();
    for (const Event& event : events) {
      if (event.frame >= start && event.frame < start + frames) {
        midi.addEvent(event.bytes.data(), 3, event.frame - start);
      }
    }
    processor.processBlock(buffer, midi);
    out.left.insert(out.left.end(), buffer.getReadPointer(0), buffer.getReadPointer(0) + frames);
    out.right.insert(out.right.end(), buffer.getReadPointer(1), buffer.getReadPointer(1) + frames);
  }
  return out;
}

// A new processor with `settings` made after prepareToPlay, as a host makes them.
Stereo renderFresh(double rate, int blockSize, const std::vector<Event>& events, int totalFrames,
                   const std::vector<Setting>& settings = {}) {
  const std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(rate, blockSize);
  for (const Setting& setting : settings) set(*processor, setting);
  return render(*processor, events, totalFrames, blockSize);
}

// ---- Measurements -----------------------------------------------------------

bool isZero(float value) { return juce::exactlyEqual(value, 0.0f); }

// Index of the first sample that is not exactly zero, or -1.
int firstNonZero(const std::vector<float>& samples) {
  for (std::size_t i = 0; i < samples.size(); ++i) {
    if (!isZero(samples[i])) return static_cast<int>(i);
  }
  return -1;
}

bool allZero(const std::vector<float>& samples, int from, int to) {
  for (int i = from; i < to; ++i) {
    if (!isZero(samples[static_cast<std::size_t>(i)])) return false;
  }
  return true;
}

bool allZero(const Stereo& audio, int from, int to) {
  return allZero(audio.left, from, to) && allZero(audio.right, from, to);
}

bool allZero(const Stereo& audio) { return allZero(audio, 0, static_cast<int>(audio.left.size())); }

// Index of the first sample where the two differ at all, or -1.
int firstDifference(const std::vector<float>& a, const std::vector<float>& b, int from = 0) {
  const std::size_t size = std::min(a.size(), b.size());
  for (std::size_t i = static_cast<std::size_t>(from); i < size; ++i) {
    if (!juce::exactlyEqual(a[i], b[i])) return static_cast<int>(i);
  }
  return a.size() == b.size() ? -1 : static_cast<int>(size);
}

bool identical(const Stereo& a, const Stereo& b) {
  return firstDifference(a.left, b.left) == -1 && firstDifference(a.right, b.right) == -1;
}

float peak(const std::vector<float>& samples, int from, int to) {
  float result = 0.0f;
  for (int i = from; i < to; ++i) {
    result = std::max(result, std::abs(samples[static_cast<std::size_t>(i)]));
  }
  return result;
}

float peak(const Stereo& audio, int from, int to) {
  return std::max(peak(audio.left, from, to), peak(audio.right, from, to));
}

float peak(const Stereo& audio) { return peak(audio, 0, static_cast<int>(audio.left.size())); }

bool finite(const Stereo& audio) {
  const auto ok = [](float sample) { return std::isfinite(sample); };
  return std::all_of(audio.left.begin(), audio.left.end(), ok) && std::all_of(audio.right.begin(), audio.right.end(), ok);
}

// How often the signal changes sign: a measure of pitch that does not care
// about level or about what the limiter was doing a moment ago.
int signChanges(const std::vector<float>& samples, int from, int to) {
  int changes = 0;
  for (int i = from + 1; i < to; ++i) {
    const float before = samples[static_cast<std::size_t>(i - 1)];
    const float now = samples[static_cast<std::size_t>(i)];
    if ((before < 0.0f) != (now < 0.0f)) ++changes;
  }
  return changes;
}

int framesFor(double seconds, double rate) { return static_cast<int>(std::lround(seconds * rate)); }

// A hit counts as audible above this peak. The quietest sound is far
// louder; exact silence is checked separately as exact zeros.
constexpr float kAudible = 0.001f;

// ---- Notes, run for every sample rate and block size ------------------------

void testSilenceWithoutMidi(const std::string& context, double rate, int blockSize) {
  const Stereo audio = renderFresh(rate, blockSize, {}, 4 * 512);
  check(allZero(audio), context, "no MIDI gives exact silence on both channels");
}

void testKickAtOffset100(const std::string& context, double rate, int blockSize) {
  const Stereo audio = renderFresh(rate, blockSize, {noteOn(100, kKick, 100, 10)}, 1024);
  check(allZero(audio, 0, 100), context, "kick at frame 100: exact zeros in frames 0..99");
  // The kick starts on a sine's zero crossing, so its first sample is zero
  // and the sound shows from the frame after.
  const int left = firstNonZero(audio.left);
  const int right = firstNonZero(audio.right);
  check(left == 101 && right == 101, context,
        text("kick at frame 100: the sound starts there (first non-zero sample: left %d, right %d)", left, right));
}

// Two notes inside one block, so processBlock has to split the block twice.
void testTwoNotesInOneBlock(const std::string& context, double rate, int blockSize) {
  constexpr int kickFrame = 10;
  constexpr int snareFrame = 40;
  jassert(snareFrame < blockSize);
  constexpr int total = 1024;

  const Stereo kickOnly = renderFresh(rate, blockSize, {noteOn(kickFrame, kKick, 100)}, total);
  const Stereo snareOnly = renderFresh(rate, blockSize, {noteOn(snareFrame, kSnare, 100)}, total);
  const Stereo both =
      renderFresh(rate, blockSize, {noteOn(kickFrame, kKick, 100), noteOn(snareFrame, kSnare, 100)}, total);

  const int snareAlone = firstNonZero(snareOnly.left);
  check(allZero(snareOnly, 0, snareFrame) && snareAlone <= snareFrame + 1, context,
        text("snare alone at frame %d: silent before it, first non-zero sample at frame %d", snareFrame, snareAlone));

  // Up to the snare the block must be the kick and nothing else; the snare has
  // to change the output from exactly where it sounds on its own.
  const int left = firstDifference(both.left, kickOnly.left);
  const int right = firstDifference(both.right, kickOnly.right);
  check(left == snareAlone && right == snareAlone, context,
        text("kick at %d + snare at %d in one block: identical to the kick alone until the snare sounds "
             "at frame %d (first difference: left %d, right %d)",
             kickFrame, snareFrame, snareAlone, left, right));
}

// Where a hit lands must not depend on how the host cuts time into blocks.
void testBlockSizeDoesNotMoveHits(const std::string& context, double rate, int blockSize) {
  const std::vector<Event> events{noteOn(7, kKick, 127), noteOn(333, kSnare, 60), noteOn(1000, kClosedHat, 127),
                                  noteOn(1001, kTom, 90)};
  const int total = 4096;
  const Stereo whole = renderFresh(rate, total, events, total);
  const Stereo blocks = renderFresh(rate, blockSize, events, total);
  check(identical(whole, blocks), context,
        text("four hits render the same samples in blocks of %d as in one block of %d", blockSize, total));
}

void testMappedNotesSound(const std::string& context, double rate, int blockSize) {
  const int total = framesFor(0.05, rate);
  int channel = 1;
  for (const VoiceSpec& voice : kVoices) {
    const Stereo audio = renderFresh(rate, blockSize, {noteOn(0, voice.gmNote, 100, channel)}, total);
    const float level = peak(audio);
    check(level > kAudible && level <= 1.0f, context,
          text("note %d on channel %d (%s) makes sound (peak %.4f)", voice.gmNote, channel, voice.id,
               static_cast<double>(level)));
    channel = channel % 16 + 3;
  }
}

void testUnmappedNotesAreSilent(const std::string& context, double rate, int blockSize) {
  std::vector<Event> events;
  int unmapped = 0;
  for (int note = 0; note < 128; ++note) {
    const bool mapped = std::any_of(kVoices.begin(), kVoices.end(),
                                    [note](const VoiceSpec& voice) { return voice.gmNote == note; });
    if (mapped) continue;
    events.push_back(noteOn(20 + note, note, 100));
    ++unmapped;
  }
  const int total = framesFor(0.05, rate);
  check(unmapped == 128 - kVoiceCount && allZero(renderFresh(rate, blockSize, events, total)), context,
        text("all %d notes no voice listens to give exact silence", unmapped));
  check(allZero(renderFresh(rate, blockSize, {noteOff(20, kKick)}, total)), context,
        "note-off for the kick note gives exact silence");
  check(allZero(renderFresh(rate, blockSize, {noteOn(20, kKick, 0)}, total)), context,
        "note-on with velocity 0 for the kick note gives exact silence");
}

// The machine has two loudnesses: a note is a plain hit or an accented one.
void testVelocityChoosesAccent(const std::string& context, double rate, int blockSize) {
  const int total = framesFor(0.05, rate);
  const auto level = [&](int velocity) {
    return peak(renderFresh(rate, blockSize, {noteOn(0, kKick, velocity)}, total));
  };
  const float soft = level(1);
  const float loud = level(127);
  check(loud > soft * 1.3f, context,
        text("velocity 127 is an accented hit, louder than velocity 1 (%.4f against %.4f)", static_cast<double>(loud),
             static_cast<double>(soft)));
  check(juce::exactlyEqual(level(kAccentVelocity - 1), soft) && juce::exactlyEqual(level(kAccentVelocity), loud),
        context, text("the accent starts at velocity %d and nothing else depends on velocity", kAccentVelocity));
}

// The hats share a choke group: a closed hat stops a sounding open hat.
void testClosedHatChokesOpenHat(const std::string& context, double rate, int blockSize) {
  const int chokeFrame = framesFor(0.05, rate);
  const int lateFrom = framesFor(0.40, rate);  // the closed hat itself has ended by here
  const int total = framesFor(0.50, rate);

  const Stereo openOnly = renderFresh(rate, blockSize, {noteOn(0, kOpenHat, 100)}, total);
  const Stereo choked =
      renderFresh(rate, blockSize, {noteOn(0, kOpenHat, 100), noteOn(chokeFrame, kClosedHat, 100)}, total);

  const int parted = firstDifference(choked.left, openOnly.left);
  check(parted >= chokeFrame && parted <= chokeFrame + 1, context,
        text("open hat then closed hat at frame %d: identical to the open hat alone up to that frame "
             "(first difference at %d)",
             chokeFrame, parted));
  check(allZero(choked, lateFrom, total), context,
        text("the choked open hat is exact silence from 0.40 s to 0.50 s (peak %.6f)",
             static_cast<double>(peak(choked, lateFrom, total))));
  check(peak(openOnly, lateFrom, total) > kAudible, context,
        text("an open hat left alone is still sounding from 0.40 s to 0.50 s (peak %.4f)",
             static_cast<double>(peak(openOnly, lateFrom, total))));
}

// ---- Parameters, run for every sample rate ----------------------------------

void testVoiceKnobsAlterTheirVoice(const std::string& context, double rate, int blockSize) {
  const int total = framesFor(0.3, rate);
  for (const VoiceSpec& voice : kVoices) {
    const std::vector<Event> hit{noteOn(0, voice.gmNote, 127)};
    const Stereo rest = renderFresh(rate, blockSize, hit, total);
    for (const char* knob : {"pitch", "tone", "decay", "level"}) {
      const Stereo turned = renderFresh(rate, blockSize, hit, total, {{voiceParameter(voice, knob), 0.9f}});
      check(!identical(rest, turned) && finite(turned) && peak(turned) > kAudible, context,
            text("%s at 0.9 alters the %s", voiceParameter(voice, knob).c_str(), voice.id));
    }
    const Stereo muted = renderFresh(rate, blockSize, hit, total, {{voiceParameter(voice, "level"), 0.0f}});
    check(allZero(muted), context, text("%s at 0 silences the %s", voiceParameter(voice, "level").c_str(), voice.id));
  }

  const std::vector<Event> snare{noteOn(0, kSnare, 127)};
  check(identical(renderFresh(rate, blockSize, snare, total),
                  renderFresh(rate, blockSize, snare, total,
                              {{"kick_pitch", 0.1f}, {"kick_tone", 0.9f}, {"kick_decay", 0.9f}, {"kick_level", 0.2f}})),
        context, "the kick's knobs leave the snare as it was");
}

// A knob turned before the host prepares the plugin and one turned after must
// come to the same samples: both reach the engine before the first hit.
void testKnobsReachTheEngineWheneverTheyAreTurned(const std::string& context, double rate, int blockSize) {
  const std::vector<Setting> settings{{"tom_pitch", 0.83f}, {"tom_decay", 0.21f}, {"tom_level", 0.6f},
                                      {"master_volume", 0.5f}, {"effect_kind", 2.0f}, {"effect_mix", 0.4f}};
  const std::vector<Event> hit{noteOn(50, kTom, 127)};
  const int total = framesFor(0.3, rate);

  std::unique_ptr<juce::AudioProcessor> early(createPluginFilter());
  for (const Setting& setting : settings) set(*early, setting);
  early->setNonRealtime(true);
  early->setPlayConfigDetails(0, 2, rate, blockSize);
  early->prepareToPlay(rate, blockSize);

  check(identical(render(*early, hit, total, blockSize), renderFresh(rate, blockSize, hit, total, settings)), context,
        "knobs turned before prepareToPlay and after it render the same samples");
}

// A knob turned while the plugin plays: the next hit is the new sound.
void testKnobTurnedBetweenHits(const std::string& context, double rate, int blockSize) {
  const int span = framesFor(2.0, rate);  // long enough for a tom to ring out
  const int window = framesFor(0.1, rate);
  const std::vector<Event> hit{noteOn(0, kTom, 127)};

  const std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(rate, blockSize);
  const int low = signChanges(render(*processor, hit, span, blockSize).left, 0, window);
  set(*processor, {"tom_pitch", 1.0f});
  const int high = signChanges(render(*processor, hit, span, blockSize).left, 0, window);
  const int highFromTheStart =
      signChanges(renderFresh(rate, blockSize, hit, span, {{"tom_pitch", 1.0f}}).left, 0, window);

  check(high > low * 3 / 2 && std::abs(high - highFromTheStart) <= 2, context,
        text("tom_pitch turned up between two hits: the second is the higher tom (sign changes in 0.1 s: "
             "%d, then %d; %d with the knob there from the start)",
             low, high, highFromTheStart));
}

void testVolume(const std::string& context, double rate, int blockSize) {
  const std::vector<Event> hit{noteOn(0, kKick, 127)};
  const int total = framesFor(0.2, rate);
  const float rest = peak(renderFresh(rate, blockSize, hit, total));
  const float half = peak(renderFresh(rate, blockSize, hit, total, {{"master_volume", 0.4f}}));
  // Volume is the knob to the power 1.5, applied after the limiter.
  const float expected = rest * std::pow(0.4f / boombapbot::plugin::kVolumeRest, 1.5f);
  check(std::abs(half - expected) < 0.02f * expected, context,
        text("master_volume at 0.4 scales the output as the machine's volume knob does (peak %.4f, expected %.4f)",
             static_cast<double>(half), static_cast<double>(expected)));
  check(allZero(renderFresh(rate, blockSize, hit, total, {{"master_volume", 0.0f}})), context,
        "master_volume at 0 gives exact silence");
}

void testEffects(const std::string& context, double rate, int blockSize) {
  const std::vector<Event> hit{noteOn(0, kSnare, 127)};
  const int total = framesFor(1.0, rate);
  const Stereo dry = renderFresh(rate, blockSize, hit, total);

  std::vector<Stereo> wet;
  for (std::size_t kind = 1; kind < kEffectNames.size(); ++kind) {
    const float choice = static_cast<float>(kind);
    wet.push_back(renderFresh(rate, blockSize, hit, total, {{"effect_kind", choice}, {"effect_mix", 0.6f}}));
    check(!identical(dry, wet.back()) && finite(wet.back()) && peak(wet.back()) <= 1.0f, context,
          text("the %s at 0.6 alters the output", kEffectNames[kind]));
    check(identical(dry, renderFresh(rate, blockSize, hit, total, {{"effect_kind", choice}, {"effect_mix", 0.0f}})),
          context, text("the %s with none of it mixed in leaves the output as it was", kEffectNames[kind]));
  }
  bool distinct = true;
  for (std::size_t a = 0; a < wet.size(); ++a) {
    for (std::size_t b = a + 1; b < wet.size(); ++b) distinct = distinct && !identical(wet[a], wet[b]);
  }
  check(distinct, context, "no two effects render the same samples");
  check(identical(dry, renderFresh(rate, blockSize, hit, total, {{"effect_kind", 0.0f}, {"effect_mix", 0.6f}})),
        context, "Off with the mix at 0.6 leaves the output as it was");
}

// ---- Host tempo, run for every sample rate ----------------------------------

// A host that reports one tempo, or none.
class HostClock final : public juce::AudioPlayHead {
 public:
  explicit HostClock(juce::Optional<double> bpm) : bpm_(bpm) {}

  juce::Optional<PositionInfo> getPosition() const override {
    PositionInfo position;
    position.setBpm(bpm_);
    position.setIsPlaying(true);
    return position;
  }

 private:
  juce::Optional<double> bpm_;
};

// A snare into the delay, on a host at `bpm` (or with no host clock at all).
// The delay glides to a new time, so it is given a while to get there first.
Stereo renderEcho(double rate, int blockSize, const HostClock* clock, float mix, int total) {
  const std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(rate, blockSize);
  set(*processor, {"effect_kind", 1.0f});
  set(*processor, {"effect_mix", mix});
  // The processor only reads the clock.
  processor->setPlayHead(const_cast<HostClock*>(clock));
  render(*processor, {}, framesFor(6.0, rate), blockSize);
  Stereo audio = render(*processor, {noteOn(0, kSnare, 127)}, total, blockSize);
  processor->setPlayHead(nullptr);
  return audio;
}

void testDelayFollowsHostTempo(const std::string& context, double rate, int blockSize) {
  const int total = framesFor(1.2, rate);
  const auto echoFrame = [&](const HostClock* clock) {
    return firstDifference(renderEcho(rate, blockSize, clock, 0.0f, total).left,
                           renderEcho(rate, blockSize, clock, 0.6f, total).left);
  };
  // The echo is a dotted eighth note behind the hit.
  const auto expected = [&](double bpm) { return framesFor(0.75 * 60.0 / bpm, rate); };
  const auto near = [](int frame, int wanted) { return frame >= 0 && std::abs(frame - wanted) <= wanted / 100 + 2; };

  for (const double bpm : {60.0, 120.0, 174.0}) {
    const HostClock clock(bpm);
    const int frame = echoFrame(&clock);
    check(near(frame, expected(bpm)), context,
          text("host at %.0f: the first echo is a dotted eighth after the hit (frame %d, expected %d)", bpm, frame,
               expected(bpm)));
  }

  const int rest = echoFrame(nullptr);
  check(near(rest, expected(boombapbot::plugin::kTempoRest)), context,
        text("no host clock: the echo keeps a new project's tempo of %.0f (frame %d, expected %d)",
             boombapbot::plugin::kTempoRest, rest, expected(boombapbot::plugin::kTempoRest)));

  const Stereo atRest = renderEcho(rate, blockSize, nullptr, 0.6f, total);
  const auto sameAs = [&](const Stereo& reference, juce::Optional<double> bpm) {
    const HostClock clock(bpm);
    return identical(reference, renderEcho(rate, blockSize, &clock, 0.6f, total));
  };
  check(sameAs(atRest, {}) && sameAs(atRest, std::nan("")) && sameAs(atRest, 0.0) && sameAs(atRest, -120.0), context,
        "a host clock with no tempo, or one that is not a tempo, renders the same samples as no clock");

  const HostClock slowest(SNARE_BPM_MIN);
  const HostClock fastest(SNARE_BPM_MAX);
  check(sameAs(renderEcho(rate, blockSize, &slowest, 0.6f, total), 5.0) &&
            sameAs(renderEcho(rate, blockSize, &fastest, 0.6f, total), 5000.0),
        context, text("a tempo outside %.0f to %.0f is held at the nearer end", SNARE_BPM_MIN, SNARE_BPM_MAX));

  const HostClock slow(60.0);
  const HostClock fast(200.0);
  check(identical(renderEcho(rate, blockSize, &slow, 0.0f, total), renderEcho(rate, blockSize, &fast, 0.0f, total)),
        context, "with no effect mixed in, the host's tempo changes nothing");
}

void testTempoChangeWhilePlaying(const std::string& context, double rate, int blockSize) {
  class MovingClock final : public juce::AudioPlayHead {
   public:
    juce::Optional<PositionInfo> getPosition() const override {
      PositionInfo position;
      position.setBpm(bpm);
      return position;
    }
    double bpm = 90.0;
  };
  MovingClock clock;
  const std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(rate, blockSize);
  set(*processor, {"effect_kind", 1.0f});
  set(*processor, {"effect_mix", 0.8f});
  processor->setPlayHead(&clock);

  bool sound = true;
  double slowTail = 0.0;
  for (const double bpm : {90.0, 40.0, 300.0, 123.456, 60.0}) {
    clock.bpm = bpm;
    const Stereo audio = render(*processor, {noteOn(0, kSnare, 127), noteOn(3000, kKick, 127)}, framesFor(0.5, rate),
                                blockSize);
    sound = sound && finite(audio) && peak(audio) > kAudible && peak(audio) <= 1.0f;
    if (juce::exactlyEqual(bpm, 40.0)) slowTail = processor->getTailLengthSeconds();
  }
  check(sound, context, "the tempo jumping between 40 and 300 while the delay rings keeps the output in range");
  check(slowTail > processor->getTailLengthSeconds() + 1.0, context,
        text("the reported tail follows the tempo (%.1f s at 40, %.1f s at 60)", slowTail,
             processor->getTailLengthSeconds()));
  processor->setPlayHead(nullptr);
}

// ---- Beats and the sequencer --------------------------------------------------

juce::String fixture(const char* name) {
  return juce::File(BOOMBAPBOT_FIXTURES_DIR).getChildFile(name).loadFileAsString();
}

const juce::String& fourPatterns() {
  static const juce::String text = fixture("four-patterns.project.json");
  return text;
}

// The beat file with something in it changed.
juce::String edited(const juce::String& json, const std::function<void(const juce::var&)>& change) {
  const juce::var document = juce::JSON::parse(json);
  change(document);
  return juce::JSON::toString(document);
}

void put(const juce::var& object, const char* key, const juce::var& value) {
  if (juce::DynamicObject* const properties = object.getDynamicObject()) properties->setProperty(key, value);
}

BoombapbotAudioProcessor& plugin(juce::AudioProcessor& processor) {
  return dynamic_cast<BoombapbotAudioProcessor&>(processor);
}

// A host's transport: where it is in the song at the start of each block.
class Transport final : public juce::AudioPlayHead {
 public:
  juce::Optional<PositionInfo> getPosition() const override {
    PositionInfo position;
    position.setBpm(bpm);
    position.setPpqPosition(beat);
    position.setIsPlaying(playing);
    return position;
  }

  double bpm = 100.0;
  double beat = 0.0;
  bool playing = true;
};

// This tempo gives a whole number of frames to the step at every rate tested,
// and the swings used keep a swung step off the exact middle between two
// frames. There the engine and the plugin may round to different sides, and a
// hit can land one frame apart.
constexpr double kSequencerBpm = 100.0;

double framesPerBeat(double rate) { return rate * 60.0 / kSequencerBpm; }
int measureFrames(double rate) { return framesFor(4.0 * 60.0 / kSequencerBpm, rate); }

// Plays the processor on a host that starts at `startBeat` and plays on. With
// `wobble`, the host's position is off by a different hair at every block, as
// one worked out from a sample count can be.
Stereo renderPlaying(juce::AudioProcessor& processor, Transport& transport, double startBeat,
                     const std::vector<Event>& events, int totalFrames, int blockSize, double rate,
                     double wobble = 0.0) {
  Stereo out;
  processor.setPlayHead(&transport);
  for (int start = 0; start < totalFrames; start += blockSize) {
    const int frames = std::min(blockSize, totalFrames - start);
    const double hair = wobble * ((start / blockSize) % 3 - 1);
    transport.beat = startBeat + start / framesPerBeat(rate) + hair;
    std::vector<Event> inBlock;
    for (const Event& event : events) {
      if (event.frame >= start && event.frame < start + frames) inBlock.push_back({event.frame - start, event.bytes});
    }
    const Stereo block = render(processor, inBlock, frames, frames);
    out.left.insert(out.left.end(), block.left.begin(), block.left.end());
    out.right.insert(out.right.end(), block.right.begin(), block.right.end());
  }
  processor.setPlayHead(nullptr);
  return out;
}

// The hits the engine's own sequencer plays for one pattern of a beat, looped
// for `measures` measures from frame 0, as the notes that would play them.
std::vector<Event> engineHits(const Beat& beat, int pattern, float swing, double rate, int measures) {
  SnareEngine* const engine = snare_engine_create(rate);
  SnarePattern rows{};
  const boombapbot::plugin::BeatPattern& source = beat.patterns[static_cast<std::size_t>(pattern)];
  rows.rows[0] = source.accents;
  for (int voice = 0; voice < kVoiceCount; ++voice) {
    rows.rows[boombapbot::plugin::voiceTrack(voice)] = source.hits[static_cast<std::size_t>(voice)];
  }
  rows.len1 = static_cast<std::uint8_t>(beat.size);
  rows.steps_per_beat = static_cast<std::uint8_t>(boombapbot::plugin::stepsPerBeat(beat.size));
  rows.swing = static_cast<std::uint8_t>(boombapbot::plugin::engineSwing(swing));
  snare_engine_set_pattern(engine, 0, &rows);
  snare_engine_set_tempo(engine, kSequencerBpm);
  snare_engine_enable_event_log(engine, 4096);
  snare_engine_cue_pattern(engine, 0);
  snare_engine_play_measures(engine, measures);

  std::vector<float> scratch(1024);
  for (int rendered = 0; rendered < measures * measureFrames(rate) + 1024; rendered += 1024) {
    snare_engine_render(engine, scratch.data(), scratch.data(), 1024);
  }
  std::vector<SnareEvent> log(static_cast<std::size_t>(snare_engine_event_count(engine)));
  snare_engine_read_events(engine, log.data(), static_cast<int>(log.size()));
  snare_engine_destroy(engine);

  std::vector<Event> hits;
  for (const SnareEvent& event : log) {
    const VoiceSpec& voice = kVoices[static_cast<std::size_t>(event.track - 1)];
    hits.push_back(noteOn(static_cast<int>(event.frame), voice.gmNote, event.accent != 0 ? 127 : 1));
  }
  return hits;
}

std::vector<Event> shifted(const std::vector<Event>& events, int byFrames, int from = 0, int to = 1 << 30) {
  std::vector<Event> out;
  for (const Event& event : events) {
    if (event.frame >= from && event.frame < to) out.push_back({event.frame + byFrames, event.bytes});
  }
  return out;
}

void append(std::vector<Event>& events, const std::vector<Event>& more) {
  events.insert(events.end(), more.begin(), more.end());
}

struct Played {
  juce::String json;
  int pattern;
  float swing;
};

std::unique_ptr<juce::AudioProcessor> makeBeatProcessor(double rate, int blockSize, const Played& played,
                                                        bool sequencer) {
  std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(rate, blockSize);
  const juce::Result loaded = plugin(*processor).loadBeat(played.json);
  jassert(loaded.wasOk());
  juce::ignoreUnused(loaded);
  set(*processor, {"pattern", static_cast<float>(played.pattern)});
  set(*processor, {"swing", played.swing});
  set(*processor, {"sequencer", sequencer ? 1.0f : 0.0f});
  return processor;
}

// The plugin's sequencer on a playing host against the same plugin, its
// sequencer off, played by notes on the frames the engine's own sequencer
// plays the pattern at. The two must render the same samples.
void testSequencerMatchesTheEngine(const std::string& context, double rate, int blockSize) {
  const juce::String triplets = edited(fourPatterns(), [](const juce::var& beat) { put(beat, "size", 12); });
  struct Case {
    const char* name;
    Played played;
  };
  const std::array<Case, 4> cases{{
      {"pattern А with the beat's swing", {fourPatterns(), 0, 0.4f}},
      {"pattern Б with no swing", {fourPatterns(), 1, 0.0f}},
      {"pattern Б with heavy swing", {fourPatterns(), 1, 0.75f}},
      {"pattern Б in twelve triplet steps", {triplets, 1, 0.4f}},
  }};
  constexpr int measures = 2;
  const int total = measures * measureFrames(rate);

  for (const Case& entry : cases) {
    Beat beat;
    boombapbot::plugin::readBeat(entry.played.json, beat);
    const std::vector<Event> hits = engineHits(beat, entry.played.pattern, entry.played.swing, rate, measures);

    Transport transport;
    const std::unique_ptr<juce::AudioProcessor> sequenced = makeBeatProcessor(rate, blockSize, entry.played, true);
    const std::unique_ptr<juce::AudioProcessor> noted = makeBeatProcessor(rate, blockSize, entry.played, false);
    const Stereo bySequencer = renderPlaying(*sequenced, transport, 0.0, {}, total, blockSize, rate);
    const Stereo byNotes = renderPlaying(*noted, transport, 0.0, hits, total, blockSize, rate);
    check(!hits.empty() && peak(bySequencer) > kAudible && identical(bySequencer, byNotes), context,
          text("%s: two measures on a playing host land every one of %d hits on the engine's own frame", entry.name,
               static_cast<int>(hits.size())));
  }
}

void testSequencerFollowsTheHost(const std::string& context, double rate, int blockSize) {
  const Played played{fourPatterns(), 1, 0.4f};
  Beat beat;
  boombapbot::plugin::readBeat(played.json, beat);
  const int measure = measureFrames(rate);
  const std::vector<Event> loop = engineHits(beat, 1, played.swing, rate, 3);
  Transport transport;
  const auto sequenced = [&] { return makeBeatProcessor(rate, blockSize, played, true); };
  const auto noted = [&] { return makeBeatProcessor(rate, blockSize, played, false); };

  // Started in the middle of the song: beat 21.25 is a beat and a quarter
  // into a measure.
  const int skipped = framesFor(1.25 * 60.0 / kSequencerBpm, rate);
  const int rest = 2 * measure - skipped;
  check(identical(renderPlaying(*sequenced(), transport, 21.25, {}, rest, blockSize, rate),
                  renderPlaying(*noted(), transport, 21.25, shifted(loop, -skipped, skipped), rest, blockSize, rate)),
        context, "started at beat 21.25, the pattern is picked up from that place in its measure");

  // Before the song starts, as a count-in has it.
  check(identical(renderPlaying(*sequenced(), transport, -4.0, {}, 2 * measure, blockSize, rate),
                  renderPlaying(*noted(), transport, -4.0, loop, 2 * measure, blockSize, rate)),
        context, "started at beat -4, the measure before the song plays like any other");

  check(identical(renderPlaying(*sequenced(), transport, 0.0, {}, 2 * measure, blockSize, rate),
                  renderPlaying(*sequenced(), transport, 0.0, {}, 2 * measure, blockSize, rate, 1e-7)),
        context, "a host whose position is a hair off at every block loses no hit and doubles none");

  // A loop: two beats played, then the host jumps back to the start.
  {
    const int half = measure / 2;
    const std::unique_ptr<juce::AudioProcessor> looped = sequenced();
    Stereo heard = renderPlaying(*looped, transport, 0.0, {}, half, blockSize, rate);
    const Stereo again = renderPlaying(*looped, transport, 0.0, {}, half, blockSize, rate);
    heard.left.insert(heard.left.end(), again.left.begin(), again.left.end());
    heard.right.insert(heard.right.end(), again.right.begin(), again.right.end());

    std::vector<Event> twice = shifted(loop, 0, 0, half);
    append(twice, shifted(loop, half, 0, half));
    check(identical(heard, renderPlaying(*noted(), transport, 0.0, twice, 2 * half, blockSize, rate)), context,
          "when the host loops back, the pattern goes back with it");
  }

  // A pattern chosen in the middle of a measure waits for the bar line.
  {
    const std::unique_ptr<juce::AudioProcessor> switched = sequenced();
    const int half = measure / 2;
    Stereo heard = renderPlaying(*switched, transport, 0.0, {}, half, blockSize, rate);
    set(*switched, {"pattern", 0.0f});
    const Stereo after = renderPlaying(*switched, transport, 2.0, {}, measure + half, blockSize, rate);
    heard.left.insert(heard.left.end(), after.left.begin(), after.left.end());
    heard.right.insert(heard.right.end(), after.right.begin(), after.right.end());

    std::vector<Event> expected = shifted(loop, 0, 0, measure);
    append(expected, shifted(engineHits(beat, 0, played.swing, rate, 1), measure));
    check(identical(heard, renderPlaying(*noted(), transport, 0.0, expected, 2 * measure, blockSize, rate)), context,
          "pattern А chosen halfway through a measure of Б takes over at the bar line");
  }

  // What keeps the sequencer quiet.
  {
    const std::unique_ptr<juce::AudioProcessor> stopped = sequenced();
    transport.playing = false;
    check(allZero(renderPlaying(*stopped, transport, 0.0, {}, measure, blockSize, rate)), context,
          "a stopped host plays no pattern");
    transport.playing = true;
    check(allZero(render(*sequenced(), {}, measure, blockSize)), context, "with no host clock no pattern plays");
    check(allZero(renderPlaying(*noted(), transport, 0.0, {}, measure, blockSize, rate)), context,
          "with the sequencer off a playing host plays no pattern");
    const std::unique_ptr<juce::AudioProcessor> empty = makeProcessor(rate, blockSize);
    check(allZero(renderPlaying(*empty, transport, 0.0, {}, measure, blockSize, rate)), context,
          "with no beat loaded a playing host plays nothing");
  }
}

void testAccentAndMutes(const std::string& context, double rate, int blockSize) {
  const int total = framesFor(0.1, rate);
  const auto level = [&](int velocity, const std::vector<Setting>& settings) {
    return peak(renderFresh(rate, blockSize, {noteOn(0, kSnare, velocity)}, total, settings));
  };
  const float accented = level(127, {});
  check(juce::exactlyEqual(level(1, {{"accent", 0.0f}}), accented), context,
        "with the accent knob fully left a plain hit is as loud as an accented one");
  check(level(1, {{"accent", 1.0f}}) < level(1, {}) * 0.8f, context,
        "with the accent knob fully right a plain hit is quieter than with it at rest");
  check(juce::exactlyEqual(level(127, {{"snare_mute", 1.0f}}), 0.0f) &&
            juce::exactlyEqual(level(127, {{"kick_mute", 1.0f}}), accented),
        context, "a muted voice is silent and the others are as they were");
}

// ---- The sound thread, run once ---------------------------------------------

// With a realtime clock the audio thread makes no sounds: a thread of the
// plugin's does, a moment after the knob moves. Hits are played until the
// higher tom is heard.
void testSoundThreadFollowsKnobs() {
  const std::string context = "sound thread";
  constexpr double rate = 48000.0;
  constexpr int blockSize = 256;
  const int span = framesFor(2.0, rate);
  const int window = framesFor(0.1, rate);
  const std::vector<Event> hit{noteOn(0, kTom, 127)};

  const std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(rate, blockSize, Clock::realtime);
  const int low = signChanges(render(*processor, hit, span, blockSize).left, 0, window);
  set(*processor, {"tom_pitch", 1.0f});

  int high = low;
  int waited = 0;
  for (; waited < 5000 && high <= low * 3 / 2; waited += 20) {
    juce::Thread::sleep(20);
    high = signChanges(render(*processor, hit, span, blockSize).left, 0, window);
  }
  check(high > low * 3 / 2, context,
        text("tom_pitch turned up on a realtime clock: the higher tom is heard within %d ms, made off the "
             "audio thread (sign changes in 0.1 s: %d, then %d)",
             waited, low, high));

  processor->releaseResources();
  processor->prepareToPlay(rate, blockSize);
  const Stereo again = render(*processor, hit, span, blockSize);
  check(std::abs(signChanges(again.left, 0, window) - high) <= 2, context,
        "after releaseResources and prepareToPlay the plugin plays the same tom");
}

// ---- The audio thread and the heap, run once --------------------------------

// A realtime processBlock must not touch the heap: an allocation can wait on
// a lock another thread holds for as long as it likes. Everything a block
// needs is made ready here first, and the trap counts heap calls only while
// processBlock runs, on this thread. The plugin's own sound thread works
// alongside and is free to allocate.
void testAudioThreadKeepsOffTheHeap() {
  const std::string context = "heap";
  constexpr double rate = 48000.0;
  constexpr int blockSize = 256;
  constexpr int blocks = 3000;

  const bool sees = heaptrap::seesTheHeap();
  check(sees, context, "the trap counts a block taken from the heap and given back under it");
  if (!sees) return;

  // The one block that is allowed the heap: offline, with a sound to make
  // again. The trap has to see it, or its silence below would mean nothing.
  {
    const std::unique_ptr<juce::AudioProcessor> offline = makeProcessor(rate, blockSize);
    set(*offline, {"tom_pitch", 0.9f});
    juce::AudioBuffer<float> block(2, blockSize);
    juce::MidiBuffer none;
    heaptrap::reset();
    {
      const heaptrap::Watch watch;
      offline->processBlock(block, none);
    }
    check(heaptrap::calls() > 0, context,
          text("an offline block that makes a sound again is seen to use the heap (%d calls)", heaptrap::calls()));
  }

  const std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(rate, blockSize, Clock::realtime);
  plugin(*processor).loadBeat(fourPatterns());
  set(*processor, {"pattern", 1.0f});
  Transport transport;
  transport.bpm = 132.0;
  processor->setPlayHead(&transport);

  // Notes for every block, some of them on voices, with a long message among
  // them that a careless reader would copy.
  juce::MidiBuffer notes;
  const juce::uint8 sysex[] = {0xf0, 0x7d, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 0xf7};
  notes.addEvent(sysex, static_cast<int>(sizeof(sysex)), 0);
  for (const VoiceSpec& voice : kVoices) notes.addEvent(noteOn(0, voice.gmNote, 127).bytes.data(), 3, voice.gmNote);
  notes.addEvent(noteOn(0, 60, 100).bytes.data(), 3, 200);
  juce::MidiBuffer midi;
  midi.ensureSize(4096);
  juce::AudioBuffer<float> buffer(2, blockSize);

  const std::array<Setting, 10> turns{{{"kick_level", 0.3f}, {"tom_pitch", 0.9f}, {"effect_kind", 2.0f},
                                       {"effect_mix", 0.5f}, {"master_volume", 0.6f}, {"snare_mute", 1.0f},
                                       {"accent", 0.2f}, {"swing", 0.7f}, {"pattern", 0.0f}, {"effect_kind", 4.0f}}};
  heaptrap::reset();
  bool sounded = false;
  for (int block = 0; block < blocks; ++block) {
    // The host's side of a block: knobs turned, the transport moved, started,
    // stopped and looped, and the block's notes handed over.
    if (block % 37 == 0) set(*processor, turns[static_cast<std::size_t>(block / 37) % turns.size()]);
    transport.playing = block % 500 < 430;
    transport.bpm = 90.0 + block % 120;
    transport.beat = (block % 900) * blockSize / (rate * 60.0 / 132.0);
    midi.clear();
    if (block % 3 == 0) midi.addEvents(notes, 0, blockSize, 0);
    buffer.clear();
    {
      const heaptrap::Watch watch;
      processor->processBlock(buffer, midi);
    }
    sounded = sounded || buffer.getMagnitude(0, blockSize) > kAudible;
    if (block % 200 == 0) juce::Thread::sleep(20);  // lets the sound thread hand over new sounds
  }
  processor->setPlayHead(nullptr);
  check(sounded && heaptrap::calls() == 0, context,
        text("%d realtime blocks with notes, the sequencer, a moving host and knobs turning make no heap call "
             "on the audio thread (%d seen)",
             blocks, heaptrap::calls()));
}

// ---- Lifecycle, run once ----------------------------------------------------

void testSampleRateChange() {
  const std::string context = "lifecycle";
  const std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(44100.0, 512);
  const Stereo first = render(*processor, {noteOn(100, kKick, 100)}, 1024, 512);
  processor->releaseResources();
  processor->setPlayConfigDetails(0, 2, 96000.0, 64);
  processor->prepareToPlay(96000.0, 64);
  // The engine is rebuilt for the new rate, so nothing rings over from before.
  const Stereo second = render(*processor, {noteOn(100, kKick, 100)}, 1024, 64);
  check(firstNonZero(first.left) == 101 && firstNonZero(second.left) == 101, context,
        text("after re-preparing from 44100 Hz to 96000 Hz a kick at frame 100 still starts there "
             "(first non-zero sample before %d, after %d)",
             firstNonZero(first.left), firstNonZero(second.left)));
}

void testUnsupportedSampleRate() {
  const std::string context = "lifecycle";
  const Stereo audio = renderFresh(384000.0, 512, {noteOn(100, kKick, 100)}, 1024);
  check(allZero(audio), context, "384000 Hz is outside the engine's range: exact silence, no crash");
}

void testDescription() {
  const std::string context = "description";
  const std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(48000.0, 512);
  const int expected = kVoiceCount * 5 + 7;
  check(processor->getParameters().size() == expected, context,
        text("the plugin has %d parameters: four knobs and a mute for each of %d voices, and seven more (%d found)",
             expected, kVoiceCount, processor->getParameters().size()));
  check(processor->getTailLengthSeconds() > 1.0, context,
        text("the tail covers the longest sound and effect (%.2f s)", processor->getTailLengthSeconds()));

  const std::unique_ptr<juce::AudioProcessorEditor> editor(processor->createEditorIfNeeded());
  check(processor->hasEditor() && editor != nullptr && editor->getWidth() > 0 && editor->getHeight() > 0, context,
        "the plugin opens a window");
}

// ---- The panel, run once ----------------------------------------------------

juce::Component* titled(juce::Component& parent, const juce::String& title) {
  for (juce::Component* child : parent.getChildren()) {
    if (child->getTitle() == title) return child;
    if (juce::Component* const found = titled(*child, title)) return found;
  }
  return nullptr;
}

// Presses the key with this title as a click does, without a mouse.
bool press(juce::Component& window, const juce::String& title) {
  auto* const key = dynamic_cast<juce::Button*>(titled(window, title));
  if (key == nullptr || !key->onClick) return false;
  key->onClick();
  return true;
}

juce::MouseEvent mouseAt(juce::Component& component, juce::Point<int> position, juce::Point<int> pressedAt,
                         bool dragged) {
  const juce::Time now = juce::Time::getCurrentTime();
  return {juce::Desktop::getInstance().getMainMouseSource(),
          position.toFloat(),
          juce::ModifierKeys::leftButtonModifier,
          juce::MouseInputSource::defaultPressure,
          juce::MouseInputSource::defaultOrientation,
          juce::MouseInputSource::defaultRotation,
          juce::MouseInputSource::defaultTiltX,
          juce::MouseInputSource::defaultTiltY,
          &component,
          &component,
          now,
          pressedAt.toFloat(),
          now,
          1,
          dragged};
}

void testPanel() {
  const std::string context = "panel";
  constexpr double rate = 48000.0;
  constexpr int blockSize = 512;
  using boombapbot::panel::StepKeys;
  constexpr int accents = BoombapbotAudioProcessor::kAccentsRow;
  constexpr int kick = 0;
  constexpr int tom = 5;

  const std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(rate, blockSize);
  BoombapbotAudioProcessor& machine = plugin(*processor);
  const std::unique_ptr<juce::AudioProcessorEditor> window(processor->createEditorIfNeeded());
  auto* const steps = dynamic_cast<StepKeys*>(titled(*window, "Step keys"));
  check(steps != nullptr, context, "the window has the step keys");
  if (steps == nullptr) return;

  // The step keys: screen row 0 is the accents, row 1 the kick, row 6 the tom.
  const auto centre = [](int row, int step) { return StepKeys::keyBounds(row, step).getCentre(); };
  steps->mouseDown(mouseAt(*steps, centre(1, 0), centre(1, 0), false));
  check(machine.stepOn(0, kick, 0), context, "a press on the kick's first step key turns that step on");
  steps->mouseDown(mouseAt(*steps, centre(6, 2), centre(6, 2), false));
  steps->mouseDrag(mouseAt(*steps, centre(6, 3), centre(6, 2), true));
  steps->mouseDrag(mouseAt(*steps, centre(4, 4), centre(6, 2), true));
  check(machine.stepOn(0, tom, 2) && machine.stepOn(0, tom, 3) && machine.stepOn(0, tom, 4) &&
            !machine.stepOn(0, 3, 4),
        context, "a drag along the tom's keys turns on each step it passes and stays in its row");
  steps->mouseDown(mouseAt(*steps, centre(6, 3), centre(6, 3), false));
  steps->mouseDown(mouseAt(*steps, centre(0, 0), centre(0, 0), false));
  check(!machine.stepOn(0, tom, 3) && machine.stepOn(0, accents, 0), context,
        "a press on a lit key turns it off, and the top row writes the accents");

  // What was written plays: the same as the beat it amounts to, loaded from a file.
  const juce::String written = edited(fourPatterns(), [](const juce::var& beat) {
    const juce::var& first = beat["patterns"][0];
    for (const char* id : {"snare", "clap", "closed_hat", "open_hat", "rim", "perc"}) {
      put(first["steps"], id, "................");
    }
    put(first["steps"], "kick", "x...............");
    put(first["steps"], "tom", "..x.x...........");
    put(first, "accents", "x...............");
    put(beat, "swing", 0.0);
    put(beat["voices"]["kick"], "pitch", 0.5);
    put(beat["mix"]["levels"], "clap", 0.75);
    put(beat["mix"]["mutes"], "rim", false);
    put(beat["effect"], "mix", 0.0);
    put(beat["panel"], "pattern", 0);
  });
  Transport transport;
  const int total = 2 * measureFrames(rate);
  const std::unique_ptr<juce::AudioProcessor> loaded = makeProcessor(rate, blockSize);
  plugin(*loaded).loadBeat(written);
  const Stereo byHand = renderPlaying(*processor, transport, 0.0, {}, total, blockSize, rate);
  check(peak(byHand) > kAudible &&
            identical(byHand, renderPlaying(*loaded, transport, 0.0, {}, total, blockSize, rate)),
        context, "a pattern written on the step keys plays the same samples as that beat loaded from a file");
  check(machine.playingStep() == 15 && machine.playingPattern() == 0, context,
        text("after two measures the sequencer says it last played step 15 of pattern 0 (step %d, pattern %d)",
             machine.playingStep(), machine.playingPattern()));
  render(*processor, {}, blockSize, blockSize);
  check(machine.playingStep() == -1, context, "with no host playing it says no step is playing");

  // The keys.
  check(press(*window, juce::String("Pattern ") + juce::String::fromUTF8("Б")) &&
            juce::exactlyEqual(valueOf(*processor, "pattern"), 1.0f),
        context, "the pattern key Б chooses pattern Б");
  check(press(*window, "Flanger") && juce::exactlyEqual(valueOf(*processor, "effect_kind"), 3.0f), context,
        "the flanger's key chooses the flanger");
  check(press(*window, "Twelve triplet steps to the measure") && machine.measureSize() == 12 &&
            press(*window, "Sixteen steps to the measure") && machine.measureSize() == 16,
        context, "the 12 and 16 keys set how many steps a measure has");
  auto* const mute = dynamic_cast<juce::Button*>(titled(*window, "Mute Rim"));
  if (mute != nullptr) mute->setToggleState(true, juce::sendNotificationSync);
  check(mute != nullptr && juce::exactlyEqual(valueOf(*processor, "rim_mute"), 1.0f), context,
        "the rim's mute key mutes the rim");

  render(*processor, {}, framesFor(3.0, rate), blockSize);
  const bool pressed = press(*window, "Tom");
  const Stereo auditioned = render(*processor, {}, framesFor(0.2, rate), blockSize);
  check(pressed && peak(auditioned) > kAudible, context,
        text("a voice's key plays the voice (peak %.4f)", static_cast<double>(peak(auditioned))));
  auto* const pitch = dynamic_cast<juce::Slider*>(titled(*window, "Pitch"));
  if (pitch != nullptr) pitch->setValue(0.9, juce::sendNotificationSync);
  check(pitch != nullptr && std::abs(valueOf(*processor, "tom_pitch") - 0.9f) < 1e-6f &&
            juce::exactlyEqual(valueOf(*processor, "kick_pitch"), 0.5f),
        context, "and its knobs become that voice's: the pitch knob now turns the tom's pitch");

  press(*window, "Pattern " + juce::String::fromUTF8("А"));
  check(press(*window, "Clear") && !machine.stepOn(0, kick, 0) && !machine.stepOn(0, tom, 2) &&
            !machine.stepOn(0, accents, 0),
        context, "the clear key empties the pattern the panel is on");

  // The beat's name, typed on the panel.
  auto* const name = dynamic_cast<juce::Label*>(titled(*window, "Beat name"));
  check(name != nullptr && name->isEditable() && name->getText() == "Untitled beat" && machine.beatName().isEmpty(),
        context, "a beat with no name shows as Untitled beat, in a field that can be typed in");
  if (name != nullptr) name->setText("  Sunday at the garage  ", juce::sendNotificationSync);
  using boombapbot::plugin::writeBeat;
  check(name != nullptr && machine.beatName() == "Sunday at the garage" && name->getText() == "Sunday at the garage" &&
            juce::JSON::parse(writeBeat(machine.currentBeat(), boombapbot::plugin::newBeatStamp()))["name"].toString() ==
                "Sunday at the garage" &&
            boombapbot::plugin::beatFileName(machine.beatName()) == "sunday-at-the-garage.boombapbot.json",
        context, "a name typed there names the beat, the file it is saved to and the beat inside the file");
  if (name != nullptr) name->setText(juce::String::repeatedString("long ", 40), juce::sendNotificationSync);
  check(machine.beatName().length() == 79 && !machine.beatName().endsWithChar(' '), context,
        text("a name too long for the site is cut to what it takes (%d letters)", machine.beatName().length()));
  {
    press(*window, "Perc");
    juce::MemoryBlock saved;
    processor->getStateInformation(saved);
    const std::unique_ptr<juce::AudioProcessor> recalled = makeProcessor(rate, blockSize);
    recalled->setStateInformation(saved.getData(), static_cast<int>(saved.getSize()));
    check(plugin(*recalled).beatName() == machine.beatName() && plugin(*recalled).selectedVoice() == 7, context,
          "the name and the voice the panel is on come back with the host's project");
  }
  if (name != nullptr) name->setText("   ", juce::sendNotificationSync);
  check(name != nullptr && machine.beatName().isEmpty() && name->getText() == "Untitled beat", context,
        "a name wiped out leaves the beat untitled");

  machine.setStep(9, 0, 0, true);
  machine.setStep(0, 12, 0, true);
  machine.setStep(0, 0, 16, true);
  machine.setMeasureSize(7);
  machine.audition(40);
  check(!machine.stepOn(0, 0, 0) && machine.measureSize() == 16 && finite(render(*processor, {}, 2048, blockSize)),
        context, "steps, sizes and voices the machine does not have are turned down");
}

// ---- Beat files, run once ---------------------------------------------------

void testBeatFile() {
  const std::string context = "beat file";
  const std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(48000.0, 512);
  const auto state = [&] {
    juce::MemoryBlock block;
    processor->getStateInformation(block);
    return block;
  };
  const juce::MemoryBlock before = state();

  struct Refused {
    const char* name;
    juce::String json;
  };
  const auto with = [](const std::function<void(const juce::var&)>& change) { return edited(fourPatterns(), change); };
  const std::array<Refused, 12> refused{{
      {"text that is not JSON", "x.x.x.x. this is not a beat"},
      {"an empty file", ""},
      {"JSON that is not a beat", "{\"format\": \"something.else\", \"schemaVersion\": 3}"},
      {"a list", "[1, 2, 3]"},
      {"a beat of the earlier machine", fixture("earlier-v2.project.json")},
      {"a beat from a newer version", with([](const juce::var& beat) { put(beat, "schemaVersion", 4); })},
      {"a beat for another machine", with([](const juce::var& beat) { put(beat, "machine", "808"); })},
      {"a row of fifteen steps", with([](const juce::var& beat) { put(beat["patterns"][0]["steps"], "kick", "x.............."); })},
      {"a row with a letter that is no step", with([](const juce::var& beat) { put(beat["patterns"][3], "accents", "x......X........"); })},
      {"a knob past its end", with([](const juce::var& beat) { put(beat["mix"], "volume", 1.5); })},
      {"a size the machine does not have", with([](const juce::var& beat) { put(beat, "size", 10); })},
      {"a voice with no level", with([](const juce::var& beat) { put(beat["mix"], "levels", juce::var(new juce::DynamicObject())); })},
  }};
  for (const Refused& file : refused) {
    const juce::Result result = plugin(*processor).loadBeat(file.json);
    check(result.failed() && result.getErrorMessage().isNotEmpty() && state() == before, context,
          text("%s is refused and changes nothing: \"%s\"", file.name, result.getErrorMessage().toRawUTF8()));
  }

  const juce::Result loaded = plugin(*processor).loadBeat(fourPatterns());
  check(loaded.wasOk() && plugin(*processor).beatName() == "Four patterns fixture", context,
        text("the fixture loads and the plugin holds its name: %s", plugin(*processor).beatName().toRawUTF8()));
  const auto is = [&](const char* id, float value) { return std::abs(valueOf(*processor, id) - value) < 1e-6f; };
  check(is("kick_pitch", 0.35f) && is("clap_level", 0.5f) && is("rim_mute", 1.0f) && is("kick_mute", 0.0f) &&
            is("master_volume", 0.8f) && is("accent", 0.6f) && is("swing", 0.4f) && is("effect_kind", 2.0f) &&
            is("effect_mix", 0.3f) && is("pattern", 2.0f),
        context, "its knobs, mutes, swing, effect and the pattern its panel was on become the parameters");

  // The beat rides in the plugin's state.
  const juce::MemoryBlock saved = state();
  const std::unique_ptr<juce::XmlElement> xml =
      juce::AudioProcessor::getXmlFromBinary(saved.getData(), static_cast<int>(saved.getSize()));
  const juce::XmlElement* const beat = xml != nullptr ? xml->getChildByName("Beat") : nullptr;
  check(beat != nullptr && beat->getNumChildElements() == 4 &&
            beat->getFirstChildElement()->getStringAttribute("kick") == "x.....x...x....." &&
            beat->getFirstChildElement()->getStringAttribute("accents") == "x.......x.....x.",
        context, "the saved state holds its four patterns as rows of steps");

  const std::unique_ptr<juce::AudioProcessor> recalled = makeProcessor(48000.0, 512);
  recalled->setStateInformation(saved.getData(), static_cast<int>(saved.getSize()));
  juce::MemoryBlock again;
  recalled->getStateInformation(again);
  check(again == saved && plugin(*recalled).beatName() == "Four patterns fixture", context,
        "save -> load -> save with a beat held is byte-for-byte identical");

  Transport transport;
  const int total = 2 * measureFrames(48000.0);
  check(identical(renderPlaying(*processor, transport, 0.0, {}, total, 512, 48000.0),
                  renderPlaying(*recalled, transport, 0.0, {}, total, 512, 48000.0)),
        context, "the recalled plugin plays the same pattern, sample for sample");

  // A state from before the plugin held beats: version 1, no patterns.
  juce::XmlElement old(*xml);
  old.setAttribute("schemaVersion", 1);
  old.deleteAllChildElements();
  for (const char* later : {"accent", "swing", "pattern", "sequencer", "rim_mute"}) old.removeAttribute(later);
  juce::MemoryBlock oldBlob;
  juce::AudioProcessor::copyXmlToBinary(old, oldBlob);
  const std::unique_ptr<juce::AudioProcessor> older = makeProcessor(48000.0, 512);
  plugin(*older).loadBeat(fourPatterns());
  older->setStateInformation(oldBlob.getData(), static_cast<int>(oldBlob.getSize()));
  const auto rests = [&](const char* id, float value) { return std::abs(valueOf(*older, id) - value) < 1e-6f; };
  check(plugin(*older).beatName().isEmpty() && rests("kick_pitch", 0.35f) && rests("swing", 0.0f) &&
            rests("pattern", 0.0f) && rests("sequencer", 1.0f) && rests("rim_mute", 0.0f) &&
            allZero(renderPlaying(*older, transport, 0.0, {}, total, 512, 48000.0)),
        context, "a version 1 state still loads: its knobs are kept, the new ones rest and no pattern plays");
}

// ---- Saving a beat, run once ------------------------------------------------

// A beat the plugin saved, committed beside the site's own fixtures. The
// site's tests open the same file, so the two agree on what a beat file is.
constexpr const char* kSavedFixture = "saved-by-plugin.project.json";

boombapbot::plugin::BeatStamp fixtureStamp() {
  return {"fixture-saved-by-plugin", juce::Time(2026, 10, 22, 12, 0, 0, 0, false)};
}

bool sameBeat(const Beat& a, const Beat& b) {
  const auto near = [](float x, float y) { return std::abs(x - y) < 1e-6f; };
  bool same = a.name == b.name && a.tempo == b.tempo && near(a.swing, b.swing) && a.size == b.size &&
              a.pattern == b.pattern && a.selectedVoice == b.selectedVoice && near(a.volume, b.volume) &&
              near(a.accent, b.accent) && a.effect == b.effect && near(a.effectMix, b.effectMix);
  for (std::size_t index = 0; index < a.patterns.size(); ++index) {
    same = same && a.patterns[index].hits == b.patterns[index].hits && a.patterns[index].accents == b.patterns[index].accents;
  }
  for (std::size_t voice = 0; voice < a.voices.size(); ++voice) {
    const boombapbot::plugin::BeatVoice& x = a.voices[voice];
    const boombapbot::plugin::BeatVoice& y = b.voices[voice];
    same = same && near(x.pitch, y.pitch) && near(x.tone, y.tone) && near(x.decay, y.decay) && near(x.level, y.level) &&
           x.muted == y.muted;
  }
  return same;
}

void testSavingABeat() {
  const std::string context = "saving a beat";
  constexpr double rate = 48000.0;
  constexpr int blockSize = 512;
  using boombapbot::plugin::readBeat;
  using boombapbot::plugin::writeBeat;

  // The fixture read and written again is the same beat.
  Beat original;
  readBeat(fourPatterns(), original);
  Beat rewritten;
  const juce::Result reread = readBeat(writeBeat(original, fixtureStamp()), rewritten);
  check(reread.wasOk() && sameBeat(original, rewritten), context,
        "the site's fixture, written out by the plugin and read back, is the same beat");

  // A plugin worked by hand: a beat loaded, knobs turned, steps written, a host at 97.4.
  const auto worked = [&] {
    std::unique_ptr<juce::AudioProcessor> made = makeProcessor(rate, blockSize);
    BoombapbotAudioProcessor& hands = plugin(*made);
    hands.loadBeat(fourPatterns());
    for (const Setting& setting : std::vector<Setting>{{"tom_pitch", 1.0f / 3.0f}, {"perc_decay", 0.81f},
                                                       {"snare_mute", 1.0f}, {"swing", 0.25f}, {"accent", 0.9f},
                                                       {"effect_kind", 4.0f}, {"effect_mix", 0.45f}, {"pattern", 3.0f}}) {
      set(*made, setting);
    }
    hands.setStep(3, 7, 0, true);
    hands.setStep(3, BoombapbotAudioProcessor::kAccentsRow, 15, true);
    hands.setMeasureSize(12);
    hands.selectVoice(7);
    return made;
  };
  const std::unique_ptr<juce::AudioProcessor> processor = worked();
  BoombapbotAudioProcessor& machine = plugin(*processor);
  Transport transport;
  transport.bpm = 97.4;
  renderPlaying(*processor, transport, 0.0, {}, blockSize, blockSize, rate);

  const juce::String saved = writeBeat(machine.currentBeat(), fixtureStamp());
  const juce::var document = juce::JSON::parse(saved);
  check(document["tempo"] == juce::var(97) && document["size"] == juce::var(12) &&
            document["panel"]["selected"].toString() == "perc" && document["panel"]["pattern"] == juce::var(3) &&
            document["effect"]["kind"].toString() == "chorus" && document["mix"]["mutes"]["snare"] == juce::var(true) &&
            document["patterns"][3]["steps"]["perc"].toString() == "x..............x" &&
            document["createdAt"].toString() == "2026-11-22T12:00:00.000Z",
        context, "a saved beat holds the host's tempo as a whole number, the panel's place and what was written");
  check(saved.contains("0.333333") && !saved.contains("0.33333334"), context,
        "knob positions are written to six places");

  // The saved beat, loaded into a new plugin, is the plugin it was saved from.
  // The pattern it plays uses no voice whose knob six places would move.
  const std::unique_ptr<juce::AudioProcessor> reopened = makeProcessor(rate, blockSize);
  const juce::Result loaded = plugin(*reopened).loadBeat(saved);
  Beat held = plugin(*reopened).currentBeat();
  held.tempo = machine.currentBeat().tempo;
  const int total = 2 * measureFrames(rate);
  transport.bpm = kSequencerBpm;
  const Stereo fromSaved = renderPlaying(*reopened, transport, 0.0, {}, total, blockSize, rate);
  check(loaded.wasOk() && sameBeat(machine.currentBeat(), held) && peak(fromSaved) > kAudible &&
            identical(renderPlaying(*worked(), transport, 0.0, {}, total, blockSize, rate), fromSaved),
        context, "a saved beat loaded into a new plugin has the same knobs and plays the same samples");

  // With the effect off there is nothing in the document to say so but a mix of 0.
  set(*processor, {"effect_kind", 0.0f});
  const juce::var dry = juce::JSON::parse(writeBeat(machine.currentBeat(), fixtureStamp()));
  check(dry["effect"]["kind"].toString() == "delay" && dry["effect"]["mix"] == juce::var(0.0), context,
        "a beat whose effect is off is written as the delay with none of it mixed in");

  const boombapbot::plugin::BeatStamp first = boombapbot::plugin::newBeatStamp();
  const boombapbot::plugin::BeatStamp second = boombapbot::plugin::newBeatStamp();
  check(first.id != second.id && first.id.length() >= 1 && first.id.length() <= 64, context,
        "each save gets an id of its own, of a length the site takes");
  using boombapbot::plugin::beatFileName;
  check(beatFileName("Four patterns fixture") == "four-patterns-fixture.boombapbot.json" &&
            beatFileName("") == "boombapbot-beat.boombapbot.json" &&
            beatFileName(juce::String::fromUTF8("  Бит №1 / test!  ")) == "1-test.boombapbot.json",
        context, "a beat's file is named for it, in letters a disk takes");

  // The committed fixture is what the plugin writes today.
  const juce::String fresh = writeBeat(original, fixtureStamp());
  const juce::File committed = juce::File(BOOMBAPBOT_FIXTURES_DIR).getChildFile(kSavedFixture);
  if (juce::SystemStats::getEnvironmentVariable("BOOMBAPBOT_WRITE_FIXTURES", {}).isNotEmpty()) {
    committed.replaceWithText(fresh, false, false, "\n");
  }
  check(committed.loadFileAsString() == fresh, context,
        text("%s is byte for byte what the plugin writes for the site's fixture "
             "(run the self-test with BOOMBAPBOT_WRITE_FIXTURES=1 to write it again)",
             kSavedFixture));
}

// ---- State, run once --------------------------------------------------------

juce::MemoryBlock saveState(juce::AudioProcessor& processor) {
  juce::MemoryBlock block;
  processor.getStateInformation(block);
  return block;
}

void loadState(juce::AudioProcessor& processor, const juce::MemoryBlock& state) {
  processor.setStateInformation(state.getData(), static_cast<int>(state.getSize()));
}

std::unique_ptr<juce::XmlElement> xmlOf(const juce::MemoryBlock& state) {
  return juce::AudioProcessor::getXmlFromBinary(state.getData(), static_cast<int>(state.getSize()));
}

juce::MemoryBlock blobOf(const juce::XmlElement& xml) {
  juce::MemoryBlock block;
  juce::AudioProcessor::copyXmlToBinary(xml, block);
  return block;
}

// Every parameter somewhere else, at values with no short decimal form.
void turnEveryKnob(juce::AudioProcessor& processor) {
  int index = 0;
  for (juce::AudioProcessorParameter* parameter : processor.getParameters()) {
    const float normalised = std::fmod(0.137f * static_cast<float>(++index) + 1.0f / 3.0f, 1.0f);
    auto* const ranged = dynamic_cast<juce::RangedAudioParameter*>(parameter);
    ranged->setValueNotifyingHost(ranged->convertTo0to1(ranged->convertFrom0to1(normalised)));
  }
  set(processor, {"effect_kind", 3.0f});
}

bool sameParameters(juce::AudioProcessor& a, juce::AudioProcessor& b) {
  const auto& left = a.getParameters();
  const auto& right = b.getParameters();
  if (left.size() != right.size()) return false;
  for (int i = 0; i < left.size(); ++i) {
    if (!juce::exactlyEqual(left[i]->getValue(), right[i]->getValue())) return false;
  }
  return true;
}

void testState() {
  const std::string context = "state";
  constexpr double rate = 48000.0;
  constexpr int blockSize = 512;
  const std::vector<Event> beat{noteOn(0, kKick, 127), noteOn(3000, kSnare, 90), noteOn(6000, kOpenHat, 127),
                                noteOn(9000, kTom, 127)};
  const int total = framesFor(0.5, rate);

  const std::unique_ptr<juce::AudioProcessor> untouched = makeProcessor(rate, blockSize);
  const juce::MemoryBlock restState = saveState(*untouched);
  const std::unique_ptr<juce::XmlElement> restXml = xmlOf(restState);
  const bool versioned = restXml != nullptr && restXml->hasTagName("BoombapbotPluginState") &&
                         restXml->getIntAttribute("schemaVersion") == 2 &&
                         restXml->getStringAttribute("machine") == "ritm12" &&
                         restXml->getNumAttributes() == 2 + untouched->getParameters().size();
  check(versioned, context,
        text("a saved state carries schemaVersion 2, machine ritm12 and every parameter (%d attributes)",
             restXml != nullptr ? restXml->getNumAttributes() : 0));

  const std::unique_ptr<juce::AudioProcessor> source = makeProcessor(rate, blockSize);
  turnEveryKnob(*source);
  const juce::MemoryBlock saved = saveState(*source);
  check(saved != restState, context, "turning the knobs changes the saved state");

  const std::unique_ptr<juce::AudioProcessor> target = makeProcessor(rate, blockSize);
  loadState(*target, saved);
  check(saveState(*target) == saved, context, "save -> load -> save is byte-for-byte identical");
  check(sameParameters(*source, *target), context, "every parameter is recalled exactly");
  check(identical(render(*source, beat, total, blockSize), render(*target, beat, total, blockSize)), context,
        "a recalled state renders the same samples as the plugin it was saved from");

  // None of these may change what the plugin saves or how it plays.
  const char garbage[] = "\x01\x02 this is not a state blob \xff\xfe";
  const auto retagged = [&](const char* tag) {
    juce::XmlElement xml(*restXml);
    xml.setTagName(tag);
    return blobOf(xml);
  };
  const auto with = [&](const char* attribute, const juce::String& value) {
    juce::XmlElement xml(*restXml);
    xml.setAttribute(attribute, value);
    return blobOf(xml);
  };
  const juce::MemoryBlock otherPlugin = retagged("SomeOtherPlugin");
  const juce::MemoryBlock noVersion = with("schemaVersion", "0");
  const juce::MemoryBlock newerVersion = with("schemaVersion", "3");
  const juce::MemoryBlock otherMachine = with("machine", "808");

  struct Refused {
    const char* name;
    const void* data;
    int size;
  };
  const std::array<Refused, 8> refused{{
      {"garbage bytes", garbage, static_cast<int>(sizeof(garbage))},
      {"an empty block", garbage, 0},
      {"no block at all", nullptr, 64},
      {"a state cut short", saved.getData(), static_cast<int>(saved.getSize() / 2)},
      {"XML of another plugin", otherPlugin.getData(), static_cast<int>(otherPlugin.getSize())},
      {"a state with schemaVersion 0", noVersion.getData(), static_cast<int>(noVersion.getSize())},
      {"a state from a newer version", newerVersion.getData(), static_cast<int>(newerVersion.getSize())},
      {"a state for another machine", otherMachine.getData(), static_cast<int>(otherMachine.getSize())},
  }};
  for (const Refused& input : refused) {
    target->setStateInformation(input.data, input.size);
    check(saveState(*target) == saved, context, text("%s leaves the state as it was", input.name));
  }

  // A state that is ours but holds nonsense is read, and every value is
  // brought to something the plugin can play.
  juce::XmlElement nonsense(*restXml);
  nonsense.setAttribute("kick_pitch", 7.5);
  nonsense.setAttribute("snare_level", -3.0);
  nonsense.setAttribute("effect_kind", 99);
  nonsense.setAttribute("effect_mix", "banana");
  nonsense.setAttribute("master_volume", "nan");
  nonsense.removeAttribute("tom_decay");
  loadState(*target, blobOf(nonsense));
  const bool tamed = juce::exactlyEqual(valueOf(*target, "kick_pitch"), 1.0f) &&
                     juce::exactlyEqual(valueOf(*target, "snare_level"), 0.0f) &&
                     juce::exactlyEqual(valueOf(*target, "effect_kind"), 4.0f) &&
                     valueOf(*target, "effect_mix") >= 0.0f && valueOf(*target, "effect_mix") <= 1.0f &&
                     valueOf(*target, "master_volume") >= 0.0f && valueOf(*target, "master_volume") <= 1.0f &&
                     juce::exactlyEqual(valueOf(*target, "tom_decay"), boombapbot::plugin::kSoundKnobRest);
  check(tamed, context,
        text("values out of range are brought into it and a missing one rests (kick_pitch %.2f, snare_level %.2f, "
             "effect_kind %.0f, effect_mix %.2f, master_volume %.2f, tom_decay %.2f)",
             static_cast<double>(valueOf(*target, "kick_pitch")), static_cast<double>(valueOf(*target, "snare_level")),
             static_cast<double>(valueOf(*target, "effect_kind")), static_cast<double>(valueOf(*target, "effect_mix")),
             static_cast<double>(valueOf(*target, "master_volume")),
             static_cast<double>(valueOf(*target, "tom_decay"))));
  const Stereo after = render(*target, beat, total, blockSize);
  check(finite(after) && peak(after) <= 1.0f, context, "after all of those loads the plugin still renders sound in range");

  loadState(*target, restState);
  check(saveState(*target) == restState, context, "loading the state of a new plugin puts every knob back at rest");
}

// The plugin's voice table is written out by hand. The machine's own file,
// which the editor reads, is the source of truth for it.
void testVoicesMatchTheMachine() {
  const std::string context = "machine";
  const juce::var machine = juce::JSON::parse(juce::File(BOOMBAPBOT_MACHINE_FILE));
  const juce::Array<juce::var>* const voices = machine["voices"].getArray();
  if (voices == nullptr || voices->size() != kVoiceCount) {
    check(false, context, text("%s lists the plugin's %d voices", BOOMBAPBOT_MACHINE_FILE, kVoiceCount));
    return;
  }
  for (int index = 0; index < kVoiceCount; ++index) {
    const VoiceSpec& spec = kVoices[static_cast<std::size_t>(index)];
    const juce::var& voice = voices->getReference(index);
    const bool same = voice["id"].toString() == spec.id && voice["name"].toString() == spec.name &&
                      voice["label"].toString() == juce::String::fromUTF8(spec.label) &&
                      static_cast<int>(voice["gmNote"]) == spec.gmNote &&
                      std::abs(static_cast<double>(voice["trim"]) - static_cast<double>(spec.trim)) < 1e-6 &&
                      std::abs(static_cast<double>(voice["pan"]) - static_cast<double>(spec.pan)) < 1e-6 &&
                      static_cast<int>(voice["chokeGroup"]) == spec.chokeGroup;
    check(same, context, text("voice %d (%s, note %d) matches ritm12.machine.json", index, spec.id, spec.gmNote));
  }
}

}  // namespace

int main() {
  const juce::ScopedJuceInitialiser_GUI juceInitialiser;

  for (const double rate : {44100.0, 48000.0, 96000.0}) {
    for (const int blockSize : {64, 512}) {
      const std::string context = text("%.0f Hz, block %d", rate, blockSize);
      testSilenceWithoutMidi(context, rate, blockSize);
      testKickAtOffset100(context, rate, blockSize);
      testTwoNotesInOneBlock(context, rate, blockSize);
      testBlockSizeDoesNotMoveHits(context, rate, blockSize);
      testMappedNotesSound(context, rate, blockSize);
      testUnmappedNotesAreSilent(context, rate, blockSize);
      testVelocityChoosesAccent(context, rate, blockSize);
      testClosedHatChokesOpenHat(context, rate, blockSize);
    }
    const std::string context = text("%.0f Hz", rate);
    testVoiceKnobsAlterTheirVoice(context, rate, 512);
    testKnobsReachTheEngineWheneverTheyAreTurned(context, rate, 512);
    testKnobTurnedBetweenHits(context, rate, 512);
    testVolume(context, rate, 512);
    testEffects(context, rate, 512);
    testDelayFollowsHostTempo(context, rate, 512);
    testTempoChangeWhilePlaying(context, rate, 512);
    testAccentAndMutes(context, rate, 512);
    for (const int blockSize : {64, 512}) {
      const std::string blocks = text("%.0f Hz, block %d", rate, blockSize);
      testSequencerMatchesTheEngine(blocks, rate, blockSize);
      testSequencerFollowsTheHost(blocks, rate, blockSize);
    }
  }
  testSoundThreadFollowsKnobs();
  testAudioThreadKeepsOffTheHeap();
  testSampleRateChange();
  testUnsupportedSampleRate();
  testDescription();
  testPanel();
  testBeatFile();
  testSavingABeat();
  testState();
  testVoicesMatchTheMachine();

  std::printf("%d checks, %d failed\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
