// Self-test for the plugin's AudioProcessor. It drives processBlock the way a
// host would, without the VST3 wrapper. Prints one line per check and exits
// non-zero if any check fails.
//
//   ctest --test-dir build/vst3 --output-on-failure

#include "BeatFile.h"
#include "HeapTrap.h"
#include "LicenseFile.h"
#include "MachineRitm12.h"
#include "Panel/Panel.h"
#include "Panel/StepKeys.h"
#include "PatternMidi.h"
#include "PluginEditor.h"
#include "PluginProcessor.h"
#include "TestLicense.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <bit>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <limits>
#include <memory>
#include <string>
#include <thread>
#include <vector>

namespace {

using boombapbot::plugin::Beat;
using boombapbot::plugin::kAccentVelocity;
using boombapbot::plugin::kEffectLast;
using boombapbot::plugin::kEffectNames;
using boombapbot::plugin::kFreeEffectLast;
using boombapbot::plugin::kVoiceCount;
using boombapbot::plugin::kVoices;
using boombapbot::plugin::Upgrade;
using boombapbot::plugin::VoiceSpec;
using boombapbot::plugin::testing::heldUpgrade;

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

// ---- The window -----------------------------------------------------------------

// Closes a window as a host does: the processor is told before it goes.
struct WindowCloser {
  void operator()(juce::AudioProcessorEditor* window) const {
    if (window == nullptr) return;
    window->processor.editorBeingDeleted(window);
    delete window;
  }
};

using Window = std::unique_ptr<juce::AudioProcessorEditor, WindowCloser>;

// The window with the panel drawn here in it, whichever window the build gives a host.
Window open(juce::AudioProcessor& processor) {
  return Window(new BoombapbotEditor(dynamic_cast<BoombapbotAudioProcessor&>(processor)));
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
// the ones about the sound thread uses one. A processor here is handed its
// upgrade, or none: no check reads the license file of the machine it runs on.
std::unique_ptr<juce::AudioProcessor> makeProcessor(double rate, int blockSize, Clock clock = Clock::offline,
                                                    Upgrade upgrade = {}) {
  std::unique_ptr<juce::AudioProcessor> processor(new BoombapbotAudioProcessor(std::move(upgrade)));
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
                   const std::vector<Setting>& settings = {}, const Upgrade& upgrade = {}) {
  const std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(rate, blockSize, Clock::offline, upgrade);
  for (const Setting& setting : settings) set(*processor, setting);
  return render(*processor, events, totalFrames, blockSize);
}

// ---- Measurements -----------------------------------------------------------

// The checks that read every sample of a render compare the samples' bits, as
// whole numbers, and mean by it what == means on floats. On the virtual Mac CI
// runs on, as x86_64 under Rosetta, a comparison of two floats says now and
// then that two samples with the same bits differ: about once in three
// thousand million, which failed one run of this self-test in a few dozen.
// The same memory compared as bytes, in the same runs, never differed.
constexpr std::uint32_t kSignBit = 0x80000000u;
constexpr std::uint32_t kInfinityBits = 0x7f800000u;

std::uint32_t bitsOf(float sample) { return std::bit_cast<std::uint32_t>(sample); }

bool isZero(float value) { return (bitsOf(value) & ~kSignBit) == 0; }

// As == on floats: the same bits and a number, or zero and zero of either sign.
bool sameSample(float a, float b) {
  const std::uint32_t left = bitsOf(a);
  const std::uint32_t right = bitsOf(b);
  if (((left | right) & ~kSignBit) == 0) return true;
  return left == right && (left & ~kSignBit) <= kInfinityBits;
}

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
    if (!sameSample(a[i], b[i])) return static_cast<int>(i);
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

  std::unique_ptr<juce::AudioProcessor> early(new BoombapbotAudioProcessor(Upgrade{}));
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
  for (int kind = 1; kind <= kFreeEffectLast; ++kind) {
    const char* const name = kEffectNames[static_cast<std::size_t>(kind)];
    const float choice = static_cast<float>(kind);
    wet.push_back(renderFresh(rate, blockSize, hit, total, {{"effect_kind", choice}, {"effect_mix", 0.6f}}));
    check(!identical(dry, wet.back()) && finite(wet.back()) && peak(wet.back()) <= 1.0f, context,
          text("the %s at 0.6 alters the output", name));
    check(identical(dry, renderFresh(rate, blockSize, hit, total, {{"effect_kind", choice}, {"effect_mix", 0.0f}})),
          context, text("the %s with none of it mixed in leaves the output as it was", name));
  }
  check(identical(dry, renderFresh(rate, blockSize, hit, total, {{"effect_kind", 0.0f}, {"effect_mix", 0.6f}})),
        context, "Off with the mix at 0.6 leaves the output as it was");

  // The upgrade's six. Without the upgrade each is a choice that sounds as none.
  const Upgrade upgrade = heldUpgrade();
  check(upgrade.held(), context, "a license file signed for the test is the upgrade");
  const Stereo upgradedDry = renderFresh(rate, blockSize, hit, total, {}, upgrade);
  check(identical(dry, upgradedDry), context, "the upgrade alone changes nothing that is heard");
  for (int kind = kFreeEffectLast + 1; kind <= kEffectLast; ++kind) {
    const char* const name = kEffectNames[static_cast<std::size_t>(kind)];
    const std::vector<Setting> chosen{{"effect_kind", static_cast<float>(kind)}, {"effect_mix", 0.6f}};
    check(identical(dry, renderFresh(rate, blockSize, hit, total, chosen)), context,
          text("without the upgrade, the %s at 0.6 renders the same samples as Off", name));
    wet.push_back(renderFresh(rate, blockSize, hit, total, chosen, upgrade));
    check(!identical(dry, wet.back()) && finite(wet.back()) && peak(wet.back()) <= 1.0f, context,
          text("with the upgrade, the %s at 0.6 alters the output", name));
    check(identical(dry, renderFresh(rate, blockSize, hit, total,
                                     {{"effect_kind", static_cast<float>(kind)}, {"effect_mix", 0.0f}}, upgrade)),
          context, text("with the upgrade, the %s with none of it mixed in leaves the output as it was", name));
  }
  bool distinct = true;
  for (std::size_t a = 0; a < wet.size(); ++a) {
    for (std::size_t b = a + 1; b < wet.size(); ++b) distinct = distinct && !identical(wet[a], wet[b]);
  }
  check(wet.size() == static_cast<std::size_t>(kEffectLast) && distinct, context,
        "no two of the ten effects render the same samples");

  // A host that automates the choice while the plugin plays, and a state recalled.
  const std::vector<Setting> pump{{"effect_kind", static_cast<float>(SNARE_EFFECT_PUMP)}, {"effect_mix", 0.6f}};
  const std::unique_ptr<juce::AudioProcessor> without = makeProcessor(rate, blockSize);
  const std::unique_ptr<juce::AudioProcessor> with = makeProcessor(rate, blockSize, Clock::offline, upgrade);
  for (const auto* processor : {&without, &with}) {
    render(**processor, hit, total, blockSize);
    for (const Setting& setting : pump) set(**processor, setting);
  }
  const Stereo automatedWithout = render(*without, hit, total, blockSize);
  const std::unique_ptr<juce::AudioProcessor> plain = makeProcessor(rate, blockSize);
  render(*plain, hit, total, blockSize);
  check(identical(automatedWithout, render(*plain, hit, total, blockSize)) && !identical(automatedWithout, render(*with, hit, total, blockSize)),
        context, "an effect of the upgrade chosen while the plugin plays is heard only with the upgrade");

  juce::MemoryBlock state;
  without->getStateInformation(state);
  const std::unique_ptr<juce::AudioProcessor> recalledWithout = makeProcessor(rate, blockSize);
  const std::unique_ptr<juce::AudioProcessor> recalledWith = makeProcessor(rate, blockSize, Clock::offline, upgrade);
  recalledWithout->setStateInformation(state.getData(), static_cast<int>(state.getSize()));
  recalledWith->setStateInformation(state.getData(), static_cast<int>(state.getSize()));
  check(juce::exactlyEqual(valueOf(*recalledWithout, "effect_kind"), static_cast<float>(SNARE_EFFECT_PUMP)) &&
            identical(dry, render(*recalledWithout, hit, total, blockSize)) &&
            identical(wet[SNARE_EFFECT_PUMP - 1], render(*recalledWith, hit, total, blockSize)),
        context, "a state saved without the upgrade keeps the choice: recalled it is silent of the effect without, and plays it with");
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
    // Where the two part, if they do, and by how much.
    const int partedLeft = firstDifference(bySequencer.left, byNotes.left);
    const int partedRight = firstDifference(bySequencer.right, byNotes.right);
    float widest = 0.0f;
    for (std::size_t frame = 0; frame < std::min(bySequencer.right.size(), byNotes.right.size()); ++frame) {
      widest = std::max({widest, std::abs(bySequencer.left[frame] - byNotes.left[frame]),
                         std::abs(bySequencer.right[frame] - byNotes.right[frame])});
    }
    check(!hits.empty() && peak(bySequencer) > kAudible && identical(bySequencer, byNotes), context,
          text("%s: two measures on a playing host land every one of %d hits on the engine's own frame "
               "(first difference: left frame %d, right frame %d; widest %.3g; peak %.4f; %d and %d frames)",
               entry.name, static_cast<int>(hits.size()), partedLeft, partedRight, static_cast<double>(widest),
               static_cast<double>(peak(bySequencer)), static_cast<int>(bySequencer.right.size()),
               static_cast<int>(byNotes.right.size())));
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

// ---- A host that misbehaves, run once -----------------------------------------

// A host is someone else's program. Whatever it says about time, and whatever
// size of block it asks for, the plugin has to answer with sound in range and
// come back. Run under the undefined-behaviour sanitizer, this is also where a
// number too large to turn into a step would be caught.
void testHostileHost() {
  const std::string context = "hostile host";
  constexpr double rate = 48000.0;

  class OddClock final : public juce::AudioPlayHead {
   public:
    juce::Optional<PositionInfo> getPosition() const override {
      PositionInfo position;
      position.setBpm(bpm);
      position.setPpqPosition(beat);
      position.setIsPlaying(true);
      return position;
    }
    double bpm = 120.0;
    double beat = 0.0;
  };

  const std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(rate, 512, Clock::realtime);
  plugin(*processor).loadBeat(fourPatterns());
  set(*processor, {"pattern", 1.0f});
  set(*processor, {"effect_mix", 0.6f});
  OddClock clock;
  processor->setPlayHead(&clock);

  const double infinity = std::numeric_limits<double>::infinity();
  const std::array<double, 16> beats{{0.0, -1.0e6, 1.0e9, -1.0e9, 1.0e9 + 1.0, 1.0e15, 9.0e18, 1.0e300, -1.0e300,
                                      infinity, -infinity, std::nan(""), 4.0, 3.999999999, 1.0e-300, -0.0}};
  const std::array<double, 9> tempos{{120.0, 0.0, -50.0, 1.0e-9, 1.0e9, infinity, std::nan(""), 39.999, 300.001}};
  const std::array<int, 7> sizes{{0, 1, 2, 63, 512, 4096, 8192}};

  juce::MidiBuffer notes;
  for (const VoiceSpec& voice : kVoices) notes.addEvent(noteOn(0, voice.gmNote, 127).bytes.data(), 3, 0);
  notes.addEvent(noteOn(0, kKick, 127).bytes.data(), 3, 100000);  // far past the end of any block
  notes.addEvent(noteOn(0, kKick, 127).bytes.data(), 3, -5);

  bool inRange = true;
  int blocks = 0;
  juce::AudioBuffer<float> buffer(2, 8192);
  juce::MidiBuffer midi;
  midi.ensureSize(1024);
  const juce::int64 started = juce::Time::currentTimeMillis();
  for (const double beat : beats) {
    for (const double tempo : tempos) {
      for (const int size : sizes) {
        clock.beat = beat;
        clock.bpm = tempo;
        buffer.setSize(2, size, false, false, true);
        buffer.clear();
        midi.clear();
        midi.addEvents(notes, -10, 200000, 0);
        processor->processBlock(buffer, midi);
        for (int channel = 0; channel < 2 && size > 0; ++channel) {
          const juce::Range<float> range = juce::FloatVectorOperations::findMinAndMax(buffer.getReadPointer(channel), size);
          inRange = inRange && std::isfinite(range.getStart()) && std::isfinite(range.getEnd()) &&
                    range.getStart() >= -1.0f && range.getEnd() <= 1.0f;
        }
        ++blocks;
      }
    }
  }
  const juce::int64 took = juce::Time::currentTimeMillis() - started;
  processor->setPlayHead(nullptr);
  check(inRange, context,
        text("%d blocks of every size from 0 to 8192 frames, at positions and tempos no song has, give sound in range",
             blocks));
  check(took < 20000, context, text("and none of them keeps the audio thread (%d ms for all)", static_cast<int>(took)));

  // After all that the plugin still plays in time.
  Transport transport;
  const std::unique_ptr<juce::AudioProcessor> fresh = makeBeatProcessor(rate, 512, {fourPatterns(), 1, 0.0f}, true);
  set(*processor, {"swing", 0.0f});
  set(*processor, {"effect_mix", 0.0f});
  set(*fresh, {"effect_mix", 0.0f});
  processor->setNonRealtime(true);
  render(*processor, {}, framesFor(30.0, rate), 512);
  const int total = measureFrames(rate);
  check(identical(renderPlaying(*processor, transport, 0.0, {}, total, 512, rate),
                  renderPlaying(*fresh, transport, 0.0, {}, total, 512, rate)),
        context, "and afterwards it plays a measure the same as a plugin that never met that host");
}

// ---- The audio thread at work, run once -------------------------------------

// What a host and a person do to the plugin while it plays, all at once: the
// audio thread runs realtime blocks with notes, the sequencer and a transport
// that starts, stops, loops and changes tempo; this thread turns knobs between
// blocks; the plugin's sound thread re-synthesises; and a second thread works
// the panel and saves and recalls the state. It is what the heap trap watches,
// and what a build under the thread sanitizer checks for races.
struct BusyRun {
  bool sounded = false;
  int heapCalls = 0;
};

BusyRun runBusyRealtimeBlocks() {
  constexpr double rate = 48000.0;
  constexpr int blockSize = 256;
  constexpr int blocks = 3000;

  // With the upgrade, so that every effect the engine has is switched in on the audio thread.
  const std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(rate, blockSize, Clock::realtime, heldUpgrade());
  BoombapbotAudioProcessor& machine = plugin(*processor);
  machine.loadBeat(fourPatterns());
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

  // The panel, worked from another thread for as long as the blocks run.
  std::atomic<bool> done{false};
  std::thread hands([&] {
    juce::Random random(7);
    juce::MemoryBlock state;
    while (!done.load()) {
      machine.rememberPatterns();
      machine.setStep(random.nextInt(4), random.nextInt(9), random.nextInt(16), random.nextBool());
      machine.audition(random.nextInt(8));
      machine.rollDice(random.nextInt(4), random.nextInt(8), random);
      machine.setMeasureSize(random.nextBool() ? 16 : 12);
      if (random.nextInt(8) == 0) machine.undoPatterns();
      if (random.nextInt(16) == 0) machine.clearPattern(random.nextInt(4));
      machine.selectVoice(random.nextInt(8));
      machine.setBeatName(random.nextBool() ? "one" : "another");
      juce::ignoreUnused(machine.currentBeat(), machine.playingStep(), machine.beatName());
      processor->getStateInformation(state);
      if (random.nextInt(4) == 0) processor->setStateInformation(state.getData(), static_cast<int>(state.getSize()));
      juce::Thread::sleep(1);
    }
  });

  const std::array<Setting, 16> turns{{{"kick_level", 0.3f}, {"tom_pitch", 0.9f}, {"effect_kind", 2.0f},
                                       {"effect_mix", 0.5f}, {"master_volume", 0.6f}, {"snare_mute", 1.0f},
                                       {"accent", 0.2f}, {"swing", 0.7f}, {"pattern", 0.0f}, {"effect_kind", 4.0f},
                                       {"effect_kind", 5.0f}, {"effect_kind", 6.0f}, {"effect_kind", 7.0f},
                                       {"effect_kind", 8.0f}, {"effect_kind", 9.0f}, {"effect_kind", 10.0f}}};
  BusyRun run;
  heaptrap::reset();
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
    run.sounded = run.sounded || buffer.getMagnitude(0, blockSize) > kAudible;
    if (block % 200 == 0) juce::Thread::sleep(20);  // lets the sound thread hand over new sounds
  }
  done.store(true);
  hands.join();
  processor->setPlayHead(nullptr);
  run.heapCalls = heaptrap::calls();
  return run;
}

// A realtime processBlock must not touch the heap: an allocation can wait on
// a lock another thread holds for as long as it likes. The trap counts heap
// calls only while processBlock runs, on the thread that runs it.
//
// Under a sanitizer the allocator is the sanitizer's and there is no trap.
// The blocks still run: they are what the sanitizer is there to watch.
void testAudioThreadAtWork() {
  const std::string context = "audio thread";
  if (!heaptrap::available()) {
    check(runBusyRealtimeBlocks().sounded, context,
          "3000 realtime blocks play while knobs turn, the panel is worked and the state is saved and recalled");
    std::printf("skip [%s] no heap trap in a build under a sanitizer\n", context.c_str());
    return;
  }

  const bool sees = heaptrap::seesTheHeap();
  check(sees, context, "the trap counts a block taken from the heap and given back under it");
  if (!sees) return;

  // The one block that is allowed the heap: offline, with a sound to make
  // again. The trap has to see it, or its silence below would mean nothing.
  {
    const std::unique_ptr<juce::AudioProcessor> offline = makeProcessor(48000.0, 256);
    set(*offline, {"tom_pitch", 0.9f});
    juce::AudioBuffer<float> block(2, 256);
    juce::MidiBuffer none;
    heaptrap::reset();
    {
      const heaptrap::Watch watch;
      offline->processBlock(block, none);
    }
    check(heaptrap::calls() > 0, context,
          text("an offline block that makes a sound again is seen to use the heap (%d calls)", heaptrap::calls()));
  }

  const BusyRun run = runBusyRealtimeBlocks();
  check(run.sounded && run.heapCalls == 0, context,
        text("3000 realtime blocks with notes, the sequencer, a moving host, knobs turning and the panel worked "
             "from another thread make no heap call on the audio thread (%d seen)",
             run.heapCalls));
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

  // A host sees the same parameters whether or not the machine holds the upgrade.
  const std::unique_ptr<juce::AudioProcessor> upgraded = makeProcessor(48000.0, 512, Clock::offline, heldUpgrade());
  const auto listed = [](juce::AudioProcessor& plugin) {
    juce::StringArray lines;
    for (juce::AudioProcessorParameter* parameter : plugin.getParameters()) {
      lines.add(parameter->getName(64) + " " + juce::String(parameter->getNumSteps()) + " " +
                juce::String(parameter->getDefaultValue()) + " " + parameter->getAllValueStrings().joinIntoString(","));
    }
    return lines;
  };
  const juce::StringArray effects = findParameter(*processor, "effect_kind")->getAllValueStrings();
  check(listed(*processor) == listed(*upgraded) && effects.size() == static_cast<int>(kEffectNames.size()) &&
            effects[kFreeEffectLast] == "Chorus" && effects[kEffectLast] == "Phaser",
        context,
        text("with and without the upgrade the parameters are the same, and Effect lists its %d choices: %s",
             effects.size(), effects.joinIntoString(", ").toRawUTF8()));
  check(plugin(*upgraded).holdsUpgrade() && !plugin(*processor).holdsUpgrade() &&
            upgraded->getTailLengthSeconds() >= processor->getTailLengthSeconds(),
        context, "the tail with the upgrade is no shorter than without");
  check(processor->getTailLengthSeconds() > 1.0, context,
        text("the tail covers the longest sound and effect (%.2f s)", processor->getTailLengthSeconds()));

  const Window editor = open(*processor);
  check(processor->hasEditor() && editor != nullptr && editor->getWidth() > 0 && editor->getHeight() > 0, context,
        "the plugin opens a window");
}

// ---- The panel, run once ----------------------------------------------------

// One row of a pattern as the plugin holds it: bit n is step n.
boombapbot::plugin::StepRow rowOf(const BoombapbotAudioProcessor& machine, int pattern, int row) {
  boombapbot::plugin::StepRow steps = 0;
  for (int step = 0; step < boombapbot::plugin::kSteps; ++step) {
    if (machine.stepOn(pattern, row, step)) steps = static_cast<boombapbot::plugin::StepRow>(steps | (1u << step));
  }
  return steps;
}

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
  const Window window = open(*processor);
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

