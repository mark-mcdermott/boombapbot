#include "PluginProcessor.h"

#include <cmath>
#include <cstdint>

namespace {

using namespace boombapbot::plugin;

// MIDI note number -> engine track, or -1 for notes no voice listens to.
constexpr std::array<std::int8_t, 128> makeNoteMap() {
  std::array<std::int8_t, 128> map{};
  for (auto& entry : map) entry = -1;
  for (int voice = 0; voice < kVoiceCount; ++voice) {
    map[static_cast<std::size_t>(kVoices[static_cast<std::size_t>(voice)].gmNote)] =
        static_cast<std::int8_t>(voiceTrack(voice));
  }
  return map;
}

constexpr std::array<std::int8_t, 128> kNoteToTrack = makeNoteMap();

// Parameter ids are baked into host sessions and saved states. Never rename one.
struct KnobSpec {
  const char* id;
  const char* name;
  float rest;
};

constexpr std::array<KnobSpec, 4> kVoiceKnobs{{
    {"pitch", "Pitch", kSoundKnobRest},
    {"tone", "Tone", kSoundKnobRest},
    {"decay", "Decay", kSoundKnobRest},
    {"level", "Level", kLevelRest},
}};

constexpr const char* kVolumeId = "master_volume";
constexpr const char* kEffectKindId = "effect_kind";
constexpr const char* kEffectMixId = "effect_mix";
constexpr int kParameterVersion = 1;

juce::String voiceParameterId(const VoiceSpec& voice, const char* knob) {
  return juce::String(voice.id) + "_" + knob;
}

juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout() {
  const juce::NormalisableRange<float> knob(0.0f, 1.0f);
  juce::AudioProcessorValueTreeState::ParameterLayout layout;

  for (const VoiceSpec& voice : kVoices) {
    auto group = std::make_unique<juce::AudioProcessorParameterGroup>(voice.id, voice.name, " | ");
    for (const KnobSpec& spec : kVoiceKnobs) {
      group->addChild(std::make_unique<juce::AudioParameterFloat>(
          juce::ParameterID{voiceParameterId(voice, spec.id), kParameterVersion},
          juce::String(voice.name) + " " + spec.name, knob, spec.rest));
    }
    layout.add(std::move(group));
  }

  juce::StringArray effects;
  for (const char* name : kEffectNames) effects.add(name);
  layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{kVolumeId, kParameterVersion},
                                                         "Volume", knob, kVolumeRest));
  layout.add(std::make_unique<juce::AudioParameterChoice>(juce::ParameterID{kEffectKindId, kParameterVersion},
                                                          "Effect", effects, kEffectRest));
  layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{kEffectMixId, kParameterVersion},
                                                         "Effect Mix", knob, kEffectMixRest));
  return layout;
}

const juce::Identifier kParameterTreeType{"BoombapbotParameters"};

constexpr const char* kStateTag = "BoombapbotPluginState";
constexpr const char* kStateSchemaVersion = "schemaVersion";
constexpr const char* kStateMachine = "machine";
constexpr const char* kMachineId = "ritm12";
// Version 1: one attribute for each parameter, named by its id, holding its
// value as the host shows it.
constexpr int kCurrentStateSchemaVersion = 1;

constexpr int kSoundPollMilliseconds = 15;
constexpr int kSoundThreadStopMilliseconds = 5000;

bool sameKnobs(float a, float b) { return juce::exactlyEqual(a, b); }

// copyXmlToBinary writes a magic number, the length of the XML, the XML and a
// zero byte. JUCE's reader takes whatever part of a cut-off blob still parses,
// which would recall half a state, so the length is checked against the block.
bool holdsWholeState(const void* data, int sizeInBytes) {
  constexpr int kFraming = 9;
  return data != nullptr && sizeInBytes > kFraming &&
         juce::ByteOrder::littleEndianInt(juce::addBytesToPointer(data, 4)) ==
             static_cast<juce::uint32>(sizeInBytes - kFraming);
}

}  // namespace

