// Standard MIDI File export: a sequence of measures of different lengths and
// step sizes, on the same tick timeline as playback.

#include <cstdint>
#include <vector>

#include "test_util.h"

using namespace snare::test;

namespace {

struct Note {
  int tick;
  bool on;
  int channel;
  int note;
  int velocity;
};

struct Parsed {
  int format = 0;
  int tracks = 0;
  int ppq = 0;
  int tempoMicros = 0;
  std::vector<int> trackEnds;
  std::vector<std::vector<int>> signatures;  // tick, numerator, denominator power
  std::vector<Note> notes;
};

int be(const std::vector<std::uint8_t>& bytes, std::size_t at, int count) {
  int value = 0;
  for (int i = 0; i < count; ++i) value = (value << 8) | bytes[at + static_cast<std::size_t>(i)];
  return value;
}

Parsed parse(const std::vector<std::uint8_t>& bytes) {
  Parsed parsed;
  parsed.format = be(bytes, 8, 2);
  parsed.tracks = be(bytes, 10, 2);
  parsed.ppq = be(bytes, 12, 2);
  std::size_t position = 14;
  while (position < bytes.size()) {
    const std::size_t end = position + 8 + static_cast<std::size_t>(be(bytes, position + 4, 4));
    std::size_t p = position + 8;
    int tick = 0;
    while (p < end) {
      int delta = 0;
      std::uint8_t byte;
      do {
        byte = bytes[p++];
        delta = (delta << 7) | (byte & 0x7f);
      } while (byte & 0x80);
      tick += delta;
      const std::uint8_t status = bytes[p++];
      if (status == 0xff) {
        const std::uint8_t type = bytes[p++];
        const std::uint8_t size = bytes[p++];
        if (type == 0x51) parsed.tempoMicros = be(bytes, p, 3);
        if (type == 0x58) parsed.signatures.push_back({tick, bytes[p], bytes[p + 1]});
        if (type == 0x2f) parsed.trackEnds.push_back(tick);
        p += size;
      } else {
        parsed.notes.push_back({tick, (status & 0xf0) == 0x90, (status & 0x0f) + 1, bytes[p], bytes[p + 1]});
        p += 2;
      }
    }
    position = end;
  }
  return parsed;
}

std::vector<std::uint8_t> exportFile(const std::vector<SnarePattern>& patterns,
                                     const std::vector<std::uint8_t>& sequence, const std::uint8_t* notes,
                                     double bpm) {
  const int count = static_cast<int>(patterns.size());
  const int measures = static_cast<int>(sequence.size());
  const int size = snare_midi_export(patterns.data(), count, sequence.data(), measures, notes, 90, 127, bpm,
                                     nullptr, 0);
  CHECK(size > 0);
  std::vector<std::uint8_t> bytes(static_cast<std::size_t>(size > 0 ? size : 0));
  CHECK_EQ(snare_midi_export(patterns.data(), count, sequence.data(), measures, notes, 90, 127, bpm,
                             bytes.data(), size),
           size);
  return bytes;
}

const std::uint8_t kNotes[SNARE_TRACKS] = {0, 36, 38, 45, 47, 50, 37, 39, 56, 49, 46, 42};

}  // namespace

SNARE_TEST(one_measure_of_sixteenths) {
  SnarePattern pattern = shape(16);
  pattern.rows[0] = 0b0001;                 // accent on step 1
  pattern.rows[1] = 0b0001'0001'0001'0001;  // kick on the beat
  pattern.rows[11] = 0x8000;                // closed hat on the last step
  const Parsed midi = parse(exportFile({pattern}, {0}, kNotes, 124.0));
  CHECK_EQ(midi.format, 1);
  CHECK_EQ(midi.tracks, 2);
  CHECK_EQ(midi.ppq, SNARE_MIDI_PPQ);
  CHECK_EQ(midi.tempoMicros, static_cast<int>(std::floor(60000000.0 / 124.0 + 0.5)));
  CHECK(midi.trackEnds == (std::vector<int>{1920, 1920}));
  CHECK(midi.signatures == (std::vector<std::vector<int>>{{0, 4, 2}}));
  CHECK_EQ(midi.notes.size(), 10u);

  std::vector<int> kicks;
  for (const Note& note : midi.notes) {
    CHECK_EQ(note.channel, 10);
    if (note.on && note.note == 36) kicks.push_back(note.tick);
  }
  CHECK(kicks == (std::vector<int>{0, 480, 960, 1440}));
  // The accented hit is louder; the last note ends inside the bar.
  CHECK_EQ(midi.notes[0].velocity, 127);
  CHECK_EQ(midi.notes[2].velocity, 90);
  const Note& lastOff = midi.notes.back();
  CHECK(!lastOff.on);
  CHECK_EQ(lastOff.note, 42);
  CHECK_EQ(lastOff.tick, 1860);
}