  steps->mouseDown(mouseAt(*steps, centre(3, 9), centre(3, 9), false));
  steps->mouseDrag(mouseAt(*steps, centre(3, 11), centre(3, 9), true));
  const bool wrote = machine.stepOn(0, 2, 9) && machine.stepOn(0, 2, 11);
  check(wrote && press(*window, "Undo") && !machine.stepOn(0, 2, 9) && !machine.stepOn(0, 2, 11), context,
        "the undo key takes back a press and drag on the step keys in one go");
  check(press(*window, "Dice") && press(*window, "Undo") && rowOf(machine, 0, 7) == 0, context,
        "the dice key throws for the voice the panel is on, and undo takes the throw back");
  check(dynamic_cast<juce::Button*>(titled(*window, "Pattern as MIDI")) != nullptr &&
            dynamic_cast<juce::Button*>(titled(*window, "Save beat")) != nullptr &&
            dynamic_cast<juce::Button*>(titled(*window, "Load beat")) != nullptr,
        context, "the panel has its load, save and MIDI keys");

  machine.setStep(9, 0, 0, true);
  machine.setStep(0, 12, 0, true);
  machine.setStep(0, 0, 16, true);
  machine.setMeasureSize(7);
  machine.audition(40);
  check(!machine.stepOn(0, 0, 0) && machine.measureSize() == 16 && finite(render(*processor, {}, 2048, blockSize)),
        context, "steps, sizes and voices the machine does not have are turned down");
}

