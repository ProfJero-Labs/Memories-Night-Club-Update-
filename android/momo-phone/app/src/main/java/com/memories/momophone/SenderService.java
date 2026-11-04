package com.memories.momophone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

// Runs all the time (a small notification shows it's on): delivers queued texts in order, retries
// until the system has them, and checks in every 5 minutes so the system knows the phone is alive.
public class SenderService extends Service {
    private static final String CHANNEL = "momo";
    private static final long PING_MS = 5 * 60 * 1000L;
    private final Object wake = new Object();
    private Thread loop;
    private volatile boolean running;

    static void kick(Context c) {
        Intent i = new Intent(c, SenderService.class);
        // Android may refuse a start from the background; the service is normally already running
        // and picks the text up from the queue within 30 seconds anyway.
        try { if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i); } catch (Exception ignored) { }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = notification("Listening for MoMo texts");
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE); else startForeground(1, n);
        if (loop == null || !loop.isAlive()) {
            running = true;
            loop = new Thread(this::run, "momo-sender");
            loop.start();
        }
        synchronized (wake) { wake.notifyAll(); }
        return START_STICKY;
    }

    private void run() {
        Store s = new Store(this);
        long lastPing = 0, backoff = 5000;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        while (running) {
            boolean sentOk = true;
            if (s.paired()) {
                PowerManager.WakeLock lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "momo:send");
                lock.acquire(60 * 1000L);
                try {
                    JSONArray q = s.queue();
                    if (q.length() > 0) {
                        // Up to 20 at a time, oldest first.
                        JSONArray batch = new JSONArray();
                        for (int i = 0; i < Math.min(20, q.length()); i++) batch.put(q.opt(i));
                        JSONObject body = new JSONObject();
                        body.put("messages", batch);
                        Api.Result r = Api.signed(this, s, "/api/momo-phone/texts", body.toString());
                        if (r.ok()) { s.drop(batch.length()); s.ok(); lastPing = System.currentTimeMillis(); backoff = 5000; }
                        else { s.error(r.error); sentOk = false; if (r.status == 401) unpairedNotice(); }
                    } else if (System.currentTimeMillis() - lastPing > PING_MS) {
                        Api.Result r = Api.signed(this, s, "/api/momo-phone/ping", "{}");
                        if (r.ok()) { s.ok(); lastPing = System.currentTimeMillis(); } else { s.error(r.error); sentOk = false; if (r.status == 401) unpairedNotice(); }
                    }
                } catch (Exception e) {
                    s.error(e.toString()); sentOk = false;
                } finally { if (lock.isHeld()) lock.release(); }
            }
            long wait = !sentOk ? backoff : s.queue().length() > 0 ? 0 : 30000;
            if (!sentOk) backoff = Math.min(backoff * 2, 5 * 60 * 1000L);
            if (wait > 0) synchronized (wake) { try { wake.wait(wait); } catch (InterruptedException e) { return; } }
        }
    }

    private void unpairedNotice() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(2, notification("Not paired any more, or the phone’s clock is wrong. Open the app."));
    }

    private Notification notification(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            if (nm.getNotificationChannel(CHANNEL) == null) nm.createNotificationChannel(new NotificationChannel(CHANNEL, "MoMo phone", NotificationManager.IMPORTANCE_LOW));
            b = new Notification.Builder(this, CHANNEL);
        } else b = new Notification.Builder(this);
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return b.setContentTitle("Memories MoMo phone").setContentText(text).setSmallIcon(android.R.drawable.stat_notify_sync).setOngoing(true).setContentIntent(open).build();
    }

    @Override public void onDestroy() { running = false; synchronized (wake) { wake.notifyAll(); } super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
