package com.boombapbot.engine;

/**
 * The engine's C ABI and the phone's sound, as native_engine.cpp gives them.
 * A handle is a pointer. Every call but the renderer's tests is made on the
 * plug-in's control thread; the audio thread is Oboe's and never comes here.
 */
final class EngineNative {

    static {
        System.loadLibrary("boombapbot_native");
    }

    private EngineNative() {}

    static native int abiVersion();

    static native long engineCreate(double sampleRate);

    static native void engineDestroy(long engine);

    static native int synthSound(long engine, int sound, float tune, float tone, float decay, float snappy);

    static native int setTempo(long engine, double bpm);

    static native int setTrack(long engine, int track, int slot, float pan, int chokeGroup);

    static native int setTrackLevel(long engine, int track, double gain);

    static native int setAccent(long engine, double plain, double accented);

    static native int setMasterVolume(long engine, double volume);

    static native int setEffect(long engine, int effect, double wet);

    static native int setPattern(long engine, int index, int[] rows, int firstLength, int secondLength, int stepsPerBeat, int swing);

    static native int cuePattern(long engine, int index);

    static native int setPanel(long engine, int rhythm, int variation, int fillRhythm, int fillVariation, int autoFill, boolean firstBeatRule);

    static native int setSong(long engine, byte[] rhythms, boolean loop);

    static native int armFill(long engine, boolean armed);

    static native int play(long engine);

    static native int stop(long engine);

    static native int trigger(long engine, int track, boolean accent);

    static native void collect(long engine);

    /** Measures begun since the last call, five numbers each: frame, ordinal, pattern, kind, position. */
    static native int readMeasures(long engine, double[] out);

    static native boolean isPlaying(long engine);

    static native int currentStep(long engine);

    static native int currentPattern(long engine);

    static native double framesRendered(long engine);

    static native double stopFrame(long engine);

    static native int activeVoices(long engine);

    static native long stolenVoices(long engine);

    static native double outputLevel(long engine);

    static native long rendererCreate(long engine);

    static native void rendererDestroy(long renderer);

    static native void rendererFill(long renderer, float[] out, int frames, int channels);

    static native float rendererTakePeak(long renderer);

    static native long rendererBuffers(long renderer);

    /** Opens the phone's default output and an engine at its rate. Throws IllegalStateException with words when it cannot. */
    static native long outputOpen();

    static native void outputClose(long output);

    static native long outputEngine(long output);

    static native long outputRenderer(long output);

    static native int outputSampleRate(long output);

    static native int outputChannels(long output);

    /** Whether Oboe closed the stream because its device left or changed, since the last call. */
    static native boolean outputTakeLost(long output);

    static native int outputBufferFrames(long output);

    static native int outputBurstFrames(long output);

    static native int outputDeviceId(long output);

    static native String outputAudioApi(long output);

    static native boolean outputExclusive(long output);
}
