// Hosts the built VST3 bundle with JUCE's own VST3 host and plays it: the
// plugin as a host meets it, through the VST3 wrapper. It is no substitute
// for Steinberg's validator or for a real host.
//
//   bundle_host_check <path to the .vst3 bundle> [a state with a beat in it]

#include <juce_audio_processors/juce_audio_processors.h>

#include <cmath>
#include <cstdio>
#include <memory>
#include <algorithm>
#include <string>
#include <vector>

namespace {

constexpr double kRate = 48000.0;
constexpr int kBlock = 512;
constexpr int kKickNote = 36;
constexpr int kOwnParameters = 47;

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

// A host that reports one tempo and, when it is playing, where it is in the song.
class HostClock final : public juce::AudioPlayHead {
 public:
  explicit HostClock(double bpm) : bpm_(bpm) {}

  juce::Optional<PositionInfo> getPosition() const override {
    PositionInfo position;
    position.setBpm(bpm_);
    position.setTimeSignature(TimeSignature{4, 4});
    position.setIsPlaying(playing);
    position.setPpqPosition(beat);
    position.setTimeInSamples(juce::roundToInt(beat * 60.0 / bpm_ * kRate));
    return position;
  }

  double framesPerBeat() const { return kRate * 60.0 / bpm_; }

  bool playing = true;
  double beat = 0.0;

