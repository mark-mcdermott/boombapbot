package com.boombapbot.engine;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Keeps the app alive while the beat plays out of the front: a foreground
 * service of the media playback type, with a media notification and a media
 * session whose pause stops the beat. The plug-in starts it when the beat
 * starts and stops it when the beat stops. Once stopped the notification
 * goes: playing again needs the page, which tells the engine what to play.
 */
public class PlaybackService extends Service {

    /** What a pause from the notification, the lock screen or a headset sends the plug-in, inside the app. */
    static final String PAUSE = "com.boombapbot.engine.PAUSE";
    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION = 1;
    private static final String TITLE = "РИТМ-12";

    private MediaSession session;

    static void start(Context context) {
        ContextCompat.startForegroundService(context, new Intent(context, PlaybackService.class));
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, PlaybackService.class));
    }

    static Intent pauseIntent(Context context) {
        return new Intent(PAUSE).setPackage(context.getPackageName());
    }

    @Override
    public void onCreate() {
        super.onCreate();
        session = new MediaSession(this, "boombapbot");
        session.setCallback(new MediaSession.Callback() {
            @Override
            public void onPause() {
                sendBroadcast(pauseIntent(PlaybackService.this));
            }

            @Override
            public void onStop() {
                onPause();
            }
        });
        session.setMetadata(
            new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, TITLE)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, appName())
                .build()
        );
        session.setPlaybackState(
            new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP)
                .setState(PlaybackState.STATE_PLAYING, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
                .build()
        );
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ServiceCompat.startForeground(this, NOTIFICATION, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        session.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private String appName() {
        return getApplicationInfo().loadLabel(getPackageManager()).toString();
    }

    private Notification notification() {
        PendingIntent pause = PendingIntent.getBroadcast(this, 0, pauseIntent(this), PendingIntent.FLAG_IMMUTABLE);
        Notification.Action pauseAction = new Notification.Action.Builder(
            Icon.createWithResource(this, android.R.drawable.ic_media_pause),
            getString(R.string.boombapbot_pause),
            pause
        ).build();
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, channel())
            : builderBeforeOreo();
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE));
        }
        return builder
            .setSmallIcon(R.drawable.boombapbot_playing)
            .setContentTitle(TITLE)
            .setContentText(appName())
            .setOngoing(true)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(pauseAction)
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0))
            .build();
    }

    @SuppressWarnings("deprecation")
    private Notification.Builder builderBeforeOreo() {
        return new Notification.Builder(this);
    }

    private String channel() {
        NotificationChannel channel = new NotificationChannel(
            CHANNEL,
            getString(R.string.boombapbot_playback_channel),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
        return CHANNEL;
    }
}
