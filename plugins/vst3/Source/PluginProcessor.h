// boombapbot as a VST3 instrument: РИТМ-12's eight voices played from MIDI
// notes on top of the shared render engine, with its knobs as host parameters.
// It follows the host's tempo, and plays the patterns of a beat saved from the
// site in time with the host's transport.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include <boombapbot/engine.h>

#include "BeatFile.h"
#include "MachineRitm12.h"
#include "Sequencer.h"

#include <array>
#include <atomic>
#include <memory>
#include <mutex>

class BoombapbotAudioProcessor final : public juce::AudioProcessor, public juce::ChangeBroadcaster {
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

  // Takes the text of a beat file saved from the site: its patterns, and its
  // knobs as parameter values. A file that is not a beat changes nothing and
  // the result says why. Not for the audio thread.
  juce::Result loadBeat(const juce::String& json);
  // The name of the beat whose patterns are held, or nothing.
  juce::String beatName() const;
  void setBeatName(const juce::String& name);
  // The plugin as a beat: its patterns, and its parameters as the beat's knobs,
  // at the tempo the host last gave. Not for the audio thread.
  boombapbot::plugin::Beat currentBeat() const;

  // What the panel works: the parameters, the steps of the patterns, how many
  // steps a measure has, a voice key pressed, and where the sequencer is.
  // Rows 0 to 7 are the voices' hits and row 8 is the accents. None of these
  // are for the audio thread.
  static constexpr int kAccentsRow = boombapbot::plugin::kVoiceCount;
  juce::AudioProcessorValueTreeState& parameters() { return parameters_; }
  bool stepOn(int pattern, int row, int step) const;
  void setStep(int pattern, int row, int step, bool on);
  void clearPattern(int pattern);
  int measureSize() const;
  void setMeasureSize(int size);
  void audition(int voice);
  // The voice whose key was pressed last on the panel. It is saved with a beat.
  void selectVoice(int voice);
  int selectedVoice() const;
  // The step the sequencer last played in its measure, or -1 when it is not playing.
  int playingStep() const;
  int playingPattern() const;

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
    std::atomic<float>* mute;
  };

  // What the host says about time for one block. A host that is playing has
  // said where in the song the block starts.
  struct HostTime {
    double tempo;
    bool playing;
    double beat;
  };

  // A pattern's rows: one for each voice, then the accents.
  using PatternRows = std::array<std::atomic<boombapbot::plugin::StepRow>, boombapbot::plugin::kVoiceCount + 1>;

  enum class Voices { changed, all };

  class SoundThread;

  SoundKnobs soundKnobs(int voice) const;
  // Sets up a new engine's tracks and fixed mix. Before the engine is rendered.
  void loadMachine(SnareEngine* engine);
  // Synthesises voices from their knobs and hands them to the engine. It
  // allocates, so it runs on the sound thread, in prepareToPlay, or in
  // processBlock only while the host renders offline.
  void refreshSounds(Voices which);
  // Queues level, accent, volume, effect and tempo changes. Audio thread only.
  void sendMix(SnareEngine* engine, double tempo);
  HostTime readHost() const;
  // Finds the sequencer's place for a block that starts at `beat`. Audio thread only.
  void followHost(double beat, double blockBeats, const boombapbot::plugin::StepGrid& grid);
  // Plays the hits one step of the playing pattern holds. Audio thread only.
  void playStep(SnareEngine* engine, std::int64_t step, const boombapbot::plugin::StepGrid& grid);
  int chosenPattern() const;
  // Plays the voice keys pressed on the panel since the last block. Audio thread only.
  void playAuditions(SnareEngine* engine);
  void setParameterTo(const juce::String& id, float value);
  void holdPatterns(const boombapbot::plugin::Beat& beat);
  double tailSecondsAt(double bpm) const;
  void stopSoundThread();

  juce::AudioProcessorValueTreeState parameters_;
  std::array<VoiceParameters, boombapbot::plugin::kVoiceCount> voiceParameters_{};
  std::atomic<float>* volume_ = nullptr;
  std::atomic<float>* effectKind_ = nullptr;
  std::atomic<float>* effectMix_ = nullptr;
  std::atomic<float>* accent_ = nullptr;
  std::atomic<float>* swing_ = nullptr;
  std::atomic<float>* pattern_ = nullptr;
  std::atomic<float>* sequencer_ = nullptr;

  // The beat's patterns. Written when a beat or a state is loaded and read by
  // the audio thread, a row at a time, with no lock.
  std::array<PatternRows, boombapbot::plugin::kPatternCount> patterns_{};
  std::atomic<int> beatSize_{boombapbot::plugin::kSizeRest};
  std::atomic<std::uint32_t> auditions_{0};
  std::atomic<int> selectedVoice_{0};
  std::atomic<double> hostTempo_{boombapbot::plugin::kTempoRest};
  std::atomic<int> shownStep_{-1};
  std::atomic<int> shownPattern_{0};
  mutable std::mutex beatNameLock_;
  juce::String beatName_;

  std::unique_ptr<SnareEngine, EngineDeleter> engine_;
  double engineSampleRate_ = 0.0;
  double longestSoundSeconds_ = 0.0;
  std::atomic<double> tailSeconds_{0.0};

  // What the engine was last sent. Audio thread only once it is rendering.
  std::array<double, boombapbot::plugin::kVoiceCount> sentGains_{};
  float sentAccent_ = 0.0f;
  float sentVolume_ = 0.0f;
  int sentEffect_ = 0;
  float sentEffectMix_ = 0.0f;
  double sentTempo_ = 0.0;
  bool mixSent_ = false;

  // Where the sequencer is in the host's song. Audio thread only.
  struct Following {
    bool active = false;
    double expectedBeat = 0.0;  // where the next block starts if the host plays on
    std::int64_t nextStep = 0;
    int stepsPerBeat = 0;
    int pattern = 0;
  };
  Following following_;

  // The knobs each voice's current samples were made from.
  std::mutex soundLock_;
  std::array<SoundKnobs, boombapbot::plugin::kVoiceCount> soundsMade_{};

  std::unique_ptr<SoundThread> soundThread_;

  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BoombapbotAudioProcessor)
};
