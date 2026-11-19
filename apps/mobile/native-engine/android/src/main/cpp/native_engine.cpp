// The engine and the phone's sound, for the plug-in's Java (EngineNative).
//
// The Oboe stream's data callback is the only caller of snare_engine_render.
// It renders into buffers made with it, takes no lock and allocates nothing,
// and what it leaves for the control thread to read are atomics. Every other
// call here is made on the plug-in's control thread.
#include <jni.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>

#include <oboe/Oboe.h>

#include "boombapbot/engine.h"

namespace {

// A buffer the device asks for is rendered this many frames at a time.
constexpr int32_t kScratchFrames = 4096;
// The most measures read from the log at once, five numbers each.
constexpr int kMeasureFields = 5;

static_assert(std::atomic<uint32_t>::is_always_lock_free && std::atomic<uint64_t>::is_always_lock_free &&
                  std::atomic<bool>::is_always_lock_free,
              "the audio thread's atomics must not lock");

// The audio thread's half of an engine.
class Renderer {
 public:
  explicit Renderer(SnareEngine* engine) : engine_(engine) {}

  // Renders the next frames into a buffer of interleaved samples: left and
  // right on its first two channels and silence on any others, or the two
  // mixed down for a device with one.
  void fill(float* out, int32_t frames, int32_t channels) {
    channels = std::max(channels, 1);
    float peak = 0.0f;
    for (int32_t done = 0; done < frames;) {
      const int32_t count = std::min(frames - done, kScratchFrames);
      snare_engine_render(engine_, left_, right_, count);
      float* frame = out + static_cast<std::size_t>(done) * static_cast<std::size_t>(channels);
      for (int32_t i = 0; i < count; ++i, frame += channels) {
        // fmax passes over a sample that is not a number.
        peak = std::fmax(peak, std::fmax(std::fabs(left_[i]), std::fabs(right_[i])));
        if (channels == 1) {
          frame[0] = 0.5f * (left_[i] + right_[i]);
          continue;
        }
        frame[0] = left_[i];
        frame[1] = right_[i];
        for (int32_t channel = 2; channel < channels; ++channel) frame[channel] = 0.0f;
      }
      done += count;
    }
    notePeak(peak);
    buffers_.fetch_add(1, std::memory_order_relaxed);
  }

  // The largest absolute sample since the last call, which starts the next one from silence.
  float takePeak() {
    const uint32_t bits = peakBits_.exchange(0, std::memory_order_relaxed);
    float peak;
    std::memcpy(&peak, &bits, sizeof peak);
    return peak;
  }

  uint64_t buffers() const { return buffers_.load(std::memory_order_relaxed); }

 private:
  // The bits of a float that is not negative order as the float does.
  void notePeak(float peak) {
    uint32_t bits;
    std::memcpy(&bits, &peak, sizeof bits);
    uint32_t seen = peakBits_.load(std::memory_order_relaxed);
    while (bits > seen && !peakBits_.compare_exchange_weak(seen, bits, std::memory_order_relaxed)) {
    }
  }

  SnareEngine* engine_;
  float left_[kScratchFrames] = {};
  float right_[kScratchFrames] = {};
  std::atomic<uint32_t> peakBits_{0};
  std::atomic<uint64_t> buffers_{0};
};

// An engine and the Oboe stream that plays it, made at the device's rate.
class Output final : public oboe::AudioStreamDataCallback, public oboe::AudioStreamErrorCallback {
 public:
  // Opens the default output and starts it. Empty, with `error` said, when it cannot.
  static std::unique_ptr<Output> open(std::string& error) {
    std::unique_ptr<Output> output(new Output());
    oboe::AudioStreamBuilder builder;
    builder.setDirection(oboe::Direction::Output)
        ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
        ->setSharingMode(oboe::SharingMode::Exclusive)
        ->setFormat(oboe::AudioFormat::Float)
        ->setFormatConversionAllowed(true)
        ->setChannelCount(oboe::ChannelCount::Stereo)
        ->setChannelConversionAllowed(true)
        ->setUsage(oboe::Usage::Media)
        ->setContentType(oboe::ContentType::Music)
        ->setDataCallback(output.get())
        ->setErrorCallback(output.get());
    const oboe::Result opened = builder.openStream(output->stream_);
    if (opened != oboe::Result::OK) {
      error = std::string("The phone's sound could not be opened: ") + oboe::convertToText(opened);
      return nullptr;
    }
    if (output->stream_->getFormat() != oboe::AudioFormat::Float) {
      error = "The phone's sound does not take float samples.";
      return nullptr;
    }
    output->rate_ = output->stream_->getSampleRate();
    output->channels_ = output->stream_->getChannelCount();
    output->engine_ = snare_engine_create(output->rate_);
    if (!output->engine_) {
      error = "The engine cannot run at " + std::to_string(output->rate_) + " Hz.";
      return nullptr;
    }
    output->renderer_ = std::make_unique<Renderer>(output->engine_);
    const oboe::Result started = output->stream_->requestStart();
    if (started != oboe::Result::OK) {
      error = std::string("The phone's sound did not start: ") + oboe::convertToText(started);
      return nullptr;
    }
    return output;
  }

