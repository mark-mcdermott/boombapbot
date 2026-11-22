// Self-test for the plugin's AudioProcessor. It drives processBlock the way a
// host would, without the VST3 wrapper. Prints one line per check and exits
// non-zero if any check fails.
//
//   ctest --test-dir build/vst3 --output-on-failure

#include "MachineRitm12.h"
#include "PluginProcessor.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

namespace {

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
  const int expected = kVoiceCount * 4 + 3;
  check(processor->getParameters().size() == expected, context,
        text("the plugin has %d parameters: four knobs for each of %d voices, volume, effect and its mix (%d found)",
             expected, kVoiceCount, processor->getParameters().size()));
  check(processor->getTailLengthSeconds() > 1.0, context,
        text("the tail covers the longest sound and effect (%.2f s)", processor->getTailLengthSeconds()));

  const std::unique_ptr<juce::AudioProcessorEditor> editor(processor->createEditorIfNeeded());
  check(processor->hasEditor() && editor != nullptr && editor->getWidth() > 0 && editor->getHeight() > 0, context,
        "the plugin opens a window");
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
                         restXml->getIntAttribute("schemaVersion") == 1 &&
                         restXml->getStringAttribute("machine") == "ritm12" &&
                         restXml->getNumAttributes() == 2 + untouched->getParameters().size();
  check(versioned, context,
        text("a saved state carries schemaVersion 1, machine ritm12 and every parameter (%d attributes)",
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
  const juce::MemoryBlock newerVersion = with("schemaVersion", "2");
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
  }
  testSoundThreadFollowsKnobs();
  testSampleRateChange();
  testUnsupportedSampleRate();
  testDescription();
  testState();
  testVoicesMatchTheMachine();

  std::printf("%d checks, %d failed\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
