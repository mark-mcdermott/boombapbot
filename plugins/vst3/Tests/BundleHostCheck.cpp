// Hosts the built VST3 bundle with JUCE's own VST3 host and plays it: the
// plugin as a host meets it, through the VST3 wrapper. It is no substitute
// for Steinberg's validator or for a real host.
//
//   bundle_host_check <path to the .vst3 bundle>

#include <juce_audio_processors/juce_audio_processors.h>

#include <cmath>
#include <cstdio>
#include <memory>
#include <string>

namespace {

constexpr double kRate = 48000.0;
constexpr int kBlock = 512;
constexpr int kKickNote = 36;
constexpr int kOwnParameters = 35;

int failures = 0;

void check(bool passed, const std::string& what) {
  if (!passed) ++failures;
  std::printf("%s %s\n", passed ? "ok  " : "FAIL", what.c_str());
}

std::unique_ptr<juce::AudioPluginInstance> host(juce::VST3PluginFormat& format,
                                               const juce::PluginDescription& description) {
  juce::String error;
  std::unique_ptr<juce::AudioPluginInstance> plugin =
      format.createInstanceFromDescription(description, kRate, kBlock, error);
  if (plugin == nullptr) {
    check(false, "the host makes an instance: " + error.toStdString());
    return nullptr;
  }
  plugin->enableAllBuses();
  plugin->setRateAndBufferSizeDetails(kRate, kBlock);
  plugin->prepareToPlay(kRate, kBlock);
  return plugin;
}

// The loudest sample of `blocks` blocks, with a kick on the first frame if asked.
float play(juce::AudioPluginInstance& plugin, bool kick, int blocks = 8) {
  juce::AudioBuffer<float> buffer(juce::jmax(2, plugin.getTotalNumOutputChannels()), kBlock);
  juce::MidiBuffer midi;
  float loudest = 0.0f;
  for (int block = 0; block < blocks; ++block) {
    buffer.clear();
    midi.clear();
    if (kick && block == 0) midi.addEvent(juce::MidiMessage::noteOn(10, kKickNote, juce::uint8{127}), 0);
    plugin.processBlock(buffer, midi);
    const float magnitude = buffer.getMagnitude(0, kBlock);
    loudest = std::isfinite(magnitude) ? juce::jmax(loudest, magnitude) : 2.0f;
  }
  return loudest;
}

juce::AudioProcessorParameter* named(juce::AudioPluginInstance& plugin, const char* name) {
  for (juce::AudioProcessorParameter* parameter : plugin.getParameters()) {
    if (parameter->getName(64) == name) return parameter;
  }
  return nullptr;
}

int ownParameters(juce::AudioPluginInstance& plugin) {
  int count = 0;
  for (const char* voice : {"Kick", "Snare", "Clap", "Closed hat", "Open hat", "Tom", "Rim", "Perc"}) {
    for (const char* knob : {"Pitch", "Tone", "Decay", "Level"}) {
      if (named(plugin, (std::string(voice) + " " + knob).c_str()) != nullptr) ++count;
    }
  }
  for (const char* name : {"Volume", "Effect", "Effect Mix"}) {
    if (named(plugin, name) != nullptr) ++count;
  }
  return count;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::fprintf(stderr, "usage: %s <path to the .vst3 bundle>\n", argv[0]);
    return 2;
  }
  const juce::ScopedJuceInitialiser_GUI juceInitialiser;

  juce::VST3PluginFormat format;
  juce::OwnedArray<juce::PluginDescription> found;
  format.findAllTypesForFile(found, argv[1]);
  check(found.size() == 1, "the bundle holds one plugin (" + std::to_string(found.size()) + " found)");
  if (found.isEmpty()) return 1;

  const juce::PluginDescription& description = *found.getFirst();
  check(description.name == "boombapbot" && description.isInstrument,
        "it is an instrument called boombapbot (" + description.name.toStdString() + ", " +
            description.manufacturerName.toStdString() + ", " + description.version.toStdString() + ", " +
            description.category.toStdString() + ")");

  const std::unique_ptr<juce::AudioPluginInstance> plugin = host(format, description);
  if (plugin == nullptr) return 1;

  const int parameters = ownParameters(*plugin);
  check(plugin->getTotalNumInputChannels() == 0 && plugin->getTotalNumOutputChannels() == 2 && plugin->acceptsMidi(),
        "it takes MIDI and has one stereo output (" + std::to_string(plugin->getTotalNumInputChannels()) + " in, " +
            std::to_string(plugin->getTotalNumOutputChannels()) + " out)");
  check(parameters == kOwnParameters,
        "the host sees its " + std::to_string(kOwnParameters) + " parameters by name (" + std::to_string(parameters) +
            " found)");
  check(juce::exactlyEqual(play(*plugin, false), 0.0f), "with no MIDI the hosted plugin is silent");
  const float kick = play(*plugin, true);
  check(kick > 0.01f && kick <= 1.0f, "note 36 plays the kick (peak " + std::to_string(kick) + ")");

  juce::AudioProcessorParameter* const level = named(*plugin, "Kick Level");
  juce::AudioProcessorParameter* const pitch = named(*plugin, "Kick Pitch");
  if (level == nullptr || pitch == nullptr) return 1;

  // The host's parameter change crosses the wrapper to the audio thread. The
  // engine fades a level it is given while playing, so the kick is all but
  // silent rather than exactly so.
  play(*plugin, false, 200);
  level->setValue(0.0f);
  play(*plugin, false, 100);
  const float faded = play(*plugin, true);
  check(faded < kick * 0.001f, "Kick Level set to 0 by the host silences the kick (peak " + std::to_string(faded) + ")");

  pitch->setValue(0.875f);
  play(*plugin, false, 2);
  juce::MemoryBlock saved;
  plugin->getStateInformation(saved);
  check(saved.getSize() > 0, "the host is given a state (" + std::to_string(saved.getSize()) + " bytes)");

  const std::unique_ptr<juce::AudioPluginInstance> second = host(format, description);
  if (second == nullptr) return 1;
  second->setStateInformation(saved.getData(), static_cast<int>(saved.getSize()));
  play(*second, false, 2);
  juce::AudioProcessorParameter* const recalledLevel = named(*second, "Kick Level");
  juce::AudioProcessorParameter* const recalledPitch = named(*second, "Kick Pitch");
  check(recalledLevel != nullptr && recalledPitch != nullptr && juce::exactlyEqual(recalledLevel->getValue(), 0.0f) &&
            juce::exactlyEqual(recalledPitch->getValue(), 0.875f),
        "a second instance recalls that state: Kick Level 0 and Kick Pitch 0.875");
  check(juce::exactlyEqual(play(*second, true), 0.0f), "and its kick is silent too");

  plugin->releaseResources();
  second->releaseResources();
  std::printf("%d failed\n", failures);
  return failures == 0 ? 0 : 1;
}
