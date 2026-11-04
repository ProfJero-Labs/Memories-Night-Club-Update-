package com.memories.momophone;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// What the app keeps on the phone: the pairing (device id + secret), the server address, and the
// queue of texts not yet delivered. Texts are queued first and removed only once the system has
// them, so nothing is lost if the network or the phone drops.
final class Store {
    static final String DEFAULT_SERVER = "https://memories-paystack-verify.diamondj04102026.workers.dev";
    private static final String NAME = "momo-phone";
    private static final int MAX_QUEUE = 500;

    private final SharedPreferences prefs;

    Store(Context c) { prefs = c.getApplicationContext().getSharedPreferences(NAME, Context.MODE_PRIVATE); }

    String server() { return prefs.getString("server", DEFAULT_SERVER); }
    void setServer(String s) { prefs.edit().putString("server", s.trim().replaceAll("/+$", "")).apply(); }
    String deviceId() { return prefs.getString("deviceId", ""); }
    String secret() { return prefs.getString("secret", ""); }
    boolean paired() { return !deviceId().isEmpty() && !secret().isEmpty(); }
    void setPairing(String deviceId, String secret) { prefs.edit().putString("deviceId", deviceId).putString("secret", secret).apply(); }
    void forget() { prefs.edit().remove("deviceId").remove("secret").apply(); }

    long lastOk() { return prefs.getLong("lastOk", 0); }
    String lastError() { return prefs.getString("lastError", ""); }
    void ok() { prefs.edit().putLong("lastOk", System.currentTimeMillis()).putString("lastError", "").apply(); }
    void error(String e) { prefs.edit().putString("lastError", e == null ? "" : e).apply(); }

    synchronized JSONArray queue() {
        try { return new JSONArray(prefs.getString("queue", "[]")); } catch (JSONException e) { return new JSONArray(); }
    }
    synchronized void add(String from, String body, long receivedAt) {
        JSONArray q = queue();
        try {
            JSONObject m = new JSONObject();
            m.put("from", from == null ? "" : from);
            m.put("body", body == null ? "" : body);
            m.put("receivedAt", Util.iso(receivedAt));
            q.put(m);
        } catch (JSONException ignored) { return; }
        // Keep the newest if the phone has been offline for a very long time.
        JSONArray keep = new JSONArray();
        for (int i = Math.max(0, q.length() - MAX_QUEUE); i < q.length(); i++) keep.put(q.opt(i));
        prefs.edit().putString("queue", keep.toString()).apply();
    }
    // Remove the first n (delivered) texts.
    synchronized void drop(int n) {
        JSONArray q = queue(), keep = new JSONArray();
        for (int i = n; i < q.length(); i++) keep.put(q.opt(i));
        prefs.edit().putString("queue", keep.toString()).apply();
    }
}
