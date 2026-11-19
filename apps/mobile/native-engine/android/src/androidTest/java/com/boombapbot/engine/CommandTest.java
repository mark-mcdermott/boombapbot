package com.boombapbot.engine;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class CommandTest {

    private static String read(String json) throws JSONException, EngineRefused {
        return Command.parse(new JSONObject(json)).toString();
    }

    @Test
    public void readsTheCommandsAsTheEditorWritesThem() throws Exception {
        assertEquals("synth(3, 0.25, 0.5, 0.75, 1.0)",
            read("{\"type\":\"synth\",\"sound\":{\"sound\":3,\"tune\":0.25,\"tone\":0.5,\"decay\":0.75,\"snappy\":1}}"));
        assertEquals("tracks([1, 0, -0.5, 2, 0.8])",
            read("{\"type\":\"tracks\",\"tracks\":[{\"track\":1,\"slot\":0,\"pan\":-0.5,\"chokeGroup\":2,\"gain\":0.8}]}"));
        assertEquals("patterns(2: [0 4369 4294967295] 16 0 4 64)",
            read("{\"type\":\"patterns\",\"patterns\":[{\"index\":2,\"pattern\":{\"rows\":[0,4369,4294967295],"
                + "\"firstLength\":16,\"secondLength\":0,\"stepsPerBeat\":4,\"swing\":64}}]}"));
        assertEquals("panel(3, 1, 12, 2, 4, true)",
            read("{\"type\":\"panel\",\"panel\":{\"rhythm\":3,\"variation\":\"ab\",\"fillRhythm\":12,\"fillVariation\":\"b\","
                + "\"autoFill\":4,\"firstBeatRule\":true}}"));
        assertEquals("mix(0.6, 1.0, 0.8)", read("{\"type\":\"mix\",\"plain\":0.6,\"accented\":1,\"master\":0.8}"));
        assertEquals("tempo(97.5)", read("{\"type\":\"tempo\",\"bpm\":97.5}"));
        assertEquals("cue(1)", read("{\"type\":\"cue\",\"pattern\":1}"));
        assertEquals("effect(9, 0.3)", read("{\"type\":\"effect\",\"effect\":9,\"wet\":0.3}"));
        assertEquals("fill(true)", read("{\"type\":\"fill\",\"armed\":true}"));
        assertEquals("song([0 1 12], true)", read("{\"type\":\"song\",\"rhythms\":[0,1,12],\"loop\":true}"));
        assertEquals("play", read("{\"type\":\"play\"}"));
        assertEquals("stop", read("{\"type\":\"stop\"}"));
        assertEquals("trigger(5, false)", read("{\"type\":\"trigger\",\"track\":5,\"accent\":false}"));
        assertTrue(Command.parse(new JSONObject("{\"type\":\"play\"}")).starts());
        assertTrue(Command.parse(new JSONObject("{\"type\":\"stop\"}")).stops());
    }

    @Test
    public void refusesWhatIsNotACommand() {
        for (String json : List.of(
            "{\"type\":\"sound\",\"slot\":0,\"pcm\":[]}",
            "{\"type\":\"tempo\"}",
            "{\"type\":\"tempo\",\"bpm\":true}",
            "{\"type\":\"fill\",\"armed\":1}",
            "{\"type\":\"cue\",\"pattern\":1.5}",
            "{\"type\":\"song\",\"rhythms\":[300],\"loop\":false}",
            "{\"type\":\"patterns\",\"patterns\":[{\"index\":0,\"pattern\":{\"rows\":[0,0,0,0,0,0,0,0,0,0,0,0,0],"
                + "\"firstLength\":16,\"secondLength\":0,\"stepsPerBeat\":4,\"swing\":0}}]}"
        )) {
            assertThrows(json, EngineRefused.class, () -> read(json));
        }
        assertThrows(EngineRefused.class, () -> Command.parse("play"));
    }

    @Test
    public void writesTheReportsAsTheEditorReadsThem() throws Exception {
        assertJson("{\"type\":\"ready\",\"sampleRate\":48000}", Report.ready(48000));
        assertJson("{\"type\":\"error\",\"message\":\"no device\"}", Report.error("no device"));
        assertJson("{\"type\":\"sound\",\"slot\":4}", Report.sound(4));
        assertJson("{\"type\":\"position\",\"step\":3,\"pattern\":1,\"playing\":true}", Report.position(3, 1, true));
        assertJson("{\"type\":\"measures\",\"measures\":[{\"frame\":96,\"ordinal\":1,\"pattern\":2,\"kind\":\"fill\",\"position\":-1}]}",
            Report.measures(List.of(new Report.Measure(96, 1, 2, 1, -1))));
        assertJson("{\"type\":\"ended\"}", Report.ended());
        assertJson("{\"type\":\"level\",\"level\":0.25}", Report.level(0.25));
        assertJson("{\"type\":\"stats\",\"frames\":4800,\"peak\":0.5,\"peakEver\":0.75,\"voices\":2,\"stolen\":1}",
            Report.stats(4800, 0.5f, 0.75f, 2, 1));
    }

    /** The same fields with the same values, numbers compared as numbers. */
    private static void assertJson(String expected, Report report) throws JSONException {
        JSONObject want = new JSONObject(expected);
        JSONObject got = report.json();
        assertEquals(report.toString(), want.length(), got.length());
        for (java.util.Iterator<String> keys = want.keys(); keys.hasNext();) {
            String key = keys.next();
            Object value = want.get(key);
            if (value instanceof Number) assertEquals(key, ((Number) value).doubleValue(), got.getDouble(key), 0);
            else assertEquals(key, value.toString(), got.get(key).toString());
        }
    }
}
