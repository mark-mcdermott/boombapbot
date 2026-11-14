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

constexpr int kTicksPerStep = SNARE_MIDI_PPQ / 4;
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

extern "C" {

int32_t snare_midi_step_tick(int step_index, double swing_percent) {
  return static_cast<int32_t>(snare::roundFrame(
      snare::stepTime(step_index, swing_percent) * snare::kTicksPerStep));
}

int32_t snare_midi_export(const uint8_t* velocities, int32_t roles,
                          const uint8_t* notes, double bpm,
                          double swing_percent, uint8_t* out,
                          int32_t capacity) {
  using namespace snare;
  if (!velocities || !notes || roles <= 0 || roles > SNARE_MAX_ROLES) {
    return SNARE_ERR_BAD_ARGUMENT;
  }
  if (!(bpm > 0.0)) return SNARE_ERR_BAD_ARGUMENT;
  bpm = clampBpm(bpm);
  const std::int32_t loopTicks = SNARE_STEPS * kTicksPerStep;

  std::vector<NoteEvent> events;
  for (int step = 0; step < SNARE_STEPS; ++step) {
    const std::int32_t tick = snare_midi_step_tick(step, swing_percent);
    for (int role = 0; role < roles; ++role) {
      const std::uint8_t velocity = velocities[role * SNARE_STEPS + step];
      if (velocity == 0) continue;
      const std::uint8_t note = notes[role] & 0x7f;
      const std::uint8_t clamped = velocity > 127 ? 127 : velocity;
      events.push_back({tick, 1, note, clamped});
      events.push_back({std::min(tick + kNoteTicks, loopTicks), 0, note, 0});
    }
  }
  std::stable_sort(events.begin(), events.end(),
                   [](const NoteEvent& a, const NoteEvent& b) {
                     if (a.tick != b.tick) return a.tick < b.tick;
                     return a.on < b.on;
                   });

  // Track 0: tempo map. Its length is one loop so hosts see the right bar.
  Writer tempo;
  tempo.metaText(0, 0x03, "boombapbot");
  const std::uint8_t signature[4] = {4, 2, 24, 8};  // 4/4
  tempo.meta(0, 0x58, signature, 4);
  const auto microseconds =
      static_cast<std::uint32_t>(std::floor(60000000.0 / bpm + 0.5));
  const std::uint8_t tempoData[3] = {
      static_cast<std::uint8_t>(microseconds >> 16),
      static_cast<std::uint8_t>(microseconds >> 8),
      static_cast<std::uint8_t>(microseconds)};
  tempo.meta(0, 0x51, tempoData, 3);
  tempo.meta(static_cast<std::uint32_t>(loopTicks), 0x2f, nullptr, 0);

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
  drums.meta(static_cast<std::uint32_t>(loopTicks - cursor), 0x2f, nullptr, 0);

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
