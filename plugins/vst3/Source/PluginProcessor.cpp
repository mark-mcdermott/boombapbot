#include "PluginProcessor.h"

#include "ParameterIds.h"
#if BOOMBAPBOT_WEB_PANEL
#include "WebPanel/WebPanelEditor.h"
#else
#include "PluginEditor.h"
#endif

#include <algorithm>
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

struct KnobSpec {
  const char* id;
  const char* name;
  float rest;
};

constexpr std::array<KnobSpec, 4> kVoiceKnobs{{
    {ids::kPitch, "Pitch", kSoundKnobRest},
    {ids::kTone, "Tone", kSoundKnobRest},
    {ids::kDecay, "Decay", kSoundKnobRest},
    {ids::kLevel, "Level", kLevelRest},
}};

constexpr int kParameterVersion = 1;

juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout() {
  const juce::NormalisableRange<float> knob(0.0f, 1.0f);
  juce::AudioProcessorValueTreeState::ParameterLayout layout;

  for (const VoiceSpec& voice : kVoices) {
    auto group = std::make_unique<juce::AudioProcessorParameterGroup>(voice.id, voice.name, " | ");
    for (const KnobSpec& spec : kVoiceKnobs) {
      group->addChild(std::make_unique<juce::AudioParameterFloat>(
          juce::ParameterID{ids::ofVoice(voice, spec.id), kParameterVersion},
          juce::String(voice.name) + " " + spec.name, knob, spec.rest));
    }
    group->addChild(std::make_unique<juce::AudioParameterBool>(
        juce::ParameterID{ids::ofVoice(voice, ids::kMute), kParameterVersion}, juce::String(voice.name) + " Mute",
        false));
    layout.add(std::move(group));
  }

  juce::StringArray effects;
  for (const char* name : kEffectNames) effects.add(name);
  juce::StringArray patterns;
  for (const char* name : kPatternNames) patterns.add(juce::String::fromUTF8(name));
  layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{ids::kVolume, kParameterVersion},
                                                         "Volume", knob, kVolumeRest));
  layout.add(std::make_unique<juce::AudioParameterChoice>(juce::ParameterID{ids::kEffectKind, kParameterVersion},
                                                          "Effect", effects, kEffectRest));
  layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{ids::kEffectMix, kParameterVersion},
                                                         "Effect Mix", knob, kEffectMixRest));
  layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{ids::kAccent, kParameterVersion}, "Accent",
                                                         knob, kAccentRest));
  layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{ids::kSwing, kParameterVersion}, "Swing",
                                                         knob, kSwingRest));
  layout.add(std::make_unique<juce::AudioParameterChoice>(juce::ParameterID{ids::kPattern, kParameterVersion},
                                                          "Pattern", patterns, 0));
  layout.add(std::make_unique<juce::AudioParameterBool>(juce::ParameterID{ids::kSequencer, kParameterVersion},
                                                        "Sequencer", true));
  return layout;
}

const juce::Identifier kParameterTreeType{"BoombapbotParameters"};

constexpr const char* kStateTag = "BoombapbotPluginState";
constexpr const char* kStateSchemaVersion = "schemaVersion";
constexpr const char* kStateMachine = "machine";
constexpr const char* kMachineId = "ritm12";
// Version 1: one attribute for each parameter, named by its id, holding its
// value as the host shows it.
// Version 2: more parameters, and a Beat element holding the patterns.
constexpr int kCurrentStateSchemaVersion = 2;
constexpr const char* kBeatTag = "Beat";
constexpr const char* kBeatName = "name";
constexpr const char* kBeatSize = "size";
constexpr const char* kBeatSelected = "selected";
constexpr const char* kWindowTag = "Window";
constexpr const char* kWindowScale = "scale";
constexpr const char* kPatternTag = "Pattern";
constexpr const char* kPatternAccents = "accents";
constexpr std::size_t kAccentRow = kVoiceCount;

// The host's tempo is held within the engine's range, as the engine holds it.
double framesPerBeat(double tempo, double sampleRate) {
  return sampleRate * 60.0 / juce::jlimit(SNARE_BPM_MIN, SNARE_BPM_MAX, tempo);
}

