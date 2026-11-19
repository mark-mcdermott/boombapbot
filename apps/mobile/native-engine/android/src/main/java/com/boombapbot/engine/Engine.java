package com.boombapbot.engine;

import java.util.ArrayList;
import java.util.List;

/** One engine, for the one thread that makes its control calls. Its render is the audio thread's. */
public final class Engine {

    /** The ABI the bindings here were written for (SNARE_ABI_VERSION in engine.h). */
    static final int ABI_VERSION = 3;
    static final int OK = 0;
    static final int QUEUE_FULL = -1;
    /** How long a control call waits for the audio thread to empty a full queue. */
    private static final long QUEUE_WAIT_MS = 250;
    private static final int MEASURE_BATCH = 16;
    private static final int MEASURE_FIELDS = 5;

    final long handle;
    public final double sampleRate;
    private final double[] measures = new double[MEASURE_BATCH * MEASURE_FIELDS];

    Engine(long handle, double sampleRate) throws EngineRefused {
        int abi = EngineNative.abiVersion();
        if (abi != ABI_VERSION) {
            throw new EngineRefused("This plug-in was built for engine ABI " + ABI_VERSION + ", and the engine in it is " + abi + ".");
        }
        if (handle == 0) throw new EngineRefused("The engine cannot run at " + Math.round(sampleRate) + " Hz.");
        this.handle = handle;
        this.sampleRate = sampleRate;
    }

    interface Call {
        int on(long engine);
    }

    /** Makes a queued control call. The queue empties at every buffer rendered, so a full one is waited for briefly. */
    void ask(String what, Call call) throws EngineRefused {
        long giveUp = System.nanoTime() + QUEUE_WAIT_MS * 1_000_000;
        while (true) {
            int code = call.on(handle);
            if (code == OK) return;
            if (code == QUEUE_FULL && System.nanoTime() < giveUp) {
                try {
                    Thread.sleep(1);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new EngineRefused("The engine was not waited for: " + what + ".");
                }
                continue;
            }
            throw new EngineRefused("The engine refused " + what + " (" + code + ").");
        }
    }

    /** Does what one command asks. A sound made is acknowledged by its slot. */
    public Report apply(Command command) throws EngineRefused {
        return command.applyTo(this);
    }

    /** Frees replaced sounds whose tails have finished. */
    public void collect() {
        EngineNative.collect(handle);
    }

    /** Takes the measures begun since the last call, oldest first. */
    public List<Report.Measure> takeMeasures() {
        List<Report.Measure> taken = new ArrayList<>();
        while (true) {
            int count = EngineNative.readMeasures(handle, measures);
            for (int i = 0; i < count; i++) {
                int at = i * MEASURE_FIELDS;
                taken.add(
                    new Report.Measure(measures[at], (int) measures[at + 1], (int) measures[at + 2], (int) measures[at + 3], (int) measures[at + 4])
                );
            }
            if (count < MEASURE_BATCH) return taken;
        }
    }

    public boolean isPlaying() {
        return EngineNative.isPlaying(handle);
    }

    public int currentStep() {
        return EngineNative.currentStep(handle);
    }

    public int currentPattern() {
        return EngineNative.currentPattern(handle);
    }

    public double framesRendered() {
        return EngineNative.framesRendered(handle);
    }

    public double stopFrame() {
        return EngineNative.stopFrame(handle);
    }

    public int activeVoices() {
        return EngineNative.activeVoices(handle);
    }

    public long stolenVoices() {
        return EngineNative.stolenVoices(handle);
    }

    public double outputLevel() {
        return EngineNative.outputLevel(handle);
    }
}