// ---- The window's size, run once ---------------------------------------------

void testWindowSize() {
  const std::string context = "window";
  constexpr int width = BoombapbotPanel::kWidth;
  constexpr int height = BoombapbotPanel::kHeight;
  const std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(48000.0, 512);
  BoombapbotAudioProcessor& machine = plugin(*processor);

  Window window = open(*processor);
  check(window->getWidth() == width && window->getHeight() == height && window->isResizable(), context,
        text("the window opens at the panel's own size, %d by %d, and can be resized (%d by %d, scale %.3f)", width,
             height, window->getWidth(), window->getHeight(), static_cast<double>(machine.windowScale())));

  window->setSize(width * 3 / 2, height * 3 / 2);
  juce::Component* const panel = window->getChildComponent(0);
  const bool panelScaled = panel != nullptr && panel->getWidth() == width && panel->getHeight() == height &&
                           std::abs(panel->getTransform().mat00 - 1.5f) < 1e-4f &&
                           std::abs(panel->getTransform().mat11 - 1.5f) < 1e-4f;
  check(panelScaled && std::abs(machine.windowScale() - 1.5f) < 1e-4f, context,
        "made half as large again, it shows the same panel through a scale of 1.5");

  window.reset();
  window = open(*processor);
  check(window->getWidth() == width * 3 / 2 && window->getHeight() == height * 3 / 2, context,
        "closed and opened again, it comes back at the size it was left");

  juce::MemoryBlock saved;
  processor->getStateInformation(saved);
  const std::unique_ptr<juce::AudioProcessor> recalled = makeProcessor(48000.0, 512);
  recalled->setStateInformation(saved.getData(), static_cast<int>(saved.getSize()));
  const Window reopened = open(*recalled);
  check(reopened->getWidth() == width * 3 / 2, context, "and so does the window of a plugin recalled from its state");

  machine.setWindowScale(9.0f);
  const bool heldAtMost = juce::exactlyEqual(machine.windowScale(), boombapbot::plugin::kWindowScaleMost);
  machine.setWindowScale(0.01f);
  check(heldAtMost && juce::exactlyEqual(machine.windowScale(), boombapbot::plugin::kWindowScaleLeast), context,
        text("the scale is held between %.1f and %.1f", static_cast<double>(boombapbot::plugin::kWindowScaleLeast),
             static_cast<double>(boombapbot::plugin::kWindowScaleMost)));
}

