#include "HeapTrap.h"

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <cstdlib>
#include <new>
#include <thread>

#if defined(__APPLE__)
#include <malloc/malloc.h>
#endif

namespace {

// The one thread being watched. It is not a thread_local flag because reading
// one can itself allocate, the first time a thread does, and note() runs
// inside the allocator.
std::atomic<std::thread::id> watchedThread{};
std::atomic<int> seen{0};

void note() {
  if (watchedThread.load(std::memory_order_relaxed) == std::this_thread::get_id()) {
    seen.fetch_add(1, std::memory_order_relaxed);
  }
}

void* take(std::size_t size) {
  note();
  return std::malloc(size == 0 ? 1 : size);
}

void* takeAligned(std::size_t size, std::align_val_t alignment) {
  note();
#if defined(_WIN32)
  return _aligned_malloc(size == 0 ? 1 : size, static_cast<std::size_t>(alignment));
#else
  void* block = nullptr;
  const std::size_t boundary = std::max(static_cast<std::size_t>(alignment), sizeof(void*));
  return posix_memalign(&block, boundary, size == 0 ? 1 : size) == 0 ? block : nullptr;
#endif
}

void give(void* block) {
  if (block == nullptr) return;
  note();
  std::free(block);
}

void giveAligned(void* block) {
  if (block == nullptr) return;
  note();
#if defined(_WIN32)
  _aligned_free(block);
#else
  std::free(block);
#endif
}

void* orThrow(void* block) {
  if (block == nullptr) throw std::bad_alloc();
  return block;
}

}  // namespace

// Every new and delete in this program, the plugin's code and JUCE's included.
void* operator new(std::size_t size) { return orThrow(take(size)); }
void* operator new[](std::size_t size) { return orThrow(take(size)); }
void* operator new(std::size_t size, const std::nothrow_t&) noexcept { return take(size); }
void* operator new[](std::size_t size, const std::nothrow_t&) noexcept { return take(size); }
void* operator new(std::size_t size, std::align_val_t alignment) { return orThrow(takeAligned(size, alignment)); }
void* operator new[](std::size_t size, std::align_val_t alignment) { return orThrow(takeAligned(size, alignment)); }
void operator delete(void* block) noexcept { give(block); }
void operator delete[](void* block) noexcept { give(block); }
void operator delete(void* block, std::size_t) noexcept { give(block); }
void operator delete[](void* block, std::size_t) noexcept { give(block); }
void operator delete(void* block, const std::nothrow_t&) noexcept { give(block); }
void operator delete[](void* block, const std::nothrow_t&) noexcept { give(block); }
void operator delete(void* block, std::align_val_t) noexcept { giveAligned(block); }
void operator delete[](void* block, std::align_val_t) noexcept { giveAligned(block); }
void operator delete(void* block, std::size_t, std::align_val_t) noexcept { giveAligned(block); }
void operator delete[](void* block, std::size_t, std::align_val_t) noexcept { giveAligned(block); }

#if defined(__APPLE__)

// The C heap too, for code in this program that calls it by name, as JUCE's
// buffers do. A program's own definitions of these are the ones its code
// reaches; the system's libraries keep using theirs, and both end in the same
// zones, so a block from one can be given back through the other.
extern "C" {

void* malloc(std::size_t size) {
  note();
  return malloc_zone_malloc(malloc_default_zone(), size);
}

void* calloc(std::size_t count, std::size_t size) {
  note();
  return malloc_zone_calloc(malloc_default_zone(), count, size);
}

void* realloc(void* block, std::size_t size) {
  note();
  if (block == nullptr) return malloc_zone_malloc(malloc_default_zone(), size);
  return malloc_zone_realloc(malloc_zone_from_ptr(block), block, size);
}

void free(void* block) {
  if (block == nullptr) return;
  note();
  if (malloc_zone_t* const zone = malloc_zone_from_ptr(block)) malloc_zone_free(zone, block);
}

}  // extern "C"

#endif

namespace heaptrap {

Watch::Watch() { watchedThread.store(std::this_thread::get_id(), std::memory_order_relaxed); }
Watch::~Watch() { watchedThread.store(std::thread::id(), std::memory_order_relaxed); }

// Each block is shown to a volatile pointer, so that no compiler can decide it
// was never needed and leave the heap alone.
bool seesTheHeap() {
  static void* volatile shown = nullptr;
  const int before = calls();
  int expected = 2;
  {
    const Watch watch;
    char* const fromNew = new char[64];
    shown = fromNew;
    delete[] static_cast<char*>(shown);
#if defined(__APPLE__)
    void* const fromMalloc = std::malloc(64);
    if (fromMalloc == nullptr) return false;
    shown = fromMalloc;
    std::free(shown);
    expected += 2;
#endif
  }
  return calls() >= before + expected;
}

int calls() { return seen.load(std::memory_order_relaxed); }

void reset() { seen.store(0, std::memory_order_relaxed); }

}  // namespace heaptrap
