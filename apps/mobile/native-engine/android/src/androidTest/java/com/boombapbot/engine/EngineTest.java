package com.boombapbot.engine;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * The plug-in's engine side with no sound device: the test asks for buffers
 * as Oboe would. The engine's own promise that its render allocates nothing
 * is held by its test_realtime; the C++ around it is read in native_engine.cpp.
 */
@RunWith(AndroidJUnit4.class)
public class EngineTest {

    private static final double RATE = 48_000;
    private static final int KICK = 1;
    private static final int HAT = 2;

    private long handle;
    private long renderer;
    private Engine engine;

    private static Command command(String json) throws JSONException, EngineRefused {
        return Command.parse(new JSONObject(json));
    }

    private static String knobs(int sound) {
        return "{\"type\":\"synth\",\"sound\":{\"sound\":" + sound + ",\"tune\":0.5,\"tone\":0.5,\"decay\":0.5,\"snappy\":0.5}}";
    }

    /** An engine told a beat the way the page tells one: two sounds on two tracks, a kick on every beat and a hat between. */
    @Before
    public void engineWithABeat() throws Exception {
        handle = EngineNative.engineCreate(RATE);
        engine = new Engine(handle, RATE);
        String[] beat = {
            "{\"type\":\"tempo\",\"bpm\":120}",
            "{\"type\":\"tracks\",\"tracks\":[{\"track\":1,\"slot\":0,\"pan\":0,\"chokeGroup\":0,\"gain\":0.9},"
                + "{\"track\":2,\"slot\":2,\"pan\":0.3,\"chokeGroup\":0,\"gain\":0.6}]}",
            "{\"type\":\"mix\",\"plain\":0.7,\"accented\":1,\"master\":0.8}",
            "{\"type\":\"patterns\",\"patterns\":[{\"index\":0,\"pattern\":{\"rows\":[0,4369,17476],\"firstLength\":16,"
                + "\"secondLength\":0,\"stepsPerBeat\":4,\"swing\":0}}]}",
            "{\"type\":\"cue\",\"pattern\":0}",
            "{\"type\":\"effect\",\"effect\":0,\"wet\":0}",
        };
        for (String json : beat) assertNull(engine.apply(command(json)));
        for (int sound : new int[] { 0, 2 }) assertEquals(Report.sound(sound).toString(), engine.apply(command(knobs(sound))).toString());
        renderer = EngineNative.rendererCreate(handle);
    }

    @After
    public void free() {
        EngineNative.rendererDestroy(renderer);
        EngineNative.engineDestroy(handle);
    }

    private static float loudest(float[] samples, int from, int every) {
        float peak = 0;
        for (int i = from; i < samples.length; i += every) peak = Math.max(peak, Math.abs(samples[i]));
        return peak;
    }

    @Test
    public void aBufferHoldsTheBeatHoweverManyChannelsTheDeviceHas() throws Exception {
        engine.apply(command("{\"type\":\"play\"}"));

        float[] stereo = new float[2 * 4800];
        EngineNative.rendererFill(renderer, stereo, 4800, 2);
        float peak = loudest(stereo, 0, 1);
        assertTrue("the beat was silent", peak > 0.05f);
        assertEquals("the meter holds the largest sample written", peak, EngineNative.rendererTakePeak(renderer), 0f);
        assertEquals("and starts again from silence", 0f, EngineNative.rendererTakePeak(renderer), 0f);

        float[] surround = new float[6 * 4800];
        java.util.Arrays.fill(surround, 1f);
        EngineNative.rendererFill(renderer, surround, 4800, 6);
        for (int channel = 2; channel < 6; channel++) assertEquals("channels past the second are silent", 0f, loudest(surround, channel, 6), 0f);

        // Longer than the scratch a buffer is rendered through.
        float[] mono = new float[10_000];
        EngineNative.rendererFill(renderer, mono, 10_000, 1);
        assertTrue(loudest(mono, 0, 1) > 0.01f);
        assertEquals(3, EngineNative.rendererBuffers(renderer));
        assertEquals(19_600, engine.framesRendered(), 0);
    }

