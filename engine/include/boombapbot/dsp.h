#ifndef BOOMBAPBOT_DSP_H
#define BOOMBAPBOT_DSP_H

// What the machines' voices are built from. Everything here keeps to the
// rules that hold native and WebAssembly renders in agreement: arithmetic in
// double, the C library's maths only for working out coefficients, and noise
// from an integer generator.

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace boombapbot::dsp {

constexpr double kPi = 3.14159265358979323846;

inline double lerp(double from, double to, double amount) { return from + (to - from) * amount; }

// Geometric interpolation, for frequencies and times.
inline double sweep(double from, double to, double amount) { return from * std::pow(to / from, amount); }

// Per-sample multiplier for an exponential decay with time constant `seconds`.
inline double decayCoefficient(double seconds, double rate) { return std::exp(-1.0 / (seconds * rate)); }

// sin(2*pi*phase) from a polynomial, so every platform computes the same value.
inline double sine(double phase) {
  double turn = phase - std::floor(phase + 0.5);         // [-0.5, 0.5)
  if (turn > 0.25) turn = 0.5 - turn;
  if (turn < -0.25) turn = -0.5 - turn;
  const double x = 2.0 * kPi * turn;                     // [-pi/2, pi/2]
  const double x2 = x * x;
  return x * (1.0 - x2 / 6.0 * (1.0 - x2 / 20.0 * (1.0 - x2 / 42.0 * (1.0 - x2 / 72.0 * (1.0 - x2 / 110.0)))));
}

// A soft limiter with the shape of tanh, from a rational approximation.
inline double saturate(double x) {
  const double limited = std::min(3.0, std::max(-3.0, x));
  const double squared = limited * limited;
  return limited * (27.0 + squared) / (27.0 + 9.0 * squared);
}

class Noise {
 public:
  explicit Noise(std::uint32_t seed) : state_(seed == 0 ? 0x9e3779b9u : seed) {}
  double next() {
    state_ ^= state_ << 13;
    state_ ^= state_ >> 17;
    state_ ^= state_ << 5;
    return static_cast<double>(state_) / 2147483648.0 - 1.0;
  }

 private:
  std::uint32_t state_;
};

class Biquad {
 public:
  static Biquad lowpass(double hz, double q, double rate) { return make(Kind::Low, hz, q, rate); }
  static Biquad highpass(double hz, double q, double rate) { return make(Kind::High, hz, q, rate); }
  static Biquad bandpass(double hz, double q, double rate) { return make(Kind::Band, hz, q, rate); }

  double process(double input) {
    const double output = b0_ * input + z1_;
    z1_ = b1_ * input - a1_ * output + z2_;
    z2_ = b2_ * input - a2_ * output;
    return output;
  }

 private:
  enum class Kind { Low, High, Band };

  static Biquad make(Kind kind, double hz, double q, double rate) {
    const double w = 2.0 * kPi * std::min(hz, rate * 0.45) / rate;
    const double cosine = std::cos(w);
    const double alpha = std::sin(w) / (2.0 * q);
    const double a0 = 1.0 + alpha;
    Biquad filter;
    if (kind == Kind::Low) {
      filter.b0_ = (1.0 - cosine) / 2.0 / a0;
      filter.b1_ = (1.0 - cosine) / a0;
      filter.b2_ = filter.b0_;
    } else if (kind == Kind::High) {
      filter.b0_ = (1.0 + cosine) / 2.0 / a0;
      filter.b1_ = -(1.0 + cosine) / a0;
      filter.b2_ = filter.b0_;
    } else {
      filter.b0_ = alpha / a0;
      filter.b1_ = 0.0;
      filter.b2_ = -alpha / a0;
    }
    filter.a1_ = -2.0 * cosine / a0;
    filter.a2_ = (1.0 - alpha) / a0;
    return filter;
  }

  double b0_ = 1.0, b1_ = 0.0, b2_ = 0.0, a1_ = 0.0, a2_ = 0.0;
  double z1_ = 0.0, z2_ = 0.0;
};

// A square wave with its edges rounded just enough not to alias.
class Square {
 public:
  Square(double hz, double rate) : step_(hz / rate) {}
  double next() {
    double value = phase_ < 0.5 ? 1.0 : -1.0;
    value += edge(phase_);
    double half = phase_ + 0.5;
    if (half >= 1.0) half -= 1.0;
    value -= edge(half);
    phase_ += step_;
    if (phase_ >= 1.0) phase_ -= 1.0;
    return value;
  }

 private:
  double edge(double t) const {
    if (t < step_) {
      const double x = t / step_;
      return x + x - x * x - 1.0;
    }
    if (t > 1.0 - step_) {
      const double x = (t - 1.0) / step_;
      return x * x + x + x + 1.0;
    }
    return 0.0;
  }

  double step_;
  double phase_ = 0.0;
};

}  // namespace boombapbot::dsp

#endif