constexpr std::size_t kHistoryLongest = 64;
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
      return parameters_.getRawParameterValue(ids::ofVoice(kVoices[voice], knob));
    };
    voiceParameters_[voice] = {value(ids::kPitch), value(ids::kTone), value(ids::kDecay), value(ids::kLevel),
                               value(ids::kMute)};
  }
  volume_ = parameters_.getRawParameterValue(ids::kVolume);
  effectKind_ = parameters_.getRawParameterValue(ids::kEffectKind);
  effectMix_ = parameters_.getRawParameterValue(ids::kEffectMix);
  accent_ = parameters_.getRawParameterValue(ids::kAccent);
  swing_ = parameters_.getRawParameterValue(ids::kSwing);
  pattern_ = parameters_.getRawParameterValue(ids::kPattern);
  sequencer_ = parameters_.getRawParameterValue(ids::kSequencer);
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
    following_ = {};
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
  longestSoundSeconds_ = longestSound;
  tailSeconds_.store(tailSecondsAt(kTempoRest), std::memory_order_relaxed);
}

// The longest sound, then the longest any effect rings on after it. The delay
// rings for longer the slower the tempo.
double BoombapbotAudioProcessor::tailSecondsAt(double bpm) const {
  double longestEffect = 0.0;
  for (int effect = SNARE_EFFECT_DELAY; effect <= SNARE_EFFECT_CHORUS; ++effect) {
    longestEffect = juce::jmax(longestEffect, snare_effect_tail_seconds(effect, bpm));
  }
  return longestSoundSeconds_ + longestEffect;
}

