package com.memories.momophone;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import java.util.LinkedHashMap;
import java.util.Map;

// Every incoming text: joined (long texts arrive in parts), queued on the phone, then the sender
// is woken to deliver it. The system decides what's a MoMo payment; the phone just passes it on.
public class SmsReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0) return;
        Map<String, StringBuilder> bySender = new LinkedHashMap<>();
        long at = System.currentTimeMillis();
        for (SmsMessage p : parts) {
            if (p == null) continue;
            String from = p.getDisplayOriginatingAddress();
            if (from == null) from = "";
            StringBuilder b = bySender.get(from);
            if (b == null) { b = new StringBuilder(); bySender.put(from, b); }
            b.append(p.getMessageBody() == null ? "" : p.getMessageBody());
            if (p.getTimestampMillis() > 0) at = p.getTimestampMillis();
        }
        Store s = new Store(c);
        for (Map.Entry<String, StringBuilder> e : bySender.entrySet()) s.add(e.getKey(), e.getValue().toString(), at);
        SenderService.kick(c);
    }
}
