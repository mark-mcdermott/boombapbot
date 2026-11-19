package com.boombapbot.engine;

import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * One command from the page, in the shapes the editor gives them
 * (NativeEngineCommand in packages/editor/src/engine/messages.ts), and what
 * it asks of the engine. Its `toString` is what it holds, for tests.
 */
public abstract class Command {

    private final String said;

    private Command(String said) {
        this.said = said;
    }

    /** Does what this command asks of an engine. A sound made is acknowledged by its slot. */
    abstract Report applyTo(Engine engine) throws EngineRefused;

    @Override
    public String toString() {
        return said;
    }

    /** Reads one command as the editor writes it. */
    public static Command parse(Object json) throws EngineRefused {
        if (!(json instanceof JSONObject)) throw new EngineRefused("A command is an object.");
        Fields fields = new Fields((JSONObject) json);
        String type = fields.string("type");
        switch (type) {
            case "synth": {
                Fields sound = fields.object("sound");
                return synth(sound.integer("sound"), sound.real("tune"), sound.real("tone"), sound.real("decay"), sound.real("snappy"));
            }
            case "tracks": {
                JSONArray tracks = fields.list("tracks");
                Fields[] each = new Fields[tracks.length()];
                for (int i = 0; i < each.length; i++) each[i] = Fields.of(tracks.opt(i), "A track");
                return tracks(each);
            }
            case "mix":
                return mix(fields.number("plain"), fields.number("accented"), fields.number("master"));
            case "patterns": {
                JSONArray patterns = fields.list("patterns");
                Fields[] each = new Fields[patterns.length()];
                for (int i = 0; i < each.length; i++) each[i] = Fields.of(patterns.opt(i), "A pattern");
                return patterns(each);
            }
            case "tempo": {
                double bpm = fields.number("bpm");
                return simple(text("tempo(%s)", bpm), "the tempo", engine -> EngineNative.setTempo(engine, bpm));
            }
            case "panel":
                return panel(fields.object("panel"));
            case "cue": {
                int pattern = fields.integer("pattern");
                return simple(text("cue(%d)", pattern), "a cue", engine -> EngineNative.cuePattern(engine, pattern));
            }
            case "effect": {
                // By the engine's own number: this plug-in keeps no list of the effects.
                int effect = fields.integer("effect");
                double wet = fields.number("wet");
                return simple(text("effect(%d, %s)", effect, wet), "the effect", engine -> EngineNative.setEffect(engine, effect, wet));
            }
            case "fill": {
                boolean armed = fields.bool("armed");
                return simple(text("fill(%b)", armed), "the fill-in", engine -> EngineNative.armFill(engine, armed));
            }
            case "song":
                return song(fields);
            case "play":
                return simple("play", "play", EngineNative::play);
            case "stop":
                return simple("stop", "stop", EngineNative::stop);
            case "trigger": {
                int track = fields.integer("track");
                boolean accent = fields.bool("accent");
                return simple(text("trigger(%d, %b)", track, accent), "a hit", engine -> EngineNative.trigger(engine, track, accent));
            }
            default:
                throw new EngineRefused(type + " is not a command this engine takes.");
        }
    }

    /** Whether this is the command that starts the beat. */
    public boolean starts() {
        return said.equals("play");
    }

    /** Whether this is the command that stops the beat. */
    public boolean stops() {
        return said.equals("stop");
    }

    private static String text(String format, Object... values) {
        return String.format(Locale.ROOT, format, values);
    }

    private static Command simple(String said, String what, Engine.Call call) {
        return new Command(said) {
            @Override
            Report applyTo(Engine engine) throws EngineRefused {
                engine.ask(what, call);
                return null;
            }
        };
    }