  // The stream stops and closes first, so its callback is done before the engine goes.
  ~Output() override {
    if (stream_) {
      stream_->stop();
      stream_->close();
    }
    renderer_.reset();
    if (engine_) snare_engine_destroy(engine_);
  }

  oboe::DataCallbackResult onAudioReady(oboe::AudioStream*, void* data, int32_t frames) override {
    renderer_->fill(static_cast<float*>(data), frames, channels_);
    return oboe::DataCallbackResult::Continue;
  }

  // The device left or changed, and Oboe has closed the stream. The control
  // thread hears of it at its next look and makes everything again.
  void onErrorAfterClose(oboe::AudioStream*, oboe::Result) override { lost_.store(true, std::memory_order_relaxed); }

  SnareEngine* engine() const { return engine_; }
  Renderer* renderer() const { return renderer_.get(); }
  int32_t rate() const { return rate_; }
  int32_t channels() const { return channels_; }
  bool takeLost() { return lost_.exchange(false, std::memory_order_relaxed); }
  int32_t bufferFrames() const { return stream_->getBufferSizeInFrames(); }
  int32_t burstFrames() const { return stream_->getFramesPerBurst(); }
  int32_t deviceId() const { return stream_->getDeviceId(); }
  const char* audioApi() const { return stream_->getAudioApi() == oboe::AudioApi::AAudio ? "AAudio" : "OpenSL ES"; }
  bool exclusive() const { return stream_->getSharingMode() == oboe::SharingMode::Exclusive; }

 private:
  Output() = default;

  std::shared_ptr<oboe::AudioStream> stream_;
  SnareEngine* engine_ = nullptr;
  std::unique_ptr<Renderer> renderer_;
  int32_t rate_ = 0;
  int32_t channels_ = 2;
  std::atomic<bool> lost_{false};
};

// A handle is a pointer widened to Java's long through uintptr_t, so that on a
// 32-bit phone it is zero-extended and comes back the same pointer.
template <typename Pointer>
Pointer* pointerOf(jlong handle) {
  return reinterpret_cast<Pointer*>(static_cast<std::uintptr_t>(handle));
}
SnareEngine* engineOf(jlong handle) { return pointerOf<SnareEngine>(handle); }
Renderer* rendererOf(jlong handle) { return pointerOf<Renderer>(handle); }
Output* outputOf(jlong handle) { return pointerOf<Output>(handle); }
template <typename Pointer>
jlong handleOf(Pointer* pointer) {
  return static_cast<jlong>(reinterpret_cast<std::uintptr_t>(pointer));
}

}  // namespace

#define NATIVE(type, name) extern "C" JNIEXPORT type JNICALL Java_com_boombapbot_engine_EngineNative_##name

// ---- The engine (control thread) -------------------------------------------

NATIVE(jint, abiVersion)(JNIEnv*, jclass) { return static_cast<jint>(snare_abi_version()); }

NATIVE(jlong, engineCreate)(JNIEnv*, jclass, jdouble rate) { return handleOf(snare_engine_create(rate)); }

NATIVE(void, engineDestroy)(JNIEnv*, jclass, jlong engine) { snare_engine_destroy(engineOf(engine)); }

NATIVE(jint, synthSound)(JNIEnv*, jclass, jlong engine, jint sound, jfloat tune, jfloat tone, jfloat decay,
                         jfloat snappy) {
  const SnareSoundParams params{sound, tune, tone, decay, snappy, 0};
  return snare_engine_synth_sound(engineOf(engine), &params);
}

NATIVE(jint, setTempo)(JNIEnv*, jclass, jlong engine, jdouble bpm) { return snare_engine_set_tempo(engineOf(engine), bpm); }

NATIVE(jint, setTrack)(JNIEnv*, jclass, jlong engine, jint track, jint slot, jfloat pan, jint choke) {
  return snare_engine_set_track(engineOf(engine), track, slot, pan, choke);
}

