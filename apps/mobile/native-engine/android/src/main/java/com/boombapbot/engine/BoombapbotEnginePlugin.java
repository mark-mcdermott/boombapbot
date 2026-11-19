package com.boombapbot.engine;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.SystemClock;
import android.util.Log;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * The engine built natively, for the page: the calls of NativeEngineBridge
 * (packages/editor/src/engine/native-audio.ts) and its reports, on "report".
 *
 * Every call to the engine but its render is made on one thread, `control`:
 * Capacitor's calls, the phone's notices and the watch all hop onto it.
 */
@CapacitorPlugin(name = "BoombapbotEngine")
public class BoombapbotEnginePlugin extends Plugin {

    private static final String REPORT_EVENT = "report";
    private static final String TAG = "BoombapbotEngine";
    /** How often the engine is read while it plays: a step is reported within a few milliseconds of sounding. */
    private static final long PLAYING_PAUSE_MS = 4;
    /** And while it is stopped, when only the meter and the stats move. */
    private static final long RESTING_PAUSE_MS = 16;

    private final ScheduledExecutorService control = Executors.newSingleThreadScheduledExecutor((work) -> new Thread(work, "boombapbot-engine"));
    private AudioOutput output;
    private Watch watch;
    private ScheduledFuture<?> looking;
    /** Times the engine was made again because the phone's sound changed. */
    private int reopened = 0;
    private AudioManager audio;
    private AudioFocusRequest focusRequest;
    /** Whether this plug-in holds the phone's sound, which it gives back when the beat stops. */
    private boolean focused = false;
    private final AudioManager.OnAudioFocusChangeListener focusChanged = (change) -> onControl(() -> heardFocus(change));
    private final BroadcastReceiver becomingNoisy = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            // Headphones pulled out stop the beat, as the phone's own players do.
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) onControl(() -> stopBeat());
        }
    };

    /**
     * Hands the phone's notices to the control thread. One that arrives after
     * the page has gone, and the thread with it, has nothing left to tell.
     */
    private void onControl(Runnable work) {
        try {
            control.execute(work);
        } catch (RejectedExecutionException gone) {
            Log.d(TAG, "A notice came after the engine had gone.");
        }
    }

    @Override
    public void load() {
        audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        ContextCompat.registerReceiver(
            getContext(),
            becomingNoisy,
            new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
    }

    @Override
    protected void handleOnDestroy() {
        getContext().unregisterReceiver(becomingNoisy);
        onControl(this::finish);
        control.shutdown();
    }

    private void report(Report report) {
        notifyListeners(REPORT_EVENT, report.json());
    }

    // ---- The page's calls ------------------------------------------------------

    /** Opens the phone's sound and makes the engine at its rate. Whoever asks has no engine, so one still here goes. */
    @PluginMethod
    public void open(PluginCall call) {
        control.execute(() -> {
            try {
                JSObject answer = new JSObject();
                answer.put("sampleRate", start());
                call.resolve(answer);
            } catch (EngineRefused refused) {
                call.reject(refused.getMessage());
            }
        });
    }

    /** Hands the engine these commands, in this order. Play asks the phone for its sound first. */
    @PluginMethod
    public void send(PluginCall call) {
        JSArray sent = call.getArray("commands", new JSArray());
        control.execute(() -> {
            try {
                if (output == null) throw new EngineRefused("The engine is not open.");
                for (int i = 0; i < sent.length(); i++) {
                    Command command = Command.parse(sent.opt(i));
                    if (command.starts() && !askForFocus()) {
                        // Another app has the sound, a call perhaps: the beat does not start over it.
                        report(Report.ended());
                        continue;
                    }
                    Report report = output.engine.apply(command);
                    if (report != null) report(report);
                    if (command.stops()) giveFocusBack();
                }
                call.resolve();
            } catch (EngineRefused refused) {
                call.reject(refused.getMessage());
            }
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        control.execute(() -> {
            finish();
            call.resolve();
        });
    }

    // ---- The engine and its sound -------------------------------------------------

    private double start() throws EngineRefused {
        end();
        output = new AudioOutput();
        watch = new Watch(now());
        schedule(RESTING_PAUSE_MS);
        return output.engine.sampleRate;
    }

    /** The stream stops before the engine goes. */
    private void end() {
        if (looking != null) looking.cancel(false);
        looking = null;
        if (output != null) output.close();
        output = null;
    }

    /** The page is done with the engine: it goes, and the phone's sound is given back. */
    private void finish() {
        end();
        giveFocusBack();
    }

    /**
     * Makes the engine again at the rate the device runs at now. The page then
     * tells the new engine the beat again, which makes its sounds at that rate,
     * and to play on if it was playing.
     */
    private void reopen() {
        if (output == null) return;
        reopened += 1;
        try {
            report(Report.ready(start()));
        } catch (EngineRefused refused) {
            end();
            report(Report.error(refused.getMessage()));
        }
    }

    private static double now() {
        return SystemClock.elapsedRealtimeNanos() / 1e9;
    }

    private void schedule(long pauseMs) {
        looking = control.schedule(this::look, pauseMs, TimeUnit.MILLISECONDS);
    }

    private void look() {
        if (output == null) return;
        // The device left or changed and Oboe closed the stream.
        if (output.takeLost()) {
            reopen();
            return;
        }
        watch.look(output.engine, output, now(), this::report);
        schedule(output.engine.isPlaying() ? PLAYING_PAUSE_MS : RESTING_PAUSE_MS);
    }

    /** Stops the beat where the phone wants quiet, and tells the page it ended. */
    private void stopBeat() {
        if (output == null || !output.engine.isPlaying()) return;
        try {
            output.engine.apply(Command.parse(new JSObject().put("type", "stop")));
        } catch (EngineRefused refused) {
            Log.w(TAG, "The beat could not be stopped: " + refused.getMessage());
        }
        report(Report.ended());
        giveFocusBack();
    }

    // ---- Audio focus ---------------------------------------------------------------

    /** Asks the phone for its sound, for playing. False when it said no. */
    private boolean askForFocus() {
        int answer;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest == null) {
                AudioAttributes attributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build();
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attributes)
                    .setOnAudioFocusChangeListener(focusChanged)
                    .build();
            }
            answer = audio.requestAudioFocus(focusRequest);
        } else {
            answer = requestFocusBeforeOreo();
        }
        focused = answer == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        return focused;
    }

    @SuppressWarnings("deprecation")
    private int requestFocusBeforeOreo() {
        return audio.requestAudioFocus(focusChanged, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
    }

    /** Gives the phone's sound back once the beat has stopped, so another app may carry on. */
    private void giveFocusBack() {
        if (!focused) return;
        focused = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audio.abandonAudioFocusRequest(focusRequest);
        } else {
            abandonFocusBeforeOreo();
        }
    }

    @SuppressWarnings("deprecation")
    private void abandonFocusBeforeOreo() {
        audio.abandonAudioFocus(focusChanged);
    }

    /**
     * A call, an alarm or another app took the sound: the beat stops, and waits
     * for a press of play, which asks for the sound again. A sound that only
     * asks the beat to be quieter for a moment is left to the phone, which
     * lowers it.
     */
    private void heardFocus(int change) {
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) stopBeat();
    }

    // ---- The run that checks itself --------------------------------------------------

    /** Set in a check run, as an extra of the intent the app is started with (see apps/mobile/README.md). */
    private static final String CHECK_EXTRA = "boombapbotCheck";
    private static final String CHECK_FILE = "check-report.json";

    private String checkMode() {
        Intent intent = getActivity() == null ? null : getActivity().getIntent();
        String mode = intent == null ? null : intent.getStringExtra(CHECK_EXTRA);
        return mode == null || mode.isEmpty() ? null : mode;
    }

    @PluginMethod
    public void checkMode(PluginCall call) {
        JSObject answer = new JSObject();
        String mode = checkMode();
        answer.put("mode", mode == null ? JSObject.NULL : mode);
        call.resolve(answer);
    }

    /** What the engine and the phone's sound say of themselves now. */
    @PluginMethod
    public void checkEngine(PluginCall call) {
        if (checkMode() == null) {
            call.reject("This is not a check run.");
            return;
        }
        control.execute(() -> {
            JSObject answer = new JSObject();
            answer.put("open", output != null);
            if (output != null) {
                answer.put("device", output.facts());
                answer.put("playing", output.engine.isPlaying());
                answer.put("framesRendered", output.engine.framesRendered());
                answer.put("buffers", output.buffers());
                answer.put("outputLevel", output.engine.outputLevel());
                answer.put("peakEver", (double) watch.peakEver());
                answer.put("reopened", reopened);
            }
            call.resolve(answer);
        });
    }

    /** As if the device had changed under the engine. */
    @PluginMethod
    public void checkLose(PluginCall call) {
        if (checkMode() == null) {
            call.reject("This is not a check run.");
            return;
        }
        control.execute(() -> {
            reopen();
            call.resolve();
        });
    }

    /**
     * Writes what the page found to the app's files, for whoever launched the
     * app to read, says in the log whether it passed, and closes the app.
     */
    @PluginMethod
    public void checkReport(PluginCall call) {
        if (checkMode() == null) {
            call.reject("This is not a check run.");
            return;
        }
        JSObject report = call.getObject("report", new JSObject());
        File file = new File(getContext().getFilesDir(), CHECK_FILE);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(report.toString().getBytes(StandardCharsets.UTF_8));
        } catch (IOException failed) {
            call.reject("The report could not be written: " + failed.getMessage());
            return;
        }
        Log.i(TAG, "BOOMBAPBOT_CHECK ok=" + report.optBoolean("ok", false) + " written to " + file.getAbsolutePath());
        call.resolve();
        if (getActivity() != null) getActivity().runOnUiThread(() -> getActivity().finishAndRemoveTask());
    }
}
