package com.qingyan.editor;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;

/** Disposable test: actual WebView page reload and native callback generation gate.
 * Does not run a segmentation model or assert native inference cancellation. */
public final class PortraitPageIsolationInstrumentation extends Instrumentation {
    private WebView web;
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    @Override public void onStart() {
        Bundle out = new Bundle();
        try {
            String pkg = getTargetContext().getPackageName();
            Activity activity = startActivitySync(new Intent(Intent.ACTION_MAIN)
                    .setComponent(new ComponentName(pkg, "com.qingyan.editor.MainActivity"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            runOnMainSync(() -> web = findWeb(activity.getWindow().getDecorView()));
            if (web == null) throw new AssertionError("Missing WebView");
            until("document.readyState==='complete' && typeof window.onPortraitAnalysis==='function'", 90000);
            if (!"true".equals(js("typeof window.crypto?.getRandomValues==='function'"))) {
                throw new AssertionError("WebView cannot provide secure request IDs");
            }
            verifyEpoch(activity);
            out.putString("result", "PASS portrait page isolation: reload, stale/current native callback gate, WebView secure random API");
            finish(0, out);
        } catch (Throwable error) {
            out.putString("result", "FAIL portrait page isolation: " + error);
            out.putString("stack", android.util.Log.getStackTraceString(error));
            finish(1, out);
        }
    }
    private void verifyEpoch(Activity activity) throws Exception {
        Field generation = activity.getClass().getDeclaredField("portraitPageGeneration");
        Field ready = activity.getClass().getDeclaredField("ready");
        Method deliver = activity.getClass().getDeclaredMethod("notifyPortrait", long.class, String.class, JSONObject.class);
        generation.setAccessible(true); ready.setAccessible(true); deliver.setAccessible(true);
        AtomicReference<Long> epoch = new AtomicReference<>();
        runOnMainSync(() -> { try { epoch.set(generation.getLong(activity)); web.reload(); } catch (Exception e) { throw new RuntimeException(e); } });
        long previous = epoch.get(), deadline = SystemClock.uptimeMillis() + 90000;
        AtomicReference<Boolean> loaded = new AtomicReference<>(false);
        while (SystemClock.uptimeMillis() < deadline) {
            runOnMainSync(() -> { try { epoch.set(generation.getLong(activity)); loaded.set(ready.getBoolean(activity)); } catch (Exception e) { throw new RuntimeException(e); } });
            if (epoch.get() > previous && loaded.get()) break;
            SystemClock.sleep(50);
        }
        if (epoch.get() <= previous || !loaded.get()) throw new AssertionError("Page reload did not advance the portrait epoch");
        until("document.readyState==='complete' && typeof window.onPortraitAnalysis==='function'", 90000);
        js("window.__gateEvents=[];window.onPortraitAnalysis=(id)=>window.__gateEvents.push(id);true");
        long current = epoch.get();
        runOnMainSync(() -> { try {
            JSONObject result = new JSONObject().put("ok", true);
            deliver.invoke(activity, previous, "old-page", result);
            deliver.invoke(activity, current, "current-page", result);
        } catch (Exception e) { throw new RuntimeException(e); } });
        until("window.__gateEvents.includes('current-page')", 30000);
        if (!"true".equals(js("JSON.stringify(window.__gateEvents)===JSON.stringify(['current-page'])"))) {
            throw new AssertionError("A stale page callback reached the new document");
        }
    }
    private void until(String expr, long timeout) throws Exception {
        long end = SystemClock.uptimeMillis() + timeout;
        while (SystemClock.uptimeMillis() < end) {
            if ("true".equals(js("!!(" + expr + ")"))) return;
            SystemClock.sleep(250);
        }
        throw new AssertionError("Timeout: " + expr);
    }
    private String js(String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1); AtomicReference<String> value = new AtomicReference<>();
        runOnMainSync(() -> web.evaluateJavascript(script, result -> { value.set(result); latch.countDown(); }));
        if (!latch.await(60, TimeUnit.SECONDS)) throw new AssertionError("WebView callback timed out");
        return value.get();
    }
    private WebView findWeb(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup parent = (ViewGroup) view;
            for (int i = 0; i < parent.getChildCount(); i++) {
                WebView found = findWeb(parent.getChildAt(i)); if (found != null) return found;
            }
        }
        return null;
    }
}
