// РИТМ-12's eight voices, built from their knob settings: pitch, tone and
// decay. They are made up for this machine and model no instrument: sine
// drums pushed into a limiter, ring-modulated squares for the hats, and
// frequency modulation for the rim and the percussion voice.
//
// They keep the rules in dsp.h, which hold native and WebAssembly renders
// in agreement. A sound's length comes from plain arithmetic; the engine
// fades its tail.

#include <cmath>
#include <cstdint>

#include "boombapbot/dsp.h"
#include "boombapbot/voices.h"

namespace {

using boombapbot::Knobs;
using boombapbot::Voice;
using namespace boombapbot::dsp;

constexpr int kVoiceCount = 8;

// Time for a decay with time constant `seconds` to fall to a thousandth.
double ringSeconds(double seconds) { return 0.02 + 6.9 * seconds; }

double wrap(double phase) { return phase - std::floor(phase); }

// ---- БАС: a sine that drops onto its pitch, driven into the limiter ---------

double kickBody(const Knobs& knobs) { return sweep(0.07, 0.5, knobs.decay); }
double kickSeconds(const Knobs& knobs) { return ringSeconds(kickBody(knobs)); }

void renderKick(const Knobs& knobs, double rate, std::uint32_t, float* out, int frames) {
  const double hz = sweep(38.0, 78.0, knobs.tune);
  const double body = decayCoefficient(kickBody(knobs), rate);
  const double drop = decayCoefficient(0.016, rate);
  const double tickFall = decayCoefficient(0.0022, rate);
  const double drive = lerp(1.1, 3.4, knobs.tone);
  const double tickLevel = lerp(0.05, 0.5, knobs.tone);
  double phase = 0.0, tickPhase = 0.0, amplitude = 1.0, bend = lerp(1.6, 3.2, knobs.tone), tick = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double tone = saturate(drive * sine(phase) * amplitude) / saturate(drive);
    out[i] = static_cast<float>(0.9 * saturate(tone + tickLevel * sine(tickPhase) * tick));
    phase = wrap(phase + hz * (1.0 + bend) / rate);
    tickPhase = wrap(tickPhase + 1900.0 / rate);
    amplitude *= body;
    bend *= drop;
    tick *= tickFall;
  }
}

// ---- МАЛЫЙ: two sines beating against each other under band-passed noise ----

double snareBody(const Knobs& knobs) { return sweep(0.055, 0.3, knobs.decay); }
double snareSeconds(const Knobs& knobs) { return ringSeconds(snareBody(knobs)); }

void renderSnare(const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  const double hz = sweep(150.0, 270.0, knobs.tune);
  const double shellFall = decayCoefficient(snareBody(knobs) * 0.55, rate);
  const double hissFall = decayCoefficient(snareBody(knobs), rate);
  const double bendFall = decayCoefficient(0.007, rate);
  Biquad band = Biquad::bandpass(lerp(2400.0, 6200.0, knobs.tone), 0.9, rate);
  Biquad lift = Biquad::highpass(900.0, 0.7, rate);
  const double hissLevel = lerp(0.9, 1.5, knobs.tone);
  double low = 0.0, high = 0.0, shell = 1.0, hiss = 1.0, bend = 0.5;
  for (int i = 0; i < frames; ++i) {
    const double drum = (0.65 * sine(low) + 0.45 * sine(high)) * shell;
    const double wires = lift.process(band.process(noise.next())) * hiss * hissLevel;
    out[i] = static_cast<float>(0.88 * saturate(1.3 * (drum + wires)));
    low = wrap(low + hz * (1.0 + bend) / rate);
    high = wrap(high + hz * 1.59 * (1.0 + bend) / rate);
    shell *= shellFall;
    hiss *= hissFall;
    bend *= bendFall;
  }
}

// ---- ХЛОП: three quick bursts of noise, then the room ----------------------

double clapTail(const Knobs& knobs) { return sweep(0.07, 0.36, knobs.decay); }
double clapSeconds(const Knobs& knobs) { return 0.03 + ringSeconds(clapTail(knobs)); }

void renderClap(const Knobs& knobs, double rate, std::uint32_t seed, float* out, int frames) {
  Noise noise(seed);
  Biquad band = Biquad::bandpass(sweep(850.0, 1900.0, knobs.tune), lerp(1.6, 0.8, knobs.tone), rate);
  Biquad air = Biquad::highpass(lerp(500.0, 1400.0, knobs.tone), 0.7, rate);
  const double burstFall = decayCoefficient(0.0035, rate);
  const double tailFall = decayCoefficient(clapTail(knobs), rate);
  const int gap = static_cast<int>(0.0095 * rate);
  double burst = 1.0, tail = 0.0;
  for (int i = 0; i < frames; ++i) {
    // Each burst starts the envelope again; the last one lets the tail go.
    if (i == gap || i == 2 * gap) burst = 1.0;
    if (i == 3 * gap) tail = 1.0;
    const double envelope = i < 3 * gap ? burst : tail;
    out[i] = static_cast<float>(0.9 * saturate(3.4 * air.process(band.process(noise.next())) * envelope));
    burst *= burstFall;
    tail *= tailFall;
  }
}

// ---- ХЭТ З and ХЭТ О: four squares, ring-modulated in pairs ----------------

struct Hat {
  double shortest;  // decay knob fully left
  double longest;   // decay knob fully right
};

constexpr Hat kClosedHat{0.014, 0.085};
constexpr Hat kOpenHat{0.11, 0.62};

double hatFall(const Hat& hat, const Knobs& knobs) { return sweep(hat.shortest, hat.longest, knobs.decay); }

