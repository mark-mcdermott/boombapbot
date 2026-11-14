// Self-test for the plugin's AudioProcessor. It compiles PluginProcessor.cpp
// directly and drives processBlock the way a host would, without the VST3
// wrapper. Prints one line per check and exits non-zero if any check fails.
//
//   ctest --test-dir build/vst3 --output-on-failure

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

int failures = 0;
int checks = 0;

void check(bool passed, const std::string& context, const std::string& what) {
  ++checks;
  if (!passed) ++failures;
  std::printf("%s [%s] %s\n", passed ? "ok  " : "FAIL", context.c_str(), what.c_str());
}

// ---- MIDI -------------------------------------------------------------------

// Notes from packages/contracts/data/roles.json.
struct MappedNote {
  const char* role;
  int note;
};

constexpr std::array<MappedNote, 8> kMappedNotes{{
    {"kick", 36},
    {"snare", 38},
    {"closed_hat", 42},
    {"open_hat", 46},
    {"low_tom", 45},
    {"high_tom", 50},
    {"clap", 39},
    {"cymbal", 49},
}};

constexpr int kKick = 36;
constexpr int kSnare = 38;
constexpr int kClosedHat = 42;
constexpr int kOpenHat = 46;
constexpr int kUnmappedNote = 60;

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

// ---- Rendering --------------------------------------------------------------

struct Stereo {
  std::vector<float> left;
  std::vector<float> right;
};

std::unique_ptr<juce::AudioProcessor> makeProcessor(double rate, int blockSize) {
  std::unique_ptr<juce::AudioProcessor> processor(createPluginFilter());
  processor->setPlayConfigDetails(0, 2, rate, blockSize);
  processor->prepareToPlay(rate, blockSize);
  return processor;
}

