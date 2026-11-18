#ifndef SNARE_FX_H
#define SNARE_FX_H

// The one effect on the mix: an echo, a reverb, a flanger or a chorus, added
// to the dry signal ahead of the limiter.
//
// Rules it keeps, so that it changes nothing the engine promises:
//   - every buffer is allocated when the engine is made, never in render;
//   - state moves one sample at a time, so output does not depend on how the
//     host cuts its buffers;
//   - no call into the C library's maths per sample: modulation comes from a
//     polynomial sine and an integer phase, so native and WebAssembly agree;
//   - switched off, it does not touch the samples at all.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

#include "boombapbot/engine.h"

namespace snare {

// How long each effect rings after the sound that fed it stops, to -60 dB.
inline double effectTailSeconds(int kind, double bpm) {
  switch (kind) {
    case SNARE_EFFECT_DELAY:
      // Each echo is 0.62 of the last, a dotted eighth later.
      return 14.5 * 0.75 * 60.0 / std::min(300.0, std::max(40.0, bpm));
    case SNARE_EFFECT_REVERB:
      return 1.6;
    case SNARE_EFFECT_FLANGER:
      return 0.12;
    case SNARE_EFFECT_CHORUS:
      return 0.04;
    default:
      return 0.0;
  }
}

class Effect {
 public:
  explicit Effect(double sampleRate) : rate_(static_cast<float>(sampleRate)) {
    std::uint32_t size = 1;
    while (size < static_cast<std::uint32_t>(kLineSeconds * sampleRate)) size <<= 1;
    mask_ = size - 1;
    lineLeft_.assign(size, 0.0f);
    lineRight_.assign(size, 0.0f);
    glide_ = static_cast<float>(1.0 - std::exp(-1.0 / (kGlideSeconds * sampleRate)));
    echoDamping_ = static_cast<float>(1.0 - std::exp(-2.0 * kPi * kEchoDampHz / sampleRate));
    flangerStep_ = phaseStep(kFlangerHz, sampleRate);
    chorusStepSlow_ = phaseStep(kChorusSlowHz, sampleRate);
    chorusStepFast_ = phaseStep(kChorusFastHz, sampleRate);
    for (int i = 0; i < kCombs; ++i) {
      combsLeft_[i].buffer.assign(scaled(kCombTuning[i], sampleRate), 0.0f);
      combsRight_[i].buffer.assign(scaled(kCombTuning[i] + kStereoSpread, sampleRate), 0.0f);
    }
    for (int i = 0; i < kAllpasses; ++i) {
      allpassesLeft_[i].buffer.assign(scaled(kAllpassTuning[i], sampleRate), 0.0f);
      allpassesRight_[i].buffer.assign(scaled(kAllpassTuning[i] + kStereoSpread, sampleRate), 0.0f);
    }
    setTempo(120.0);
    echoNow_ = echoTarget_;
  }

  // Which effect, and how much of it is added to the dry signal (0 to 1).
  // A change of effect fades the old one out before the new one starts.
  void set(int kind, float wet) {
    wanted_ = kind;
    wetWanted_ = kind == SNARE_EFFECT_NONE ? 0.0f : std::min(1.0f, std::max(0.0f, wet));
  }

  // The echo keeps time with the machine: a dotted eighth note.
  void setTempo(double bpm) {
    const double samples = 0.75 * 60.0 / bpm * rate_;
    echoTarget_ = static_cast<float>(std::min(static_cast<double>(mask_ - 2), std::max(1.0, samples)));
  }

  void process(float* left, float* right, int frames, float smoothing) {
    if (kind_ == SNARE_EFFECT_NONE && wanted_ == SNARE_EFFECT_NONE) return;
    for (int i = 0; i < frames; ++i) {
      if (kind_ != wanted_ && wet_ == 0.0f) start(wanted_);
      wet_ = approach(wet_, kind_ == wanted_ ? wetWanted_ : 0.0f, smoothing);
      float wetLeft = 0.0f;
      float wetRight = 0.0f;
      switch (kind_) {
        case SNARE_EFFECT_DELAY:
          echo(left[i], right[i], wetLeft, wetRight);
          break;
        case SNARE_EFFECT_REVERB:
          reverb(left[i], right[i], wetLeft, wetRight);
          break;
        case SNARE_EFFECT_FLANGER:
          flanger(left[i], right[i], wetLeft, wetRight);
          break;
        case SNARE_EFFECT_CHORUS:
          chorus(left[i], right[i], wetLeft, wetRight);
          break;
        default:
          break;
      }
      left[i] += wet_ * wetLeft;
      right[i] += wet_ * wetRight;
    }
  }