    @Test
    public void thePageIsToldWhatTheWorkletWouldTellIt() throws Exception {
        Watch watch = new Watch(0);
        float[] buffer = new float[2 * 256];
        Watch.Meter meter = () -> EngineNative.rendererTakePeak(renderer);
        Runnable fill = () -> EngineNative.rendererFill(renderer, buffer, 256, 2);
        java.util.function.DoubleFunction<List<String>> reports = (now) -> {
            List<String> said = new ArrayList<>();
            watch.look(engine, meter, now, (report) -> said.add(report.toString()));
            return said;
        };

        // Stopped: where the engine stands, once, and nothing after it.
        fill.run();
        assertEquals(List.of(Report.position(-1, 0, false).toString()), reports.apply(0));
        assertEquals(List.of(), reports.apply(0));

        // Playing: the measure that began and the step that sounded, each once.
        engine.apply(command("{\"type\":\"play\"}"));
        fill.run();
        List<String> started = reports.apply(0);
        assertEquals(2, started.size());
        JSONObject measures = new JSONObject(started.get(0));
        assertEquals("measures", measures.getString("type"));
        assertEquals(1, measures.getJSONArray("measures").length());
        assertEquals(1, measures.getJSONArray("measures").getJSONObject(0).getInt("ordinal"));
        assertEquals("basic", measures.getJSONArray("measures").getJSONObject(0).getString("kind"));
        assertEquals(Report.position(0, 0, true).toString(), started.get(1));
        assertEquals(List.of(), reports.apply(0));

        // A step is an eighth of a second at this tempo: the next one is reported when it sounds.
        for (int i = 0; i < (int) RATE / 8 / 256 + 1; i++) fill.run();
        assertEquals(List.of(Report.position(1, 0, true).toString()), reports.apply(0));

        // The meter thirty times a second and the stats ten: neither before its time.
        List<String> level = reports.apply(0.04);
        assertEquals(1, level.size());
        assertEquals("level", new JSONObject(level.get(0)).getString("type"));
        assertTrue(new JSONObject(level.get(0)).getDouble("level") > 0);
        List<String> stats = reports.apply(0.11);
        assertEquals(1, stats.size());
        JSONObject said = new JSONObject(stats.get(0));
        assertEquals("stats", said.getString("type"));
        assertEquals(engine.framesRendered(), said.getDouble("frames"), 0);
        assertTrue(said.getDouble("peak") > 0.05);
        assertEquals(said.getDouble("peak"), said.getDouble("peakEver"), 0);
        assertTrue(said.getInt("voices") >= 1);
        assertEquals(0, said.getInt("stolen"));

        // The next stats start from silence, and remember the loudest so far.
        JSONObject next = new JSONObject(reports.apply(0.22).get(0));
        assertEquals(0, next.getDouble("peak"), 0);
        assertEquals(said.getDouble("peak"), next.getDouble("peakEver"), 0);

        engine.apply(command("{\"type\":\"stop\"}"));
        fill.run();
        assertEquals(List.of(Report.position(-1, 0, false).toString()), reports.apply(0.22));
    }

    @Test
    public void aCommandTheEngineCannotTakeIsRefusedInWords() throws Exception {
        assertRefused("the tempo", "{\"type\":\"tempo\",\"bpm\":-1}");
        assertRefused("a cue", "{\"type\":\"cue\",\"pattern\":99}");
        assertRefused("Sound 99", knobs(99));
        assertThrows(EngineRefused.class, () -> new Engine(EngineNative.engineCreate(1000), 1000));
    }

    private void assertRefused(String words, String json) throws JSONException, EngineRefused {
        Command refused = command(json);
        EngineRefused thrown = assertThrows(EngineRefused.class, () -> engine.apply(refused));
        assertTrue(thrown.getMessage(), thrown.getMessage().contains(words));
    }
}
