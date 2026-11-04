package com.memories.momophone;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// After the phone restarts, the sender starts again by itself.
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) || "android.intent.action.QUICKBOOT_POWERON".equals(intent.getAction())) SenderService.kick(c);
    }
}