 private:
  double bpm_;
};

juce::AudioProcessorParameter* named(juce::AudioPluginInstance& plugin, const char* name) {
  for (juce::AudioProcessorParameter* parameter : plugin.getParameters()) {
    if (parameter->getName(64) == name) return parameter;
  }
  return nullptr;
}

// A kick into the delay on a host at `bpm`, once the delay has settled there.
std::vector<float> playEcho(juce::VST3PluginFormat& format, const juce::PluginDescription& description, double bpm,
                            int blocks) {
  const std::unique_ptr<juce::AudioPluginInstance> plugin = host(format, description);
  juce::AudioProcessorParameter* const mix = plugin != nullptr ? named(*plugin, "Effect Mix") : nullptr;
  if (mix == nullptr) return {};
  HostClock clock(bpm);
  plugin->setPlayHead(&clock);
  mix->setValue(0.6f);
  play(*plugin, false, 600);

  std::vector<float> heard;
  juce::AudioBuffer<float> buffer(2, kBlock);
  juce::MidiBuffer midi;
  for (int block = 0; block < blocks; ++block) {
    buffer.clear();
    midi.clear();
    if (block == 0) midi.addEvent(juce::MidiMessage::noteOn(10, kKickNote, juce::uint8{127}), 0);
    plugin->processBlock(buffer, midi);
    heard.insert(heard.end(), buffer.getReadPointer(0), buffer.getReadPointer(0) + kBlock);
  }
  plugin->setPlayHead(nullptr);
  plugin->releaseResources();
  return heard;
}

// The fixture beat's panel is on pattern В, which holds two toms: on its third
// step and its eleventh. At 120 that is a quarter of a second in.
constexpr double kBeatBpm = 120.0;
constexpr double kFirstHitSeconds = 0.25;

// A host does not hand a plugin's state back bare. JUCE's host keeps what the
// VST3 component gave it inside a document of its own, and that is what its
// setStateInformation takes. This puts the plugin's state in such a document,
// as JUCE's host would have saved it.
juce::MemoryBlock asTheHostKeepsIt(const juce::MemoryBlock& pluginState) {
  juce::XmlElement kept("VST3PluginState");
  kept.createNewChildElement("IComponent")->addTextElement(pluginState.toBase64Encoding());
  juce::MemoryBlock block;
  juce::AudioProcessor::copyXmlToBinary(kept, block);
  return block;
}

// A measure of the beat in a recalled state, played by a host's transport
// alone, with no notes. Returns the frame its first sound is on, or -1.
int firstSoundOfTheBeat(juce::VST3PluginFormat& format, const juce::PluginDescription& description,
                        const juce::MemoryBlock& state, bool hostPlays, float& kickPitch) {
  const std::unique_ptr<juce::AudioPluginInstance> plugin = host(format, description);
  if (plugin == nullptr) return -1;
  plugin->setStateInformation(state.getData(), static_cast<int>(state.getSize()));
  HostClock clock(kBeatBpm);
  clock.playing = hostPlays;
  plugin->setPlayHead(&clock);

  int firstSound = -1;
  juce::AudioBuffer<float> buffer(2, kBlock);
  juce::MidiBuffer midi;
  const int blocks = juce::roundToInt(4.0 * clock.framesPerBeat()) / kBlock;
  for (int block = 0; block < blocks; ++block) {
    clock.beat = block * kBlock / clock.framesPerBeat();
    buffer.clear();
    midi.clear();
    plugin->processBlock(buffer, midi);
    for (int frame = 0; firstSound < 0 && frame < kBlock; ++frame) {
      if (!juce::exactlyEqual(buffer.getSample(0, frame), 0.0f)) firstSound = block * kBlock + frame;
    }
  }
  const juce::AudioProcessorParameter* const pitch = named(*plugin, "Kick Pitch");
  kickPitch = pitch != nullptr ? pitch->getValue() : -1.0f;
  plugin->setPlayHead(nullptr);
  plugin->releaseResources();
  return firstSound;
}

int ownParameters(juce::AudioPluginInstance& plugin) {
  int count = 0;
  for (const char* voice : {"Kick", "Snare", "Clap", "Closed hat", "Open hat", "Tom", "Rim", "Perc"}) {
    for (const char* knob : {"Pitch", "Tone", "Decay", "Level", "Mute"}) {
      if (named(plugin, (std::string(voice) + " " + knob).c_str()) != nullptr) ++count;
    }
  }
  for (const char* name : {"Volume", "Effect", "Effect Mix", "Accent", "Swing", "Pattern", "Sequencer"}) {
    if (named(plugin, name) != nullptr) ++count;
  }
  return count;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2 || argc > 3) {
    std::fprintf(stderr, "usage: %s <path to the .vst3 bundle> [a state with a beat in it]\n", argv[0]);
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

  // The delay's echo is a dotted eighth note behind the hit, so two hosts at
  // different tempos part ways where the faster one's first echo arrives.
  const std::vector<float> fast = playEcho(format, description, 120.0, 80);
  const std::vector<float> slow = playEcho(format, description, 60.0, 80);
  const auto parted = std::mismatch(fast.begin(), fast.end(), slow.begin(), slow.end(),
                                    [](float a, float b) { return juce::exactlyEqual(a, b); });
  const double partedSeconds = static_cast<double>(parted.first - fast.begin()) / kRate;
  check(!fast.empty() && fast.size() == slow.size() && std::abs(partedSeconds - 0.375) < 0.01,
        "the delay follows the host's tempo: hosts at 120 and at 60 part ways 0.375 s after the hit (" +
            std::to_string(partedSeconds) + " s)");

  // A beat in a recalled state, played by the host's transport through the
  // wrapper: the host's position has to reach the sequencer for this to sound,
  // and to sound on time.
  if (argc == 3) {
    juce::MemoryBlock beatState;
    const bool read = juce::File::getCurrentWorkingDirectory()
                          .getChildFile(juce::String::fromUTF8(argv[2]))
                          .loadFileAsData(beatState);
    check(read && beatState.getSize() > 0, "the state with a beat in it is read");
    float kickPitch = -1.0f;
    const int expected = juce::roundToInt(kFirstHitSeconds * kRate);
    const juce::MemoryBlock kept = asTheHostKeepsIt(beatState);
    const int played = firstSoundOfTheBeat(format, description, kept, true, kickPitch);
    check(std::abs(kickPitch - 0.35f) < 1e-6f, "the recalled state sets the beat's knobs: Kick Pitch 0.35 (" +
                                                   std::to_string(kickPitch) + ")");
    check(played >= expected && played <= expected + 2,
          "with the host playing and no notes, the beat's pattern sounds, first on its third step (frame " +
              std::to_string(played) + ", expected " + std::to_string(expected) + ")");
    const int stopped = firstSoundOfTheBeat(format, description, kept, false, kickPitch);
    check(stopped == -1, "with the host stopped the pattern does not play");
  }

  plugin->releaseResources();
  second->releaseResources();
  std::printf("%d failed\n", failures);
  return failures == 0 ? 0 : 1;
}