// What the host says about this block. A host with no tempo to give gets a new
// project's, and one that does not say where it is in the song, or names a
// place no song reaches, is not playing.
BoombapbotAudioProcessor::HostTime BoombapbotAudioProcessor::readHost() const {
  HostTime time{kTempoRest, false, 0.0};
  const juce::AudioPlayHead* const playHead = getPlayHead();
  if (playHead == nullptr) return time;
  const auto position = playHead->getPosition();
  if (!position.hasValue()) return time;

  if (const auto bpm = position->getBpm(); bpm.hasValue() && std::isfinite(*bpm) && *bpm > 0.0) time.tempo = *bpm;
  if (const auto beat = position->getPpqPosition(); beat.hasValue() && std::abs(*beat) <= kSongBeatsMost) {
    time.playing = position->getIsPlaying();
    time.beat = *beat;
  }
  return time;
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
void BoombapbotAudioProcessor::sendMix(SnareEngine* engine, double tempo) {
  for (int voice = 0; voice < kVoiceCount; ++voice) {
    const auto index = static_cast<std::size_t>(voice);
    const VoiceParameters& values = voiceParameters_[index];
    const bool muted = values.mute->load(std::memory_order_relaxed) >= 0.5f;
    const double gain = muted ? 0.0 : levelGain(kVoices[index], values.level->load(std::memory_order_relaxed));
    if (mixSent_ && juce::exactlyEqual(gain, sentGains_[index])) continue;
    if (snare_engine_set_track_level(engine, voiceTrack(voice), gain) != SNARE_OK) return;
    sentGains_[index] = gain;
  }

  const float accent = accent_->load(std::memory_order_relaxed);
  if (!mixSent_ || !juce::exactlyEqual(accent, sentAccent_)) {
    if (snare_engine_set_accent(engine, plainGain(accent), kAccentedGain) != SNARE_OK) return;
    sentAccent_ = accent;
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

  // The delay keeps time with the engine's tempo, so the engine follows the host's.
  if (!mixSent_ || !juce::exactlyEqual(tempo, sentTempo_)) {
    if (snare_engine_set_tempo(engine, tempo) != SNARE_OK) return;
    sentTempo_ = tempo;
    tailSeconds_.store(tailSecondsAt(tempo), std::memory_order_relaxed);
  }
  mixSent_ = true;
}

int BoombapbotAudioProcessor::chosenPattern() const {
  return juce::jlimit(0, kPatternCount - 1, static_cast<int>(std::lround(pattern_->load(std::memory_order_relaxed))));
}

// The host's position is the truth, but one block's start and the last one's
// end rarely agree to the last digit. While the host plays on, the step that
// comes next is remembered, so no step is played twice or passed over. When
// the host has jumped, by a loop or a seek, the place is found afresh.
void BoombapbotAudioProcessor::followHost(double beat, double blockBeats, const StepGrid& grid) {
  const double halfAStep = 0.5 / grid.stepsPerBeat;
  const bool playedOn = following_.active && following_.stepsPerBeat == grid.stepsPerBeat &&
                        std::abs(beat - following_.expectedBeat) <= halfAStep;
  if (!playedOn) {
    following_.nextStep = grid.firstStepFrom(beat);
    following_.pattern = chosenPattern();
  }
  following_.active = true;
  following_.stepsPerBeat = grid.stepsPerBeat;
  following_.expectedBeat = beat + blockBeats;
}

// As on the machine, a pattern chosen while another plays takes over at the
// next bar line.
void BoombapbotAudioProcessor::playStep(SnareEngine* engine, std::int64_t step, const StepGrid& grid) {
  const int place = grid.placeOf(step);
  if (place == 0) following_.pattern = chosenPattern();
  shownStep_.store(place, std::memory_order_relaxed);
  shownPattern_.store(following_.pattern, std::memory_order_relaxed);

  const PatternRows& rows = patterns_[static_cast<std::size_t>(following_.pattern)];
  const auto on = [place](const std::atomic<StepRow>& row) {
    return ((row.load(std::memory_order_relaxed) >> place) & 1) != 0;
  };
  const int accent = on(rows[kAccentRow]) ? 1 : 0;
  for (int voice = 0; voice < kVoiceCount; ++voice) {
    if (on(rows[static_cast<std::size_t>(voice)])) snare_engine_trigger(engine, voiceTrack(voice), accent);
  }
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
  const HostTime host = readHost();
  hostTempo_.store(host.tempo, std::memory_order_relaxed);
  sendMix(engine, host.tempo);

  float* const left = buffer.getWritePointer(0);
  float* const right = buffer.getWritePointer(1);
  int rendered = 0;
  const auto renderTo = [&](int offset) {
    if (offset > rendered) snare_engine_render(engine, left + rendered, right + rendered, offset - rendered);
    rendered = juce::jmax(rendered, offset);
  };

  // The sequencer runs while the host does, from the host's place in the song.
  const StepGrid grid(beatSize_.load(std::memory_order_relaxed), swing_->load(std::memory_order_relaxed));
  const double beatFrames = framesPerBeat(host.tempo, engineSampleRate_);
  const bool sequencing = host.playing && sequencer_->load(std::memory_order_relaxed) >= 0.5f;
  if (sequencing) {
    followHost(host.beat, frames / beatFrames, grid);
  } else {
    following_.active = false;
    shownStep_.store(-1, std::memory_order_relaxed);
  }
  playAuditions(engine);
  // The frame the next step falls on, or `frames` when it is not in this block.
  const auto nextStepFrame = [&] {
    if (!sequencing) return frames;
    const double frame = std::floor((grid.beatOf(following_.nextStep) - host.beat) * beatFrames + 0.5);
    return static_cast<int>(juce::jlimit(static_cast<double>(rendered), static_cast<double>(frames), frame));
  };

  // Every hit, a note-on from the host or a step of the pattern, plays at its
  // own frame. The engine applies queued triggers at the start of the next
  // render call, so the block is split there: render up to the frame, queue
  // the trigger, carry on. A full queue drops the hit; there is nothing
  // useful to do about that here.
  //
  // MIDI events are read as raw bytes. Building a juce::MidiMessage could
  // allocate for long messages such as SysEx.
  auto note = midi.begin();
  const auto noteTrack = [&]() -> int {
    const juce::MidiMessageMetadata event = *note;
    if (event.numBytes != 3 || (event.data[0] & 0xf0) != 0x90) return -1;
    if ((event.data[2] & 0x7f) == 0) return -1;  // note-on with velocity 0 is a note-off
    return kNoteToTrack[static_cast<std::size_t>(event.data[1] & 0x7f)];
  };
  for (;;) {
    while (note != midi.end() && noteTrack() < 0) ++note;
    const int stepFrame = nextStepFrame();
    const bool noteLeft = note != midi.end();
    const int noteFrame = noteLeft ? juce::jlimit(rendered, frames, (*note).samplePosition) : frames;

    if (stepFrame < frames && stepFrame <= noteFrame) {
      renderTo(stepFrame);
      playStep(engine, following_.nextStep, grid);
      ++following_.nextStep;
    } else if (noteLeft) {
      renderTo(noteFrame);
      const int velocity = (*note).data[2] & 0x7f;
      snare_engine_trigger(engine, noteTrack(), velocity >= kAccentVelocity ? 1 : 0);
      ++note;
    } else {
      break;
    }
  }
  renderTo(frames);

  for (int channel = 2; channel < channels; ++channel) buffer.clear(channel, 0, frames);
  midi.clear();  // the plugin produces no MIDI
}

// ---- Editor -----------------------------------------------------------------

bool BoombapbotAudioProcessor::hasEditor() const { return true; }
juce::AudioProcessorEditor* BoombapbotAudioProcessor::createEditor() {
#if BOOMBAPBOT_WEB_PANEL
  return new BoombapbotWebEditor(*this);
#else
  return new BoombapbotEditor(*this);
#endif
}

// ---- Description ------------------------------------------------------------

const juce::String BoombapbotAudioProcessor::getName() const { return JucePlugin_Name; }
bool BoombapbotAudioProcessor::acceptsMidi() const { return true; }
bool BoombapbotAudioProcessor::producesMidi() const { return false; }
bool BoombapbotAudioProcessor::isMidiEffect() const { return false; }
double BoombapbotAudioProcessor::getTailLengthSeconds() const {
  return tailSeconds_.load(std::memory_order_relaxed);
}

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

  juce::XmlElement* const beat = state.createNewChildElement(kBeatTag);
  beat->setAttribute(kBeatName, beatName());
  beat->setAttribute(kBeatSize, beatSize_.load(std::memory_order_relaxed));
  beat->setAttribute(kBeatSelected, kVoices[static_cast<std::size_t>(selectedVoice())].id);
  for (const PatternRows& rows : patterns_) {
    juce::XmlElement* const pattern = beat->createNewChildElement(kPatternTag);
    pattern->setAttribute(kPatternAccents, rowText(rows[kAccentRow].load(std::memory_order_relaxed)));
    for (std::size_t voice = 0; voice < kVoices.size(); ++voice) {
      pattern->setAttribute(kVoices[voice].id, rowText(rows[voice].load(std::memory_order_relaxed)));
    }
  }
  state.createNewChildElement(kWindowTag)->setAttribute(kWindowScale, static_cast<double>(windowScale()));
  copyXmlToBinary(state, destData);
}

// A state that is cut short, is not this plugin's, is for another machine, or
// was written by a newer version is left unread. In one that is read, a value
// out of range is brought into it, a parameter it does not name goes to its
// resting value, and patterns it does not hold are empty.
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

  Beat beat;
  if (const juce::XmlElement* const saved = state->getChildByName(kBeatTag)) {
    beat.name = tidyBeatName(saved->getStringAttribute(kBeatName));
    const juce::String selected = saved->getStringAttribute(kBeatSelected);
    for (std::size_t voice = 0; voice < kVoices.size(); ++voice) {
      if (selected == kVoices[voice].id) beat.selectedVoice = static_cast<int>(voice);
    }
    const int size = saved->getIntAttribute(kBeatSize, kSizeRest);
    beat.size = validSize(size) ? size : kSizeRest;
    std::size_t index = 0;
    for (const juce::XmlElement* pattern : saved->getChildWithTagNameIterator(kPatternTag)) {
      if (index == beat.patterns.size()) break;
      BeatPattern& rows = beat.patterns[index++];
      rows.accents = rowFromText(pattern->getStringAttribute(kPatternAccents));
      for (std::size_t voice = 0; voice < kVoices.size(); ++voice) {
        rows.hits[voice] = rowFromText(pattern->getStringAttribute(kVoices[voice].id));
      }
    }
  }
  selectVoice(beat.selectedVoice);
  holdPatterns(beat);

  const juce::XmlElement* const window = state->getChildByName(kWindowTag);
  const double scale = window != nullptr ? window->getDoubleAttribute(kWindowScale, kWindowScaleRest) : kWindowScaleRest;
  setWindowScale(std::isfinite(scale) ? static_cast<float>(scale) : kWindowScaleRest);
}

