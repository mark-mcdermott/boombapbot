// Standard MIDI File export. Timing comes from the same timeline functions
// as playback, so exported notes line up with what the engine renders.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

#include "boombapbot/engine.h"
#include "timeline.h"

namespace snare {
namespace {

// MIDI ticks in one engine tick. Both divide the quarter note evenly.
constexpr int kMidiPerTick = SNARE_MIDI_PPQ / SNARE_TICKS_PER_BEAT;
constexpr int kNoteTicks = SNARE_MIDI_PPQ / 8;  // a thirty-second note
constexpr std::uint8_t kDrumChannel = 9;        // channel 10

struct NoteEvent {
  std::int32_t tick;
  std::uint8_t on;  // 0 note off, 1 note on; offs sort first at equal ticks
  std::uint8_t note;
  std::uint8_t velocity;
};

class Writer {
 public:
  void byte(std::uint8_t value) { bytes_.push_back(value); }
  void text(const char* value) {
    for (const char* c = value; *c; ++c) byte(static_cast<std::uint8_t>(*c));
  }
  void u16(std::uint32_t value) {
    byte(static_cast<std::uint8_t>(value >> 8));
    byte(static_cast<std::uint8_t>(value));
  }
  void u32(std::uint32_t value) {
    u16(value >> 16);
    u16(value & 0xffff);
  }
  void varLen(std::uint32_t value) {
    std::uint8_t stack[5];
    int count = 0;
    stack[count++] = static_cast<std::uint8_t>(value & 0x7f);
    while ((value >>= 7) != 0) {
      stack[count++] = static_cast<std::uint8_t>((value & 0x7f) | 0x80);
    }
    while (count > 0) byte(stack[--count]);
  }
  void meta(std::uint32_t delta, std::uint8_t type, const std::uint8_t* data,
            std::uint32_t length) {
    varLen(delta);
    byte(0xff);
    byte(type);
    varLen(length);
    for (std::uint32_t i = 0; i < length; ++i) byte(data[i]);
  }
  void metaText(std::uint32_t delta, std::uint8_t type, const char* value) {
    meta(delta, type, reinterpret_cast<const std::uint8_t*>(value),
         static_cast<std::uint32_t>(std::strlen(value)));
  }
  const std::vector<std::uint8_t>& bytes() const { return bytes_; }

 private:
  std::vector<std::uint8_t> bytes_;
};

void appendTrack(Writer& file, const Writer& track) {
  file.text("MTrk");
  file.u32(static_cast<std::uint32_t>(track.bytes().size()));
  for (std::uint8_t b : track.bytes()) file.byte(b);
}

}  // namespace
}  // namespace snare

namespace snare {
namespace {

struct Signature {
  std::int32_t tick;
  std::uint8_t numerator;
  std::uint8_t denominatorPower;
};

// A measure's length as a time signature, when it has one: a 12-step measure
// of eighth-note triplets is 4/4, but seven of those steps are not a meter.
bool signatureOf(int measureTicks, Signature& out) {
  const int units[4] = {SNARE_TICKS_PER_BEAT, SNARE_TICKS_PER_BEAT / 2, SNARE_TICKS_PER_BEAT / 4,
                        SNARE_TICKS_PER_BEAT / 8};
  for (int i = 0; i < 4; ++i) {
    if (measureTicks % units[i] == 0 && measureTicks / units[i] <= 255) {
      out.numerator = static_cast<std::uint8_t>(measureTicks / units[i]);
      out.denominatorPower = static_cast<std::uint8_t>(2 + i);
      return true;
    }
  }
  return false;
}

std::uint8_t velocityOf(std::int32_t value) {
  return static_cast<std::uint8_t>(std::min(127, std::max(1, value)));
}

}  // namespace
}  // namespace snare

