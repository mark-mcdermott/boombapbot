#ifndef SNARE_FX_H
#define SNARE_FX_H

// The one effect on the mix, ahead of the limiter. An echo, a reverb, a
// flanger, a chorus and vinyl noise are added to the dry signal, and how much
// is the amount asked for. A crusher, tape, a pump, a filter and a phaser
// work on the signal itself; with nothing asked for they pass it untouched,
// so one effect can still fade out before the next begins.
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
    case SNARE_EFFECT_CRUSHER:
      return 0.01;
    case SNARE_EFFECT_TAPE:
      return 0.05;
    case SNARE_EFFECT_PUMP:
      // Nothing rings on, but its gain takes this long to come back up.
      return 0.5;
    case SNARE_EFFECT_FILTER:
      return 0.1;
    case SNARE_EFFECT_VINYL:
      // The noise holds on after the last sound, then fades.
      return 1.6;
    case SNARE_EFFECT_PHASER:
      return 0.15;
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
    crushEvery_ = kCrushHz >= sampleRate;
    crushStep_ = crushEvery_ ? 0 : phaseStep(kCrushHz, sampleRate);
    wowStep_ = phaseStep(kWowHz, sampleRate);
    flutterStep_ = phaseStep(kFlutterHz, sampleRate);
    tapeDamping_ = onePole(kTapeDampHz, sampleRate);
    pumpTone_ = onePole(kPumpToneHz, sampleRate);
    pumpAttack_ = timeConstant(kPumpAttackSeconds, sampleRate);
    pumpRelease_ = timeConstant(kPumpReleaseSeconds, sampleRate);
    pumpFall_ = timeConstant(kPumpFallSeconds, sampleRate);
    pumpCatchUp_ = timeConstant(kPumpCatchUpSeconds, sampleRate);
    filterTop_ = static_cast<float>(std::min(kFilterTopHz, 0.45 * sampleRate) / sampleRate);
    filterFloor_ = static_cast<float>(std::min(kFilterFloorHz, 0.1 * sampleRate) / sampleRate);
    vinylHoldFrames_ = static_cast<std::uint32_t>(kVinylHoldSeconds * sampleRate);
    vinylRise_ = timeConstant(kVinylRiseSeconds, sampleRate);
    vinylFade_ = timeConstant(kVinylFadeSeconds, sampleRate);
    hissTone_ = onePole(kHissHz, sampleRate);
    popDecay_ = static_cast<float>(std::exp(-1.0 / (kPopSeconds * sampleRate)));
    popOdds_ = phaseStep(kPopsPerSecond, sampleRate);
    tickOdds_ = phaseStep(kTicksPerSecond, sampleRate);
    phaserStep_ = phaseStep(kPhaserHz, sampleRate);
    phaserLow_ = static_cast<float>(std::min(kPhaserLowHz, 0.1 * sampleRate) / sampleRate);
    phaserSpan_ = static_cast<float>(std::min(kPhaserHighHz, 0.4 * sampleRate) / sampleRate) - phaserLow_;
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
        case SNARE_EFFECT_VINYL:
          vinyl(left[i], right[i], wetLeft, wetRight);
          break;
        case SNARE_EFFECT_CRUSHER:
          crusher(left[i], right[i]);
          continue;
        case SNARE_EFFECT_TAPE:
          tape(left[i], right[i]);
          continue;
        case SNARE_EFFECT_PUMP:
          pump(left[i], right[i]);
          continue;
        case SNARE_EFFECT_FILTER:
          filter(left[i], right[i]);
          continue;
        case SNARE_EFFECT_PHASER:
          phaser(left[i], right[i]);
          continue;
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
  // The crusher: how often it takes a new sample, and the levels each side of nothing.
  static constexpr double kCrushHz = 12000.0;
  static constexpr float kCrushLevels = 64.0f;
  // Tape: its slow and its quick wobble, where its top rolls off, how hard it is driven.
  static constexpr double kWowHz = 0.55;
  static constexpr double kFlutterHz = 6.3;
  static constexpr float kTapeLateMs = 2.8f;
  static constexpr float kWowMs = 2.2f;
  static constexpr float kFlutterMs = 0.3f;
  static constexpr double kTapeDampHz = 4000.0;
  static constexpr float kTapeDrive = 3.0f;
  static constexpr float kTapeLevel = 0.45f;
  // The pump listens to the low end and ducks everything under a hit: how
  // quickly it comes down, how quickly the level it hears falls, how soon a
  // level becomes the usual one, how slowly the mix comes back, and how far.
  static constexpr double kPumpToneHz = 150.0;
  static constexpr double kPumpAttackSeconds = 0.005;
  static constexpr double kPumpFallSeconds = 0.05;
  static constexpr double kPumpCatchUpSeconds = 0.1;
  static constexpr double kPumpReleaseSeconds = 0.12;
  static constexpr float kPumpDepth = 16.0f;
  static constexpr float kPumpMakeup = 0.6f;
  // The filter: where it stands open and shut, and how little it damps its own ring.
  static constexpr double kFilterTopHz = 18000.0;
  static constexpr double kFilterFloorHz = 180.0;
  static constexpr float kFilterDamping = 1.0f / 3.0f;
  static constexpr float kFilterFadeIn = 16.0f;
  // Vinyl: what counts as sound, how long the noise holds on after it, and what the noise is made of.
  static constexpr float kVinylFloor = 0.003f;
  static constexpr double kVinylHoldSeconds = 0.75;
  static constexpr double kVinylRiseSeconds = 0.02;
  static constexpr double kVinylFadeSeconds = 0.12;
  static constexpr double kHissHz = 5000.0;
  static constexpr float kHissLevel = 0.012f;
  static constexpr double kPopsPerSecond = 6.0;
  static constexpr double kTicksPerSecond = 90.0;
  static constexpr double kPopSeconds = 0.0004;
  static constexpr float kPopLevel = 0.16f;
  static constexpr float kTickLevel = 0.035f;
  static constexpr std::uint32_t kNoiseSeed = 0x9e3779b9u;
  // The phaser: how slowly it sweeps, between where, and how much of itself it hears.
  static constexpr double kPhaserHz = 0.3;
  static constexpr double kPhaserLowHz = 250.0;
  static constexpr double kPhaserHighHz = 2800.0;
  static constexpr float kPhaserFeedback = 0.55f;
  static constexpr int kPhaserStages = 4;

  struct Comb {
    std::vector<float> buffer;
    std::size_t index = 0;
    float store = 0.0f;
  };

  struct Allpass {
    std::vector<float> buffer;
    std::size_t index = 0;
  };

  // A low-pass of two poles that stays steady however fast it is swept.
  struct Sweepable {
    float first = 0.0f;
    float second = 0.0f;
  };

  // One side of the phaser: what each stage holds, and what came out last.
  struct Stages {
    float held[kPhaserStages] = {};
    float back = 0.0f;
  };

  static std::size_t scaled(int samplesAt44100, double sampleRate) {
    return static_cast<std::size_t>((static_cast<std::int64_t>(samplesAt44100) * static_cast<std::int64_t>(sampleRate) + 22050) / 44100);
  }

  static std::uint32_t phaseStep(double hz, double sampleRate) {
    return static_cast<std::uint32_t>(hz / sampleRate * 4294967296.0);
  }

  // What a one-pole filter moves by each sample to turn over at a frequency.
  static float onePole(double hz, double sampleRate) {
    return static_cast<float>(1.0 - std::exp(-2.0 * kPi * hz / sampleRate));
  }

  // The same for something that follows its target in about so many seconds.
  static float timeConstant(double seconds, double sampleRate) {
    return static_cast<float>(1.0 - std::exp(-1.0 / (seconds * sampleRate)));
  }

  // Exactly the one at nothing and exactly the other at everything.
  static float blend(float dry, float made, float amount) { return dry * (1.0f - amount) + made * amount; }

  // Keeps a value that is dying away from turning into numbers too small to be quick with.
  static void settle(float& value) {
    if (std::fabs(value) < kQuiet) value = 0.0f;
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

  // tan(pi * f) for a frequency given as a part of the sample rate, below
  // half of it, from the same polynomial.
  static float tangent(float ofRate) {
    const std::uint32_t phase = static_cast<std::uint32_t>(ofRate * 2147483648.0f);
    return sine(phase) / sine(phase + 0x40000000u);
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
    // The crusher takes its first sample at once.
    crushPhase_ = 0u - crushStep_;
    heldLeft_ = 0.0f;
    heldRight_ = 0.0f;
    wowPhase_ = 0;
    flutterPhase_ = 0;
    tapeLeft_ = 0.0f;
    tapeRight_ = 0.0f;
    pumpLow1_ = 0.0f;
    pumpLow2_ = 0.0f;
    pumpLevel_ = 0.0f;
    pumpUsual_ = 0.0f;
    pumpEnvelope_ = 0.0f;
    filterLeft_ = Sweepable{};
    filterRight_ = Sweepable{};
    // The same crackle every time, so a render can be made twice.
    noise_ = kNoiseSeed;
    vinylHold_ = 0;
    vinylGate_ = 0.0f;
    hissLeft_ = 0.0f;
    hissRight_ = 0.0f;
    popLeft_ = 0.0f;
    popRight_ = 0.0f;
    phaserPhase_ = 0;
    phaserLeft_ = Stages{};
    phaserRight_ = Stages{};
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

  // Fewer samples and fewer levels: each one is held until the next is due,
  // and rounded to the nearest of a few.
  static float coarse(float sample) {
    const float scaled = std::min(1.0f, std::max(-1.0f, sample)) * kCrushLevels;
    return static_cast<float>(static_cast<std::int32_t>(scaled + (scaled >= 0.0f ? 0.5f : -0.5f))) / kCrushLevels;
  }

  void crusher(float& left, float& right) {
    const std::uint32_t before = crushPhase_;
    crushPhase_ += crushStep_;
    if (crushEvery_ || crushPhase_ < before) {
      heldLeft_ = coarse(left);
      heldRight_ = coarse(right);
    }
    left = blend(left, heldLeft_, wet_);
    right = blend(right, heldRight_, wet_);
  }

  // What is loud is rounded off, and the level it comes out at is set to match.
  static float warm(float sample) {
    const float driven = std::min(1.0f, std::max(-1.0f, sample * kTapeDrive));
    return (1.5f * driven - 0.5f * driven * driven * driven) * kTapeLevel;
  }

  // The signal a moment late, the moment wandering as a tape's speed does,
  // with its top rolled off and its peaks rounded. All of it grows with the
  // amount asked for, the lateness too, so at nothing it is the signal as it came.
  void tape(float& left, float& right) {
    write(left, right);
    const float late = 1.0f + wet_ * milliseconds(kTapeLateMs + kWowMs * sine(wowPhase_) + kFlutterMs * sine(flutterPhase_));
    wowPhase_ += wowStep_;
    flutterPhase_ += flutterStep_;
    const float heardLeft = tap(lineLeft_, late);
    const float heardRight = tap(lineRight_, late);
    tapeLeft_ += (heardLeft - tapeLeft_) * tapeDamping_;
    tapeRight_ += (heardRight - tapeRight_) * tapeDamping_;
    settle(tapeLeft_);
    settle(tapeRight_);
    left = blend(heardLeft, warm(tapeLeft_), wet_);
    right = blend(heardRight, warm(tapeRight_), wet_);
  }

  // Ducks everything under each low hit and lets it swell back. It listens
  // to the low end for a rise, the level against where the level has lately
  // been, so a hit ducks the mix as it lands and the mix is back while the
  // hit still rings. The front of the hit is through before it comes down.
  void pump(float& left, float& right) {
    pumpLow1_ += (0.5f * (left + right) - pumpLow1_) * pumpTone_;
    pumpLow2_ += (pumpLow1_ - pumpLow2_) * pumpTone_;
    const float level = std::fabs(pumpLow2_);
    pumpLevel_ += (level - pumpLevel_) * (level > pumpLevel_ ? pumpAttack_ : pumpFall_);
    pumpUsual_ += (pumpLevel_ - pumpUsual_) * pumpCatchUp_;
    const float rise = std::max(0.0f, pumpLevel_ - pumpUsual_);
    pumpEnvelope_ += (rise - pumpEnvelope_) * (rise > pumpEnvelope_ ? pumpAttack_ : pumpRelease_);
    settle(pumpLow1_);
    settle(pumpLow2_);
    settle(pumpLevel_);
    settle(pumpUsual_);
    settle(pumpEnvelope_);
    const float gain = (1.0f + kPumpMakeup * wet_) / (1.0f + kPumpDepth * wet_ * pumpEnvelope_);
    left *= gain;
    right *= gain;
  }

  static float lowpass(Sweepable& state, float input, float a1, float a2, float a3) {
    const float v3 = input - state.second;
    const float v1 = a1 * state.first + a2 * v3;
    const float v2 = state.second + a2 * state.first + a3 * v3;
    state.first = 2.0f * v1 - state.first;
    state.second = 2.0f * v2 - state.second;
    settle(state.first);
    settle(state.second);
    return v2;
  }

  // A low-pass with a ring to it. The amount asked for is how far it is
  // shut: wide open at nothing, down to the low end at everything.
  void filter(float& left, float& right) {
    const float open = 1.0f - wet_;
    const float g = tangent(filterFloor_ + (filterTop_ - filterFloor_) * open * open * open);
    const float a1 = 1.0f / (1.0f + g * (g + kFilterDamping));
    const float a2 = g * a1;
    const float a3 = g * a2;
    // Wide open is not quite the signal as it came, so the last of the way there is a fade.
    const float amount = std::min(1.0f, wet_ * kFilterFadeIn);
    left = blend(left, lowpass(filterLeft_, left, a1, a2, a3), amount);
    right = blend(right, lowpass(filterRight_, right, a1, a2, a3), amount);
  }

  std::uint32_t random() {
    noise_ ^= noise_ << 13;
    noise_ ^= noise_ >> 17;
    noise_ ^= noise_ << 5;
    return noise_;
  }

  // A random number as a sample, from -1 up to 1.
  static float asSample(std::uint32_t number) {
    return static_cast<float>(static_cast<std::int32_t>(number)) / 2147483648.0f;
  }

  // A record's surface: hiss, small ticks and the odd pop, a little apart on
  // the two sides. It sounds only while there is something to hear and for a
  // moment after, so a machine that has stopped is quiet.
  void vinyl(float left, float right, float& wetLeft, float& wetRight) {
    if (std::fabs(left) > kVinylFloor || std::fabs(right) > kVinylFloor) {
      vinylHold_ = vinylHoldFrames_;
    } else if (vinylHold_ > 0) {
      --vinylHold_;
    }
    const float open = vinylHold_ > 0 ? 1.0f : 0.0f;
    vinylGate_ += (open - vinylGate_) * (open > vinylGate_ ? vinylRise_ : vinylFade_);
    if (open == 0.0f && vinylGate_ < kSettled) vinylGate_ = 0.0f;

    hissLeft_ += (asSample(random()) - hissLeft_) * hissTone_;
    hissRight_ += (asSample(random()) - hissRight_) * hissTone_;
    const std::uint32_t chance = random();
    if (chance < popOdds_ || chance - popOdds_ < tickOdds_) {
      const std::uint32_t drawn = random();
      const float size = (chance < popOdds_ ? kPopLevel : kTickLevel) * asSample(drawn);
      const bool nearLeft = (drawn & 1u) != 0;
      popLeft_ += size * (nearLeft ? 1.0f : 0.6f);
      popRight_ += size * (nearLeft ? 0.6f : 1.0f);
    }
    wetLeft = vinylGate_ * (hissLeft_ * kHissLevel + popLeft_);
    wetRight = vinylGate_ * (hissRight_ * kHissLevel + popRight_);
    popLeft_ *= popDecay_;
    popRight_ *= popDecay_;
    settle(popLeft_);
    settle(popRight_);
  }

  // Four stages that each turn the signal's phase round a frequency, with a
  // little of what comes out fed back in.
  static float turned(Stages& stages, float input, std::uint32_t phase, float low, float span) {
    const float swing = 0.5f + 0.5f * sine(phase);
    const float g = tangent(low + span * swing * swing);
    const float a = (g - 1.0f) / (g + 1.0f);
    float through = input + stages.back * kPhaserFeedback;
    for (float& held : stages.held) {
      const float out = a * through + held;
      held = through - a * out;
      settle(held);
      through = out;
    }
    stages.back = through;
    settle(stages.back);
    return through;
  }

  // The signal against a copy whose phase is swept slowly: notches that
  // travel up and down it, a quarter of a turn apart on the two sides.
  void phaser(float& left, float& right) {
    left = blend(left, 0.5f * (left + turned(phaserLeft_, left, phaserPhase_, phaserLow_, phaserSpan_)), wet_);
    right = blend(right, 0.5f * (right + turned(phaserRight_, right, phaserPhase_ + 0x40000000u, phaserLow_, phaserSpan_)), wet_);
    phaserPhase_ += phaserStep_;
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

  bool crushEvery_ = false;
  std::uint32_t crushPhase_ = 0;
  std::uint32_t crushStep_ = 0;
  float heldLeft_ = 0.0f;
  float heldRight_ = 0.0f;

  std::uint32_t wowPhase_ = 0;
  std::uint32_t wowStep_ = 0;
  std::uint32_t flutterPhase_ = 0;
  std::uint32_t flutterStep_ = 0;
  float tapeDamping_ = 1.0f;
  float tapeLeft_ = 0.0f;
  float tapeRight_ = 0.0f;

  float pumpTone_ = 1.0f;
  float pumpAttack_ = 1.0f;
  float pumpRelease_ = 1.0f;
  float pumpFall_ = 1.0f;
  float pumpCatchUp_ = 1.0f;
  float pumpLow1_ = 0.0f;
  float pumpLow2_ = 0.0f;
  float pumpLevel_ = 0.0f;
  float pumpUsual_ = 0.0f;
  float pumpEnvelope_ = 0.0f;

  float filterTop_ = 0.0f;
  float filterFloor_ = 0.0f;
  Sweepable filterLeft_;
  Sweepable filterRight_;

  std::uint32_t noise_ = kNoiseSeed;
  std::uint32_t vinylHoldFrames_ = 0;
  std::uint32_t vinylHold_ = 0;
  float vinylRise_ = 1.0f;
  float vinylFade_ = 1.0f;
  float vinylGate_ = 0.0f;
  float hissTone_ = 1.0f;
  float hissLeft_ = 0.0f;
  float hissRight_ = 0.0f;
  float popDecay_ = 0.0f;
  float popLeft_ = 0.0f;
  float popRight_ = 0.0f;
  std::uint32_t popOdds_ = 0;
  std::uint32_t tickOdds_ = 0;

  std::uint32_t phaserPhase_ = 0;
  std::uint32_t phaserStep_ = 0;
  float phaserLow_ = 0.0f;
  float phaserSpan_ = 0.0f;
  Stages phaserLeft_;
  Stages phaserRight_;

  Comb combsLeft_[kCombs];
  Comb combsRight_[kCombs];
  Allpass allpassesLeft_[kAllpasses];
  Allpass allpassesRight_[kAllpasses];
};

}  // namespace snare

#endif
