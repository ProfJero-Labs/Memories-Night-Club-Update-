package com.memories.momophone;

import android.content.Context;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.Charset;
import java.security.KeyStore;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.List;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

// Talking to the Memories system.
//  - Pairing: POST /api/momo-phone/pair { code, name } → { deviceId, secret } (not signed).
//  - Everything else is signed: x-momo-sign = HMAC-SHA256(secret, time + "." + body).
//  - Android 6 doesn't know the newer root certificates (Let's Encrypt, Google Trust Services), so
//    they're built into the app (assets/roots) and trusted alongside the phone's own.
final class Api {
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static SSLSocketFactory factory;

    static final class Result {
        final int status; final JSONObject json; final String error;
        Result(int status, JSONObject json, String error) { this.status = status; this.json = json; this.error = error; }
        boolean ok() { return status >= 200 && status < 300 && error == null; }
    }

    static Result pair(Context c, Store s, String code, String name) {
        try {
            JSONObject b = new JSONObject();
            b.put("code", code);
            b.put("name", name);
            return post(c, s.server() + "/api/momo-phone/pair", b.toString(), null, null);
        } catch (Exception e) { return new Result(0, null, e.toString()); }
    }

    static Result signed(Context c, Store s, String path, String body) {
        try {
            String time = String.valueOf(System.currentTimeMillis());
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(s.secret().getBytes(UTF8), "HmacSHA256"));
            String sign = Util.hex(mac.doFinal((time + "." + body).getBytes(UTF8)));
            return post(c, s.server() + path, body, s.deviceId(), new String[] { time, sign });
        } catch (Exception e) { return new Result(0, null, e.toString()); }
    }

    private static Result post(Context c, String url, String body, String deviceId, String[] timeSign) {
        HttpsURLConnection h = null;
        try {
            h = (HttpsURLConnection) new URL(url).openConnection();
            h.setSSLSocketFactory(socketFactory(c));
            h.setConnectTimeout(15000);
            h.setReadTimeout(20000);
            h.setRequestMethod("POST");
            h.setDoOutput(true);
            h.setRequestProperty("Content-Type", "application/json");
            if (deviceId != null) {
                h.setRequestProperty("x-momo-device", deviceId);
                h.setRequestProperty("x-momo-time", timeSign[0]);
                h.setRequestProperty("x-momo-sign", timeSign[1]);
            }
            byte[] out = body.getBytes(UTF8);
            h.setFixedLengthStreamingMode(out.length);
            OutputStream os = h.getOutputStream();
            os.write(out);
            os.close();
            int status = h.getResponseCode();
            InputStream in = status >= 400 ? h.getErrorStream() : h.getInputStream();
            String text = in == null ? "" : read(in);
            JSONObject json = text.isEmpty() ? new JSONObject() : new JSONObject(text);
            if (status >= 400) return new Result(status, json, json.optString("error", "Error " + status));
            return new Result(status, json, null);
        } catch (Exception e) {
            return new Result(0, null, "No connection: " + e.getClass().getSimpleName());
        } finally { if (h != null) h.disconnect(); }
    }

    private static String read(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        in.close();
        return new String(b.toByteArray(), UTF8);
    }

    // The phone's own trusted certificates, plus the ones built into the app.
    private static synchronized SSLSocketFactory socketFactory(Context c) throws Exception {
        if (factory != null) return factory;
        TrustManagerFactory sys = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        sys.init((KeyStore) null);
        KeyStore ks = KeyStore.getInstance(KeyStore.getDefaultType());
        ks.load(null, null);
        CertificateFactory cf = CertificateFactory.getInstance("X.509");
        String[] files = c.getAssets().list("roots");
        if (files != null) for (String f : files) {
            InputStream in = c.getAssets().open("roots/" + f);
            try { ks.setCertificateEntry(f, cf.generateCertificate(in)); } finally { in.close(); }
        }
        TrustManagerFactory own = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        own.init(ks);
        final List<X509TrustManager> all = new ArrayList<>();
        for (TrustManager t : sys.getTrustManagers()) if (t instanceof X509TrustManager) all.add((X509TrustManager) t);
        for (TrustManager t : own.getTrustManagers()) if (t instanceof X509TrustManager) all.add((X509TrustManager) t);
        X509TrustManager either = new X509TrustManager() {
            @Override public void checkClientTrusted(X509Certificate[] chain, String auth) throws CertificateException {
                throw new CertificateException("Not used");
            }
            @Override public void checkServerTrusted(X509Certificate[] chain, String auth) throws CertificateException {
                CertificateException last = null;
                for (X509TrustManager t : all) {
                    try { t.checkServerTrusted(chain, auth); return; } catch (CertificateException e) { last = e; }
                }
                throw last != null ? last : new CertificateException("Untrusted");
            }
            @Override public X509Certificate[] getAcceptedIssuers() {
                List<X509Certificate> out = new ArrayList<>();
                for (X509TrustManager t : all) for (X509Certificate x : t.getAcceptedIssuers()) out.add(x);
                return out.toArray(new X509Certificate[0]);
            }
        };
        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(null, new TrustManager[] { either }, null);
        factory = ctx.getSocketFactory();
        return factory;
    }
}
