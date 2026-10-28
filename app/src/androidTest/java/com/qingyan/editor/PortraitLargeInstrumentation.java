package com.qingyan.editor;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Real bundled portrait models, real controls, and saved PNGs on a disposable emulator.
 * A completed workflow or changed pixels are not evidence of beauty/hair quality. */
public final class PortraitLargeInstrumentation extends Instrumentation {
    private Activity activity;
    private WebView web;
    private String stage = "launch";
    private final JSONArray checks = new JSONArray();
    private final JSONArray clickTraces = new JSONArray();
    private final JSONArray saves = new JSONArray();
    private final JSONObject timings = new JSONObject();
    private long visualRequestId;
    private int sourceWidth = 2400, sourceHeight = 3000;

    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            String pkg = getTargetContext().getPackageName();
            require(pkg.endsWith(".e2e"), "disposable app ID enforced");
            activity = startActivitySync(new Intent(Intent.ACTION_MAIN)
                    .setComponent(new ComponentName(pkg, "com.qingyan.editor.MainActivity"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            runOnMainSync(() -> web = findWeb(activity.getWindow().getDecorView()));
            require(web != null, "real WebView present");
            until("document.readyState==='complete'&&typeof document.querySelector('#importBtn')?.onclick==='function'&&typeof Android.analyzePortrait==='function'&&!Android.isExportBusy()", 90000);
            AtomicReference<Boolean> blocked = new AtomicReference<>();
            runOnMainSync(() -> blocked.set(web.getSettings().getBlockNetworkLoads()));
            require(blocked.get(), "WebView network remains blocked during local portrait work");
            stage = "import"; long started = SystemClock.uptimeMillis();
            click("#importBtn"); waitPicker(); chooseDownloads(); tapText("mint-e2e-large-source.jpg");
            until("document.querySelector('#imageInfo').textContent.includes('2400 × 3000')&&document.querySelector('#busy').hidden", 120000);
            timings.put("originalImportIncludingPicker", SystemClock.uptimeMillis() - started);
            require("true".equals(js("document.querySelector('#previewCanvas').width===720&&document.querySelector('#previewCanvas').height===900")), "7.2 MP source retains original dimensions with a 720x900 display preview");
            capture("imported");
            // Observe and forward the real native callback. Never replace a model result.
            js("window.__portraitBridgeEvents=[];const nativeCallback=window.onPortraitAnalysis;window.onPortraitAnalysis=(id,value)=>{try{const r=typeof value==='string'?JSON.parse(value):value;window.__portraitBridgeEvents.push({id,ok:r?.ok,faceCount:Array.isArray(r?.faces)?r.faces.length:null,landmarkCount:r?.faces?.[0]?.landmarks?.length||0,modelSha256:r?.detector?.modelSha256||null,maskWidth:r?.mask?.width||0,maskHeight:r?.mask?.height||0});}finally{return nativeCallback(id,value);}};true");

            stage = "skin-detect";
            click("[data-category=portrait]"); click("[data-tool=portrait]");
            started = SystemClock.uptimeMillis(); click("#detectPortrait");
            until("document.querySelectorAll('[data-person-face]').length>=1&&document.querySelector('#busy').hidden", 120000);
            timings.put("faceDetectionIncludingTouchAndPolling", SystemClock.uptimeMillis() - started);
            require("true".equals(js("window.__portraitBridgeEvents.some(e=>e.ok&&e.faceCount>=1&&e.landmarkCount===478)")), "real bundled face model returned complete landmark data through the production callback");
            click("#person-face-1");
            require("true".equals(js("document.querySelector('#person-face-1').getAttribute('aria-pressed')==='true'&&!document.querySelector('#p-smooth').disabled")), "person 1 explicitly selected before changing skin parameters");
            capture("face-selected");
            click("#portraitPresetDetails summary"); click("#detailSkin");
            require("true".equals(js("document.querySelector('#detailSkin').checked")), "texture skin experimental option selected through its actual checkbox");
            rememberPreview(); started = SystemClock.uptimeMillis();
            // Exact range value uses the same input handler; detection, selection,
            // options, apply and system file controls use real pointer/accessibility.
            js("const s=document.querySelector('#p-smooth');s.value='65';s.dispatchEvent(new Event('input',{bubbles:true}));true");
            until("document.querySelector('#pv-smooth').textContent==='65'&&!document.querySelector('#applyBtn').disabled", 120000);
            settleLayout(); JSONObject skinPixels = previewDifference();
            require(skinPixels.getInt("changedPixels") > 0, "texture skin strength 65 changes actual preview pixels, without claiming perceptual quality");
            timings.put("skin65PreviewIncludingPolling", SystemClock.uptimeMillis() - started);
            write("portrait-large-skin-preview-pixels.json", skinPixels.toString(2)); capture("skin-preview");
            stage = "skin-apply"; started = SystemClock.uptimeMillis(); click("#applyBtn");
            until("document.querySelector('#imageInfo').textContent.includes('1 步')&&document.querySelector('#busy').hidden", 120000);
            timings.put("skinApplyIncludingTouchAndPolling", SystemClock.uptimeMillis() - started);
            capture("skin-applied"); saveAndReopen("skin", false);

            stage = "background-detect";
            click("[data-category=portrait]"); click("[data-tool=background]");
            started = SystemClock.uptimeMillis(); click("#detectPortrait");
            until("window.__portraitBridgeEvents.some(e=>e.ok&&e.maskWidth>0)&&!document.querySelector('#applyBtn').disabled&&document.querySelector('#busy').hidden", 120000);
            timings.put("personSegmentationIncludingTouchAndPolling", SystemClock.uptimeMillis() - started);
            require("true".equals(js("window.__portraitBridgeEvents.some(e=>e.ok&&e.maskWidth===205&&e.maskHeight===256)")), "real person model returned a 205x256 confidence mask matching the 4:5 photograph; this is not a hair-detail accuracy assertion");
            click("#edgeAware");
            require("true".equals(js("document.querySelector('#edgeAware').checked")), "experimental edge-aware refinement selected through the actual checkbox");
            click("#bgMode-transparent");
            require("true".equals(js("document.querySelector('#bgMode-transparent').classList.contains('active')&&!document.querySelector('#showMask').checked")), "transparent composition selected with diagnostic mask overlay turned off by the product");
            settleLayout(); JSONObject backgroundPixels = alphaStats();
            require(backgroundPixels.getInt("lowAlphaPixels") > 0 && backgroundPixels.getInt("highAlphaPixels") > 0, "transparent preview contains both retained and removed pixels");
            write("portrait-large-background-preview-pixels.json", backgroundPixels.toString(2)); capture("background-preview");
            stage = "background-apply"; started = SystemClock.uptimeMillis(); click("#applyBtn");
            until("document.querySelector('#imageInfo').textContent.includes('1 步')&&document.querySelector('#busy').hidden", 120000);
            timings.put("backgroundApplyIncludingTouchAndPolling", SystemClock.uptimeMillis() - started);
            capture("background-applied"); saveAndReopen("background", true);

            JSONObject report = baseReport("PASS");
            report.put("nativeCallbacks", new JSONArray(js("window.__portraitBridgeEvents")));
            write("portrait-large-result.json", report.toString(2));
            result.putString("result", "PASS Android portrait large workflow, " + checks.length() + " checks; real local models and SAF PNGs, no perceptual quality or physical-device performance claim");
            finish(0, result);
        } catch (Throwable error) {
            result.putString("result", "FAIL Android portrait large workflow " + stage + ": " + error);
            result.putString("stack", android.util.Log.getStackTraceString(error));
            try {
                write("portrait-large-result.json", baseReport("FAIL").put("error", error.toString()).toString(2));
                write("portrait-large-failure.txt", result.toString() + "\n" + tree(getUiAutomation().getRootInActiveWindow(), 0));
                capture("FAIL-" + stage);
            } catch (Exception ignored) {}
            finish(1, result);
        }
    }

    private JSONObject baseReport(String result) throws Exception {
        return new JSONObject().put("result", result).put("stage", stage).put("checks", checks)
                .put("timingsMsIncludingAutomationAndPolling", timings).put("saves", saves)
                .put("androidApi", android.os.Build.VERSION.SDK_INT).put("abi", android.os.Build.SUPPORTED_ABIS[0])
                .put("originalWidth", 2400).put("originalHeight", 3000)
                .put("originalSha256", "34471604e6f19bdbc31e8a556caa9d20bab29c417a7817a1c352740458dcf0eb")
                .put("realBundledPortraitModels", true).put("remoteGenerativeAiTested", false)
                .put("physicalDevice", false).put("systemDocumentPicker", true)
                .put("skinOption", "detail-v2 experimental, smooth 65").put("cutoutOption", "edge-aware v2 experimental, transparent")
                .put("limits", "One pinned NASA photograph on an emulator. Pixel changes and alpha occupancy validate workflow, not skin naturalness, hair accuracy, identity preservation, FPS, peak memory, or physical-device speed. Exact range values are dispatched to the production input handler; other major actions use real touch/system accessibility.");
    }

    private void rememberPreview() throws Exception {
        js("const c=document.querySelector('#previewCanvas');window.__portraitBefore=c.getContext('2d').getImageData(0,0,c.width,c.height).data;true");
    }
    private JSONObject previewDifference() throws Exception {
        return new JSONObject(js("(()=>{const c=document.querySelector('#previewCanvas'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data,b=window.__portraitBefore;let changedPixels=0,maxChannelDelta=0;for(let i=0;i<p.length;i+=4){let changed=false;for(let k=0;k<4;k++){const delta=Math.abs(p[i+k]-b[i+k]);if(delta)changed=true;maxChannelDelta=Math.max(maxChannelDelta,delta);}if(changed)changedPixels++;}delete window.__portraitBefore;return{width:c.width,height:c.height,changedPixels,maxChannelDelta};})()"));
    }
    private JSONObject alphaStats() throws Exception {
        return new JSONObject(js("(()=>{const c=document.querySelector('#previewCanvas'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let lowAlphaPixels=0,highAlphaPixels=0;for(let i=3;i<p.length;i+=4){if(p[i]<16)lowAlphaPixels++;if(p[i]>239)highAlphaPixels++;}return{width:c.width,height:c.height,lowAlphaPixels,highAlphaPixels};})()"));
    }

    private void saveAndReopen(String name, boolean transparent) throws Exception {
        stage = name + "-save"; long started = SystemClock.uptimeMillis();
        click("#exportBtn"); until("document.querySelector('#exportDialog').open", 10000);
        JSONObject choice = new JSONObject(js("(()=>{const n=document.querySelector('#exportResolution');return{originalDisabled:n.querySelector('[value=original]').disabled,selected:n.value,details:document.querySelector('#exportDetails').textContent};})()"));
        int expectedWidth = sourceWidth, expectedHeight = sourceHeight;
        if (choice.getBoolean("originalDisabled")) {
            require("choose".equals(choice.getString("selected")), "original-budget refusal requires an explicit resolution choice");
            require(!choice.getString("details").isBlank(), "original-budget refusal has a visible explanation");
            require("true".equals(js("document.querySelector('#saveBtn').disabled")), "saving stays disabled before choosing working resolution");
            capture(name + "-original-budget");
            click("#exportResolution"); tapText("工作尺寸（最长边 2560，证件照按设定）");
            until("document.querySelector('#exportResolution').value==='working'&&!document.querySelector('#saveBtn').disabled", 10000);
            double scale = Math.min(1d, 2560d / Math.max(sourceWidth, sourceHeight));
            expectedWidth = (int)Math.round(sourceWidth * scale); expectedHeight = (int)Math.round(sourceHeight * scale);
            choice.put("explicitWorkingChoice", true);
        } else {
            require("original".equals(choice.getString("selected")), "available original resolution stays selected");
            choice.put("explicitWorkingChoice", false);
        }
        click("[data-format='image/png']");
        require("true".equals(js("document.querySelector('#exportSize').value==='unchanged'&&!document.querySelector('#saveBtn').disabled")), "PNG export keeps the chosen processing dimensions without an additional resize");
        choice.put("name", name).put("expectedWidth", expectedWidth).put("expectedHeight", expectedHeight);
        choice.put("finalDetails", new JSONArray(js("[document.querySelector('#exportDetails').textContent]")).getString(0));
        saves.put(choice); capture(name + "-save-settings"); click("#saveBtn"); waitPicker(); chooseDownloads();
        String fileName = "mint-e2e-portrait-" + name + ".png";
        AccessibilityNodeInfo edit = findClass(getUiAutomation().getRootInActiveWindow(), "android.widget.EditText");
        require(edit != null, "system PNG filename field exists");
        Bundle text = new Bundle(); text.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, fileName);
        require(edit.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, text), "system PNG filename set");
        capture(name + "-save-picker"); tapText("Save");
        until("!Android.isExportBusy()&&document.querySelector('#toast').textContent.includes('已保存')", 120000);
        timings.put(name + "SaveIncludingSystemPicker", SystemClock.uptimeMillis() - started);
        require(true, name + " PNG completed the native SAF write");