NATIVE(jint, setTrackLevel)(JNIEnv*, jclass, jlong engine, jint track, jdouble gain) {
  return snare_engine_set_track_level(engineOf(engine), track, gain);
}

NATIVE(jint, setAccent)(JNIEnv*, jclass, jlong engine, jdouble plain, jdouble accented) {
  return snare_engine_set_accent(engineOf(engine), plain, accented);
}

NATIVE(jint, setMasterVolume)(JNIEnv*, jclass, jlong engine, jdouble volume) {
  return snare_engine_set_master_volume(engineOf(engine), volume);
}

NATIVE(jint, setEffect)(JNIEnv*, jclass, jlong engine, jint effect, jdouble wet) {
  return snare_engine_set_effect(engineOf(engine), effect, wet);
}

NATIVE(jint, setPattern)(JNIEnv* env, jclass, jlong engine, jint index, jintArray rows, jint firstLength,
                         jint secondLength, jint stepsPerBeat, jint swing) {
  SnarePattern pattern{};
  const jsize count = env->GetArrayLength(rows);
  if (count > SNARE_TRACKS) return SNARE_ERR_BAD_ARGUMENT;
  jint bits[SNARE_TRACKS] = {};
  env->GetIntArrayRegion(rows, 0, count, bits);
  for (jsize track = 0; track < count; ++track) pattern.rows[track] = static_cast<uint32_t>(bits[track]);
  pattern.len1 = static_cast<uint8_t>(firstLength);
  pattern.len2 = static_cast<uint8_t>(secondLength);
  pattern.steps_per_beat = static_cast<uint8_t>(stepsPerBeat);
  pattern.swing = static_cast<uint8_t>(swing);
  return snare_engine_set_pattern(engineOf(engine), index, &pattern);
}

NATIVE(jint, cuePattern)(JNIEnv*, jclass, jlong engine, jint index) { return snare_engine_cue_pattern(engineOf(engine), index); }

NATIVE(jint, setPanel)(JNIEnv*, jclass, jlong engine, jint rhythm, jint variation, jint fillRhythm, jint fillVariation,
                       jint autoFill, jboolean firstBeatRule) {
  SnarePanel panel{};
  panel.rhythm = static_cast<uint8_t>(rhythm);
  panel.variation = static_cast<uint8_t>(variation);
  panel.fill_rhythm = static_cast<uint8_t>(fillRhythm);
  panel.fill_variation = static_cast<uint8_t>(fillVariation);
  panel.auto_fill = static_cast<uint8_t>(autoFill);
  panel.first_beat_rule = firstBeatRule ? 1 : 0;
  return snare_engine_set_panel(engineOf(engine), &panel);
}

NATIVE(jint, setSong)(JNIEnv* env, jclass, jlong engine, jbyteArray rhythms, jboolean loop) {
  const jsize count = env->GetArrayLength(rhythms);
  if (count > SNARE_SONG_MEASURES) return SNARE_ERR_TOO_LARGE;
  uint8_t song[SNARE_SONG_MEASURES];
  env->GetByteArrayRegion(rhythms, 0, count, reinterpret_cast<jbyte*>(song));
  return snare_engine_set_song(engineOf(engine), song, count, loop ? 1 : 0);
}

NATIVE(jint, armFill)(JNIEnv*, jclass, jlong engine, jboolean armed) { return snare_engine_arm_fill(engineOf(engine), armed ? 1 : 0); }
NATIVE(jint, play)(JNIEnv*, jclass, jlong engine) { return snare_engine_play(engineOf(engine)); }
NATIVE(jint, stop)(JNIEnv*, jclass, jlong engine) { return snare_engine_stop(engineOf(engine)); }

NATIVE(jint, trigger)(JNIEnv*, jclass, jlong engine, jint track, jboolean accent) {
  return snare_engine_trigger(engineOf(engine), track, accent ? 1 : 0);
}

NATIVE(void, collect)(JNIEnv*, jclass, jlong engine) { snare_engine_collect(engineOf(engine)); }