// Runs `totalFrames` through the processor in host-sized blocks. Each event is
// handed over in the block that contains its frame, at its offset inside that
// block. The buffer is filled with junk before every call, so anything the
// processor does not write shows up.
Stereo render(juce::AudioProcessor& processor, const std::vector<Event>& events, int totalFrames,
              int blockSize) {
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

Stereo renderFresh(double rate, int blockSize, const std::vector<Event>& events, int totalFrames) {
  const std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(rate, blockSize);
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

int framesFor(double seconds, double rate) { return static_cast<int>(std::lround(seconds * rate)); }

#if defined(__GNUC__) || defined(__clang__)
std::string text(const char* format, ...) __attribute__((format(printf, 1, 2)));
#endif

std::string text(const char* format, ...) {
  char line[256];
  va_list arguments;
  va_start(arguments, format);
  std::vsnprintf(line, sizeof(line), format, arguments);
  va_end(arguments);
  return line;
}

// A hit counts as audible above this peak. The quietest kit voice is far
// louder; exact silence is checked separately as exact zeros.
constexpr float kAudible = 0.001f;

// ---- Audio checks, run for every sample rate and block size -----------------

void testSilenceWithoutMidi(const std::string& context, double rate, int blockSize) {
  const Stereo audio = renderFresh(rate, blockSize, {}, 4 * 512);
  check(allZero(audio), context, "no MIDI gives exact silence on both channels");
}

void testKickAtOffset100(const std::string& context, double rate, int blockSize) {
  const Stereo audio = renderFresh(rate, blockSize, {noteOn(100, kKick, 100, 10)}, 1024);
  check(allZero(audio, 0, 100), context, "kick at frame 100: exact zeros in frames 0..99");
  const int left = firstNonZero(audio.left);
  const int right = firstNonZero(audio.right);
  check(left == 100 && right == 100, context,
        text("kick at frame 100: first non-zero sample at frame 100 (left %d, right %d)", left,
             right));
}

// Two notes inside one block, so processBlock has to split the block twice.
void testTwoNotesInOneBlock(const std::string& context, double rate, int blockSize) {
  constexpr int kickFrame = 10;
  constexpr int snareFrame = 40;
  jassert(snareFrame < blockSize);
  constexpr int total = 1024;

  const Stereo kickOnly = renderFresh(rate, blockSize, {noteOn(kickFrame, kKick, 100)}, total);
  const Stereo snareOnly = renderFresh(rate, blockSize, {noteOn(snareFrame, kSnare, 100)}, total);
  const Stereo both = renderFresh(
      rate, blockSize, {noteOn(kickFrame, kKick, 100), noteOn(snareFrame, kSnare, 100)}, total);

  const int snareAlone = firstNonZero(snareOnly.left);
  check(snareAlone == snareFrame, context,
        text("snare alone at frame %d: first non-zero sample at frame %d", snareFrame, snareAlone));

  const int firstSound = firstNonZero(both.left);
  check(allZero(both, 0, kickFrame) && firstSound == kickFrame, context,
        text("kick at %d + snare at %d in one block: first non-zero sample at frame %d", kickFrame,
             snareFrame, firstSound));

  // Up to the snare the block must be the kick and nothing else; the snare has
  // to change the output from exactly its own frame.
  const int left = firstDifference(both.left, kickOnly.left);
  const int right = firstDifference(both.right, kickOnly.right);
  check(left == snareFrame && right == snareFrame, context,
        text("kick at %d + snare at %d in one block: identical to kick alone before frame %d, "
             "first difference at frame %d (left %d, right %d)",
             kickFrame, snareFrame, snareFrame, snareFrame, left, right));
}

void testMappedNotesSound(const std::string& context, double rate, int blockSize) {
  const int total = framesFor(0.05, rate);
  int channel = 1;
  for (const MappedNote& mapped : kMappedNotes) {
    const Stereo audio = renderFresh(rate, blockSize, {noteOn(0, mapped.note, 100, channel)}, total);
    const float level = peak(audio, 0, total);
    check(level > kAudible, context,
          text("note %d on channel %d (%s) makes sound (peak %.4f)", mapped.note, channel,
               mapped.role, static_cast<double>(level)));
    channel = channel % 16 + 3;  // 1, 4, 7, 10, 13, 16, 3, 6
  }
}

void testIgnoredMessagesAreSilent(const std::string& context, double rate, int blockSize) {
  const int total = framesFor(0.05, rate);
  check(allZero(renderFresh(rate, blockSize, {noteOn(20, kUnmappedNote, 100)}, total)), context,
        text("unmapped note %d gives exact silence", kUnmappedNote));
  check(allZero(renderFresh(rate, blockSize, {noteOff(20, kKick)}, total)), context,
        "note-off for the kick note gives exact silence");
  check(allZero(renderFresh(rate, blockSize, {noteOn(20, kKick, 0)}, total)), context,
        "note-on with velocity 0 for the kick note gives exact silence");
}

// The hats share a choke group in the 808 kit: a closed hat stops a sounding
// open hat.
void testClosedHatChokesOpenHat(const std::string& context, double rate, int blockSize) {
  const int chokeFrame = framesFor(0.05, rate);
  const int settled = chokeFrame + framesFor(0.010, rate);  // well past the choke fade
  const int lateFrom = framesFor(0.20, rate);  // the closed hat itself has ended by here
  const int total = framesFor(0.30, rate);

  const Stereo openOnly = renderFresh(rate, blockSize, {noteOn(0, kOpenHat, 100)}, total);
  const Stereo closedOnly = renderFresh(rate, blockSize, {noteOn(chokeFrame, kClosedHat, 100)}, total);
  const Stereo choked = renderFresh(
      rate, blockSize, {noteOn(0, kOpenHat, 100), noteOn(chokeFrame, kClosedHat, 100)}, total);

  const int beforeChoke = firstDifference(choked.left, openOnly.left);
  check(beforeChoke == chokeFrame, context,
        text("open hat then closed hat at frame %d: identical to the open hat alone until frame %d "
             "(first difference at %d)",
             chokeFrame, chokeFrame, beforeChoke));

  const int leftover = std::max(firstDifference(choked.left, closedOnly.left, settled),
                                firstDifference(choked.right, closedOnly.right, settled));
  check(leftover == -1, context,
        text("10 ms after the closed hat only the closed hat is left: identical to the closed hat "
             "alone from frame %d (first difference at %d)",
             settled, leftover));

  const float chokedLate = peak(choked, lateFrom, total);
  const float openLate = peak(openOnly, lateFrom, total);
  check(allZero(choked, lateFrom, total), context,
        text("choked open hat is exact silence from 0.20 s to 0.30 s (peak %.6f)",
             static_cast<double>(chokedLate)));
  check(openLate > kAudible, context,
        text("un-choked open hat is still sounding from 0.20 s to 0.30 s (peak %.4f)",
             static_cast<double>(openLate)));
}

// ---- Lifecycle and state, run once ------------------------------------------

void testSampleRateChange() {
  const std::string context = "lifecycle";
  const std::unique_ptr<juce::AudioProcessor> processor = makeProcessor(44100.0, 512);
  const Stereo first = render(*processor, {noteOn(100, kKick, 100)}, 1024, 512);
  processor->releaseResources();
  processor->setPlayConfigDetails(0, 2, 96000.0, 64);
  processor->prepareToPlay(96000.0, 64);
  // The engine is rebuilt for the new rate, so nothing rings over from before.
  const Stereo second = render(*processor, {noteOn(100, kKick, 100)}, 1024, 64);
  check(firstNonZero(first.left) == 100 && firstNonZero(second.left) == 100, context,
        text("after re-preparing from 44100 Hz to 96000 Hz a kick at frame 100 still starts at "
             "frame 100 (before %d, after %d)",
             firstNonZero(first.left), firstNonZero(second.left)));
}

void testUnsupportedSampleRate() {
  const std::string context = "lifecycle";
  const Stereo audio = renderFresh(384000.0, 512, {noteOn(100, kKick, 100)}, 1024);
  check(allZero(audio), context, "384000 Hz is outside the engine's range: exact silence, no crash");
}

juce::MemoryBlock saveState(juce::AudioProcessor& processor) {
  juce::MemoryBlock block;
  processor.getStateInformation(block);
  return block;
}

juce::MemoryBlock stateBlob(const juce::String& type, int schemaVersion, const juce::String& kitId) {
  juce::XmlElement xml(type);
  xml.setAttribute("schemaVersion", schemaVersion);
  xml.setAttribute("kitId", kitId);
  juce::MemoryBlock block;
  juce::AudioProcessor::copyXmlToBinary(xml, block);
  return block;
}

void testState() {
  const std::string context = "state";

  const std::unique_ptr<juce::AudioProcessor> source = makeProcessor(48000.0, 512);
  const juce::MemoryBlock saved = saveState(*source);
  check(saved.getSize() > 0, context, text("saved state is not empty (%d bytes)",
                                           static_cast<int>(saved.getSize())));

  const std::unique_ptr<juce::XmlElement> xml =
      juce::AudioProcessor::getXmlFromBinary(saved.getData(), static_cast<int>(saved.getSize()));
  const bool versioned = xml != nullptr && xml->getIntAttribute("schemaVersion") == 1 &&
                         xml->getStringAttribute("kitId") == "808";
  check(versioned, context,
        text("saved state carries schemaVersion 1 and kitId 808: %s",
             xml != nullptr
                 ? xml->toString(juce::XmlElement::TextFormat().singleLine().withoutHeader())
                       .toRawUTF8()
                 : "(not XML)"));

  const std::unique_ptr<juce::AudioProcessor> target = makeProcessor(48000.0, 512);
  target->setStateInformation(saved.getData(), static_cast<int>(saved.getSize()));
  check(saveState(*target) == saved, context, "save -> load -> save is byte-for-byte identical");

  // Each of these must be ignored and leave the saved state as it was.
  const char garbage[] = "\x01\x02 this is not a state blob \xff\xfe";
  const juce::MemoryBlock wrongType = stateBlob("SomeOtherPlugin", 1, "808");
  const juce::MemoryBlock newerSchema = stateBlob("BoombapbotPluginState", 99, "808");
  const juce::MemoryBlock unknownKit = stateBlob("BoombapbotPluginState", 1, "no-such-kit");

  struct Rejected {
    const char* name;
    const void* data;
    int size;
  };
  const std::array<Rejected, 5> rejected{{
      {"garbage bytes", garbage, static_cast<int>(sizeof(garbage))},
      {"an empty block", garbage, 0},
      {"XML of another type", wrongType.getData(), static_cast<int>(wrongType.getSize())},
      {"a newer schemaVersion", newerSchema.getData(), static_cast<int>(newerSchema.getSize())},
      {"an unknown kit id", unknownKit.getData(), static_cast<int>(unknownKit.getSize())},
  }};
  for (const Rejected& input : rejected) {
    target->setStateInformation(input.data, input.size);
    check(saveState(*target) == saved, context,
          text("%s is ignored: saved state is unchanged", input.name));
  }

  const Stereo audio = render(*target, {noteOn(100, kKick, 100)}, 1024, 512);
  check(firstNonZero(audio.left) == 100, context,
        "after the rejected loads the processor still plays a kick at frame 100");
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
      testMappedNotesSound(context, rate, blockSize);
      testIgnoredMessagesAreSilent(context, rate, blockSize);
      testClosedHatChokesOpenHat(context, rate, blockSize);
    }
  }
  testSampleRateChange();
  testUnsupportedSampleRate();
  testState();

  std::printf("%d checks, %d failed\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