        stage = name + "-reopen"; started = SystemClock.uptimeMillis();
        js("window.__portraitSavedFile=null;window.__portraitOldRevision=document.querySelector('#imageInfo').dataset.sourceRevision;document.querySelector('#fileInput').addEventListener('change',e=>window.__portraitSavedFile=e.target.files?.[0]||null,{once:true,capture:true});true");
        if ("true".equals(js("!document.querySelector('#headerMenu').open"))) click("#headerMenu summary");
        click("#openTop"); waitPicker(); chooseDownloads(); tapText(fileName);
        until("!!window.__portraitSavedFile", 30000);
        for (int i = 0; i < 30; i++) {
            if ("true".equals(js("!!document.querySelector('#confirmDialog')?.open"))) click("#confirmYes");
            if ("true".equals(js("document.querySelector('#busy').hidden&&document.querySelector('#imageInfo').dataset.sourceRevision!==window.__portraitOldRevision"))) break;
            SystemClock.sleep(300);
        }
        until("document.querySelector('#busy').hidden&&document.querySelector('#imageInfo').dataset.sourceRevision!==window.__portraitOldRevision&&document.querySelector('#imageInfo').textContent.includes('" + expectedWidth + " × " + expectedHeight + "')", 120000);
        timings.put(name + "ReopenIncludingSystemPicker", SystemClock.uptimeMillis() - started);
        inspectSavedPng(name, expectedWidth, expectedHeight, transparent);
        sourceWidth = expectedWidth; sourceHeight = expectedHeight;
        require(true, name + " saved PNG reopened as a new source at the explicitly chosen dimensions");
        capture(name + "-reopened");
    }

    private void inspectSavedPng(String name, int width, int height, boolean transparent) throws Exception {
        // This reads the actual File returned by DocumentsUI after the SAF write.
        // It does not substitute a preview capture for the exported image.
        js("delete window.__savedPngStats;delete window.__savedPngError;(async()=>{const f=window.__portraitSavedFile,header=new Uint8Array(await f.slice(0,24).arrayBuffer());if([137,80,78,71,13,10,26,10].some((v,i)=>header[i]!==v))throw Error('Saved file is not PNG');const view=new DataView(header.buffer),ihdrWidth=view.getUint32(16),ihdrHeight=view.getUint32(20);const hash=await MintProjectBackup.sha256Blob(f);const url=URL.createObjectURL(f),image=new Image();let c;try{image.src=url;await image.decode();c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);let lowAlphaPixels=0,highAlphaPixels=0,partialAlphaPixels=0;for(let y=0;y<c.height;y+=128){const p=ctx.getImageData(0,y,c.width,Math.min(128,c.height-y)).data;for(let i=3;i<p.length;i+=4){if(p[i]<16)lowAlphaPixels++;if(p[i]>239)highAlphaPixels++;if(p[i]>0&&p[i]<255)partialAlphaPixels++;}await new Promise(resolve=>setTimeout(resolve,0));}window.__savedPngStats={name:f.name,bytes:f.size,sha256:hash,ihdrWidth,ihdrHeight,decodedWidth:c.width,decodedHeight:c.height,lowAlphaPixels,highAlphaPixels,partialAlphaPixels};}finally{if(c)c.width=c.height=1;image.src='';URL.revokeObjectURL(url);delete window.__portraitSavedFile;}})().catch(e=>window.__savedPngError=String(e));true");
        until("!!window.__savedPngStats||!!window.__savedPngError", 120000);
        require("true".equals(js("!window.__savedPngError")), "saved PNG is independently readable: " + js("window.__savedPngError||null"));
        JSONObject pixels = new JSONObject(js("window.__savedPngStats"));
        require(pixels.getInt("ihdrWidth") == width && pixels.getInt("ihdrHeight") == height
                && pixels.getInt("decodedWidth") == width && pixels.getInt("decodedHeight") == height, "actual " + name + " PNG header and decoded image match selected output dimensions");
        if (transparent) require(pixels.getInt("lowAlphaPixels") > 0 && pixels.getInt("highAlphaPixels") > 0, "actual background PNG retains both transparent and opaque regions after save/reopen");
        else require(pixels.getInt("highAlphaPixels") == width * height && pixels.getInt("partialAlphaPixels") == 0, "actual skin PNG retains the original photograph's opaque alpha");
        write("portrait-large-" + name + "-saved-png.json", pixels.toString(2));
    }

    // The minimal pointer and SAF helpers below mirror the existing AI test, kept
    // local so changing this independent runner cannot alter that concurrent suite.

    private void settleLayout()throws Exception {
        js("window.__layoutSettled=false;requestAnimationFrame(()=>requestAnimationFrame(()=>window.__layoutSettled=true));true");
        until("window.__layoutSettled",10000);
        awaitVisualState();
    }
    private void awaitVisualState()throws Exception {
        CountDownLatch drawn=new CountDownLatch(1);
        long requestId=++visualRequestId;
        runOnMainSync(()->web.postVisualStateCallback(requestId,new WebView.VisualStateCallback(){@Override public void onComplete(long id){drawn.countDown();}}));
        if(!drawn.await(10,TimeUnit.SECONDS))throw new AssertionError("WebView visual state did not settle");
    }
    private void pointer(long down,int action,float x,float y){MotionEvent e=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,x,y,0);e.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);sendPointerSync(e);e.recycle();}
    private void waitPicker()throws Exception {long end=SystemClock.uptimeMillis()+120000;while(SystemClock.uptimeMillis()<end){AccessibilityNodeInfo n=getUiAutomation().getRootInActiveWindow();if(n!=null&&String.valueOf(n.getPackageName()).contains("documentsui"))return;SystemClock.sleep(300);}throw new AssertionError("system DocumentsUI not visible; state="+js("JSON.stringify({toast:document.querySelector('#toast')?.textContent,busy:document.querySelector('#busy')?.hidden,nativeBusy:Android.isExportBusy()})"));}
    private void chooseDownloads()throws Exception {
        AccessibilityNodeInfo root=getUiAutomation().getRootInActiveWindow();
        AccessibilityNodeInfo roots=findId(root,"com.google.android.documentsui:id/roots_list");
        AccessibilityNodeInfo breadcrumb=findId(root,"com.google.android.documentsui:id/breadcrumb_text");
        boolean alreadyDownloads=breadcrumb!=null&&"Downloads".equals(String.valueOf(breadcrumb.getText()));
        if(roots==null&&!alreadyDownloads){
            AccessibilityNodeInfo nav=findDescription(root,"Show roots");
            while(nav!=null&&!nav.isClickable())nav=nav.getParent();
            require(nav!=null&&nav.performAction(AccessibilityNodeInfo.ACTION_CLICK),"system root navigation opened");
        }
        if(roots!=null||!alreadyDownloads){
            long end=SystemClock.uptimeMillis()+15000;boolean selected=false;
            while(SystemClock.uptimeMillis()<end){
                roots=findId(getUiAutomation().getRootInActiveWindow(),"com.google.android.documentsui:id/roots_list");
                AccessibilityNodeInfo n=findText(roots,"Downloads");
                while(n!=null&&!n.isClickable())n=n.getParent();
                if(n!=null&&n.performAction(AccessibilityNodeInfo.ACTION_CLICK)){selected=true;break;}SystemClock.sleep(250);
            }
            require(selected,"Downloads selected from the root list, not a duplicate breadcrumb");SystemClock.sleep(300);
        }
        // Image grid mode omits filenames from accessibility. Select the real list control.
        AccessibilityNodeInfo list=findId(getUiAutomation().getRootInActiveWindow(),"com.google.android.documentsui:id/sub_menu_list");
        if(list!=null){require(list.performAction(AccessibilityNodeInfo.ACTION_CLICK),"system file list enabled for explicit filename selection");SystemClock.sleep(300);}
    }
    private AccessibilityNodeInfo findId(AccessibilityNodeInfo n,String id){if(n==null)return null;if(n.isVisibleToUser()&&id.equals(n.getViewIdResourceName()))return n;for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo v=findId(n.getChild(i),id);if(v!=null)return v;}return null;}
    private AccessibilityNodeInfo findDescription(AccessibilityNodeInfo n,String text){if(n==null)return null;if(n.isVisibleToUser()&&n.getContentDescription()!=null&&text.equalsIgnoreCase(n.getContentDescription().toString()))return n;for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo v=findDescription(n.getChild(i),text);if(v!=null)return v;}return null;}
    private void tapText(String text)throws Exception {long end=SystemClock.uptimeMillis()+15000;while(SystemClock.uptimeMillis()<end){AccessibilityNodeInfo n=findText(getUiAutomation().getRootInActiveWindow(),text);while(n!=null&&!n.isClickable())n=n.getParent();if(n!=null&&n.performAction(AccessibilityNodeInfo.ACTION_CLICK))return;SystemClock.sleep(300);}throw new AssertionError("system control missing: "+text+"\n"+tree(getUiAutomation().getRootInActiveWindow(),0));}
    private AccessibilityNodeInfo findText(AccessibilityNodeInfo n,String text){if(n==null)return null;if(n.isVisibleToUser()&&n.getText()!=null&&text.equalsIgnoreCase(n.getText().toString()))return n;for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo v=findText(n.getChild(i),text);if(v!=null)return v;}return null;}
    private AccessibilityNodeInfo findClass(AccessibilityNodeInfo n,String cls){if(n==null)return null;if(n.isVisibleToUser()&&cls.contentEquals(n.getClassName()))return n;for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo v=findClass(n.getChild(i),cls);if(v!=null)return v;}return null;}
    private String tree(AccessibilityNodeInfo n,int d){if(n==null||d>18)return "";String s=" ".repeat(d)+n.getClassName()+" "+n.getViewIdResourceName()+" "+n.getText()+"\n";for(int i=0;i<n.getChildCount();i++)s+=tree(n.getChild(i),d+1);return s;}
    private void require(boolean condition,String message){if(!condition)throw new AssertionError(message);checks.put(message);}
    private JSONObject tapGeometry(String selector)throws Exception {
        // Only structural identifiers and geometry are recorded: never text,
        // input values, HTML, endpoint URLs, prompts or API credentials.
        return new JSONObject(js("(()=>{const e=document.querySelector("+JSONObject.quote(selector)+");if(!e)return{ready:false,missing:true};const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y),describe=n=>n?{tag:n.tagName,id:n.id||''}:null;return{x,y,left:r.left,top:r.top,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,scrollX,scrollY,ready:!!(r.width&&r.height&&!e.disabled&&getComputedStyle(e).visibility==='visible'&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&hit&&(hit===e||e.contains(hit))),target:describe(e),hit:describe(hit)};})()"));
    }
    private boolean sameTapGeometry(JSONObject first,JSONObject second)throws Exception {
        if(first==null||!first.optBoolean("ready")||!second.optBoolean("ready"))return false;
        for(String key:new String[]{"x","y","left","top","width","height","viewportWidth","viewportHeight","scrollX","scrollY"}){
            if(Math.abs(first.getDouble(key)-second.getDouble(key))>.25)return false;
        }
        return first.getJSONObject("hit").toString().equals(second.getJSONObject("hit").toString());
    }
    private void click(String selector)throws Exception {
        String q=JSONObject.quote(selector);
        JSONObject trace=new JSONObject();JSONArray samples=new JSONArray();
        trace.put("selector",selector);trace.put("stage",stage);trace.put("samples",samples);trace.put("result","aborted-before-touch");clickTraces.put(trace);
        try {
            js("document.querySelector("+q+").scrollIntoView({block:'center',inline:'center',behavior:'instant'});true");
            long deadline=SystemClock.uptimeMillis()+10000,stableSince=0;
            JSONObject previous=null;int stableSamples=0;
            while(SystemClock.uptimeMillis()<deadline){
                settleLayout();
                JSONObject current=tapGeometry(selector);
                if(samples.length()<30)samples.put(current);
                if(sameTapGeometry(previous,current))stableSamples++;else{stableSamples=0;stableSince=SystemClock.uptimeMillis();}
                previous=current;
                if(stableSamples<2||SystemClock.uptimeMillis()-stableSince<120)continue;
                // Fence the compositor again, then remeasure immediately before
                // arming the real pointer. A moved/covered target is never tapped.
                awaitVisualState();
                JSONObject finalGeometry=tapGeometry(selector);
                if(!sameTapGeometry(current,finalGeometry)){previous=finalGeometry;stableSamples=0;stableSince=SystemClock.uptimeMillis();continue;}
                js("(()=>{if(window.__mintTapCleanup)window.__mintTapCleanup();const intended=document.querySelector("+q+"),describe=n=>n?{tag:n.tagName,id:n.id||''}:null;window.__mintTapEvents=[];const observe=e=>{window.__mintTapEvents.push({type:e.type,target:describe(e.target),hit:describe(document.elementFromPoint(e.clientX,e.clientY)),x:e.clientX,y:e.clientY,intended:!!(e.target&&(e.target===intended||intended.contains(e.target)))});if(e.type==='pointerup')window.__mintTapCleanup();};window.__mintTapCleanup=()=>{document.removeEventListener('pointerdown',observe,true);document.removeEventListener('pointerup',observe,true);};document.addEventListener('pointerdown',observe,true);document.addEventListener('pointerup',observe,true);})()");
                JSONObject armedGeometry=tapGeometry(selector);
                if(!sameTapGeometry(finalGeometry,armedGeometry)){js("window.__mintTapCleanup();true");previous=armedGeometry;stableSamples=0;stableSince=SystemClock.uptimeMillis();continue;}
                int[] offset=new int[2],width=new int[1];runOnMainSync(()->{web.getLocationOnScreen(offset);width[0]=web.getWidth();});
                float scale=width[0]/(float)armedGeometry.getDouble("viewportWidth");
                float x=offset[0]+(float)armedGeometry.getDouble("x")*scale,y=offset[1]+(float)armedGeometry.getDouble("y")*scale;
                trace.put("finalGeometry",armedGeometry);trace.put("screenX",x);trace.put("screenY",y);trace.put("result","pointer-pending");
                long down=SystemClock.uptimeMillis();pointer(down,MotionEvent.ACTION_DOWN,x,y);pointer(down,MotionEvent.ACTION_UP,x,y);waitForIdleSync();
                // No RAF wait here: import/save may have opened DocumentsUI and
                // paused the WebView. Read the captured pointer events directly.
                until("window.__mintTapEvents&&window.__mintTapEvents.some(e=>e.type==='pointerup')",5000);
                JSONArray events=new JSONArray(js("window.__mintTapEvents||[]"));trace.put("pointerEvents",events);
                boolean correct=events.length()==2;
                for(int i=0;i<events.length();i++)correct&=events.getJSONObject(i).getBoolean("intended");
                trace.put("result",correct?"intended-target-touched":"wrong-pointer-target");
                if(!correct)throw new AssertionError("Real pointer did not hit intended control: "+selector+"; "+events);
                return;
            }
            throw new AssertionError("Control did not become stable and uncovered: "+selector+"; "+previous);
        } finally {
            write("portrait-large-click-trace.json",clickTraces.toString(2));
        }
    }
    private void until(String expression,long timeout)throws Exception {long end=SystemClock.uptimeMillis()+timeout;while(SystemClock.uptimeMillis()<end){if("true".equals(js("!!("+expression+")")))return;SystemClock.sleep(250);}throw new AssertionError("Timeout: "+expression+"; state="+js("JSON.stringify({toast:document.querySelector('#toast')?.textContent,busy:document.querySelector('#busy')?.hidden,nativeBusy:typeof Android!=='undefined'?Android.isExportBusy():null,ai:document.querySelector('#portraitStatus')?.textContent})"));}
    private String js(String code)throws Exception {CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();runOnMainSync(()->web.evaluateJavascript("try{"+code+"}catch(e){'__MINT_E2E_JS_ERROR__'+String(e)}",v->{value.set(v);latch.countDown();}));if(!latch.await(30,TimeUnit.SECONDS))throw new AssertionError("JS timeout");if(value.get()!=null&&value.get().contains("__MINT_E2E_JS_ERROR__"))throw new AssertionError(value.get());return value.get();}
    private void capture(String name)throws Exception {
        AccessibilityNodeInfo active=getUiAutomation().getRootInActiveWindow();
        if(active!=null&&getTargetContext().getPackageName().equals(String.valueOf(active.getPackageName()))){
            CountDownLatch drawn=new CountDownLatch(1);runOnMainSync(()->web.postVisualStateCallback(1,new WebView.VisualStateCallback(){@Override public void onComplete(long id){drawn.countDown();}}));
            if(!drawn.await(10,TimeUnit.SECONDS))throw new AssertionError("WebView visual state not ready for screenshot");
        } // DocumentsUI pauses WebView; capture the actual native window directly.

        try{getUiAutomation().waitForIdle(200,3000);}catch(java.util.concurrent.TimeoutException ignored){}
        Bitmap image=getUiAutomation().takeScreenshot();if(image==null)throw new AssertionError("Missing screenshot");try(FileOutputStream out=getTargetContext().openFileOutput("portrait-large-"+name+".png",0)){image.compress(Bitmap.CompressFormat.PNG,100,out);}image.recycle();}
    private void write(String name,String text)throws Exception {try(FileOutputStream out=getTargetContext().openFileOutput(name,0)){out.write(text.getBytes(StandardCharsets.UTF_8));}}
    private WebView findWeb(View v){if(v instanceof WebView)return(WebView)v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){WebView w=findWeb(g.getChildAt(i));if(w!=null)return w;}}return null;}
}
