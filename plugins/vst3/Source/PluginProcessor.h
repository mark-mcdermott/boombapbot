// boombapbot as a VST3 instrument: РИТМ-12's eight voices played from MIDI
// notes on top of the shared render engine, with its knobs as host parameters.
// It follows the host's tempo. No sequencer yet.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include <boombapbot/engine.h>

#include "MachineRitm12.h"

#include <array>
#include <atomic>
#include <memory>
#include <mutex>

class BoombapbotAudioProcessor final : public juce::AudioProcessor {
 public:
  BoombapbotAudioProcessor();
  ~BoombapbotAudioProcessor() override;

  void prepareToPlay(double sampleRate, int samplesPerBlock) override;
  void releaseResources() override;
  bool isBusesLayoutSupported(const BusesLayout& layouts) const override;

  void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) override;
  using juce::AudioProcessor::processBlock;

  juce::AudioProcessorEditor* createEditor() override;
  bool hasEditor() const override;

  const juce::String getName() const override;
  bool acceptsMidi() const override;
  bool producesMidi() const override;
  bool isMidiEffect() const override;
  double getTailLengthSeconds() const override;

  int getNumPrograms() override;
  int getCurrentProgram() override;
  void setCurrentProgram(int index) override;
  const juce::String getProgramName(int index) override;
  void changeProgramName(int index, const juce::String& newName) override;

  void getStateInformation(juce::MemoryBlock& destData) override;
  void setStateInformation(const void* data, int sizeInBytes) override;

 private:
  struct EngineDeleter {
    void operator()(SnareEngine* engine) const { snare_engine_destroy(engine); }
  };

  // The knobs a voice's samples are synthesised from.
  struct SoundKnobs {
    float pitch;
    float tone;
    float decay;
  };

  // Where the host's parameter values are read from, on any thread.
  struct VoiceParameters {
    std::atomic<float>* pitch;
    std::atomic<float>* tone;
    std::atomic<float>* decay;
    std::atomic<float>* level;
  };

  enum class Voices { changed, all };

  class SoundThread;

  SoundKnobs soundKnobs(int voice) const;
  // Sets up a new engine's tracks and fixed mix. Before the engine is rendered.
  void loadMachine(SnareEngine* engine);
  // Synthesises voices from their knobs and hands them to the engine. It
  // allocates, so it runs on the sound thread, in prepareToPlay, or in
  // processBlock only while the host renders offline.
  void refreshSounds(Voices which);
  // Queues level, volume, effect and tempo changes. Audio thread only.
  void sendMix(SnareEngine* engine);
  double hostTempo() const;
  double tailSecondsAt(double bpm) const;
  void stopSoundThread();

  juce::AudioProcessorValueTreeState parameters_;
  std::array<VoiceParameters, boombapbot::plugin::kVoiceCount> voiceParameters_{};
  std::atomic<float>* volume_ = nullptr;
  std::atomic<float>* effectKind_ = nullptr;
  std::atomic<float>* effectMix_ = nullptr;

  std::unique_ptr<SnareEngine, EngineDeleter> engine_;
  double engineSampleRate_ = 0.0;
  double longestSoundSeconds_ = 0.0;
  std::atomic<double> tailSeconds_{0.0};

  // What the engine was last sent. Audio thread only once it is rendering.
  std::array<float, boombapbot::plugin::kVoiceCount> sentLevels_{};
  float sentVolume_ = 0.0f;
  int sentEffect_ = 0;
  float sentEffectMix_ = 0.0f;
  double sentTempo_ = 0.0;
  bool mixSent_ = false;

  // The knobs each voice's current samples were made from.
  std::mutex soundLock_;
  std::array<SoundKnobs, boombapbot::plugin::kVoiceCount> soundsMade_{};

  std::unique_ptr<SoundThread> soundThread_;

  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BoombapbotAudioProcessor)
};