extern "C" {

int32_t snare_midi_export(const SnarePattern* patterns, int32_t pattern_count,
                          const uint8_t* sequence, int32_t measures,
                          const uint8_t* track_notes, int32_t plain_velocity,
                          int32_t accent_velocity, double bpm, uint8_t* out,
                          int32_t capacity) {
  using namespace snare;
  if (!patterns || !sequence || !track_notes || pattern_count <= 0 || measures <= 0 || measures > 4096) {
    return SNARE_ERR_BAD_ARGUMENT;
  }
  if (!(bpm > 0.0)) return SNARE_ERR_BAD_ARGUMENT;
  bpm = clampBpm(bpm);

  std::vector<NoteEvent> events;
  std::vector<Signature> signatures;
  std::int32_t measureStart = 0;
  for (int measure = 0; measure < measures; ++measure) {
    if (sequence[measure] >= pattern_count) return SNARE_ERR_BAD_ARGUMENT;
    const SnarePattern& pattern = patterns[sequence[measure]];
    if (!validShape(pattern.len1, pattern.len2, pattern.steps_per_beat)) return SNARE_ERR_BAD_ARGUMENT;
    const int steps = pattern.len1 + pattern.len2;
    const int stepLength = stepTicks(pattern.steps_per_beat) * kMidiPerTick;
    const int measureLength = steps * stepLength;

    Signature signature{measureStart, 0, 0};
    if (signatureOf(measureLength / kMidiPerTick, signature) &&
        (signatures.empty() || signatures.back().numerator != signature.numerator ||
         signatures.back().denominatorPower != signature.denominatorPower)) {
      signatures.push_back(signature);
    }

    for (int played = 0; played < steps; ++played) {
      const std::uint32_t bit = 1u << stepPosition(played, pattern.len1);
      const std::int32_t tick = measureStart + played * stepLength;
      const std::uint8_t velocity =
          velocityOf((pattern.rows[0] & bit) != 0 ? accent_velocity : plain_velocity);
      for (int track = 1; track < SNARE_TRACKS; ++track) {
        if ((pattern.rows[track] & bit) == 0) continue;
        const std::uint8_t note = track_notes[track] & 0x7f;
        events.push_back({tick, 1, note, velocity});
        events.push_back({tick + std::min(kNoteTicks, stepLength), 0, note, 0});
      }
    }
    measureStart += measureLength;
  }
  const std::int32_t endTick = measureStart;
  std::stable_sort(events.begin(), events.end(),
                   [](const NoteEvent& a, const NoteEvent& b) {
                     if (a.tick != b.tick) return a.tick < b.tick;
                     return a.on < b.on;
                   });

  // Track 0: tempo and meter. Its length is the whole piece so hosts see the
  // right number of bars.
  Writer tempo;
  tempo.metaText(0, 0x03, "boombapbot");
  const auto microseconds =
      static_cast<std::uint32_t>(std::floor(60000000.0 / bpm + 0.5));
  const std::uint8_t tempoData[3] = {
      static_cast<std::uint8_t>(microseconds >> 16),
      static_cast<std::uint8_t>(microseconds >> 8),
      static_cast<std::uint8_t>(microseconds)};
  tempo.meta(0, 0x51, tempoData, 3);
  std::int32_t tempoCursor = 0;
  for (const Signature& signature : signatures) {
    const std::uint8_t data[4] = {signature.numerator, signature.denominatorPower, 24, 8};
    tempo.meta(static_cast<std::uint32_t>(signature.tick - tempoCursor), 0x58, data, 4);
    tempoCursor = signature.tick;
  }
  tempo.meta(static_cast<std::uint32_t>(endTick - tempoCursor), 0x2f, nullptr, 0);

  // Track 1: drum notes.
  Writer drums;
  drums.metaText(0, 0x03, "Drums");
  std::int32_t cursor = 0;
  for (const NoteEvent& event : events) {
    drums.varLen(static_cast<std::uint32_t>(event.tick - cursor));
    cursor = event.tick;
    drums.byte(static_cast<std::uint8_t>((event.on ? 0x90 : 0x80) | kDrumChannel));
    drums.byte(event.note);
    drums.byte(event.velocity);
  }
  drums.meta(static_cast<std::uint32_t>(endTick - cursor), 0x2f, nullptr, 0);

  Writer file;
  file.text("MThd");
  file.u32(6);
  file.u16(1);  // format 1
  file.u16(2);  // tracks
  file.u16(SNARE_MIDI_PPQ);
  appendTrack(file, tempo);
  appendTrack(file, drums);

  const auto size = static_cast<int32_t>(file.bytes().size());
  if (out && capacity >= size) std::memcpy(out, file.bytes().data(), file.bytes().size());
  return size;
}

}  // extern "C"