void renderHat(const Hat& hat, const Knobs& knobs, double rate, float* out, int frames) {
  const double base = sweep(430.0, 910.0, knobs.tune);
  Square first(base, rate), second(base * 1.483, rate), third(base * 1.932, rate), fourth(base * 2.546, rate);
  Biquad band = Biquad::bandpass(lerp(6500.0, 11000.0, knobs.tone), 1.1, rate);
  Biquad cut = Biquad::highpass(lerp(4200.0, 8200.0, knobs.tone), 0.8, rate);
  const double fall = decayCoefficient(hatFall(hat, knobs), rate);
  double amplitude = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double metal = 0.5 * (first.next() * second.next() + third.next() * fourth.next());
    out[i] = static_cast<float>(0.85 * saturate(4.2 * cut.process(band.process(metal)) * amplitude));
    amplitude *= fall;
  }
}

double closedHatSeconds(const Knobs& knobs) { return ringSeconds(hatFall(kClosedHat, knobs)); }
double openHatSeconds(const Knobs& knobs) { return ringSeconds(hatFall(kOpenHat, knobs)); }
void renderClosedHat(const Knobs& k, double r, std::uint32_t, float* o, int f) { renderHat(kClosedHat, k, r, o, f); }
void renderOpenHat(const Knobs& k, double r, std::uint32_t, float* o, int f) { renderHat(kOpenHat, k, r, o, f); }

// ---- ТОМ: one drum with the whole range of a set ---------------------------

double tomBody(const Knobs& knobs) { return sweep(0.07, 0.42, knobs.decay); }
double tomSeconds(const Knobs& knobs) { return ringSeconds(tomBody(knobs)); }

void renderTom(const Knobs& knobs, double rate, std::uint32_t, float* out, int frames) {
  const double hz = sweep(72.0, 265.0, knobs.tune);
  const double body = decayCoefficient(tomBody(knobs), rate);
  const double drop = decayCoefficient(0.028, rate);
  const double overtone = lerp(0.05, 0.45, knobs.tone);
  const double drive = lerp(1.0, 2.2, knobs.tone);
  double phase = 0.0, amplitude = 1.0, bend = 0.6;
  for (int i = 0; i < frames; ++i) {
    const double skin = sine(phase) + overtone * sine(wrap(phase * 2.0)) * amplitude;
    out[i] = static_cast<float>(0.85 * saturate(drive * skin * amplitude) / saturate(drive));
    phase = wrap(phase + hz * (1.0 + bend) / rate);
    amplitude *= body;
    bend *= drop;
  }
}

// ---- РИМ: a short knock, one sine bending another --------------------------

double rimBody(const Knobs& knobs) { return sweep(0.007, 0.045, knobs.decay); }
double rimSeconds(const Knobs& knobs) { return ringSeconds(rimBody(knobs)); }

void renderRim(const Knobs& knobs, double rate, std::uint32_t, float* out, int frames) {
  const double hz = sweep(330.0, 920.0, knobs.tune);
  const double fall = decayCoefficient(rimBody(knobs), rate);
  const double depth = lerp(0.4, 2.4, knobs.tone);
  Biquad band = Biquad::bandpass(hz * 1.6, 0.8, rate);
  double carrier = 0.0, bender = 0.0, amplitude = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double knock = sine(wrap(carrier + depth * amplitude * sine(bender) / (2.0 * kPi)));
    out[i] = static_cast<float>(0.9 * saturate(2.6 * band.process(knock) * amplitude));
    carrier = wrap(carrier + hz / rate);
    bender = wrap(bender + hz * 1.63 / rate);
    amplitude *= fall;
  }
}

// ---- ПЕРК: a struck tone that starts bright and rings out plain -----------

double percBody(const Knobs& knobs) { return sweep(0.045, 0.55, knobs.decay); }
double percSeconds(const Knobs& knobs) { return ringSeconds(percBody(knobs)); }

void renderPerc(const Knobs& knobs, double rate, std::uint32_t, float* out, int frames) {
  const double hz = sweep(280.0, 1120.0, knobs.tune);
  const double fall = decayCoefficient(percBody(knobs), rate);
  const double brightFall = decayCoefficient(percBody(knobs) * 0.3, rate);
  const double depth = lerp(0.3, 4.2, knobs.tone);
  double carrier = 0.0, bender = 0.0, amplitude = 1.0, bright = 1.0;
  for (int i = 0; i < frames; ++i) {
    const double struck = sine(wrap(carrier + depth * bright * sine(bender) / (2.0 * kPi)));
    out[i] = static_cast<float>(0.8 * struck * amplitude);
    carrier = wrap(carrier + hz / rate);
    bender = wrap(bender + hz * 1.41 / rate);
    amplitude *= fall;
    bright *= brightFall;
  }
}

// A voice's place here is its sound number and its sound slot. Never reorder.
constexpr Voice kVoices[kVoiceCount] = {
    {kickSeconds, renderKick, 0x1200'0001u},
    {snareSeconds, renderSnare, 0x1200'0002u},
    {clapSeconds, renderClap, 0x1200'0003u},
    {closedHatSeconds, renderClosedHat, 0x1200'0004u},
    {openHatSeconds, renderOpenHat, 0x1200'0005u},
    {tomSeconds, renderTom, 0x1200'0006u},
    {rimSeconds, renderRim, 0x1200'0007u},
    {percSeconds, renderPerc, 0x1200'0008u},
};

}  // namespace

const boombapbot::VoiceTable& boombapbot::machineVoices() {
  static constexpr VoiceTable table{kVoices, kVoiceCount};
  return table;
}