// ---- The panel's side ---------------------------------------------------------

// A voice key pressed on the panel. The engine's queue belongs to the audio
// thread, so the press is left as a bit for the next block to play.
void BoombapbotAudioProcessor::audition(int voice) {
  if (voice >= 0 && voice < kVoiceCount) auditions_.fetch_or(1u << voice, std::memory_order_relaxed);
}

void BoombapbotAudioProcessor::playAuditions(SnareEngine* engine) {
  const std::uint32_t pressed = auditions_.exchange(0, std::memory_order_relaxed);
  for (int voice = 0; pressed != 0 && voice < kVoiceCount; ++voice) {
    if ((pressed >> voice) & 1u) snare_engine_trigger(engine, voiceTrack(voice), 1);
  }
}

bool BoombapbotAudioProcessor::stepOn(int pattern, int row, int step) const {
  if (pattern < 0 || pattern >= kPatternCount || row < 0 || row > kVoiceCount || step < 0 || step >= kSteps) return false;
  const StepRow steps = patterns_[static_cast<std::size_t>(pattern)][static_cast<std::size_t>(row)].load(
      std::memory_order_relaxed);
  return ((steps >> step) & 1) != 0;
}

void BoombapbotAudioProcessor::setStep(int pattern, int row, int step, bool on) {
  if (pattern < 0 || pattern >= kPatternCount || row < 0 || row > kVoiceCount || step < 0 || step >= kSteps) return;
  std::atomic<StepRow>& steps = patterns_[static_cast<std::size_t>(pattern)][static_cast<std::size_t>(row)];
  const auto bit = static_cast<StepRow>(1u << step);
  if (on) {
    steps.fetch_or(bit, std::memory_order_relaxed);
  } else {
    steps.fetch_and(static_cast<StepRow>(~bit), std::memory_order_relaxed);
  }
  patternsChanged();
}