// Watches the sound knobs and re-synthesises a voice when one has moved, so
// the audio thread never does. It polls: a parameter listener can be called on
// the audio thread, where waking another thread is not allowed.
class BoombapbotAudioProcessor::SoundThread final : public juce::Thread {
 public:
  explicit SoundThread(BoombapbotAudioProcessor& owner) : Thread("boombapbot sounds"), owner_(owner) {}

  void run() override {
    while (!threadShouldExit()) {
      // An offline render brings its sounds up to date itself, block by block.
      if (!owner_.isNonRealtime()) owner_.refreshSounds(Voices::changed);
      wait(kSoundPollMilliseconds);
    }
  }

 private:
  BoombapbotAudioProcessor& owner_;
};

BoombapbotAudioProcessor::BoombapbotAudioProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      parameters_(*this, nullptr, kParameterTreeType, createParameterLayout()),
      soundThread_(std::make_unique<SoundThread>(*this)) {
  for (std::size_t voice = 0; voice < kVoices.size(); ++voice) {
    const auto value = [&](const char* knob) {
      return parameters_.getRawParameterValue(voiceParameterId(kVoices[voice], knob));
    };
    voiceParameters_[voice] = {value("pitch"), value("tone"), value("decay"), value("level")};
  }
  volume_ = parameters_.getRawParameterValue(kVolumeId);
  effectKind_ = parameters_.getRawParameterValue(kEffectKindId);
  effectMix_ = parameters_.getRawParameterValue(kEffectMixId);
}

BoombapbotAudioProcessor::~BoombapbotAudioProcessor() { stopSoundThread(); }

// ---- Lifecycle (off the audio thread) ---------------------------------------

void BoombapbotAudioProcessor::prepareToPlay(double sampleRate, int /*samplesPerBlock*/) {
  stopSoundThread();

  // The engine is tied to one sample rate. Hosts do not call prepareToPlay
  // while processBlock is running, so replacing it here is safe.
  if (engine_ == nullptr || !juce::exactlyEqual(engineSampleRate_, sampleRate)) {
    // snare_engine_create returns null outside 8 kHz..192 kHz. The plugin
    // then stays silent rather than failing.
    engine_.reset(snare_engine_create(sampleRate));
    engineSampleRate_ = sampleRate;
    mixSent_ = false;
    if (engine_ != nullptr) loadMachine(engine_.get());
  }
  if (engine_ == nullptr) return;

  refreshSounds(Voices::all);
  soundThread_->startThread();
}

void BoombapbotAudioProcessor::releaseResources() {
  // The engine is kept so a later prepareToPlay at the same rate is cheap.
  stopSoundThread();
}

void BoombapbotAudioProcessor::stopSoundThread() { soundThread_->stopThread(kSoundThreadStopMilliseconds); }

// These calls queue engine commands from the calling thread. That is safe
// because the engine is new and processBlock does not run during
// prepareToPlay; afterwards the audio thread is the queue's only producer.
void BoombapbotAudioProcessor::loadMachine(SnareEngine* engine) {
  double longestSound = 0.0;
  for (int voice = 0; voice < kVoiceCount; ++voice) {
    const VoiceSpec& spec = kVoices[static_cast<std::size_t>(voice)];
    const int result = snare_engine_set_track(engine, voiceTrack(voice), voice, spec.pan, spec.chokeGroup);
    jassert(result == SNARE_OK);
    juce::ignoreUnused(result);

    const SnareSoundParams longest{voice, kSoundKnobRest, kSoundKnobRest, 1.0f, kUnusedSnappy, 0};
    longestSound = juce::jmax(longestSound, snare_synth_frames(&longest, engineSampleRate_) / engineSampleRate_);
  }
  snare_engine_set_accent(engine, kPlainGain, kAccentedGain);
  // The delay keeps time with the engine's tempo. Until the plugin follows the
  // host's, that is the tempo of a new project.
  snare_engine_set_tempo(engine, kTempoRest);

  double longestEffect = 0.0;
  for (int effect = SNARE_EFFECT_DELAY; effect <= SNARE_EFFECT_CHORUS; ++effect) {
    longestEffect = juce::jmax(longestEffect, snare_effect_tail_seconds(effect, kTempoRest));
  }
  tailSeconds_ = longestSound + longestEffect;
}