    private static Command synth(int sound, float tune, float tone, float decay, float snappy) {
        return new Command(text("synth(%d, %s, %s, %s, %s)", sound, tune, tone, decay, snappy)) {
            // Synthesised on the control thread, at this engine's rate.
            @Override
            Report applyTo(Engine engine) throws EngineRefused {
                int code = EngineNative.synthSound(engine.handle, sound, tune, tone, decay, snappy);
                if (code != Engine.OK) throw new EngineRefused("Sound " + sound + " could not be made (" + code + ").");
                return Report.sound(sound);
            }
        };
    }

    private static Command tracks(Fields[] tracks) throws EngineRefused {
        int count = tracks.length;
        int[] track = new int[count];
        int[] slot = new int[count];
        float[] pan = new float[count];
        int[] choke = new int[count];
        double[] gain = new double[count];
        StringBuilder said = new StringBuilder("tracks(");
        for (int i = 0; i < count; i++) {
            track[i] = tracks[i].integer("track");
            slot[i] = tracks[i].integer("slot");
            pan[i] = tracks[i].real("pan");
            choke[i] = tracks[i].integer("chokeGroup");
            gain[i] = tracks[i].number("gain");
            said.append(i == 0 ? "" : ", ").append(text("[%d, %d, %s, %d, %s]", track[i], slot[i], pan[i], choke[i], gain[i]));
        }
        return new Command(said.append(')').toString()) {
            @Override
            Report applyTo(Engine engine) throws EngineRefused {
                for (int i = 0; i < count; i++) {
                    int at = i;
                    engine.ask("a track", handle -> EngineNative.setTrack(handle, track[at], slot[at], pan[at], choke[at]));
                    engine.ask("a track's level", handle -> EngineNative.setTrackLevel(handle, track[at], gain[at]));
                }
                return null;
            }
        };
    }

    private static Command mix(double plain, double accented, double master) {
        return new Command(text("mix(%s, %s, %s)", plain, accented, master)) {
            @Override
            Report applyTo(Engine engine) throws EngineRefused {
                engine.ask("the accent", handle -> EngineNative.setAccent(handle, plain, accented));
                engine.ask("the volume", handle -> EngineNative.setMasterVolume(handle, master));
                return null;
            }
        };
    }

    private static final int TRACKS = 12;

    private static Command patterns(Fields[] entries) throws EngineRefused {
        int count = entries.length;
        int[] index = new int[count];
        int[][] rows = new int[count][];
        int[][] shape = new int[count][];
        StringBuilder said = new StringBuilder("patterns(");
        for (int i = 0; i < count; i++) {
            index[i] = entries[i].integer("index");
            Fields pattern = entries[i].object("pattern");
            JSONArray bits = pattern.list("rows");
            if (bits.length() > TRACKS) {
                throw new EngineRefused("A pattern has " + bits.length() + " rows, and the engine has " + TRACKS + " tracks.");
            }
            rows[i] = new int[bits.length()];
            StringBuilder rowText = new StringBuilder();
            for (int track = 0; track < bits.length(); track++) {
                long row = Fields.whole(bits.opt(track), "A pattern's row", 0, 0xFFFF_FFFFL);
                rows[i][track] = (int) row;
                rowText.append(track == 0 ? "" : " ").append(row);
            }
            shape[i] = new int[] {
                pattern.bounded("firstLength", 0, 255),
                pattern.bounded("secondLength", 0, 255),
                pattern.bounded("stepsPerBeat", 0, 255),
                pattern.bounded("swing", 0, 255),
            };
            said.append(i == 0 ? "" : ", ")
                .append(text("%d: [%s] %d %d %d %d", index[i], rowText, shape[i][0], shape[i][1], shape[i][2], shape[i][3]));
        }
        return new Command(said.append(')').toString()) {
            @Override
            Report applyTo(Engine engine) throws EngineRefused {
                for (int i = 0; i < count; i++) {
                    int at = i;
                    engine.ask("a pattern", handle ->
                        EngineNative.setPattern(handle, index[at], rows[at], shape[at][0], shape[at][1], shape[at][2], shape[at][3])
                    );
                }
                return null;
            }
        };
    }

