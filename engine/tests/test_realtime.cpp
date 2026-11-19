// The audio thread must never touch the heap. This suite replaces the global
// allocation functions with counting ones and renders under the heaviest
// conditions the engine has: a full pattern at the fastest tempo, voice
// stealing, kit swaps and a stream of queued commands.

#include <atomic>
#include <cstdlib>
#include <new>
#include <vector>

#include "test_util.h"

namespace {

std::atomic<bool> counting{false};
std::atomic<long> allocations{0};
std::atomic<long> releases{0};

void* countedAllocate(std::size_t size) {
  if (counting.load(std::memory_order_relaxed)) allocations.fetch_add(1, std::memory_order_relaxed);
  void* memory = std::malloc(size == 0 ? 1 : size);
  if (memory == nullptr) throw std::bad_alloc();
  return memory;
}

void countedRelease(void* memory) noexcept {
  if (memory == nullptr) return;
  if (counting.load(std::memory_order_relaxed)) releases.fetch_add(1, std::memory_order_relaxed);
  std::free(memory);
}

}  // namespace

void* operator new(std::size_t size) { return countedAllocate(size); }
void* operator new[](std::size_t size) { return countedAllocate(size); }
void operator delete(void* memory) noexcept { countedRelease(memory); }
void operator delete[](void* memory) noexcept { countedRelease(memory); }
void operator delete(void* memory, std::size_t) noexcept { countedRelease(memory); }
void operator delete[](void* memory, std::size_t) noexcept { countedRelease(memory); }

using namespace snare::test;

namespace {

constexpr double kRate = 48000.0;
constexpr int kBlock = 128;

struct Counted {
  long allocations;
  long releases;
};

// Renders `blocks` buffers with the counters armed only around the render call.
Counted renderCounted(SnareEngine* engine, std::vector<float>& left, std::vector<float>& right,
                      int blocks) {
  const long allocationsBefore = allocations.load();
  const long releasesBefore = releases.load();
  for (int block = 0; block < blocks; ++block) {
    counting.store(true);
    snare_engine_render(engine, left.data(), right.data(), kBlock);
    counting.store(false);
  }
  return {allocations.load() - allocationsBefore, releases.load() - releasesBefore};
}

// Sounds long enough that every hit is still ringing when the next lands.
void giveSounds(SnareEngine* engine, float level) {
  for (int slot = 0; slot < SNARE_SOUNDS; ++slot) {
    giveSound(engine, slot, constant(static_cast<int>(kRate), level), kRate);
  }
}

// Every step of every track of every pattern, thirty-two steps long.
void fillBank(SnareEngine* engine) {
  SnarePattern pattern = shape(16, 16, 8);
  for (std::uint32_t& row : pattern.rows) row = 0xffffffffu;
  for (int index = 0; index < SNARE_PATTERNS; ++index) snare_engine_set_pattern(engine, index, &pattern);
}

}  // namespace

SNARE_TEST(the_counters_see_an_allocation_and_its_release) {
  const long allocationsBefore = allocations.load();
  const long releasesBefore = releases.load();
  counting.store(true);
  // Called directly: a compiler may remove a matched new and delete expression.
  ::operator delete(::operator new(16));
  counting.store(false);
  CHECK_EQ(allocations.load() - allocationsBefore, 1);
  CHECK_EQ(releases.load() - releasesBefore, 1);
}

SNARE_TEST(render_does_not_allocate_while_playing_the_fullest_pattern) {
  SnareEngine* engine = snare_engine_create(kRate);
  giveSounds(engine, 0.1f);
  fillBank(engine);
  snare_engine_set_tempo(engine, SNARE_BPM_MAX);
  snare_engine_play(engine);
  std::vector<float> left(kBlock), right(kBlock);

  const Counted counted = renderCounted(engine, left, right, 2000);
  CHECK_EQ(counted.allocations, 0);
  CHECK_EQ(counted.releases, 0);
  CHECK(snare_engine_current_measure(engine) > 4);
  snare_engine_destroy(engine);
}

SNARE_TEST(render_does_not_allocate_with_any_effect_on_or_changing) {
  SnareEngine* engine = snare_engine_create(kRate);
  giveSounds(engine, 0.1f);
  fillBank(engine);
  snare_engine_play(engine);
  std::vector<float> left(kBlock), right(kBlock);
  long allocated = 0;
  long released = 0;
  for (int effect : {SNARE_EFFECT_DELAY, SNARE_EFFECT_REVERB, SNARE_EFFECT_FLANGER, SNARE_EFFECT_CHORUS,
                     SNARE_EFFECT_CRUSHER, SNARE_EFFECT_TAPE, SNARE_EFFECT_PUMP, SNARE_EFFECT_FILTER,
                     SNARE_EFFECT_VINYL, SNARE_EFFECT_PHASER, SNARE_EFFECT_NONE, SNARE_EFFECT_REVERB}) {
    snare_engine_set_effect(engine, effect, 0.8);
    const Counted counted = renderCounted(engine, left, right, 400);
    allocated += counted.allocations;
    released += counted.releases;
  }
  CHECK_EQ(allocated, 0);
  CHECK_EQ(released, 0);
  snare_engine_destroy(engine);
}