BoombapbotAudioProcessor::SoundKnobs BoombapbotAudioProcessor::soundKnobs(int voice) const {
  const VoiceParameters& values = voiceParameters_[static_cast<std::size_t>(voice)];
  return {values.pitch->load(std::memory_order_relaxed), values.tone->load(std::memory_order_relaxed),
          values.decay->load(std::memory_order_relaxed)};
}

// The engine takes a new sound at its next buffer boundary and lets hits
// already ringing finish on the old one, which it frees here once they have.
void BoombapbotAudioProcessor::refreshSounds(Voices which) {
  const std::lock_guard<std::mutex> lock(soundLock_);
  SnareEngine* const engine = engine_.get();
  if (engine == nullptr) return;

  for (int voice = 0; voice < kVoiceCount; ++voice) {
    const SoundKnobs knobs = soundKnobs(voice);
    SoundKnobs& made = soundsMade_[static_cast<std::size_t>(voice)];
    if (which == Voices::changed && sameKnobs(knobs.pitch, made.pitch) && sameKnobs(knobs.tone, made.tone) &&
        sameKnobs(knobs.decay, made.decay)) {
      continue;
    }
    const SnareSoundParams sound{voice, knobs.pitch, knobs.tone, knobs.decay, kUnusedSnappy, 0};
    if (snare_engine_synth_sound(engine, &sound) == SNARE_OK) made = knobs;
  }
  snare_engine_collect(engine);
}

bool BoombapbotAudioProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
  return layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo() &&
         layouts.getMainInputChannelSet().isDisabled();
}

// ---- Audio thread -----------------------------------------------------------

// A change that does not fit in the engine's queue is not recorded as sent, so
// the next block tries again.
void BoombapbotAudioProcessor::sendMix(SnareEngine* engine) {
  for (int voice = 0; voice < kVoiceCount; ++voice) {
    const auto index = static_cast<std::size_t>(voice);
    const float level = voiceParameters_[index].level->load(std::memory_order_relaxed);
    if (mixSent_ && juce::exactlyEqual(level, sentLevels_[index])) continue;
    if (snare_engine_set_track_level(engine, voiceTrack(voice), levelGain(kVoices[index], level)) != SNARE_OK) return;
    sentLevels_[index] = level;
  }

  const float volume = volume_->load(std::memory_order_relaxed);
  if (!mixSent_ || !juce::exactlyEqual(volume, sentVolume_)) {
    if (snare_engine_set_master_volume(engine, masterGain(volume)) != SNARE_OK) return;
    sentVolume_ = volume;
  }

  // As in the editor, an effect with nothing of it mixed in is no effect.
  int effect = static_cast<int>(std::lround(effectKind_->load(std::memory_order_relaxed)));
  float mix = effectMix_->load(std::memory_order_relaxed);
  if (effect == SNARE_EFFECT_NONE || mix <= 0.0f) {
    effect = SNARE_EFFECT_NONE;
    mix = 0.0f;
  }
  if (!mixSent_ || effect != sentEffect_ || !juce::exactlyEqual(mix, sentEffectMix_)) {
    if (snare_engine_set_effect(engine, effect, static_cast<double>(mix)) != SNARE_OK) return;
    sentEffect_ = effect;
    sentEffectMix_ = mix;
  }
  mixSent_ = true;
}

void BoombapbotAudioProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) {
  juce::ScopedNoDenormals noDenormals;

  const int frames = buffer.getNumSamples();
  const int channels = buffer.getNumChannels();
  SnareEngine* const engine = engine_.get();

  if (engine == nullptr || channels < 2) {
    buffer.clear();
    midi.clear();
    return;
  }

  // An offline render has no deadline, so it makes its sounds here and a
  // bounce always plays the knobs as they stand at each block.
  if (isNonRealtime()) refreshSounds(Voices::changed);
  sendMix(engine);

  float* const left = buffer.getWritePointer(0);
  float* const right = buffer.getWritePointer(1);

  // Every note-on plays one hit. The engine applies queued triggers at the
  // start of the next render call, so the block is split at each note's
  // sample offset: render up to the offset, queue the trigger, carry on.
  //
  // Events are read as raw bytes. Building a juce::MidiMessage could allocate
  // for long messages such as SysEx.
  int rendered = 0;
  for (const juce::MidiMessageMetadata event : midi) {
    if (event.numBytes != 3 || (event.data[0] & 0xf0) != 0x90) continue;
    const int velocity = event.data[2] & 0x7f;
    if (velocity == 0) continue;  // note-on with velocity 0 is a note-off
    const int track = kNoteToTrack[static_cast<std::size_t>(event.data[1] & 0x7f)];
    if (track < 0) continue;

    const int offset = juce::jlimit(rendered, frames, event.samplePosition);
    if (offset > rendered) {
      snare_engine_render(engine, left + rendered, right + rendered, offset - rendered);
      rendered = offset;
    }
    // A full queue drops the hit; there is nothing useful to do about it here.
    snare_engine_trigger(engine, track, velocity >= kAccentVelocity ? 1 : 0);
  }

  if (frames > rendered) {
    snare_engine_render(engine, left + rendered, right + rendered, frames - rendered);
  }

  for (int channel = 2; channel < channels; ++channel) buffer.clear(channel, 0, frames);
  midi.clear();  // the plugin produces no MIDI
}

// ---- Editor -----------------------------------------------------------------

bool BoombapbotAudioProcessor::hasEditor() const { return true; }
juce::AudioProcessorEditor* BoombapbotAudioProcessor::createEditor() {
  return new juce::GenericAudioProcessorEditor(*this);
}

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

void BoombapbotAudioProcessor::getStateInformation(juce::MemoryBlock& destData) {
  juce::XmlElement state(kStateTag);
  state.setAttribute(kStateSchemaVersion, kCurrentStateSchemaVersion);
  state.setAttribute(kStateMachine, kMachineId);
  for (juce::AudioProcessorParameter* parameter : getParameters()) {
    if (const auto* ranged = dynamic_cast<juce::RangedAudioParameter*>(parameter)) {
      state.setAttribute(ranged->paramID, static_cast<double>(ranged->convertFrom0to1(ranged->getValue())));
    }
  }
  copyXmlToBinary(state, destData);
}

// A state that is cut short, is not this plugin's, is for another machine, or
// was written by a newer version is left unread. In one that is read, a value out of range is
// brought into it, and a parameter it does not name goes to its resting value.
void BoombapbotAudioProcessor::setStateInformation(const void* data, int sizeInBytes) {
  if (!holdsWholeState(data, sizeInBytes)) return;
  const std::unique_ptr<juce::XmlElement> state = getXmlFromBinary(data, sizeInBytes);
  if (state == nullptr || !state->hasTagName(kStateTag)) return;
  const int version = state->getIntAttribute(kStateSchemaVersion);
  if (version < 1 || version > kCurrentStateSchemaVersion) return;
  if (state->getStringAttribute(kStateMachine) != kMachineId) return;

  for (juce::AudioProcessorParameter* parameter : getParameters()) {
    auto* const ranged = dynamic_cast<juce::RangedAudioParameter*>(parameter);
    if (ranged == nullptr) continue;
    const juce::NormalisableRange<float>& range = ranged->getNormalisableRange();
    const double saved = state->getDoubleAttribute(ranged->paramID, std::nan(""));
    const float value = std::isfinite(saved)
                            ? ranged->convertTo0to1(juce::jlimit(range.start, range.end, static_cast<float>(saved)))
                            : ranged->getDefaultValue();
    ranged->setValueNotifyingHost(value);
  }
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new BoombapbotAudioProcessor(); }
