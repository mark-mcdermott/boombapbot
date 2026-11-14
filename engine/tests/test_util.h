// Tiny test harness: named cases, CHECK macros, non-zero exit on failure.
#pragma once

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <functional>
#include <string>
#include <utility>
#include <vector>

#include "boombapbot/engine.h"

namespace snare::test {

struct Case {
  std::string name;
  std::function<void()> body;
};

inline std::vector<Case>& cases() {
  static std::vector<Case> all;
  return all;
}

inline int& failures() {
  static int count = 0;
  return count;
}

struct Registrar {
  Registrar(const char* name, std::function<void()> body) {
    cases().push_back({name, std::move(body)});
  }
};

inline int runAll() {
  for (const Case& test : cases()) {
    const int before = failures();
    try {
      test.body();
    } catch (const std::exception& error) {
      std::printf("  exception: %s\n", error.what());
      ++failures();
    }
    std::printf("%s %s\n", failures() == before ? "PASS" : "FAIL", test.name.c_str());
  }
  std::printf("%d case(s), %d failure(s)\n", static_cast<int>(cases().size()), failures());
  return failures() == 0 ? 0 : 1;
}

// A sample that holds one value, so sums and fades are easy to reason about.
inline std::vector<float> constant(int frames, float value) {
  return std::vector<float>(static_cast<std::size_t>(frames), value);
}

inline void setVoice(SnareKit* kit, int role, const std::vector<float>& pcm, double rate,
                     float gain = 1.0f, float pan = 0.0f, int choke = 0) {
  const int result = snare_kit_set_voice(kit, role, pcm.data(), static_cast<int>(pcm.size()), 1,
                                         rate, gain, pan, choke);
  if (result != SNARE_OK) {
    std::printf("  snare_kit_set_voice failed: %d\n", result);
    ++failures();
  }
}

inline std::vector<SnareEvent> readEvents(const SnareEngine* engine) {
  std::vector<SnareEvent> events(static_cast<std::size_t>(snare_engine_event_count(engine)));
  if (!events.empty()) {
    snare_engine_read_events(engine, events.data(), static_cast<int>(events.size()));
  }
  return events;
}

}  // namespace snare::test

#define SNARE_TEST(name)                                                    \
  static void name();                                                       \
  static ::snare::test::Registrar registrar_##name(#name, name);            \
  static void name()

#define CHECK(condition)                                                    \
  do {                                                                      \
    if (!(condition)) {                                                     \
      std::printf("  %s:%d CHECK(%s)\n", __FILE__, __LINE__, #condition);   \
      ++::snare::test::failures();                                          \
    }                                                                       \
  } while (0)

#define CHECK_EQ(actual, expected)                                          \
  do {                                                                      \
    const auto a_ = (actual);                                               \
    const auto e_ = (expected);                                             \
    if (!(a_ == e_)) {                                                      \
      std::printf("  %s:%d %s == %s (got %g, want %g)\n", __FILE__, __LINE__, \
                  #actual, #expected, static_cast<double>(a_),              \
                  static_cast<double>(e_));                                 \
      ++::snare::test::failures();                                          \
    }                                                                       \
  } while (0)

#define CHECK_NEAR(actual, expected, tolerance)                             \
  do {                                                                      \
    const double a_ = static_cast<double>(actual);                          \
    const double e_ = static_cast<double>(expected);                        \
    if (!(std::fabs(a_ - e_) <= (tolerance))) {                             \
      std::printf("  %s:%d %s ~ %s (got %g, want %g)\n", __FILE__, __LINE__, \
                  #actual, #expected, a_, e_);                              \
      ++::snare::test::failures();                                          \
    }                                                                       \
  } while (0)

#define SNARE_TEST_MAIN() \
  int main() { return ::snare::test::runAll(); }