SNARE_TEST(measures_of_different_lengths_and_step_sizes_follow_each_other) {
  SnarePattern triplets = shape(12, 0, 3);  // four beats of triplets
  triplets.rows[2] = 0b1001'0010'0100;
  SnarePattern waltz = shape(12, 0, 4);     // three beats
  waltz.rows[1] = 0b0001;
  SnarePattern thirtySeconds = shape(16, 16, 8);
  thirtySeconds.rows[9] = (1u << 0) | (1u << 31);
  SnarePattern five = shape(16, 4, 4);      // five beats, using the 2nd part
  five.rows[3] = (1u << 15) | (1u << 16) | (1u << 19);
  const Parsed midi = parse(exportFile({triplets, waltz, thirtySeconds, five}, {0, 1, 1, 2, 3}, kNotes, 120.0));

  // 4 + 3 + 3 + 4 + 5 beats.
  CHECK(midi.trackEnds == (std::vector<int>{19 * 480, 19 * 480}));
  CHECK(midi.signatures ==
        (std::vector<std::vector<int>>{{0, 4, 2}, {1920, 3, 2}, {4800, 4, 2}, {6720, 5, 2}}));

  std::vector<int> ons;
  for (const Note& note : midi.notes) {
    if (note.on) ons.push_back(note.tick);
  }
  CHECK(ons == (std::vector<int>{
                   320, 800, 1280, 1760,   // triplet steps 2, 5, 8 and 11, 160 ticks each
                   1920, 3360,              // the waltz twice
                   4800, 4800 + 31 * 60,    // first and last thirty-second
                   6720 + 15 * 120, 6720 + 16 * 120, 6720 + 19 * 120}));
}

SNARE_TEST(the_second_part_follows_a_short_first_part) {
  SnarePattern pattern = shape(3, 2);
  pattern.rows[1] = (1u << 2) | (1u << 16) | (1u << 17) | (1u << 5);  // step 6 of the 1st part is not played
  const Parsed midi = parse(exportFile({pattern}, {0}, kNotes, 120.0));
  std::vector<int> ons;
  for (const Note& note : midi.notes) {
    if (note.on) ons.push_back(note.tick);
  }
  CHECK(ons == (std::vector<int>{240, 360, 480}));
  CHECK(midi.trackEnds == (std::vector<int>{600, 600}));
  CHECK(midi.signatures == (std::vector<std::vector<int>>{{0, 5, 4}}));  // five sixteenths
}

SNARE_TEST(a_measure_with_no_meter_gets_no_time_signature) {
  SnarePattern pattern = shape(7, 0, 3);  // seven triplet eighths
  pattern.rows[1] = 1;
  const Parsed midi = parse(exportFile({pattern}, {0}, kNotes, 120.0));
  CHECK(midi.signatures.empty());
  CHECK(midi.trackEnds == (std::vector<int>{1120, 1120}));
}

SNARE_TEST(bad_arguments_are_refused) {
  const SnarePattern pattern = shape(16);
  const SnarePattern broken = shape(0);
  const std::uint8_t sequence[2] = {0, 1};
  std::uint8_t out[16];
  CHECK_EQ(snare_midi_export(nullptr, 1, sequence, 1, kNotes, 90, 127, 120.0, nullptr, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_midi_export(&pattern, 1, nullptr, 1, kNotes, 90, 127, 120.0, nullptr, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_midi_export(&pattern, 1, sequence, 1, nullptr, 90, 127, 120.0, nullptr, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_midi_export(&pattern, 1, sequence, 0, kNotes, 90, 127, 120.0, nullptr, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_midi_export(&pattern, 1, sequence, 2, kNotes, 90, 127, 120.0, nullptr, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_midi_export(&broken, 1, sequence, 1, kNotes, 90, 127, 120.0, nullptr, 0), SNARE_ERR_BAD_ARGUMENT);
  CHECK_EQ(snare_midi_export(&pattern, 1, sequence, 1, kNotes, 90, 127, 0.0, nullptr, 0), SNARE_ERR_BAD_ARGUMENT);
  // Too small a buffer is not written to, and the size is still reported.
  out[0] = 0xaa;
  CHECK(snare_midi_export(&pattern, 1, sequence, 1, kNotes, 90, 127, 120.0, out, 16) > 16);
  CHECK_EQ(out[0], 0xaa);
}

SNARE_TEST_MAIN()
