package com.boombapbot.engine;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.List;

/** One report to the page, as the editor reads it (EngineReport in packages/editor/src/engine/messages.ts). */
public final class Report {

    /** A measure the engine began. */
    public static final class Measure {

        private static final String[] KINDS = { "basic", "fill", "intro" };

        final double frame;
        final int ordinal;
        final int pattern;
        final int kind;
        final int position;

        Measure(double frame, int ordinal, int pattern, int kind, int position) {
            this.frame = frame;
            this.ordinal = ordinal;
            this.pattern = pattern;
            this.kind = kind;
            this.position = position;
        }

        String kindName() {
            return kind >= 0 && kind < KINDS.length ? KINDS[kind] : KINDS[0];
        }
    }

    public final String type;
    private final JSObject json;

    private Report(String type, JSObject fields) {
        this.type = type;
        this.json = fields;
        json.put("type", type);
    }

    /** As the editor reads it. */
    public JSObject json() {
        return json;
    }

    @Override
    public String toString() {
        return json.toString();
    }

    /** The engine was made again by this plug-in, at this rate, and has been told nothing. */
    public static Report ready(double sampleRate) {
        JSObject fields = new JSObject();
        fields.put("sampleRate", sampleRate);
        return new Report("ready", fields);
    }

    public static Report error(String message) {
        return new Report("error", new JSObject().put("message", message));
    }

    public static Report sound(int slot) {
        return new Report("sound", new JSObject().put("slot", slot));
    }

    public static Report position(int step, int pattern, boolean playing) {
        return new Report("position", new JSObject().put("step", step).put("pattern", pattern).put("playing", playing));
    }

    public static Report measures(List<Measure> measures) {
        JSArray list = new JSArray();
        for (Measure measure : measures) {
            JSObject fields = new JSObject();
            fields.put("frame", measure.frame);
            fields.put("ordinal", measure.ordinal);
            fields.put("pattern", measure.pattern);
            fields.put("kind", measure.kindName());
            fields.put("position", measure.position);
            list.put(fields);
        }
        return new Report("measures", new JSObject().put("measures", list));
    }

    /** Play ended by itself, or because the phone took the sound away. */
    public static Report ended() {
        return new Report("ended", new JSObject());
    }

    public static Report level(double level) {
        JSObject fields = new JSObject();
        fields.put("level", level);
        return new Report("level", fields);
    }

    public static Report stats(double frames, float peak, float peakEver, int voices, long stolen) {
        JSObject fields = new JSObject();
        fields.put("frames", frames);
        fields.put("peak", (double) peak);
        fields.put("peakEver", (double) peakEver);
        fields.put("voices", voices);
        fields.put("stolen", stolen);
        return new Report("stats", fields);
    }
}