NATIVE(jint, readMeasures)(JNIEnv* env, jclass, jlong engine, jdoubleArray out) {
  constexpr int kBatch = 16;
  SnareMeasure measures[kBatch];
  const int capacity = std::min(kBatch, static_cast<int>(env->GetArrayLength(out)) / kMeasureFields);
  const int count = snare_engine_read_measures(engineOf(engine), measures, capacity);
  jdouble fields[kBatch * kMeasureFields];
  for (int i = 0; i < count; ++i) {
    jdouble* field = fields + i * kMeasureFields;
    field[0] = measures[i].frame;
    field[1] = measures[i].ordinal;
    field[2] = measures[i].pattern;
    field[3] = measures[i].kind;
    field[4] = measures[i].position;
  }
  env->SetDoubleArrayRegion(out, 0, count * kMeasureFields, fields);
  return count;
}

NATIVE(jboolean, isPlaying)(JNIEnv*, jclass, jlong engine) { return snare_engine_is_playing(engineOf(engine)) != 0; }
NATIVE(jint, currentStep)(JNIEnv*, jclass, jlong engine) { return snare_engine_current_step(engineOf(engine)); }
NATIVE(jint, currentPattern)(JNIEnv*, jclass, jlong engine) { return snare_engine_current_pattern(engineOf(engine)); }
NATIVE(jdouble, framesRendered)(JNIEnv*, jclass, jlong engine) { return snare_engine_frames_rendered(engineOf(engine)); }
NATIVE(jdouble, stopFrame)(JNIEnv*, jclass, jlong engine) { return snare_engine_stop_frame(engineOf(engine)); }
NATIVE(jint, activeVoices)(JNIEnv*, jclass, jlong engine) { return snare_engine_active_voices(engineOf(engine)); }
NATIVE(jlong, stolenVoices)(JNIEnv*, jclass, jlong engine) { return snare_engine_stolen_voices(engineOf(engine)); }
NATIVE(jdouble, outputLevel)(JNIEnv*, jclass, jlong engine) { return snare_engine_output_level(engineOf(engine)); }

// ---- A renderer with no stream, for tests ------------------------------------

NATIVE(jlong, rendererCreate)(JNIEnv*, jclass, jlong engine) { return handleOf(new Renderer(engineOf(engine))); }
NATIVE(void, rendererDestroy)(JNIEnv*, jclass, jlong renderer) { delete rendererOf(renderer); }

NATIVE(void, rendererFill)(JNIEnv* env, jclass, jlong renderer, jfloatArray out, jint frames, jint channels) {
  jfloat* samples = env->GetFloatArrayElements(out, nullptr);
  rendererOf(renderer)->fill(samples, frames, channels);
  env->ReleaseFloatArrayElements(out, samples, 0);
}

NATIVE(jfloat, rendererTakePeak)(JNIEnv*, jclass, jlong renderer) { return rendererOf(renderer)->takePeak(); }
NATIVE(jlong, rendererBuffers)(JNIEnv*, jclass, jlong renderer) { return static_cast<jlong>(rendererOf(renderer)->buffers()); }

// ---- The phone's sound (control thread) ----------------------------------------

NATIVE(jlong, outputOpen)(JNIEnv* env, jclass) {
  std::string error;
  std::unique_ptr<Output> output = Output::open(error);
  if (!output) {
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), error.c_str());
    return 0;
  }
  return handleOf(output.release());
}

NATIVE(void, outputClose)(JNIEnv*, jclass, jlong output) { delete outputOf(output); }
NATIVE(jlong, outputEngine)(JNIEnv*, jclass, jlong output) { return handleOf(outputOf(output)->engine()); }
NATIVE(jlong, outputRenderer)(JNIEnv*, jclass, jlong output) { return handleOf(outputOf(output)->renderer()); }
NATIVE(jint, outputSampleRate)(JNIEnv*, jclass, jlong output) { return outputOf(output)->rate(); }
NATIVE(jint, outputChannels)(JNIEnv*, jclass, jlong output) { return outputOf(output)->channels(); }
NATIVE(jboolean, outputTakeLost)(JNIEnv*, jclass, jlong output) { return outputOf(output)->takeLost(); }
NATIVE(jint, outputBufferFrames)(JNIEnv*, jclass, jlong output) { return outputOf(output)->bufferFrames(); }
NATIVE(jint, outputBurstFrames)(JNIEnv*, jclass, jlong output) { return outputOf(output)->burstFrames(); }
NATIVE(jint, outputDeviceId)(JNIEnv*, jclass, jlong output) { return outputOf(output)->deviceId(); }
NATIVE(jstring, outputAudioApi)(JNIEnv* env, jclass, jlong output) { return env->NewStringUTF(outputOf(output)->audioApi()); }
NATIVE(jboolean, outputExclusive)(JNIEnv*, jclass, jlong output) { return outputOf(output)->exclusive(); }
