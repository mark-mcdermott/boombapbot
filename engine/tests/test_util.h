// Tiny test harness: named cases, CHECK macros, non-zero exit on failure.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
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

// Gives a slot a mono sound.
inline void giveSound(SnareEngine* engine, int slot, const std::vector<float>& pcm, double rate) {
  SnareSound* sound = snare_sound_create(static_cast<int>(pcm.size()), 1, rate);
  if (!sound) {
    std::printf("  snare_sound_create failed\n");
    ++failures();
    return;
  }
  std::copy(pcm.begin(), pcm.end(), snare_sound_data(sound));
  snare_engine_set_sound(engine, slot, sound);
}

// An empty pattern of the given shape.
inline SnarePattern shape(int len1, int len2 = 0, int stepsPerBeat = 4) {
  SnarePattern pattern{};
  pattern.len1 = static_cast<std::uint8_t>(len1);
  pattern.len2 = static_cast<std::uint8_t>(len2);
  pattern.steps_per_beat = static_cast<std::uint8_t>(stepsPerBeat);
  return pattern;
}

// Unity gain everywhere, so sample values pass straight through to the output
// until the limiter's knee at 0.8.
inline void makeUnity(SnareEngine* engine) {
  snare_engine_set_accent(engine, 1.0, 1.0);
  snare_engine_set_master_volume(engine, 1.0);
  for (int track = 1; track < SNARE_TRACKS; ++track) {
    snare_engine_set_track(engine, track, track - 1, 0.0f, 0);
    snare_engine_set_track_level(engine, track, 1.0);
  }
}

// The engine applies this before its limiter.
constexpr double kHeadroom = 0.9;

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
