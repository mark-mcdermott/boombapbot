// Standard MIDI File export: structure, event count and timestamps.

#include <cstdint>
#include <string>
#include <vector>

#include "../tools/project_io.h"
#include "test_util.h"

using namespace snare::test;

namespace {

struct MidiEvent {
  std::uint32_t tick;
  std::uint8_t status;
  std::uint8_t data1;
  std::uint8_t data2;
};

struct MidiFile {
  int format = -1;
  int trackCount = 0;
  int ppq = 0;
  std::uint32_t tempoMicros = 0;
  std::uint8_t numerator = 0;
  std::uint8_t denominatorPower = 0;
  std::vector<std::vector<MidiEvent>> tracks;
  std::vector<std::uint32_t> trackEnd;
  bool valid = false;
};

std::uint32_t be(const std::uint8_t* p, int bytes) {
  std::uint32_t value = 0;
  for (int i = 0; i < bytes; ++i) value = (value << 8) | p[i];
  return value;
}

MidiFile parse(const std::vector<std::uint8_t>& bytes) {
  MidiFile file;
  if (bytes.size() < 14 || std::string(bytes.begin(), bytes.begin() + 4) != "MThd") return file;
  file.format = static_cast<int>(be(&bytes[8], 2));
  file.trackCount = static_cast<int>(be(&bytes[10], 2));
  file.ppq = static_cast<int>(be(&bytes[12], 2));
  std::size_t pos = 14;
  while (pos + 8 <= bytes.size()) {
    if (std::string(bytes.begin() + static_cast<long>(pos), bytes.begin() + static_cast<long>(pos) + 4) != "MTrk") return file;
    const std::size_t length = be(&bytes[pos + 4], 4);
    std::size_t p = pos + 8;
    const std::size_t end = p + length;
    if (end > bytes.size()) return file;
    std::vector<MidiEvent> events;
    std::uint32_t tick = 0;
    std::uint32_t endTick = 0;
    while (p < end) {
      std::uint32_t delta = 0;
      std::uint8_t b;
      do {
        b = bytes[p++];
        delta = (delta << 7) | (b & 0x7f);
      } while (b & 0x80);
      tick += delta;
      const std::uint8_t status = bytes[p++];
      if (status == 0xff) {
        const std::uint8_t type = bytes[p++];
        const std::uint8_t size = bytes[p++];
        if (type == 0x51) file.tempoMicros = be(&bytes[p], 3);
        if (type == 0x58) {
          file.numerator = bytes[p];
          file.denominatorPower = bytes[p + 1];
        }
        if (type == 0x2f) endTick = tick;
        p += size;
      } else {
        events.push_back({tick, status, bytes[p], bytes[p + 1]});
        p += 2;
      }
    }
    file.tracks.push_back(events);
    file.trackEnd.push_back(endTick);
    pos = end;
  }
  file.valid = pos == bytes.size();
  return file;
}

std::vector<std::uint8_t> exportProject(const snare::io::Project& project,
                                        const snare::io::Roles& roles) {
  std::vector<std::uint8_t> flat(roles.ids.size() * SNARE_STEPS);
  for (std::size_t role = 0; role < roles.ids.size(); ++role) {
    for (int step = 0; step < SNARE_STEPS; ++step) {
      flat[role * SNARE_STEPS + static_cast<std::size_t>(step)] = project.velocities[role][step];
    }
  }
  const int roleCount = static_cast<int>(roles.ids.size());
  const int size = snare_midi_export(flat.data(), roleCount, roles.gmNotes.data(), project.bpm,
                                     project.swing, nullptr, 0);
  std::vector<std::uint8_t> out(static_cast<std::size_t>(size > 0 ? size : 0));
  const int written = snare_midi_export(flat.data(), roleCount, roles.gmNotes.data(), project.bpm,
                                        project.swing, out.data(), size);
  CHECK_EQ(written, size);
  return out;
}

}  // namespace