void BoombapbotAudioProcessor::clearPattern(int pattern) {
  if (pattern < 0 || pattern >= kPatternCount) return;
  rememberPatterns();
  for (std::atomic<StepRow>& row : patterns_[static_cast<std::size_t>(pattern)]) row.store(0, std::memory_order_relaxed);
  patternsChanged();
}

void BoombapbotAudioProcessor::rollDice(int pattern, int voice, juce::Random& random) {
  if (pattern < 0 || pattern >= kPatternCount || voice < 0 || voice >= kVoiceCount) return;
  rememberPatterns();
  const int size = measureSize();
  StepRow row = 0;
  for (int step = 0; step < size; ++step) {
    if (random.nextDouble() < diceChance(step, size)) row = static_cast<StepRow>(row | (1u << step));
  }
  patterns_[static_cast<std::size_t>(pattern)][static_cast<std::size_t>(voice)].store(row, std::memory_order_relaxed);
  patternsChanged();
}

void BoombapbotAudioProcessor::patternsChanged() {
  updateHostDisplay(ChangeDetails().withNonParameterStateChanged(true));
  sendChangeMessage();
}

BoombapbotAudioProcessor::PatternsThen BoombapbotAudioProcessor::patternsNow() const {
  PatternsThen now;
  for (std::size_t pattern = 0; pattern < patterns_.size(); ++pattern) {
    for (std::size_t row = 0; row < patterns_[pattern].size(); ++row) {
      now.rows[pattern][row] = patterns_[pattern][row].load(std::memory_order_relaxed);
    }
  }
  now.size = measureSize();
  return now;
}

