package com.boombapbot.engine;

import com.getcapacitor.JSObject;

/**
 * The phone's sound: an Oboe stream whose data callback is the one caller
 * of the engine's render, and the engine it plays, made at the rate the
 * device runs at now. Made and closed on the control thread.
 */
final class AudioOutput implements Watch.Meter, AutoCloseable {

    private long handle;
    final Engine engine;
    private final long renderer;

    AudioOutput() throws EngineRefused {
        long opened;
        try {
            opened = EngineNative.outputOpen();
        } catch (IllegalStateException refused) {
            throw new EngineRefused(refused.getMessage());
        }
        handle = opened;
        try {
            engine = new Engine(EngineNative.outputEngine(handle), EngineNative.outputSampleRate(handle));
        } catch (EngineRefused refused) {
            EngineNative.outputClose(handle);
            throw refused;
        }
        renderer = EngineNative.outputRenderer(handle);
    }

    @Override
    public float takePeak() {
        return EngineNative.rendererTakePeak(renderer);
    }

    long buffers() {
        return EngineNative.rendererBuffers(renderer);
    }

    /** Whether the device left or changed since the last call, and Oboe closed the stream. */
    boolean takeLost() {
        return EngineNative.outputTakeLost(handle);
    }

    JSObject facts() {
        JSObject facts = new JSObject();
        facts.put("sampleRate", engine.sampleRate);
        facts.put("channels", EngineNative.outputChannels(handle));
        facts.put("bufferFrames", EngineNative.outputBufferFrames(handle));
        facts.put("burstFrames", EngineNative.outputBurstFrames(handle));
        facts.put("deviceId", EngineNative.outputDeviceId(handle));
        facts.put("audioApi", EngineNative.outputAudioApi(handle));
        facts.put("exclusive", EngineNative.outputExclusive(handle));
        return facts;
    }

    /** The stream stops and closes before the engine goes. */
    @Override
    public void close() {
        if (handle == 0) return;
        EngineNative.outputClose(handle);
        handle = 0;
    }
}
