package com.qingyan.editor.test;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Bitmap;
import java.io.File;
import java.io.FileOutputStream;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import org.json.JSONArray;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Dependency-free instrumentation: executes the real WebView and native export-cancel flow. */
public final class EditorSmokeInstrumentation extends Instrumentation {
    private Activity activity;
    private WebView web;
    private int passed;
    private final StringBuilder report = new StringBuilder();

    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            Intent launch = new Intent(Intent.ACTION_MAIN);
            launch.setComponent(new ComponentName("com.qingyan.editor.portrait", "com.qingyan.editor.MainActivity"));
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity = startActivitySync(launch);
            runOnMainSync(() -> web = findWeb(activity.getWindow().getDecorView()));
            require(web != null, "Native Activity owns a WebView");
            until("!!document.querySelector('#demoBtn')", 30000);
            require("true".equals(js("document.querySelector('#exportBtn').disabled")), "Empty state prevents export");
            click("#demoBtn");
            until("document.querySelector('#imageInfo').textContent.includes('1500 × 1900')", 30000);
            check("Demo image decoded and rendered");
            click("[data-filter=mono]"); click("#applyBtn");
            until("document.querySelector('#imageInfo').textContent.includes('1 步')", 10000);
            until("(()=>{let c=document.querySelector('#previewCanvas'),p=c.getContext('2d').getImageData(100,100,1,1).data;return p[0]===p[1]&&p[1]===p[2]})()", 10000);
            check("Black-and-white modifies actual canvas pixels");
            click("#undoBtn"); until("document.querySelector('#imageInfo').textContent.includes('0 步')", 10000);
            click("#redoBtn"); until("document.querySelector('#imageInfo').textContent.includes('1 步')", 10000);
            check("Undo and redo work in WebView");
            click("[data-tool=crop]"); click("[data-ratio='1']"); click("#applyBtn");
            until("document.querySelector('#imageInfo').textContent.startsWith('1320 × 1320')", 10000);
            check("1:1 crop has exact full-resolution dimensions");
            click("[data-tool=text]");
            js("(()=>{let e=document.querySelector('#textInput');e.value='薄荷时光';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
            click("#applyBtn"); until("document.querySelector('#imageInfo').textContent.includes('3 步')", 10000);
            check("Chinese text applies");
            click("[data-tool=sticker]"); click("[data-sticker='✦']"); click("#applyBtn");
            until("document.querySelector('#imageInfo').textContent.includes('4 步')", 10000);
            check("Sticker applies");
            click("[data-tool=draw]");
            JSONArray rect = new JSONArray(js("(()=>{let r=document.querySelector('#overlayCanvas').getBoundingClientRect();return [r.left,r.top,r.width,r.height,innerWidth]})()"));
            int[] offset = new int[2]; runOnMainSync(() -> web.getLocationOnScreen(offset));
            float scale = web.getWidth() / (float)rect.getDouble(4);
            float x = offset[0] + (float)(rect.getDouble(0)+rect.getDouble(2)*.25)*scale;
            float y = offset[1] + (float)(rect.getDouble(1)+rect.getDouble(3)*.35)*scale;
            long down=SystemClock.uptimeMillis();
            pointer(down,down,MotionEvent.ACTION_DOWN,x,y);
            for(int i=1;i<=8;i++)pointer(down,SystemClock.uptimeMillis(),MotionEvent.ACTION_MOVE,x+i*5,y+i*2);
            pointer(down,SystemClock.uptimeMillis(),MotionEvent.ACTION_UP,x+40,y+16);
            until("!document.querySelector('#applyBar').hidden",10000);click("#applyBtn");
            until("document.querySelector('#imageInfo').textContent.includes('5 步')",10000);
            check("Native touch drawing reaches canvas and commits");
            click("#exportBtn"); until("document.querySelector('#exportDialog').open",10000);
            click("[data-format='image/png']");
            require("true".equals(js("document.querySelector('#qualityRow').hidden")),"PNG hides JPEG quality control");
            click("#saveBtn");
            // System picker is deliberately cancelled: no device file is created by this smoke test.
            long pickerDeadline=SystemClock.uptimeMillis()+30000;
            AtomicReference<Boolean> focus=new AtomicReference<>(true);
            while(SystemClock.uptimeMillis()<pickerDeadline){runOnMainSync(()->focus.set(activity.hasWindowFocus()));if(!focus.get())break;SystemClock.sleep(200);}
            require(!focus.get(),"Native save picker opened");
            SystemClock.sleep(1000);
            sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            until("!document.querySelector('#saveBtn').disabled",20000);
            require(js("document.querySelector('#toast').textContent").contains("取消"),"Native picker cancellation is not reported as success");
            check("Export can be opened again after cancel");
            click("#exportBtn"); until("document.querySelector('#exportDialog').open",10000);click("[data-close=exportDialog]");
            require("false".equals(js("document.documentElement.scrollWidth>innerWidth")),"Mobile viewport has no horizontal overflow");
            runOnMainSync(()->web.reload());
            until("!!document.querySelector('#draftDialog')&&document.querySelector('#draftDialog').open",20000);
            click("#restoreDraft");
            until("document.querySelector('#imageInfo').textContent.includes('5 步')",20000);
            check("Local IndexedDB draft restores after WebView reload");
            capture();
            result.putString("stream", "\n"+report+"PASS: "+passed+" Android smoke checks\n");
            result.putInt("passed", passed);
            finish(Activity.RESULT_OK,result);
        } catch(Throwable error) {
            try { capture(); } catch(Exception ignored) {}
            result.putString("stream","\n"+report+"FAIL: "+error+"\n");
            result.putString("failure",error.toString());
            finish(Activity.RESULT_CANCELED,result);
        }
    }
    private void capture() throws Exception {
        Bitmap image=getUiAutomation().takeScreenshot();
        if(image!=null){try(FileOutputStream out=new FileOutputStream(new File(getTargetContext().getFilesDir(),"qa-editor.png"))){image.compress(Bitmap.CompressFormat.PNG,100,out);}image.recycle();}
    }
    private void pointer(long down,long now,int action,float x,float y){MotionEvent e=MotionEvent.obtain(down,now,action,x,y,0);sendPointerSync(e);e.recycle();}
    private void click(String selector)throws Exception{js("document.querySelector("+org.json.JSONObject.quote(selector)+").click();true");SystemClock.sleep(120);}
    private void until(String expression,long timeout)throws Exception{long end=SystemClock.uptimeMillis()+timeout;while(SystemClock.uptimeMillis()<end){if("true".equals(js(expression)))return;SystemClock.sleep(150);}throw new AssertionError("Timeout: "+expression);}
    private String js(String script)throws Exception{CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();runOnMainSync(()->web.evaluateJavascript(script,r->{value.set(r);latch.countDown();}));if(!latch.await(15,TimeUnit.SECONDS))throw new AssertionError("JS callback timed out");return value.get();}
    private void require(boolean truth,String message){if(!truth)throw new AssertionError(message);check(message);}
    private void check(String message){passed++;report.append("PASS ").append(message).append('\n');}
    private WebView findWeb(View view){if(view instanceof WebView)return (WebView)view;if(view instanceof ViewGroup){ViewGroup g=(ViewGroup)view;for(int i=0;i<g.getChildCount();i++){WebView w=findWeb(g.getChildAt(i));if(w!=null)return w;}}return null;}
}
