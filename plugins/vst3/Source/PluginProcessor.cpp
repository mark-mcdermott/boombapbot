#include "PluginProcessor.h"

#include "Kit808Data.h"

// The engine's tool-side WAV decoder. The engine builds with
// -Wno-sign-conversion; JUCE's recommended warning flags turn it back on, so
// it is silenced for this one header.
JUCE_BEGIN_IGNORE_WARNINGS_GCC_LIKE("-Wsign-conversion")
#include "wav_io.h"
JUCE_END_IGNORE_WARNINGS_GCC_LIKE

#include <array>
#include <cstdint>
#include <exception>
#include <vector>

namespace {

// Engine slot and General MIDI note of each drum role. Mirrors
// packages/contracts/data/roles.json, which is the source of truth.
struct RoleSpec {
  const char* id;
  int index;
  int gmNote;
};

constexpr std::array<RoleSpec, 8> kRoles{{
    {"kick", 0, 36},
    {"snare", 1, 38},
    {"closed_hat", 2, 42},
    {"open_hat", 3, 46},
    {"low_tom", 4, 45},
    {"high_tom", 5, 50},
    {"clap", 6, 39},
    {"cymbal", 7, 49},
}};

// MIDI note number -> role index, or -1 for notes no role listens to.
constexpr std::array<std::int8_t, 128> makeNoteMap() {
  std::array<std::int8_t, 128> map{};
  for (auto& entry : map) entry = -1;
  for (const RoleSpec& role : kRoles) {
    map[static_cast<std::size_t>(role.gmNote)] = static_cast<std::int8_t>(role.index);
  }
  return map;
}

constexpr std::array<std::int8_t, 128> kNoteToRole = makeNoteMap();

// One voice of the embedded kit.
struct KitVoiceSpec {
  int role;
  const char* data;
  int size;
  float gain;
  float pan;
  int chokeGroup;
};

constexpr const char* kKit808Id = "808";

// Mirrors packages/contracts/data/kits/808.kit.json, which is the source of
// truth for gain, pan and choke group. The role column is the engine slot from
// roles.json. The two hats share choke group 1.
std::array<KitVoiceSpec, 8> kit808Voices() {
  namespace data = Kit808Data;
  return {{
      {0, data::kick_wav, data::kick_wavSize, 0.85f, 0.0f, 0},
      {1, data::snare_wav, data::snare_wavSize, 0.75f, 0.0f, 0},
      {2, data::closed_hat_wav, data::closed_hat_wavSize, 0.4f, 0.2f, 1},
      {3, data::open_hat_wav, data::open_hat_wavSize, 0.4f, 0.2f, 1},
      {4, data::low_tom_wav, data::low_tom_wavSize, 0.7f, -0.3f, 0},
      {5, data::high_tom_wav, data::high_tom_wavSize, 0.7f, 0.3f, 0},
      {6, data::clap_wav, data::clap_wavSize, 0.8f, -0.1f, 0},
      {7, data::cymbal_wav, data::cymbal_wavSize, 0.55f, -0.2f, 0},
  }};
}

const juce::Identifier kStateType{"BoombapbotPluginState"};
const juce::Identifier kStateSchemaVersion{"schemaVersion"};
const juce::Identifier kStateKitId{"kitId"};
constexpr int kCurrentStateSchemaVersion = 1;

}  // namespace

BoombapbotAudioProcessor::BoombapbotAudioProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      kitId_(kKit808Id) {}

// ---- Lifecycle (off the audio thread) ---------------------------------------

void BoombapbotAudioProcessor::prepareToPlay(double sampleRate, int /*samplesPerBlock*/) {
  // The engine is tied to one sample rate. Hosts do not call prepareToPlay
  // while processBlock is running, so replacing it here is safe.
  if (engine_ != nullptr && juce::exactlyEqual(engineSampleRate_, sampleRate)) return;

  // snare_engine_create returns null outside 8 kHz..192 kHz. The plugin then
  // stays silent rather than failing.
  engine_.reset(snare_engine_create(sampleRate));
  engineSampleRate_ = sampleRate;
  if (engine_ != nullptr) commitEmbeddedKit(engine_.get());
}

void BoombapbotAudioProcessor::releaseResources() {
  // The engine is kept so a later prepareToPlay at the same rate is free.
}

void BoombapbotAudioProcessor::commitEmbeddedKit(SnareEngine* engine) {
  SnareKit* kit = snare_kit_create();
  double longestSeconds = 0.0;

  for (const KitVoiceSpec& voice : kit808Voices()) {
    try {
      const auto* first = reinterpret_cast<const std::uint8_t*>(voice.data);
      const std::vector<std::uint8_t> bytes(first, first + voice.size);
      const snare::wav::Audio audio = snare::wav::decode(bytes);
      const int result =
          snare_kit_set_voice(kit, voice.role, audio.pcm.data(), audio.frames, audio.channels,
                              audio.sampleRate, voice.gain, voice.pan, voice.chokeGroup);
      jassert(result == SNARE_OK);
      juce::ignoreUnused(result);
      longestSeconds = juce::jmax(longestSeconds, audio.frames / audio.sampleRate);
    } catch (const std::exception&) {
      // A voice that fails to decode is left out; the others still play.
      jassertfalse;
    }
  }

  tailSeconds_ = longestSeconds;
  // The engine owns the kit from here and swaps it in at the next buffer.
  snare_engine_commit_kit(engine, kit);
}