SNARE_TEST(fixture_exports_expected_notes) {
  const snare::io::Roles roles = snare::io::loadRoles(SNARE_CONTRACTS_DIR);
  const snare::io::Project project = snare::io::loadProject(
      std::string(SNARE_CONTRACTS_DIR) + "/fixtures/kick-snare-hat.project.json", roles);
  const MidiFile file = parse(exportProject(project, roles));

  CHECK(file.valid);
  CHECK_EQ(file.format, 1);
  CHECK_EQ(file.trackCount, 2);
  CHECK_EQ(file.ppq, SNARE_MIDI_PPQ);
  CHECK_EQ(file.tracks.size(), static_cast<std::size_t>(2));
  if (file.tracks.size() != 2) return;

  // Tempo track: 124 bpm, 4/4, one bar long, no notes.
  CHECK_EQ(file.tempoMicros, static_cast<std::uint32_t>(std::floor(60000000.0 / 124.0 + 0.5)));
  CHECK_EQ(file.numerator, 4);
  CHECK_EQ(file.denominatorPower, 2);
  CHECK(file.tracks[0].empty());
  CHECK_EQ(file.trackEnd[0], 1920u);
  CHECK_EQ(file.trackEnd[1], 1920u);

  // Drum track: one note on and one note off per hit, all on channel 10.
  const auto& drums = file.tracks[1];
  CHECK_EQ(drums.size(), static_cast<std::size_t>(22 * 2));
  int noteOns = 0;
  for (const MidiEvent& event : drums) {
    CHECK_EQ(event.status & 0x0f, 9);
    if ((event.status & 0xf0) != 0x90) continue;
    ++noteOns;
    // Find the step this note belongs to and compare tick, note and velocity.
    bool matched = false;
    for (int step = 0; step < SNARE_STEPS && !matched; ++step) {
      if (static_cast<std::uint32_t>(snare_midi_step_tick(step, project.swing)) != event.tick) continue;
      for (std::size_t role = 0; role < roles.ids.size(); ++role) {
        if (roles.gmNotes[role] == event.data1 && project.velocities[role][step] == event.data2) {
          matched = true;
        }
      }
    }
    CHECK(matched);
  }
  CHECK_EQ(noteOns, 22);
  for (std::size_t i = 1; i < drums.size(); ++i) CHECK(drums[i].tick >= drums[i - 1].tick);
}

SNARE_TEST(ticks_follow_the_playback_timeline) {
  CHECK_EQ(snare_midi_step_tick(0, 50.0), 0);
  CHECK_EQ(snare_midi_step_tick(1, 50.0), 120);
  CHECK_EQ(snare_midi_step_tick(4, 50.0), 480);
  CHECK_EQ(snare_midi_step_tick(15, 50.0), 1800);
  CHECK_EQ(snare_midi_step_tick(1, 75.0), 180);
  CHECK_EQ(snare_midi_step_tick(2, 75.0), 240);
  CHECK_EQ(snare_midi_step_tick(1, 66.6667), 160);
  // The same proportion of a step as the audio scheduler uses.
  for (int step = 0; step < SNARE_STEPS; ++step) {
    CHECK_NEAR(snare_midi_step_tick(step, 58.0) / 120.0, snare_step_time(step, 58.0), 1.0 / 120.0);
  }
}

SNARE_TEST(general_midi_drum_notes) {
  const snare::io::Roles roles = snare::io::loadRoles(SNARE_CONTRACTS_DIR);
  CHECK_EQ(roles.gmNotes[0], 36);
  CHECK_EQ(roles.gmNotes[1], 38);
  CHECK_EQ(roles.gmNotes[2], 42);
  CHECK_EQ(roles.gmNotes[3], 46);

  snare::io::Project project;
  project.bpm = 100.0;
  project.swing = 75.0;
  project.velocities[0][0] = 127;
  project.velocities[3][15] = 1;
  const MidiFile file = parse(exportProject(project, roles));
  CHECK(file.valid);
  if (file.tracks.size() != 2) return;
  const auto& drums = file.tracks[1];
  CHECK_EQ(drums.size(), static_cast<std::size_t>(4));
  if (drums.size() != 4) return;
  CHECK_EQ(drums[0].tick, 0u);
  CHECK_EQ(drums[0].data1, 36);
  CHECK_EQ(drums[0].data2, 127);
  CHECK_EQ(drums[1].status, 0x89);
  // Step 16 with full swing is the last possible note; its off stays in the bar.
  CHECK_EQ(drums[2].tick, 1860u);
  CHECK_EQ(drums[2].data1, 46);
  CHECK_EQ(drums[3].tick, 1920u);
  CHECK_EQ(file.trackEnd[1], 1920u);
}

SNARE_TEST(bad_arguments_are_rejected) {
  const std::uint8_t velocities[SNARE_STEPS] = {};
  const std::uint8_t notes[1] = {36};
  CHECK(snare_midi_export(nullptr, 1, notes, 120, 50, nullptr, 0) < 0);
  CHECK(snare_midi_export(velocities, 0, notes, 120, 50, nullptr, 0) < 0);
  CHECK(snare_midi_export(velocities, 1, notes, 0, 50, nullptr, 0) < 0);
  CHECK(snare_midi_export(velocities, 1, notes, 120, 50, nullptr, 0) > 0);
}

SNARE_TEST_MAIN()
