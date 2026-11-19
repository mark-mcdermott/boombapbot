package com.boombapbot.engine;

import java.util.List;
import java.util.function.Consumer;

/**
 * What the page is told about an engine at work, as often as the page's own
 * worklet tells it (packages/editor/src/engine/worklet/processor.ts): every
 * measure begun, a position only when it changes, the level thirty times a
 * second while it changes, and the stats ten times a second.
 */
public final class Watch {

    /** Where the audio thread's loudest sample since the last reading is read from. */
    public interface Meter {
        float takePeak();
    }

    private static final double LEVEL_EVERY = 1.0 / 30.0;
    private static final double STATS_EVERY = 0.1;

    private int step = -1;
    private int pattern = -1;
    private boolean playing = false;
    private double stopFrame = -1;
    private double level = 0;
    private double levelDue;
    private double statsDue;
    private float peakEver = 0;

    /** `now` is seconds on any clock that only goes forward. */
    public Watch(double now) {
        levelDue = now + LEVEL_EVERY;
        statsDue = now + STATS_EVERY;
    }

    /** The largest absolute output sample since the engine was made. */
    public float peakEver() {
        return peakEver;
    }

    /** Reads the engine and reports what is new. For the control thread. */
    public void look(Engine engine, Meter meter, double now, Consumer<Report> report) {
        List<Report.Measure> measures = engine.takeMeasures();
        if (!measures.isEmpty()) report.accept(Report.measures(measures));

        double stopFrame = engine.stopFrame();
        if (stopFrame != this.stopFrame) {
            this.stopFrame = stopFrame;
            if (stopFrame >= 0) report.accept(Report.ended());
        }

        int step = engine.currentStep();
        int pattern = engine.currentPattern();
        boolean playing = engine.isPlaying();
        if (step != this.step || pattern != this.pattern || playing != this.playing) {
            this.step = step;
            this.pattern = pattern;
            this.playing = playing;
            report.accept(Report.position(step, pattern, playing));
        }

        if (now >= levelDue) {
            levelDue = now + LEVEL_EVERY;
            double level = engine.outputLevel();
            if (level != this.level) {
                this.level = level;
                report.accept(Report.level(level));
            }
        }

        if (now >= statsDue) {
            statsDue = now + STATS_EVERY;
            float peak = meter.takePeak();
            peakEver = Math.max(peakEver, peak);
            report.accept(Report.stats(engine.framesRendered(), peak, peakEver, engine.activeVoices(), engine.stolenVoices()));
            // A sound a knob replaced is freed here, once its tail has rung out.
            engine.collect();
        }
    }
}
