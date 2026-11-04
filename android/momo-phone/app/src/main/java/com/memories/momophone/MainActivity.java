package com.memories.momophone;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

// One screen: is it working, pair it, allow texts, keep it running, send a test.
public class MainActivity extends Activity {
    private Store store;
    private TextView status;
    private final Handler handler = new Handler();
    private final Runnable refresh = new Runnable() { @Override public void run() { show(); handler.postDelayed(this, 2000); } };

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        store = new Store(this);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(18);
        col.setPadding(pad, pad, pad, pad);

        TextView title = text("Memories MoMo phone", 24);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        col.addView(title);
        col.addView(text("Keep this phone on, charged and connected at the club. It passes the wallet’s MoMo texts to the Memories system, and payments confirm themselves.", 15));

        status = text("", 17);
        status.setPadding(0, dp(14), 0, dp(14));
        col.addView(status);

        Button allow = button("1. Allow reading texts");
        allow.setOnClickListener(v -> askSms());
        col.addView(allow);

        final EditText code = new EditText(this);
        code.setHint("6-digit code from the manager");
        code.setInputType(InputType.TYPE_CLASS_NUMBER);
        code.setTextSize(22);
        col.addView(code);
        Button pair = button("2. Pair with the code");
        pair.setOnClickListener(v -> pair(code.getText().toString().trim()));
        col.addView(pair);

        Button keep = button("3. Keep it running (battery)");
        keep.setOnClickListener(v -> keepRunning());
        col.addView(keep);

        Button test = button("Send a test (check it works)");
        test.setOnClickListener(v -> test());
        col.addView(test);

        final EditText server = new EditText(this);
        server.setText(store.server());
        server.setTextSize(12);
        server.setVisibility(View.GONE);
        Button adv = button("Server address (engineer only)");
        adv.setOnClickListener(v -> {
            if (server.getVisibility() == View.GONE) server.setVisibility(View.VISIBLE);
            else { store.setServer(server.getText().toString()); server.setVisibility(View.GONE); toast("Saved."); }
        });
        col.addView(adv);
        col.addView(server);

        ScrollView sv = new ScrollView(this);
        sv.addView(col);
        setContentView(sv);
        SenderService.kick(this);
    }

    @Override protected void onResume() { super.onResume(); handler.post(refresh); }
    @Override protected void onPause() { handler.removeCallbacks(refresh); super.onPause(); }

    private void show() {
        boolean sms = Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED;
        int queued = store.queue().length();
        String err = store.lastError();
        StringBuilder s = new StringBuilder();
        s.append(sms ? "✓ Can read texts\n" : "✗ Not allowed to read texts yet (step 1)\n");
        s.append(store.paired() ? "✓ Paired\n" : "✗ Not paired yet (step 2)\n");
        s.append(ignoringBattery() ? "✓ Kept running\n" : "• Battery saving may stop it (step 3)\n");
        s.append("Last contact with the system: ").append(Util.ago(store.lastOk())).append('\n');
        if (queued > 0) s.append(queued).append(" text").append(queued == 1 ? "" : "s").append(" waiting to send\n");
        if (!err.isEmpty()) s.append("Problem: ").append(err);
        status.setText(s.toString());
    }

    private void askSms() {
        if (Build.VERSION.SDK_INT >= 23) requestPermissions(new String[] { Manifest.permission.RECEIVE_SMS }, 1);
        else toast("Already allowed.");
    }

    private void pair(final String code) {
        if (code.length() != 6) { toast("Type the 6-digit code from the manager."); return; }
        toast("Pairing…");
        new Thread(() -> {
            Api.Result r = Api.pair(this, store, code, Build.MANUFACTURER + " " + Build.MODEL);
            runOnUiThread(() -> {
                if (r.ok() && r.json != null && !r.json.optString("deviceId").isEmpty()) {
                    store.setPairing(r.json.optString("deviceId"), r.json.optString("secret"));
                    store.ok();
                    SenderService.kick(this);
                    toast("Paired. This phone now confirms MoMo payments.");
                } else toast(r.error == null ? "Couldn’t pair." : r.error);
                show();
            });
        }).start();
    }

    private void test() {
        if (!store.paired()) { toast("Pair it first (step 2)."); return; }
        toast("Sending a test…");
        new Thread(() -> {
            Api.Result r = Api.signed(this, store, "/api/momo-phone/ping", "{}");
            if (r.ok()) store.ok(); else store.error(r.error);
            runOnUiThread(() -> { toast(r.ok() ? "It works: the system heard this phone." : "Didn’t work: " + r.error); show(); });
        }).start();
    }

    private boolean ignoringBattery() {
        if (Build.VERSION.SDK_INT < 23) return true;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        return pm.isIgnoringBatteryOptimizations(getPackageName());
    }

    private void keepRunning() {
        if (Build.VERSION.SDK_INT < 23 || ignoringBattery()) { toast("Already kept running."); return; }
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
    }

    private TextView text(String s, int size) { TextView t = new TextView(this); t.setText(s); t.setTextSize(size); return t; }
    private Button button(String s) { Button b = new Button(this); b.setText(s); b.setAllCaps(false); b.setTextSize(17); return b; }
    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
    private void toast(String s) { android.widget.Toast.makeText(this, s, android.widget.Toast.LENGTH_LONG).show(); }
}