// ---- The dice and the undo, run once ----------------------------------------

void testDiceAndUndo() {
  const std::string context = "dice and undo";
  constexpr int tom = 5;
  const std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(48000.0, 512);
  BoombapbotAudioProcessor& machine = plugin(*processor);
  machine.loadBeat(fourPatterns());
  const juce::MemoryBlock loaded = [&] {
    juce::MemoryBlock block;
    processor->getStateInformation(block);
    return block;
  }();

  // Many throws, counted: how often each kind of step gets a hit.
  juce::Random random(12);
  constexpr int throws = 4000;
  std::array<int, boombapbot::plugin::kSteps> hits{};
  bool othersLeft = true;
  const boombapbot::plugin::StepRow kick = rowOf(machine, 1, 0);
  for (int count = 0; count < throws; ++count) {
    machine.rollDice(1, tom, random);
    for (int step = 0; step < boombapbot::plugin::kSteps; ++step) hits[static_cast<std::size_t>(step)] += machine.stepOn(1, tom, step);
    othersLeft = othersLeft && rowOf(machine, 1, 0) == kick;
  }
  const auto share = [&](int step) { return static_cast<double>(hits[static_cast<std::size_t>(step)]) / throws; };
  check(std::abs(share(0) - 0.55) < 0.03 && std::abs(share(8) - 0.55) < 0.03 && std::abs(share(2) - 0.3) < 0.03 &&
            std::abs(share(7) - 0.14) < 0.03 && othersLeft,
        context,
        text("the dice put a hit on the beat %.0f%% of the time, between beats %.0f%% and off them %.0f%%, as the "
             "site's do, and touch no other voice",
             100.0 * share(0), 100.0 * share(2), 100.0 * share(7)));

  machine.setMeasureSize(12);
  bool pastTheMeasure = false;
  for (int count = 0; count < 200; ++count) {
    machine.rollDice(1, tom, random);
    pastTheMeasure = pastTheMeasure || (rowOf(machine, 1, tom) >> 12) != 0;
  }
  check(!pastTheMeasure, context, "in a twelve-step measure the dice leave the last four steps alone");

  // Every one of those was a step back; the history keeps the last 64.
  int undone = 0;
  while (machine.undoPatterns()) ++undone;
  check(undone == 64 && !machine.canUndoPatterns(), context,
        text("undo walks back through the changes it remembers, 64 at the most (%d taken back)", undone));

  // One at a time, on a new plugin: each kind of change is one step back.
  const std::unique_ptr<juce::AudioProcessor> fresh = makeProcessor(48000.0, 512);
  BoombapbotAudioProcessor& panel = plugin(*fresh);
  check(!panel.canUndoPatterns() && !panel.undoPatterns(), context, "a new plugin has nothing to undo");
  panel.loadBeat(fourPatterns());
  juce::MemoryBlock afterLoad;
  fresh->getStateInformation(afterLoad);
  check(afterLoad == loaded, context, "two plugins given the same beat save the same state");

  const auto backTo = [&](const juce::MemoryBlock& wanted) {
    juce::MemoryBlock now;
    const bool undid = panel.undoPatterns();
    fresh->getStateInformation(now);
    return undid && now == wanted;
  };
  panel.clearPattern(0);
  const bool clearUndone = !panel.stepOn(0, 0, 0) && backTo(afterLoad);
  panel.rollDice(0, tom, random);
  const bool diceUndone = backTo(afterLoad);
  panel.setMeasureSize(12);
  const bool sizeUndone = panel.measureSize() == 12 && backTo(afterLoad);
  // A press and a drag on the step keys: remembered once, when the press began.
  panel.rememberPatterns();
  panel.setStep(0, 2, 5, true);
  panel.setStep(0, 2, 6, true);
  panel.setStep(0, 2, 7, true);
  const bool dragUndone = backTo(afterLoad);
  check(clearUndone && diceUndone && sizeUndone && dragUndone, context,
        "a clear, a throw of the dice, a new measure size and a drag across the step keys are each one step back");

  // Loading a beat is a step back too: the patterns from before come back.
  panel.setStep(3, 0, 1, true);
  panel.loadBeat(fourPatterns());
  check(panel.undoPatterns() && panel.stepOn(3, 0, 1), context,
        "undo after loading a beat brings back the patterns that were there");
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
      {"a beat from a newer version", with([](const juce::var& beat) { put(beat, "schemaVersion", 5); })},
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

  // A beat that names an effect of the upgrade is not refused: it loads with its effect off.
  juce::String leftOut;
  const juce::Result paid = plugin(*processor).loadBeat(fixture("paid-effect.project.json"), &leftOut);
  check(paid.wasOk() && leftOut == "crusher" && plugin(*processor).beatName() == "Paid effect fixture" &&
            std::abs(valueOf(*processor, "effect_kind")) < 1e-6f && std::abs(valueOf(*processor, "kick_pitch") - 0.35f) < 1e-6f,
        context, text("a beat naming an effect of the upgrade loads with its effect off, and says which: %s", leftOut.toRawUTF8()));

  // With the upgrade the same beat keeps its effect, and a beat saved names it.
  using boombapbot::plugin::effectKind;
  using boombapbot::plugin::readBeat;
  using boombapbot::plugin::writeBeat;
  const std::unique_ptr<juce::AudioProcessor> upgraded = makeProcessor(48000.0, 512, Clock::offline, heldUpgrade());
  const juce::Result kept = plugin(*upgraded).loadBeat(fixture("paid-effect.project.json"), &leftOut);
  check(kept.wasOk() && leftOut.isEmpty() && juce::exactlyEqual(valueOf(*upgraded, "effect_kind"), static_cast<float>(SNARE_EFFECT_CRUSHER)) &&
            std::abs(valueOf(*upgraded, "effect_mix") - 0.6f) < 1e-6f,
        context, "with the upgrade, a beat naming the crusher loads with the crusher, and nothing is left out");
  const std::array<const char*, 6> names{{"crusher", "tape", "pump", "filter", "vinyl", "phaser"}};
  for (std::size_t index = 0; index < names.size(); ++index) {
    const int effect = kFreeEffectLast + 1 + static_cast<int>(index);
    set(*upgraded, {"effect_kind", static_cast<float>(effect)});
    const juce::String saved = writeBeat(plugin(*upgraded).currentBeat(), boombapbot::plugin::newBeatStamp());
    const juce::var document = juce::JSON::parse(saved);
    Beat reread;
    const std::unique_ptr<juce::AudioProcessor> again = makeProcessor(48000.0, 512, Clock::offline, heldUpgrade());
    const std::unique_ptr<juce::AudioProcessor> locked = makeProcessor(48000.0, 512);
    juce::String lockedOut;
    check(document["effect"]["kind"].toString() == names[index] && effectKind(effect) == names[index] &&
              readBeat(saved, reread).wasOk() && reread.effect == effect &&
              plugin(*again).loadBeat(saved).wasOk() && juce::exactlyEqual(valueOf(*again, "effect_kind"), static_cast<float>(effect)) &&
              plugin(*locked).loadBeat(saved, &lockedOut).wasOk() && lockedOut == names[index] &&
              juce::exactlyEqual(valueOf(*locked, "effect_kind"), 0.0f),
          context,
          text("a beat saved on the %s names it, loads with it under the upgrade, and loads with it off without", names[index]));
  }
  // Without the upgrade a choice of the upgrade's is still the choice, and a beat saved says so.
  set(*processor, {"effect_kind", static_cast<float>(SNARE_EFFECT_PUMP)});
  const juce::var unplayed = juce::JSON::parse(writeBeat(plugin(*processor).currentBeat(), boombapbot::plugin::newBeatStamp()));
  check(unplayed["effect"]["kind"].toString() == "pump", context,
        "without the upgrade, a beat saved while Effect stands on the pump names the pump");

  // A beat of the version before this one is the same beat.
  const juce::Result versionThree = plugin(*processor).loadBeat(fixture("version-3.project.json"));
  check(versionThree.wasOk() && plugin(*processor).beatName() == "Version 3 fixture" && std::abs(valueOf(*processor, "effect_kind") - 2.0f) < 1e-6f,
        context, "a beat of version 3 loads as it is");

  const juce::Result loaded = plugin(*processor).loadBeat(fourPatterns(), &leftOut);
  check(loaded.wasOk() && leftOut.isEmpty() && plugin(*processor).beatName() == "Four patterns fixture", context,
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

// ---- A pattern as MIDI, run once ---------------------------------------------

struct MidiNote {
  double tick;
  int note;
  int velocity;
  int channel;
};

// The note-ons of a MIDI file's drum track, and what its header and tempo say.
struct ReadMidi {
  bool ok = false;
  int tracks = 0;
  int ticksPerBeat = 0;
  double bpm = 0.0;
  std::vector<MidiNote> notes;
};

ReadMidi readMidi(const juce::MemoryBlock& bytes) {
  ReadMidi read;
  juce::MemoryInputStream stream(bytes, false);
  juce::MidiFile file;
  if (!file.readFrom(stream)) return read;
  read.ok = true;
  read.tracks = file.getNumTracks();
  read.ticksPerBeat = file.getTimeFormat();
  for (int track = 0; track < file.getNumTracks(); ++track) {
    for (const juce::MidiMessageSequence::MidiEventHolder* event : *file.getTrack(track)) {
      const juce::MidiMessage& message = event->message;
      if (message.isTempoMetaEvent()) read.bpm = 60.0 / message.getTempoSecondsPerQuarterNote();
      if (message.isNoteOn()) {
        read.notes.push_back({message.getTimeStamp(), message.getNoteNumber(), message.getVelocity(), message.getChannel()});
      }
    }
  }
  return read;
}

void testPatternAsMidi() {
  const std::string context = "MIDI";
  constexpr double rate = 48000.0;
  constexpr int blockSize = 512;
  using boombapbot::plugin::patternMidiFileName;
  using boombapbot::plugin::plainVelocity;
  using boombapbot::plugin::writePatternMidi;

  // Straight sixteenths at a tempo where a MIDI tick is a whole number of
  // frames, so the file's notes can be put on exact frames.
  const juce::String straight = edited(fourPatterns(), [](const juce::var& beat) {
    put(beat, "swing", 0.0);
    put(beat, "tempo", static_cast<int>(kSequencerBpm));
    put(beat["effect"], "mix", 0.0);
  });
  Beat beat;
  boombapbot::plugin::readBeat(straight, beat);
  const ReadMidi file = readMidi(writePatternMidi(beat, 1));

  int hits = 0;
  for (const boombapbot::plugin::StepRow row : beat.patterns[1].hits) hits += juce::BigInteger(row).countNumberOfSetBits();
  const bool drums = std::all_of(file.notes.begin(), file.notes.end(), [](const MidiNote& note) {
    const bool mapped = std::any_of(kVoices.begin(), kVoices.end(),
                                    [&](const VoiceSpec& voice) { return voice.gmNote == note.note; });
    return mapped && note.channel == 10;
  });
  check(file.ok && file.tracks == 2 && file.ticksPerBeat == SNARE_MIDI_PPQ && std::abs(file.bpm - kSequencerBpm) < 1e-6 &&
            static_cast<int>(file.notes.size()) == hits && drums,
        context,
        text("pattern Б is a two-track MIDI file at the beat's tempo with a note for each of its %d hits, on the "
             "voices' notes on channel 10 (%d notes, %.1f bpm)",
             hits, static_cast<int>(file.notes.size()), file.bpm));

  const int plain = plainVelocity(beat.accent);
  const bool twoLoudnesses = std::all_of(file.notes.begin(), file.notes.end(), [&](const MidiNote& note) {
    const int step = juce::roundToInt(note.tick / (SNARE_MIDI_PPQ / 4.0));
    const bool accented = ((beat.patterns[1].accents >> step) & 1) != 0;
    return note.velocity == (accented ? 127 : plain);
  });
  check(twoLoudnesses && plain == 81, context,
        text("a hit on an accented step is written at 127 and a plain one at %d, as the site writes them", plain));
  check(plainVelocity(0.0f) == kAccentVelocity - 1 && plainVelocity(1.0f) == 51, context,
        text("with the accent knob fully left a plain hit is written at %d, just under what the plugin takes for "
             "an accent",
             kAccentVelocity - 1));

  // The file played back into the plugin is the pattern the sequencer plays.
  const double framesPerTick = framesPerBeat(rate) / SNARE_MIDI_PPQ;
  std::vector<Event> notes;
  for (const MidiNote& note : file.notes) {
    notes.push_back(noteOn(juce::roundToInt(note.tick * framesPerTick), note.note, note.velocity, note.channel));
  }
  Transport transport;
  const int total = measureFrames(rate);
  const Played played{straight, 1, 0.0f};
  check(juce::exactlyEqual(framesPerTick, std::floor(framesPerTick)) &&
            identical(renderPlaying(*makeBeatProcessor(rate, blockSize, played, true), transport, 0.0, {}, total,
                                    blockSize, rate),
                      renderPlaying(*makeBeatProcessor(rate, blockSize, played, false), transport, 0.0, notes, total,
                                    blockSize, rate)),
        context, "its notes played back into the plugin render the same samples as the sequencer playing the pattern");

  // Swing and triplets move the notes as they move the steps.
  Beat swung = beat;
  swung.swing = 0.5f;
  const ReadMidi swungFile = readMidi(writePatternMidi(swung, 1));
  const bool late = std::any_of(swungFile.notes.begin(), swungFile.notes.end(), [](const MidiNote& note) {
    return juce::exactlyEqual(std::fmod(note.tick, SNARE_MIDI_PPQ / 4.0), 30.0);
  });
  Beat triplets = beat;
  triplets.size = 12;
  const ReadMidi tripletFile = readMidi(writePatternMidi(triplets, 1));
  const bool onTriplets = !tripletFile.notes.empty() &&
                          std::all_of(tripletFile.notes.begin(), tripletFile.notes.end(), [](const MidiNote& note) {
                            return juce::exactlyEqual(std::fmod(note.tick, SNARE_MIDI_PPQ / 3.0), 0.0);
                          });
  check(late && onTriplets, context,
        "with swing every second sixteenth is written late, and a twelve-step measure is written in triplets");

  check(writePatternMidi(beat, 4).isEmpty() && writePatternMidi(beat, -1).isEmpty() &&
            readMidi(writePatternMidi(Beat{}, 0)).ok && readMidi(writePatternMidi(Beat{}, 0)).notes.empty(),
        context, "a pattern the beat does not have gives no file, and an empty one a file with no notes");
  check(patternMidiFileName("Sunday at the garage", 1) == "sunday-at-the-garage-2.mid" &&
            patternMidiFileName("", 0) == "boombapbot-beat-1.mid",
        context, "the file is named for the beat and the pattern");
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
                     juce::exactlyEqual(valueOf(*target, "effect_kind"), static_cast<float>(kEffectLast)) &&
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
  testAudioThreadAtWork();
  testHostileHost();
  testSampleRateChange();
  testUnsupportedSampleRate();
  testDescription();
  testPanel();
  testWindowSize();
  testDiceAndUndo();
  testBeatFile();
  testSavingABeat();
  testPatternAsMidi();
  testState();
  testVoicesMatchTheMachine();

  std::printf("%d checks, %d failed\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