// A moment that is the same as the last one remembered is not kept twice.
void BoombapbotAudioProcessor::rememberPatterns() {
  const PatternsThen now = patternsNow();
  const std::lock_guard<std::mutex> lock(historyLock_);
  if (!history_.empty() && history_.back() == now) return;
  if (history_.size() == kHistoryLongest) history_.erase(history_.begin());
  history_.push_back(now);
}

bool BoombapbotAudioProcessor::canUndoPatterns() const {
  const PatternsThen now = patternsNow();
  const std::lock_guard<std::mutex> lock(historyLock_);
  return std::any_of(history_.begin(), history_.end(), [&](const PatternsThen& then) { return !(then == now); });
}

// Goes back to the last remembered moment that differs from this one.
bool BoombapbotAudioProcessor::undoPatterns() {
  const PatternsThen now = patternsNow();
  PatternsThen then;
  {
    const std::lock_guard<std::mutex> lock(historyLock_);
    while (!history_.empty() && history_.back() == now) history_.pop_back();
    if (history_.empty()) return false;
    then = history_.back();
    history_.pop_back();
  }
  for (std::size_t pattern = 0; pattern < patterns_.size(); ++pattern) {
    for (std::size_t row = 0; row < patterns_[pattern].size(); ++row) {
      patterns_[pattern][row].store(then.rows[pattern][row], std::memory_order_relaxed);
    }
  }
  beatSize_.store(then.size, std::memory_order_relaxed);
  patternsChanged();
  return true;
}

void BoombapbotAudioProcessor::selectVoice(int voice) {
  if (voice >= 0 && voice < kVoiceCount) selectedVoice_.store(voice, std::memory_order_relaxed);
}

int BoombapbotAudioProcessor::selectedVoice() const { return selectedVoice_.load(std::memory_order_relaxed); }

float BoombapbotAudioProcessor::windowScale() const { return windowScale_.load(std::memory_order_relaxed); }

void BoombapbotAudioProcessor::setWindowScale(float scale) {
  windowScale_.store(juce::jlimit(kWindowScaleLeast, kWindowScaleMost, scale), std::memory_order_relaxed);
}

int BoombapbotAudioProcessor::measureSize() const { return beatSize_.load(std::memory_order_relaxed); }

void BoombapbotAudioProcessor::setMeasureSize(int size) {
  if (!validSize(size) || size == measureSize()) return;
  rememberPatterns();
  beatSize_.store(size, std::memory_order_relaxed);
  updateHostDisplay(ChangeDetails().withNonParameterStateChanged(true));
  sendChangeMessage();
}

int BoombapbotAudioProcessor::playingStep() const { return shownStep_.load(std::memory_order_relaxed); }
int BoombapbotAudioProcessor::playingPattern() const { return shownPattern_.load(std::memory_order_relaxed); }

// ---- Beats --------------------------------------------------------------------

void BoombapbotAudioProcessor::holdPatterns(const Beat& beat) {
  for (std::size_t index = 0; index < patterns_.size(); ++index) {
    const BeatPattern& pattern = beat.patterns[index];
    for (std::size_t voice = 0; voice < kVoices.size(); ++voice) {
      patterns_[index][voice].store(pattern.hits[voice], std::memory_order_relaxed);
    }
    patterns_[index][kAccentRow].store(pattern.accents, std::memory_order_relaxed);
  }
  beatSize_.store(beat.size, std::memory_order_relaxed);
  {
    const std::lock_guard<std::mutex> lock(beatNameLock_);
    beatName_ = beat.name;
  }
  sendChangeMessage();
}

void BoombapbotAudioProcessor::setBeatName(const juce::String& name) {
  const juce::String tidy = tidyBeatName(name);
  {
    const std::lock_guard<std::mutex> lock(beatNameLock_);
    if (tidy == beatName_) return;
    beatName_ = tidy;
  }
  updateHostDisplay(ChangeDetails().withNonParameterStateChanged(true));
  sendChangeMessage();
}

