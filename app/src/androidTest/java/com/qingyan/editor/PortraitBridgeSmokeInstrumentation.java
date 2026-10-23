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

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Exercises actual JavaScript -> native -> JavaScript callbacks in the installed WebView. */
public final class PortraitBridgeSmokeInstrumentation extends Instrumentation {
    private WebView web;
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    @Override public void onStart() {
        Bundle out = new Bundle();
        try {
            Intent intent = new Intent(Intent.ACTION_MAIN).setComponent(new ComponentName(
                    "com.qingyan.editor.portrait", "com.qingyan.editor.MainActivity"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Activity activity = startActivitySync(intent);
            runOnMainSync(() -> web = findWeb(activity.getWindow().getDecorView()));
            if (web == null) throw new AssertionError("Missing WebView");
            until("document.readyState === 'complete' && typeof Android.analyzePortrait==='function'", 90000);
            // Keep an existing test-draft prompt from overlaying the repeated fixture run.
            // Closing the dialog does not delete the saved draft.
            js("if(document.querySelector('#draftDialog')?.open)document.querySelector('#draftDialog').close();true");
            capture("qa-portrait-welcome.png");
            js("document.querySelector('#portraitDemoBtn').click();true");
            until("document.querySelector('#imageInfo').textContent.includes('512')", 90000);
            capture("qa-portrait-imported.png");
            js("window.__originalPortraitCallback=window.onPortraitAnalysis;"
                    + "window.__bridgeTest={};window.onPortraitAnalysis=(id,result)=>{window.__bridgeTest[id]=result};"
                    + "Android.analyzePortrait('not-a-data-url','bad','face');true");
            until("window.__bridgeTest.bad && window.__bridgeTest.bad.ok===false", 30000);
            js("(()=>{let i=new Image();i.onload=()=>{let c=document.createElement('canvas');c.width=i.width;c.height=i.height;"
                    + "c.getContext('2d').drawImage(i,0,0);let p=c.toDataURL('image/png');window.__bridgePixels=p;"
                    + "Android.analyzePortrait(p,'face','face');Android.analyzePortrait(p,'busy','person')};"
                    + "i.src='demo/astronaut.png';return true;})()");
            until("window.__bridgeTest.face && window.__bridgeTest.face.ok===true", 180000);
            until("window.__bridgeTest.busy && window.__bridgeTest.busy.ok===false", 30000);
            if (!"true".equals(js("(()=>{let r=window.__bridgeTest.face;return r.faceLimit===5&&r.faces.length===1"
                    + "&&!('landmarks' in r)&&!('selectedFaceId' in r)"
                    + "&&r.faces.every(f=>f.landmarks.length===478&&f.landmarks.every(p=>['x','y','z'].every(k=>Number.isFinite(p[k]))))"
                    + "&&r.detector.id==='mediapipe-face-landmarker'&&r.detector.topology==='MediaPipe478'"
                    + "&&r.detector.modelSha256==='64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'"
                    + "&&r.detectionSize.width===512&&r.detectionSize.height===512})()"))) {
                throw new AssertionError("Invalid multi-face contract or bundled model provenance");
            }
            js("Android.analyzePortrait(window.__bridgePixels,'person','person');true");
            until("window.__bridgeTest.person && window.__bridgeTest.person.ok===true", 180000);
            if (!"true".equals(js("(()=>{let m=window.__bridgeTest.person.mask;return m.width===256&&m.height===256&&atob(m.data).length===65536})()"))) {
                throw new AssertionError("Invalid person confidence-mask callback payload");
            }
            String summary = "PASS bridge: ready, invalid-input error, max-5/complete-478/model-hash/dimension contract, concurrent request rejection, 256x256/65536-byte person-mask callback";
            // Restore production callback before exercising actual user-facing controls.
            js("window.onPortraitAnalysis=window.__originalPortraitCallback;document.querySelector('[data-tool=portrait]').click();document.querySelector('#detectPortrait').click();true");
            // Assert controls/state/pixels, not a stale localized success sentence. A UI
            // failure is a test failure and must never be converted to finish(0).
            until("document.querySelectorAll('[data-person-face]').length>=1", 75000);
            js("document.querySelector('#person-face-1').click();true");
            until("document.querySelector('#person-face-1')?.classList.contains('active')", 30000);
            js("window.__beforeBeauty=document.querySelector('#previewCanvas').toDataURL();"
                    + "let s=document.querySelector('#p-smooth');s.value=20;s.dispatchEvent(new Event('input',{bubbles:true}));true");
            until("document.querySelector('#previewCanvas').toDataURL()!==window.__beforeBeauty", 30000);
            js("document.querySelector('#applyBtn').click();true");
            until("document.querySelector('#imageInfo').textContent.includes('1 步')", 30000);
            capture("qa-portrait-selected-face-applied.png");
            js("document.querySelector('[data-tool=background]').click();document.querySelector('#detectPortrait').click();true");
            until("document.querySelector('#portraitStatus').textContent.includes('人像已分离')", 75000);
            js("document.querySelector('#applyBtn').click();true");
            until("document.querySelector('#imageInfo').textContent.includes('2 步')", 30000);
            js("document.querySelector('[data-tool=idphoto]').click();document.querySelector('[data-id-size=\"295,413\"]').click();document.querySelector('#applyBtn').click();true");
            until("document.querySelector('#imageInfo').textContent.includes('295 × 413')", 30000);
            capture("qa-portrait-idphoto.png");
            summary += "; production UI explicit face selection/nonzero beauty pixels/commit/background/295x413 ID preset PASS";
            try (java.io.FileOutputStream saved = getTargetContext().openFileOutput(
                    "public-portrait-bridge-result.txt", android.content.Context.MODE_PRIVATE)) {
                saved.write(summary.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            out.putString("result", summary);
            finish(0, out);
        } catch (Throwable error) {
            out.putString("result", "FAIL bridge: " + error);
            out.putString("stack", android.util.Log.getStackTraceString(error));
            // Replace any result from a prior run, so file readers cannot report stale PASS.
            try (java.io.FileOutputStream saved = getTargetContext().openFileOutput(
                    "public-portrait-bridge-result.txt", android.content.Context.MODE_PRIVATE)) {
                saved.write(out.getString("result").getBytes(java.nio.charset.StandardCharsets.UTF_8));
            } catch (java.io.IOException writeError) {
                out.putString("resultWriteError", writeError.toString());
            }
            finish(1, out);
        }
    }
    private void capture(String name) throws Exception {
        android.graphics.Bitmap shot = getUiAutomation().takeScreenshot();
        if (shot != null) {
            try (java.io.FileOutputStream saved = getTargetContext().openFileOutput(
                    name, android.content.Context.MODE_PRIVATE)) {
                shot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, saved);
            }
            shot.recycle();
        }
    }
    private void until(String expression, long timeout) throws Exception {
        long end = SystemClock.uptimeMillis() + timeout;
        while (SystemClock.uptimeMillis() < end) {
            if ("true".equals(js("!!(" + expression + ")"))) return;
            SystemClock.sleep(500);
        }
        throw new AssertionError("Timeout " + expression);
    }
    private String js(String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        runOnMainSync(() -> web.evaluateJavascript(script, result -> { value.set(result); latch.countDown(); }));
        if (!latch.await(60, TimeUnit.SECONDS)) throw new AssertionError("WebView JavaScript callback timeout");
        return value.get();
    }
    private WebView findWeb(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup parent = (ViewGroup) view;
            for (int i = 0; i < parent.getChildCount(); i++) {
                WebView found = findWeb(parent.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }
}