bool BoombapbotAudioProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
  return layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo() &&
         layouts.getMainInputChannelSet().isDisabled();
}

// ---- Audio thread -----------------------------------------------------------

void BoombapbotAudioProcessor::processBlock(juce::AudioBuffer<float>& buffer,
                                          juce::MidiBuffer& midi) {
  juce::ScopedNoDenormals noDenormals;

  const int frames = buffer.getNumSamples();
  const int channels = buffer.getNumChannels();
  SnareEngine* const engine = engine_.get();

  if (engine == nullptr || channels < 2) {
    buffer.clear();
    midi.clear();
    return;
  }

  float* const left = buffer.getWritePointer(0);
  float* const right = buffer.getWritePointer(1);

  // "MIDI Trigger": every note-on plays one hit. The engine applies queued
  // triggers at the start of the next render call, so the block is split at
  // each note's sample offset: render up to the offset, queue the trigger,
  // carry on. In this plugin the audio thread is the only caller that queues
  // engine commands, which keeps the engine's command queue single-producer.
  //
  // Events are read as raw bytes. Building a juce::MidiMessage could allocate
  // for long messages such as SysEx.
  int rendered = 0;
  for (const juce::MidiMessageMetadata event : midi) {
    if (event.numBytes != 3 || (event.data[0] & 0xf0) != 0x90) continue;
    const int velocity = event.data[2] & 0x7f;
    if (velocity == 0) continue;  // note-on with velocity 0 is a note-off
    const int role = kNoteToRole[static_cast<std::size_t>(event.data[1] & 0x7f)];
    if (role < 0) continue;

    const int offset = juce::jlimit(rendered, frames, event.samplePosition);
    if (offset > rendered) {
      snare_engine_render(engine, left + rendered, right + rendered, offset - rendered);
      rendered = offset;
    }
    // A full queue drops the hit; there is nothing useful to do about it here.
    snare_engine_trigger(engine, role, velocity);
  }

  if (frames > rendered) {
    snare_engine_render(engine, left + rendered, right + rendered, frames - rendered);
  }

  for (int channel = 2; channel < channels; ++channel) buffer.clear(channel, 0, frames);
  midi.clear();  // the plugin produces no MIDI
}

// ---- Editor -----------------------------------------------------------------

// No editor in the spike. There are no parameters for a generic editor to
// show, and this way no window is ever opened inside the host.
bool BoombapbotAudioProcessor::hasEditor() const { return false; }
juce::AudioProcessorEditor* BoombapbotAudioProcessor::createEditor() { return nullptr; }

// ---- Description ------------------------------------------------------------

const juce::String BoombapbotAudioProcessor::getName() const { return JucePlugin_Name; }
bool BoombapbotAudioProcessor::acceptsMidi() const { return true; }
bool BoombapbotAudioProcessor::producesMidi() const { return false; }
bool BoombapbotAudioProcessor::isMidiEffect() const { return false; }
double BoombapbotAudioProcessor::getTailLengthSeconds() const { return tailSeconds_; }

int BoombapbotAudioProcessor::getNumPrograms() { return 1; }
int BoombapbotAudioProcessor::getCurrentProgram() { return 0; }
void BoombapbotAudioProcessor::setCurrentProgram(int /*index*/) {}
const juce::String BoombapbotAudioProcessor::getProgramName(int /*index*/) { return {}; }
void BoombapbotAudioProcessor::changeProgramName(int /*index*/, const juce::String& /*newName*/) {}

// ---- State ------------------------------------------------------------------

// A small versioned blob: the schema version and the kit id. Only the 808 kit
// is built in, so the kit id is all there is to recall.
void BoombapbotAudioProcessor::getStateInformation(juce::MemoryBlock& destData) {
  juce::ValueTree state(kStateType);
  state.setProperty(kStateSchemaVersion, kCurrentStateSchemaVersion, nullptr);
  state.setProperty(kStateKitId, kitId_, nullptr);
  if (const std::unique_ptr<juce::XmlElement> xml = state.createXml()) {
    copyXmlToBinary(*xml, destData);
  }
}

void BoombapbotAudioProcessor::setStateInformation(const void* data, int sizeInBytes) {
  const std::unique_ptr<juce::XmlElement> xml = getXmlFromBinary(data, sizeInBytes);
  if (xml == nullptr) return;
  const juce::ValueTree state = juce::ValueTree::fromXml(*xml);
  if (!state.hasType(kStateType)) return;

  // State written by a newer schema is ignored rather than guessed at.
  const int version = state.getProperty(kStateSchemaVersion, 0);
  if (version < 1 || version > kCurrentStateSchemaVersion) return;

  // An unknown kit id keeps the built-in kit.
  const juce::String kitId = state.getProperty(kStateKitId, kKit808Id).toString();
  if (kitId == kKit808Id) kitId_ = kitId;
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new BoombapbotAudioProcessor(); }