 private:
  static constexpr double kPi = 3.14159265358979323846;
  static constexpr double kLineSeconds = 1.5;
  static constexpr double kGlideSeconds = 0.08;
  static constexpr double kEchoDampHz = 3200.0;
  static constexpr float kEchoHop = 0.62f;
  static constexpr double kFlangerHz = 0.22;
  static constexpr float kFlangerFeedback = 0.6f;
  static constexpr double kChorusSlowHz = 0.7;
  static constexpr double kChorusFastHz = 0.93;
  static constexpr float kSettled = 1e-5f;
  static constexpr float kQuiet = 1e-15f;
  static constexpr int kCombs = 8;
  static constexpr int kAllpasses = 4;
  // Delay lengths in samples at 44.1 kHz, as in the reverb they come from.
  static constexpr int kCombTuning[kCombs] = {1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617};
  static constexpr int kAllpassTuning[kAllpasses] = {556, 441, 341, 225};
  static constexpr int kStereoSpread = 23;
  static constexpr float kRoom = 0.84f;
  static constexpr float kDamp = 0.2f;
  static constexpr float kReverbInput = 0.015f;
  static constexpr float kReverbOutput = 1.0f;

  struct Comb {
    std::vector<float> buffer;
    std::size_t index = 0;
    float store = 0.0f;
  };

  struct Allpass {
    std::vector<float> buffer;
    std::size_t index = 0;
  };

  static std::size_t scaled(int samplesAt44100, double sampleRate) {
    return static_cast<std::size_t>((static_cast<std::int64_t>(samplesAt44100) * static_cast<std::int64_t>(sampleRate) + 22050) / 44100);
  }

  static std::uint32_t phaseStep(double hz, double sampleRate) {
    return static_cast<std::uint32_t>(hz / sampleRate * 4294967296.0);
  }

  static float approach(float value, float target, float coefficient) {
    const float next = value + (target - value) * coefficient;
    return std::fabs(target - next) < kSettled ? target : next;
  }

  // sin of a phase that wraps at 2^32, from a polynomial.
  static float sine(std::uint32_t phase) {
    float turn = static_cast<float>(phase) / 4294967296.0f;  // [0, 1)
    if (turn >= 0.5f) turn -= 1.0f;                           // [-0.5, 0.5)
    if (turn > 0.25f) turn = 0.5f - turn;
    if (turn < -0.25f) turn = -0.5f - turn;
    const float x = 6.2831853f * turn;                        // [-pi/2, pi/2]
    const float x2 = x * x;
    return x * (1.0f - x2 / 6.0f * (1.0f - x2 / 20.0f * (1.0f - x2 / 42.0f)));
  }

  // Begins an effect from silence. Old samples in the delay line are left
  // where they are and simply never read again.
  void start(int kind) {
    kind_ = kind;
    validFrom_ = written_;
    echoNow_ = echoTarget_;
    dampLeft_ = 0.0f;
    dampRight_ = 0.0f;
    flangerPhase_ = 0;
    chorusSlow_ = 0;
    chorusFast_ = 0;
    if (kind != SNARE_EFFECT_REVERB) return;
    for (Comb& comb : combsLeft_) clear(comb);
    for (Comb& comb : combsRight_) clear(comb);
    for (Allpass& allpass : allpassesLeft_) std::fill(allpass.buffer.begin(), allpass.buffer.end(), 0.0f);
    for (Allpass& allpass : allpassesRight_) std::fill(allpass.buffer.begin(), allpass.buffer.end(), 0.0f);
  }

  static void clear(Comb& comb) {
    std::fill(comb.buffer.begin(), comb.buffer.end(), 0.0f);
    comb.store = 0.0f;
  }

  // The sample written `back` samples ago, or silence from before the effect began.
  float past(const std::vector<float>& line, std::uint32_t back) const {
    if (back > written_ - validFrom_) return 0.0f;
    return line[static_cast<std::uint32_t>(written_ - back) & mask_];
  }

  // The line a fractional number of samples ago, at least one.
  float tap(const std::vector<float>& line, float delay) const {
    const std::uint32_t whole = static_cast<std::uint32_t>(delay);
    const float fraction = delay - static_cast<float>(whole);
    const float newer = past(line, whole);
    return newer + (past(line, whole + 1) - newer) * fraction;
  }

  void write(float left, float right) {
    const std::uint32_t at = static_cast<std::uint32_t>(written_) & mask_;
    lineLeft_[at] = left;
    lineRight_[at] = right;
    ++written_;
  }