juce::String BoombapbotAudioProcessor::beatName() const {
  const std::lock_guard<std::mutex> lock(beatNameLock_);
  return beatName_;
}

void BoombapbotAudioProcessor::setParameterTo(const juce::String& id, float value) {
  juce::RangedAudioParameter* const parameter = parameters_.getParameter(id);
  jassert(parameter != nullptr);
  if (parameter == nullptr) return;
  // A parameter already there is left alone, so the host is told only of what changed.
  const float wanted = parameter->convertTo0to1(value);
  if (!juce::exactlyEqual(wanted, parameter->getValue())) parameter->setValueNotifyingHost(wanted);
}

Beat BoombapbotAudioProcessor::currentBeat() const {
  Beat beat;
  beat.name = beatName();
  beat.tempo = juce::roundToInt(juce::jlimit(SNARE_BPM_MIN, SNARE_BPM_MAX, hostTempo_.load(std::memory_order_relaxed)));
  beat.swing = swing_->load(std::memory_order_relaxed);
  beat.size = measureSize();
  for (std::size_t index = 0; index < patterns_.size(); ++index) {
    for (std::size_t voice = 0; voice < kVoices.size(); ++voice) {
      beat.patterns[index].hits[voice] = patterns_[index][voice].load(std::memory_order_relaxed);
    }
    beat.patterns[index].accents = patterns_[index][kAccentRow].load(std::memory_order_relaxed);
  }
  beat.pattern = chosenPattern();
  beat.selectedVoice = selectedVoice();
  beat.volume = volume_->load(std::memory_order_relaxed);
  beat.accent = accent_->load(std::memory_order_relaxed);
  for (std::size_t voice = 0; voice < kVoices.size(); ++voice) {
    const VoiceParameters& values = voiceParameters_[voice];
    beat.voices[voice] = {values.pitch->load(std::memory_order_relaxed), values.tone->load(std::memory_order_relaxed),
                          values.decay->load(std::memory_order_relaxed), values.level->load(std::memory_order_relaxed),
                          values.mute->load(std::memory_order_relaxed) >= 0.5f};
  }
  beat.effect = juce::roundToInt(effectKind_->load(std::memory_order_relaxed));
  beat.effectMix = effectMix_->load(std::memory_order_relaxed);
  return beat;
}

// The beat's tempo is not taken: in a host, the host keeps time.
void BoombapbotAudioProcessor::applyBeat(const Beat& beat) {
  for (std::size_t index = 0; index < kVoices.size(); ++index) {
    const VoiceSpec& voice = kVoices[index];
    const BeatVoice& knobs = beat.voices[index];
    setParameterTo(ids::ofVoice(voice, ids::kPitch), knobs.pitch);
    setParameterTo(ids::ofVoice(voice, ids::kTone), knobs.tone);
    setParameterTo(ids::ofVoice(voice, ids::kDecay), knobs.decay);
    setParameterTo(ids::ofVoice(voice, ids::kLevel), knobs.level);
    setParameterTo(ids::ofVoice(voice, ids::kMute), knobs.muted ? 1.0f : 0.0f);
  }
  setParameterTo(ids::kVolume, beat.volume);
  setParameterTo(ids::kAccent, beat.accent);
  setParameterTo(ids::kSwing, beat.swing);
  setParameterTo(ids::kEffectKind, static_cast<float>(beat.effect));
  setParameterTo(ids::kEffectMix, beat.effectMix);
  setParameterTo(ids::kPattern, static_cast<float>(beat.pattern));

  selectVoice(beat.selectedVoice);
  holdPatterns(beat);
  updateHostDisplay(ChangeDetails().withNonParameterStateChanged(true));
}

juce::Result BoombapbotAudioProcessor::loadBeat(const juce::String& json) {
  Beat beat;
  if (const juce::Result read = readBeat(json, beat); read.failed()) return read;
  rememberPatterns();
  applyBeat(beat);
  return juce::Result::ok();
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new BoombapbotAudioProcessor(); }
