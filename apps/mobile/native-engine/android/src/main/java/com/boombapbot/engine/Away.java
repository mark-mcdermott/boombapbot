package com.boombapbot.engine;

/**
 * The app out of the front, with the beat perhaps playing on: which reports
 * still go to the page, whose web view may be asleep, and what the engine did
 * meanwhile.
 */
public final class Away {

    public final double since;
    public final double framesBefore;
    private float peak = 0;

    public Away(double since, double frames) {
        this.since = since;
        this.framesBefore = frames;
    }

    /** The loudest sample the engine made while the app was away. */
    public float peak() {
        return peak;
    }

    /**
     * Whether a report goes to the page now. What changes the machine's state
     * goes and waits for the page to wake. What only shows it at work, the
     * step, the meter and the stats, is let go: hundreds of them a second would
     * pile up, and the page is told the step again on its return.
     */
    public boolean passes(Report report) {
        switch (report.type) {
            case "stats":
                peak = Math.max(peak, (float) report.json().optDouble("peak", 0));
                return false;
            case "position":
            case "level":
                return false;
            default:
                return true;
        }
    }
}
