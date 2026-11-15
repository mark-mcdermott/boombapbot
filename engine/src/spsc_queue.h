// Fixed-capacity single-producer single-consumer queue. Wait-free on both
// sides, no allocation after construction.
#pragma once

#include <atomic>
#include <cstddef>

namespace snare {

template <typename T, std::size_t Capacity>
class SpscQueue {
 public:
  bool push(const T& item) {
    const std::size_t head = head_.load(std::memory_order_relaxed);
    const std::size_t next = (head + 1) % (Capacity + 1);
    if (next == tail_.load(std::memory_order_acquire)) return false;
    items_[head] = item;
    head_.store(next, std::memory_order_release);
    return true;
  }

  // Producer side only.
  bool full() const {
    const std::size_t head = head_.load(std::memory_order_relaxed);
    return (head + 1) % (Capacity + 1) == tail_.load(std::memory_order_acquire);
  }

  bool pop(T& out) {
    const std::size_t tail = tail_.load(std::memory_order_relaxed);
    if (tail == head_.load(std::memory_order_acquire)) return false;
    out = items_[tail];
    tail_.store((tail + 1) % (Capacity + 1), std::memory_order_release);
    return true;
  }

 private:
  T items_[Capacity + 1]{};
  std::atomic<std::size_t> head_{0};
  std::atomic<std::size_t> tail_{0};
};

}  // namespace snare