  float milliseconds(float ms) const { return ms * 0.001f * rate_; }

  // Echoes that cross from one side to the other, each quieter and duller.
  void echo(float left, float right, float& wetLeft, float& wetRight) {
    echoNow_ += (echoTarget_ - echoNow_) * glide_;
    wetLeft = tap(lineLeft_, echoNow_);
    wetRight = tap(lineRight_, echoNow_);
    dampLeft_ += (wetLeft - dampLeft_) * echoDamping_;
    dampRight_ += (wetRight - dampRight_) * echoDamping_;
    write(0.5f * (left + right) + dampRight_ * kEchoHop, dampLeft_ * kEchoHop);
  }

  // A short delay swept slowly and fed back on itself.
  void flanger(float left, float right, float& wetLeft, float& wetRight) {
    wetLeft = tap(lineLeft_, milliseconds(4.0f + 3.0f * sine(flangerPhase_)));
    wetRight = tap(lineRight_, milliseconds(4.0f + 3.0f * sine(flangerPhase_ + 0x40000000u)));
    flangerPhase_ += flangerStep_;
    write(left + wetLeft * kFlangerFeedback, right + wetRight * kFlangerFeedback);
  }

  // Two copies a little late, drifting against each other, swapped between the sides.
  void chorus(float left, float right, float& wetLeft, float& wetRight) {
    const float slow = 4.0f * sine(chorusSlow_);
    const float fast = 4.0f * sine(chorusFast_);
    wetLeft = 0.5f * (tap(lineLeft_, milliseconds(16.0f + slow)) + tap(lineLeft_, milliseconds(24.0f + fast)));
    wetRight = 0.5f * (tap(lineRight_, milliseconds(16.0f + fast)) + tap(lineRight_, milliseconds(24.0f - slow)));
    chorusSlow_ += chorusStepSlow_;
    chorusFast_ += chorusStepFast_;
    write(left, right);
  }

  static float ring(Comb& comb, float input) {
    const float output = comb.buffer[comb.index];
    comb.store = output * (1.0f - kDamp) + comb.store * kDamp;
    if (std::fabs(comb.store) < kQuiet) comb.store = 0.0f;
    comb.buffer[comb.index] = input + comb.store * kRoom;
    if (++comb.index == comb.buffer.size()) comb.index = 0;
    return output;
  }

  static float diffuse(Allpass& allpass, float input) {
    const float held = allpass.buffer[allpass.index];
    allpass.buffer[allpass.index] = input + held * 0.5f;
    if (++allpass.index == allpass.buffer.size()) allpass.index = 0;
    return held - input;
  }

  // A room: eight damped combs side by side, then four allpasses in a row.
  void reverb(float left, float right, float& wetLeft, float& wetRight) {
    const float input = (left + right) * kReverbInput;
    float sumLeft = 0.0f;
    float sumRight = 0.0f;
    for (int i = 0; i < kCombs; ++i) {
      sumLeft += ring(combsLeft_[i], input);
      sumRight += ring(combsRight_[i], input);
    }
    for (int i = 0; i < kAllpasses; ++i) {
      sumLeft = diffuse(allpassesLeft_[i], sumLeft);
      sumRight = diffuse(allpassesRight_[i], sumRight);
    }
    wetLeft = sumLeft * kReverbOutput;
    wetRight = sumRight * kReverbOutput;
  }

  const float rate_;
  std::uint32_t mask_ = 0;
  std::vector<float> lineLeft_;
  std::vector<float> lineRight_;
  std::uint64_t written_ = 0;
  std::uint64_t validFrom_ = 0;

  int kind_ = SNARE_EFFECT_NONE;    // the effect sounding
  int wanted_ = SNARE_EFFECT_NONE;  // the effect asked for
  float wet_ = 0.0f;
  float wetWanted_ = 0.0f;

  float glide_ = 1.0f;
  float echoTarget_ = 1.0f;
  float echoNow_ = 1.0f;
  float echoDamping_ = 1.0f;
  float dampLeft_ = 0.0f;
  float dampRight_ = 0.0f;

  std::uint32_t flangerPhase_ = 0;
  std::uint32_t flangerStep_ = 0;
  std::uint32_t chorusSlow_ = 0;
  std::uint32_t chorusFast_ = 0;
  std::uint32_t chorusStepSlow_ = 0;
  std::uint32_t chorusStepFast_ = 0;

  Comb combsLeft_[kCombs];
  Comb combsRight_[kCombs];
  Allpass allpassesLeft_[kAllpasses];
  Allpass allpassesRight_[kAllpasses];
};

}  // namespace snare

#endif
