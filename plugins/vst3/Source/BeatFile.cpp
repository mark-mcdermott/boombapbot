#include "BeatFile.h"

#include <cmath>

namespace boombapbot::plugin {
namespace {

constexpr const char* kProjectFormat = "boombapbot.project";
constexpr const char* kMachineId = "ritm12";
// Named as the document names them, in the order of the engine's effects from 1.
constexpr std::array<const char*, 4> kEffectKinds{{"delay", "reverb", "flanger", "chorus"}};
constexpr int kNameLongest = 80;

juce::Result wrong(const juce::String& what) { return juce::Result::fail(what); }

bool isNumber(const juce::var& value) { return value.isInt() || value.isInt64() || value.isDouble(); }

juce::Result readKnob(const juce::var& value, const juce::String& path, float& knob) {
  if (!isNumber(value)) return wrong(path + " is missing or is not a number.");
  const double position = static_cast<double>(value);
  if (!(position >= 0.0 && position <= 1.0)) return wrong(path + " is not a knob position from 0 to 1.");
  knob = static_cast<float>(position);
  return juce::Result::ok();
}

juce::Result readWhole(const juce::var& value, const juce::String& path, int least, int most, int& whole) {
  if (!isNumber(value)) return wrong(path + " is missing or is not a number.");
  const double number = static_cast<double>(value);
  if (!(number >= least && number <= most) || !juce::exactlyEqual(number, std::floor(number))) {
    return wrong(path + " is not a whole number from " + juce::String(least) + " to " + juce::String(most) + ".");
  }
  whole = static_cast<int>(number);
  return juce::Result::ok();
}

juce::Result readRow(const juce::var& value, const juce::String& path, StepRow& row) {
  const juce::String text = value.isString() ? value.toString() : juce::String();
  if (text.length() != kSteps || !text.containsOnly("x.")) {
    return wrong(path + " is not a row of " + juce::String(kSteps) + " steps of \"x\" or \".\".");
  }
  row = rowFromText(text);
  return juce::Result::ok();
}

juce::Result readPattern(const juce::var& pattern, const juce::String& path, BeatPattern& out) {
  if (!pattern.isObject()) return wrong(path + " is missing.");
  if (const juce::Result row = readRow(pattern["accents"], path + ".accents", out.accents); row.failed()) return row;
  for (std::size_t voice = 0; voice < kVoices.size(); ++voice) {
    const char* const id = kVoices[voice].id;
    if (const juce::Result row = readRow(pattern["steps"][id], path + ".steps." + id, out.hits[voice]); row.failed()) {
      return row;
    }
  }
  return juce::Result::ok();
}

juce::Result readVoice(const juce::var& document, const char* id, BeatVoice& out) {
  const juce::var& knobs = document["voices"][id];
  const juce::var& mix = document["mix"];
  const juce::String sound = juce::String("voices.") + id;
  if (const juce::Result knob = readKnob(knobs["pitch"], sound + ".pitch", out.pitch); knob.failed()) return knob;
  if (const juce::Result knob = readKnob(knobs["tone"], sound + ".tone", out.tone); knob.failed()) return knob;
  if (const juce::Result knob = readKnob(knobs["decay"], sound + ".decay", out.decay); knob.failed()) return knob;
  if (const juce::Result knob = readKnob(mix["levels"][id], juce::String("mix.levels.") + id, out.level);
      knob.failed()) {
    return knob;
  }
  const juce::var& muted = mix["mutes"][id];
  if (!muted.isBool()) return wrong(juce::String("mix.mutes.") + id + " is missing or is not true or false.");
  out.muted = static_cast<bool>(muted);
  return juce::Result::ok();
}

juce::Result readEffect(const juce::var& effect, Beat& out) {
  const juce::String kind = effect["kind"].toString();
  int found = SNARE_EFFECT_NONE;
  for (std::size_t index = 0; index < kEffectKinds.size(); ++index) {
    if (kind == kEffectKinds[index]) found = SNARE_EFFECT_DELAY + static_cast<int>(index);
  }
  if (found == SNARE_EFFECT_NONE) return wrong("effect.kind is not an effect this machine has.");
  out.effect = found;
  return readKnob(effect["mix"], "effect.mix", out.effectMix);
}

// What kind of document this is, before any of it is read.
juce::Result checkKind(const juce::var& document) {
  if (!document.isObject()) return wrong("This is not a boombapbot beat file.");
  if (document["format"].toString() != kProjectFormat) return wrong("This is not a boombapbot beat file.");

  const juce::var& version = document["schemaVersion"];
  if (!isNumber(version)) return wrong("This beat file does not say which version it is.");
  if (static_cast<int>(version) < kBeatSchemaVersion) {
    return wrong("This beat was saved by an earlier boombapbot. Open it on the site and save it again.");
  }
  if (static_cast<int>(version) > kBeatSchemaVersion) {
    return wrong("This beat was saved by a newer boombapbot than this plugin knows.");
  }
  if (document["machine"].toString() != kMachineId) return wrong("This beat is for another machine.");
  return juce::Result::ok();
}

juce::Result readDocument(const juce::var& document, Beat& out) {
  if (const juce::Result kind = checkKind(document); kind.failed()) return kind;

  out.name = document["name"].toString().substring(0, kNameLongest);
  if (out.name.isEmpty()) return wrong("name is missing.");
  if (const juce::Result tempo = readWhole(document["tempo"], "tempo", static_cast<int>(SNARE_BPM_MIN),
                                           static_cast<int>(SNARE_BPM_MAX), out.tempo);
      tempo.failed()) {
    return tempo;
  }
  if (const juce::Result swing = readKnob(document["swing"], "swing", out.swing); swing.failed()) return swing;

  if (!isNumber(document["size"]) || !validSize(static_cast<int>(document["size"]))) {
    return wrong("size is not 16 or 12.");
  }
  out.size = static_cast<int>(document["size"]);

  const juce::Array<juce::var>* const patterns = document["patterns"].getArray();
  if (patterns == nullptr || patterns->size() != kPatternCount) {
    return wrong("patterns does not hold " + juce::String(kPatternCount) + " patterns.");
  }
  for (int index = 0; index < kPatternCount; ++index) {
    if (const juce::Result pattern = readPattern(patterns->getReference(index),
                                                 "patterns." + juce::String(index),
                                                 out.patterns[static_cast<std::size_t>(index)]);
        pattern.failed()) {
      return pattern;
    }
  }

  if (const juce::Result knob = readKnob(document["mix"]["volume"], "mix.volume", out.volume); knob.failed()) return knob;
  if (const juce::Result knob = readKnob(document["mix"]["accent"], "mix.accent", out.accent); knob.failed()) return knob;
  for (std::size_t voice = 0; voice < kVoices.size(); ++voice) {
    if (const juce::Result read = readVoice(document, kVoices[voice].id, out.voices[voice]); read.failed()) return read;
  }
  if (const juce::Result effect = readEffect(document["effect"], out); effect.failed()) return effect;
  return readWhole(document["panel"]["pattern"], "panel.pattern", 0, kPatternCount - 1, out.pattern);
}

}  // namespace

juce::String rowText(StepRow row) {
  juce::String text;
  for (int step = 0; step < kSteps; ++step) text << ((row >> step) & 1 ? 'x' : '.');
  return text;
}

StepRow rowFromText(const juce::String& text) {
  StepRow row = 0;
  for (int step = 0; step < juce::jmin(kSteps, text.length()); ++step) {
    if (text[step] == 'x') row = static_cast<StepRow>(row | (1u << step));
  }
  return row;
}

juce::Result readBeat(const juce::String& json, Beat& beat) {
  juce::var document;
  if (juce::JSON::parse(json, document).failed()) return wrong("This file is not JSON, so it is not a beat file.");
  Beat read;
  if (const juce::Result result = readDocument(document, read); result.failed()) return result;
  beat = read;
  return juce::Result::ok();
}

}  // namespace boombapbot::plugin