SNARE_TEST(render_does_not_allocate_while_applying_commands) {
  SnareEngine* engine = snare_engine_create(kRate);
  giveSounds(engine, 0.1f);
  snare_engine_enable_event_log(engine, 4096);
  fillBank(engine);
  snare_engine_play(engine);
  std::vector<float> left(kBlock), right(kBlock);
  SnarePattern pattern = shape(5, 3, 6);

  long allocated = 0;
  long released = 0;
  for (int pass = 0; pass < 400; ++pass) {
    // Every kind of queued command, sent from the control side between buffers.
    pattern.rows[pass % SNARE_TRACKS] = static_cast<std::uint32_t>(pass) * 2654435761u;
    snare_engine_set_pattern(engine, pass % SNARE_PATTERNS, &pattern);
    snare_engine_set_step(engine, pass % SNARE_PATTERNS, pass % SNARE_TRACKS, pass % SNARE_MAX_STEPS, pass & 1);
    snare_engine_cue_pattern(engine, (pass * 7) % SNARE_PATTERNS);
    snare_engine_set_tempo(engine, 60.0 + pass % 240);
    snare_engine_set_track(engine, 1 + pass % 11, pass % SNARE_SOUNDS, 0.0f, pass % 3);
    snare_engine_set_track_level(engine, 1 + pass % 11, 0.2 + (pass % 5) * 0.1);
    snare_engine_set_accent(engine, 0.5, 0.5 + (pass % 5) * 0.1);
    snare_engine_set_master_volume(engine, 0.3 + (pass % 5) * 0.1);
    snare_engine_trigger(engine, 1 + pass % 11, pass & 1);
    if (pass % 3 == 0) {
      SnarePanel panel{};
      panel.rhythm = static_cast<std::uint8_t>(pass % SNARE_RHYTHMS);
      panel.variation = static_cast<std::uint8_t>(pass % 3);
      panel.fill_rhythm = static_cast<std::uint8_t>(12 + pass % 4);
      panel.auto_fill = static_cast<std::uint8_t>(pass % 5);
      panel.first_beat_rule = 1;
      snare_engine_set_panel(engine, &panel);
      snare_engine_arm_fill(engine, pass & 1);
    }
    if (pass % 40 == 5) {
      std::uint8_t song[100];
      for (int i = 0; i < 100; ++i) song[i] = static_cast<std::uint8_t>((pass + i) % SNARE_RHYTHMS);
      snare_engine_set_song(engine, song, pass % 80 == 5 ? 100 : 0, 1);
    }
    if (pass % 50 == 10) snare_engine_stop(engine);
    if (pass % 50 == 20) snare_engine_play(engine);
    if (pass % 50 == 30) snare_engine_play_measures(engine, 2);
    const Counted counted = renderCounted(engine, left, right, 4);
    allocated += counted.allocations;
    released += counted.releases;
  }
  CHECK_EQ(allocated, 0);
  CHECK_EQ(released, 0);
  snare_engine_destroy(engine);
}

SNARE_TEST(render_does_not_allocate_or_free_when_sounds_are_replaced) {
  SnareEngine* engine = snare_engine_create(kRate);
  giveSounds(engine, 0.1f);
  fillBank(engine);
  snare_engine_set_tempo(engine, SNARE_BPM_MAX);
  snare_engine_play(engine);
  std::vector<float> left(kBlock), right(kBlock);

  long allocated = 0;
  long released = 0;
  for (int pass = 0; pass < 600; ++pass) {
    // What a knob drag does: one slot gets a new sound, again and again.
    giveSound(engine, pass % 3, constant(static_cast<int>(kRate / 4), 0.1f), kRate);
    if (pass % 7 == 0) snare_engine_set_sound(engine, 5, nullptr);
    if (pass % 11 == 0) giveSounds(engine, 0.05f);
    const Counted counted = renderCounted(engine, left, right, 3);
    allocated += counted.allocations;
    released += counted.releases;
  }
  CHECK_EQ(allocated, 0);
  CHECK_EQ(released, 0);
  snare_engine_destroy(engine);
}

SNARE_TEST(render_does_not_allocate_when_voices_are_stolen) {
  SnareEngine* engine = snare_engine_create(kRate);
  giveSounds(engine, 0.02f);
  std::vector<float> left(kBlock), right(kBlock);
  long allocated = 0;
  long released = 0;
  for (int pass = 0; pass < 2000; ++pass) {
    for (int track = 1; track < SNARE_TRACKS; ++track) snare_engine_trigger(engine, track, 0);
    counting.store(true);
    snare_engine_render(engine, left.data(), right.data(), 2);
    counting.store(false);
  }
  allocated = allocations.load();
  released = releases.load();
  CHECK(snare_engine_stolen_voices(engine) > 0u);
  // Nothing was counted while armed in this case beyond the self-test above.
  CHECK_EQ(allocated, 1);
  CHECK_EQ(released, 1);
  snare_engine_destroy(engine);
}

SNARE_TEST_MAIN()
