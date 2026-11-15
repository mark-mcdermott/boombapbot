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

SnareKit* makeKit(float level) {
  SnareKit* kit = snare_kit_create();
  for (int role = 0; role < SNARE_MAX_ROLES; ++role) {
    // Long enough that every hit overlaps the next and the pool overflows.
    setVoice(kit, role, constant(static_cast<int>(kRate), level), kRate, 0.2f, 0.0f, role < 2 ? 1 : 0);
  }
  return kit;
}

void fillPattern(SnareEngine* engine) {
  std::vector<std::uint8_t> row(SNARE_STEPS, 100);
  for (int role = 0; role < SNARE_MAX_ROLES; ++role) snare_engine_set_row(engine, role, row.data());
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

SNARE_TEST(render_does_not_allocate_while_playing_and_stealing) {
  SnareEngine* engine = snare_engine_create(kRate);
  snare_engine_commit_kit(engine, makeKit(0.1f));
  fillPattern(engine);
  snare_engine_set_tempo(engine, SNARE_BPM_MAX);
  snare_engine_play(engine);
  std::vector<float> left(kBlock), right(kBlock);

  const Counted counted = renderCounted(engine, left, right, 2000);
  CHECK_EQ(counted.allocations, 0);
  CHECK_EQ(counted.releases, 0);
  CHECK(snare_engine_stolen_voices(engine) > 0);
  snare_engine_destroy(engine);
}

SNARE_TEST(render_does_not_allocate_while_applying_commands) {
  SnareEngine* engine = snare_engine_create(kRate);
  snare_engine_commit_kit(engine, makeKit(0.1f));
  snare_engine_enable_event_log(engine, 4096);
  fillPattern(engine);
  snare_engine_play(engine);
  std::vector<float> left(kBlock), right(kBlock);
  std::vector<std::uint8_t> row(SNARE_STEPS, 0);

  long allocated = 0;
  long released = 0;
  for (int pass = 0; pass < 400; ++pass) {
    // Every kind of queued command, sent from the control side between buffers.
    row[static_cast<std::size_t>(pass % SNARE_STEPS)] = static_cast<std::uint8_t>(1 + pass % 127);
    snare_engine_set_row(engine, pass % SNARE_MAX_ROLES, row.data());
    snare_engine_set_step(engine, pass % SNARE_MAX_ROLES, pass % SNARE_STEPS, pass % 128);
    snare_engine_set_tempo(engine, 60.0 + pass % 240);
    snare_engine_set_swing(engine, 50.0 + pass % 25);
    snare_engine_set_master_gain(engine, 0.3 + (pass % 5) * 0.1);
    snare_engine_trigger(engine, pass % SNARE_MAX_ROLES, 127);
    if (pass % 50 == 10) snare_engine_stop(engine);
    if (pass % 50 == 20) snare_engine_play(engine);
    if (pass % 50 == 30) snare_engine_clear_pattern(engine);
    if (pass % 50 == 40) fillPattern(engine);
    const Counted counted = renderCounted(engine, left, right, 4);
    allocated += counted.allocations;
    released += counted.releases;
  }
  CHECK_EQ(allocated, 0);
  CHECK_EQ(released, 0);
  snare_engine_destroy(engine);
}

SNARE_TEST(render_does_not_allocate_or_free_when_a_kit_is_swapped) {
  SnareEngine* engine = snare_engine_create(kRate);
  snare_engine_commit_kit(engine, makeKit(0.1f));
  fillPattern(engine);
  snare_engine_play(engine);
  std::vector<float> left(kBlock), right(kBlock);

  long allocated = 0;
  long released = 0;
  for (int swap = 0; swap < 20; ++swap) {
    // Building and committing a kit allocates, on the control side only.
    snare_engine_commit_kit(engine, makeKit(0.05f + 0.01f * static_cast<float>(swap)));
    const Counted counted = renderCounted(engine, left, right, 200);
    allocated += counted.allocations;
    released += counted.releases;
    // Replaced kits are freed here, never inside render.
    snare_engine_collect(engine);
  }
  CHECK_EQ(allocated, 0);
  CHECK_EQ(released, 0);
  snare_engine_destroy(engine);
}

SNARE_TEST(render_does_not_allocate_or_free_when_single_sounds_are_replaced) {
  SnareEngine* engine = snare_engine_create(kRate);
  snare_engine_commit_kit(engine, makeKit(0.1f));
  fillPattern(engine);
  snare_engine_set_tempo(engine, SNARE_BPM_MAX);
  snare_engine_play(engine);
  std::vector<float> left(kBlock), right(kBlock);

  long allocated = 0;
  long released = 0;
  for (int pass = 0; pass < 600; ++pass) {
    // What a knob drag does: one slot gets a new sound, again and again.
    SnareSound* sound = snare_sound_create(static_cast<int>(kRate / 4), 1, kRate);
    snare_sound_data(sound)[0] = 0.1f;
    snare_engine_set_sound(engine, pass % 3, sound);
    if (pass % 7 == 0) snare_engine_set_sound(engine, 5, nullptr);
    snare_engine_set_slot(engine, pass % SNARE_MAX_ROLES, 0.2f, 0.0f, pass % 2);
    const Counted counted = renderCounted(engine, left, right, 3);
    allocated += counted.allocations;
    released += counted.releases;
  }
  CHECK_EQ(allocated, 0);
  CHECK_EQ(released, 0);
  snare_engine_destroy(engine);
}

SNARE_TEST_MAIN()