    private static int variation(Fields fields, String key) throws EngineRefused {
        String name = fields.string(key);
        switch (name) {
            case "a":
                return 0;
            case "ab":
                return 1;
            case "b":
                return 2;
            default:
                throw new EngineRefused(name + " is not a variation.");
        }
    }

    private static Command panel(Fields panel) throws EngineRefused {
        int rhythm = panel.bounded("rhythm", 0, 255);
        int variation = variation(panel, "variation");
        int fillRhythm = panel.bounded("fillRhythm", 0, 255);
        int fillVariation = variation(panel, "fillVariation");
        int autoFill = panel.bounded("autoFill", 0, 255);
        boolean firstBeatRule = panel.bool("firstBeatRule");
        String said = text("panel(%d, %d, %d, %d, %d, %b)", rhythm, variation, fillRhythm, fillVariation, autoFill, firstBeatRule);
        return simple(said, "the panel", engine ->
            EngineNative.setPanel(engine, rhythm, variation, fillRhythm, fillVariation, autoFill, firstBeatRule)
        );
    }

    private static Command song(Fields fields) throws EngineRefused {
        JSONArray list = fields.list("rhythms");
        byte[] rhythms = new byte[list.length()];
        StringBuilder said = new StringBuilder("song([");
        for (int i = 0; i < rhythms.length; i++) {
            long rhythm = Fields.whole(list.opt(i), "A song's rhythm", 0, 255);
            rhythms[i] = (byte) rhythm;
            said.append(i == 0 ? "" : " ").append(rhythm);
        }
        boolean loop = fields.bool("loop");
        return simple(said.append("], ").append(loop).append(')').toString(), "a song", engine -> EngineNative.setSong(engine, rhythms, loop));
    }

    /** A JSON object as the page sends it, with what each field must be. */
    private static final class Fields {

        private final JSONObject object;

        Fields(JSONObject object) {
            this.object = object;
        }

        static Fields of(Object json, String what) throws EngineRefused {
            if (!(json instanceof JSONObject)) throw new EngineRefused(what + " is not an object.");
            return new Fields((JSONObject) json);
        }

        Object value(String key) throws EngineRefused {
            Object value = object.opt(key);
            if (value == null || value == JSONObject.NULL) throw new EngineRefused(object.optString("type", "A command") + " has no " + key + ".");
            return value;
        }

        double number(String key) throws EngineRefused {
            Object value = value(key);
            if (!(value instanceof Number)) throw new EngineRefused(key + " is not a number.");
            return ((Number) value).doubleValue();
        }

        float real(String key) throws EngineRefused {
            return (float) number(key);
        }

        static long whole(Object value, String what, long lowest, long highest) throws EngineRefused {
            if (!(value instanceof Number)) throw new EngineRefused(what + " is not a number.");
            double number = ((Number) value).doubleValue();
            if (number != Math.rint(number) || number < lowest || number > highest) {
                throw new EngineRefused(what + " is not a whole number from " + lowest + " to " + highest + ".");
            }
            return (long) number;
        }

        int integer(String key) throws EngineRefused {
            return (int) whole(value(key), key, Integer.MIN_VALUE, Integer.MAX_VALUE);
        }

        int bounded(String key, int lowest, int highest) throws EngineRefused {
            return (int) whole(value(key), key, lowest, highest);
        }

        boolean bool(String key) throws EngineRefused {
            Object value = value(key);
            if (!(value instanceof Boolean)) throw new EngineRefused(key + " is not true or false.");
            return (Boolean) value;
        }

        String string(String key) throws EngineRefused {
            Object value = value(key);
            if (!(value instanceof String)) throw new EngineRefused(key + " is not text.");
            return (String) value;
        }

        Fields object(String key) throws EngineRefused {
            return of(value(key), key);
        }

        JSONArray list(String key) throws EngineRefused {
            Object value = value(key);
            if (!(value instanceof JSONArray)) throw new EngineRefused(key + " is not a list.");
            return (JSONArray) value;
        }
    }
}
