package com.qingyan.editor;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
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

/** Real Android/WebView/HTTPS/SAF workflow with a synthetic, explicitly non-AI server. */
public final class AiFlowInstrumentation extends Instrumentation {
    private Activity activity;
    private WebView web;
    private final JSONArray checks = new JSONArray();
    private String stage="launch";
    private final JSONObject timings=new JSONObject();
    private final JSONArray clickTraces=new JSONArray();
    private long visualRequestId;
    private long requestStarted;
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    @Override public void onStart() {
        Bundle result=new Bundle();
        try {
            String pkg=getTargetContext().getPackageName();
            require(pkg.endsWith(".e2e"),"disposable app ID enforced");
            activity=startActivitySync(new Intent(Intent.ACTION_MAIN).setComponent(new ComponentName(pkg,"com.qingyan.editor.MainActivity")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            runOnMainSync(()->web=findWeb(activity.getWindow().getDecorView()));
            until("document.readyState==='complete'&&document.querySelector('#portraitDemoBtn')&&typeof document.querySelector('#portraitDemoBtn').onclick==='function'&&typeof Android.editImage==='function'&&!Android.isExportBusy()",90000);
            AtomicReference<Boolean> blocked=new AtomicReference<>();runOnMainSync(()->blocked.set(web.getSettings().getBlockNetworkLoads()));require(blocked.get(),"WebView network stays blocked");
            require("true".equals(js("Android.samplePng('../index.html')===''&&Android.samplePng('missing')===''")),"sample bridge rejects filenames and unknown IDs");
            verifyHomeActions();
            click("#importBtn");waitPicker();chooseDownloads();tapText("mint-e2e-source.png");until("document.querySelector('#imageInfo').textContent.includes('512 × 512')&&document.querySelector('#busy').hidden&&!Android.isExportBusy()",30000);
            capture("photo-imported");verifyEditorLayout();measureAdjustments();capture("adjustments-neutral");verifyHomeAiEntry();js("window.__beforeAi=document.querySelector('#previewCanvas').toDataURL();true");
            js("(()=>{const t=MintAiTransport;window.MintAiTransport={receive:t.receive,send:(data,signal)=>{window.__sentImage=data.image;window.__sentMask=data.mask;return t.send(data,signal);}};})()");
            writePng("ai-e2e-before-erase.png","window.__beforeAi");
            stage="erase";openAi("erase","/v1/images/edits");paint();capture("erase-selected");send();
            until("!document.querySelector('#aiAccept').hidden",45000);require("true".equals(js("document.querySelector('#aiKey').value===''")),"key cleared after erase");capture("erase-result");
            checkPixels(false);accept();saveAndReopen("erase",512,512);
            stage="http-error";openAi("erase","/unauthorized");paint();send();until("document.querySelector('#aiStatus').textContent.includes('401')",30000);
            require("true".equals(js("document.querySelector('#aiAccept').hidden&&!MintAiUI.isBusy()&&document.querySelector('#aiKey').value===''")),"401 is recoverable, no accepted result or retained key");click("#aiClose");
            stage="ratio-error";openAi("erase","/wrong-ratio");paint();send();until("document.querySelector('#aiStatus').textContent.includes('宽高比')",30000);
            require("true".equals(js("document.querySelector('#aiAccept').hidden&&!MintAiUI.isBusy()")),"wrong ratio rejected without replacing project");capture("ratio-rejected");click("#aiClose");
            stage="cancel";openAi("erase","/slow");paint();send();until("MintAiUI.isBusy()",10000);click("#aiClose");until("!MintAiUI.isBusy()&&!document.querySelector('#aiDialog').open",30000);
            require("true".equals(js("document.querySelector('#aiKey').value===''&&document.querySelector('#aiAccept').hidden")),"cancel clears key and stale result");
            stage="outpaint";js("window.__beforeAi=document.querySelector('#previewCanvas').toDataURL();true");openAi("outpaint","/v1/images/edits");capture("outpaint-config");send();until("!document.querySelector('#aiAccept').hidden",45000);checkPixels(true);capture("outpaint-result");accept();saveAndReopen("outpaint",716,716);
            stage="public-example";click("#homeBack");click("#portraitDemoBtn");until("document.querySelector('#imageInfo').textContent.includes('512 × 512')&&document.querySelector('#busy').hidden",30000);require(true,"bundled public photo example opens in Android");capture("public-example");
            JSONObject report=new JSONObject();report.put("result","PASS");report.put("androidApi",android.os.Build.VERSION.SDK_INT);report.put("abi",android.os.Build.SUPPORTED_ABIS[0]);report.put("checks",checks);report.put("previewContextAttributes",new JSONObject(js("document.querySelector('#previewCanvas').getContext('2d').getContextAttributes()")));report.put("timingsMsIncludingAutomationPolling",timings);report.put("mockService",true);report.put("realAiModel",false);report.put("physicalDevice",false);report.put("systemDocumentPicker",true);report.put("savedFilesReopened",true);
            write("ai-e2e-result.json",report.toString(2));result.putString("result","PASS Android AI mock workflow, "+checks.length()+" checks; real HTTPS/SAF, no real AI model");finish(0,result);
        } catch(Throwable e) {
            result.putString("result","FAIL "+stage+": "+e);result.putString("stack",android.util.Log.getStackTraceString(e));
            try {JSONObject partial=new JSONObject();partial.put("result","FAIL");partial.put("stage",stage);partial.put("checks",checks);partial.put("timingsMsIncludingAutomationPolling",timings);write("ai-e2e-partial.json",partial.toString(2));write("ai-e2e-failure.txt",result.toString()+"\n"+tree(getUiAutomation().getRootInActiveWindow(),0)+"\nDOM: "+js("document.body.innerText.slice(-9000)"));capture("FAIL-"+stage);}catch(Exception ignored){}
            finish(1,result);
        }
    }
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
    private void assertEditorFits(String label)throws Exception {
        settleLayout();
        JSONObject layout=new JSONObject(js("(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.left,y:r.top,right:r.right,bottom:r.bottom,w:r.width,h:r.height};};return{viewport:{w:innerWidth,h:innerHeight},scrollWidth:document.documentElement.scrollWidth,stage:rect('#stage'),photo:rect('#previewCanvas'),panel:rect('#toolPanel'),category:rect('.category-tabs'),tools:rect('.tool-tabs')};})()"));
        write("ai-e2e-layout-"+label+".json",layout.toString(2));
        JSONObject viewport=layout.getJSONObject("viewport"),stageRect=layout.getJSONObject("stage"),photo=layout.getJSONObject("photo"),panel=layout.getJSONObject("panel"),category=layout.getJSONObject("category"),tools=layout.getJSONObject("tools");
        double width=viewport.getDouble("w"),height=viewport.getDouble("h");
        require(layout.getDouble("scrollWidth")<=width+1,label+": no horizontal page overflow");
        for(String key:new String[]{"stage","panel","category","tools"}){
            JSONObject r=layout.getJSONObject(key);
            require(r.getDouble("w")>0&&r.getDouble("h")>=39.5&&r.getDouble("x")>=-1&&r.getDouble("right")<=width+1&&r.getDouble("y")>=-1&&r.getDouble("bottom")<=height+1,label+": "+key+" is visible inside the real WebView viewport; "+r);
        }
        require(photo.getDouble("w")>=128&&photo.getDouble("h")>=128,label+": fitted photo remains useful, at least 128 CSS px per side");
        require(photo.getDouble("x")>=stageRect.getDouble("x")-1&&photo.getDouble("right")<=stageRect.getDouble("right")+1&&photo.getDouble("y")>=stageRect.getDouble("y")-1&&photo.getDouble("bottom")<=stageRect.getDouble("bottom")+1,label+": fitted photo is not clipped by the stage");
        require(category.getDouble("y")>=panel.getDouble("bottom")-1&&category.getDouble("y")>=tools.getDouble("bottom")-1,label+": categories stay below tools and parameters");
    }
    private void assertTouchTargets(String selectors)throws Exception {
        JSONArray targets=new JSONArray(js("Array.from(document.querySelectorAll("+JSONObject.quote(selectors)+"),e=>{const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{id:e.id||e.dataset.category||e.dataset.adjustParam||e.tagName,w:r.width,h:r.height,x:r.left,y:r.top,right:r.right,bottom:r.bottom,inViewport:r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,uncovered:!!hit&&(hit===e||e.contains(hit))};})"));
        require(targets.length()>0,"touch targets exist: "+selectors);
        for(int i=0;i<targets.length();i++){
            JSONObject t=targets.getJSONObject(i);
            require(t.getDouble("w")>=39.5&&t.getDouble("h")>=39.5&&t.getBoolean("inViewport")&&t.getBoolean("uncovered"),"40 CSS px reachable touch target: "+t);
        }
    }
    private void reachTarget(String selector)throws Exception {
        js("document.querySelector("+JSONObject.quote(selector)+").scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});true");
        settleLayout();assertTouchTargets(selector);
    }
    private void verifyHomeActions()throws Exception {
        stage="home-surface";
        require("true".equals(js("document.body.classList.contains('is-home')&&document.documentElement.scrollWidth<=innerWidth+1&&!document.querySelector('#aiDialog').open")),"empty home is visible without overflow or an image-less AI sheet");
        for(String selector:new String[]{"#importBtn","#homeLibrary","[data-start-tool=portrait]","#homeAiBtn","[data-start-tool=collage]"})reachTarget(selector);
        reachTarget("#importBtn");
        // DOM/style evidence only. Positive geometry does not prove that WebView
        // actually painted an icon; inspect the following PNG independently.
        JSONObject icons=new JSONObject(js("(()=>{"
                +"const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};"
                +"const inspect=n=>{if(!n)return null;const s=getComputedStyle(n);let bbox;try{const b=n.getBBox();bbox={x:b.x,y:b.y,width:b.width,height:b.height};}catch(e){bbox={error:e.name};}return{mounted:n.isConnected,namespaceURI:n.namespaceURI,rect:rect(n),bbox,stroke:s.stroke,color:s.color,fill:s.fill,opacity:s.opacity,strokeOpacity:s.strokeOpacity,visibility:s.visibility,display:s.display};};"
                +"const entries=['#importBtn','#homeLibrary','[data-start-tool=portrait]','#homeAiBtn','[data-start-tool=collage]'].map(selector=>{const entry=document.querySelector(selector),svg=entry&&entry.querySelector('[data-icon] svg'),paths=svg?Array.from(svg.querySelectorAll('path')):[];return{selector,mounted:!!(entry&&entry.isConnected),iconName:svg&&svg.closest('[data-icon]').dataset.icon,svg:inspect(svg),pathCount:paths.length,paths:paths.map(inspect)};});"
                +"return{evidence:'DOM geometry and computed styles only; actual painted visibility requires PNG inspection',innerWidth,innerHeight,devicePixelRatio,scrollX,scrollY,entries};})()"));
        int[] screenOffset=new int[2],webSize=new int[2];
        runOnMainSync(()->{web.getLocationOnScreen(screenOffset);webSize[0]=web.getWidth();webSize[1]=web.getHeight();});
        JSONObject nativeViewport=new JSONObject();nativeViewport.put("screenX",screenOffset[0]);nativeViewport.put("screenY",screenOffset[1]);nativeViewport.put("width",webSize[0]);nativeViewport.put("height",webSize[1]);nativeViewport.put("widthPerCssPixel",webSize[0]/icons.getDouble("innerWidth"));icons.put("webView",nativeViewport);
        write("ai-e2e-home-icons.json",icons.toString(2));
        JSONArray entries=icons.getJSONArray("entries");
        for(int i=0;i<entries.length();i++){
            JSONObject entry=entries.getJSONObject(i);String name=entry.getString("selector");
            require(entry.getBoolean("mounted")&&!entry.isNull("svg")&&entry.getInt("pathCount")>0,name+": SVG and path are mounted (not a painted-visibility assertion)");
            JSONObject svg=entry.getJSONObject("svg"),bounds=svg.getJSONObject("rect");
            require(svg.getBoolean("mounted")&&bounds.getDouble("width")>0&&bounds.getDouble("height")>0,name+": SVG has nonzero layout dimensions");
            JSONArray paths=entry.getJSONArray("paths");
            for(int j=0;j<paths.length();j++){
                JSONObject path=paths.getJSONObject(j),pathBounds=path.getJSONObject("rect");
                require(path.getBoolean("mounted")&&pathBounds.getDouble("width")>0&&pathBounds.getDouble("height")>0,name+": path "+j+" has nonzero geometry");
            }
        }
        capture("home-actions");
        verifyHomeIconPixels(icons);
        click("#homeLibrary");until("document.querySelector('#projectLibraryDialog').open",10000);
        require(true,"home library card opens the existing project library with real touch");
        click("#projectLibraryClose");until("!document.querySelector('#projectLibraryDialog').open",10000);
    }
    private void verifyHomeIconPixels(JSONObject icons)throws Exception {
        String png="ai-e2e-home-actions.png";Bitmap screenshot;
        // Read the exact evidence image above; do not capture a later frame.
        try(java.io.InputStream input=getTargetContext().openFileInput(png)){screenshot=BitmapFactory.decodeStream(input);}
        if(screenshot==null)throw new AssertionError("Cannot decode the captured home PNG");
        JSONObject report=new JSONObject();JSONArray samples=new JSONArray();
        report.put("sourcePng",png);report.put("width",screenshot.getWidth());report.put("height",screenshot.getHeight());
        report.put("centerFraction",.75);report.put("darkPixelRule","(red + green + blue) / 3 < 130");report.put("minimumDarkPixels",8);report.put("entries",samples);
        JSONObject webViewport=icons.getJSONObject("webView");double scale=webViewport.getDouble("widthPerCssPixel"),offsetX=webViewport.getDouble("screenX"),offsetY=webViewport.getDouble("screenY");
        try {
            JSONArray entries=icons.getJSONArray("entries");
            for(int i=0;i<entries.length();i++){
                JSONObject entry=entries.getJSONObject(i),rect=entry.getJSONObject("svg").getJSONObject("rect");
                int left=(int)Math.floor(offsetX+(rect.getDouble("x")+rect.getDouble("width")*.125)*scale),top=(int)Math.floor(offsetY+(rect.getDouble("y")+rect.getDouble("height")*.125)*scale);
                int right=(int)Math.ceil(offsetX+(rect.getDouble("x")+rect.getDouble("width")*.875)*scale),bottom=(int)Math.ceil(offsetY+(rect.getDouble("y")+rect.getDouble("height")*.875)*scale);
                boolean within=left>=0&&top>=0&&right<=screenshot.getWidth()&&bottom<=screenshot.getHeight();
                int x=Math.max(0,left),y=Math.max(0,top),w=Math.max(0,Math.min(right,screenshot.getWidth())-x),h=Math.max(0,Math.min(bottom,screenshot.getHeight())-y),dark=0;
                if(w>0&&h>0){int[] pixels=new int[w*h];screenshot.getPixels(pixels,0,w,x,y,w,h);for(int pixel:pixels){int red=(pixel>>16)&255,green=(pixel>>8)&255,blue=pixel&255;if(red+green+blue<390)dark++;}}
                JSONObject sample=new JSONObject(),region=new JSONObject();region.put("left",left);region.put("top",top);region.put("right",right);region.put("bottom",bottom);
                sample.put("selector",entry.getString("selector"));sample.put("svgCssRect",rect);sample.put("mappedCenterRegion",region);sample.put("fullyInsideScreenshot",within);sample.put("sampledPixels",w*h);sample.put("darkPixels",dark);samples.put(sample);
            }
        } finally {screenshot.recycle();write("ai-e2e-home-icon-pixels.json",report.toString(2));}
        // Keep every count and the original PNG even when the first icon fails.
        for(int i=0;i<samples.length();i++){
            JSONObject sample=samples.getJSONObject(i);
            require(sample.getBoolean("fullyInsideScreenshot")&&sample.getInt("sampledPixels")>0&&sample.getInt("darkPixels")>=8,sample.getString("selector")+": actual home PNG contains at least 8 dark pixels in the icon's central 75%; observed "+sample.getInt("darkPixels"));
        }
    }
    private void verifyHomeAiEntry()throws Exception {
        stage="home-ai-entry";click("#homeBack");
        until("document.body.classList.contains('is-home')",10000);click("#homeAiBtn");
        until("document.querySelector('#aiDialog').open&&!document.querySelector('#aiSend').disabled",10000);
        require("true".equals(js("document.querySelector('#aiServiceDetails').open")),"AI service settings start expanded from the home entry");
        assertSheetFits("#aiDialog","home-ai");capture("home-ai-opened");
        click("#aiClose");until("!document.querySelector('#aiDialog').open",10000);
        if("true".equals(js("document.body.classList.contains('is-home')")))click("#resumeBtn");
        until("document.body.classList.contains('is-editing')",10000);settleLayout();
        require("true".equals(js("document.querySelector('#applyBar').hidden&&document.querySelector('#previewCanvas').toDataURL()===window.__layoutPixels")),"home AI entry and dismissal preserve the neutral photo without adding a preview");
    }
    private void assertSheetFits(String selector,String label)throws Exception {
        settleLayout();
        JSONObject sheet=new JSONObject(js("(()=>{const e=document.querySelector("+JSONObject.quote(selector)+"),r=e.getBoundingClientRect(),controls=Array.from(e.querySelectorAll('button,input,select,textarea')).map(n=>{const b=n.getBoundingClientRect();return{id:n.id||n.tagName,x:b.left,right:b.right,w:b.width,h:b.height};}).filter(b=>b.w&&b.h);return{open:e.open,x:r.left,y:r.top,right:r.right,bottom:r.bottom,w:r.width,h:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop,overflowY:getComputedStyle(e).overflowY,wideControls:controls.filter(b=>b.x<r.left-1||b.right>r.right+1)};})()"));
        write("ai-e2e-sheet-"+label+".json",sheet.toString(2));
        require(sheet.getBoolean("open")&&sheet.getDouble("x")>=-1&&sheet.getDouble("y")>=-1&&sheet.getDouble("right")<=sheet.getDouble("viewportWidth")+1&&sheet.getDouble("bottom")<=sheet.getDouble("viewportHeight")+1,label+": open sheet fits the real WebView viewport");
        require(sheet.getDouble("scrollWidth")<=sheet.getDouble("clientWidth")+1&&sheet.getJSONArray("wideControls").length()==0,label+": sheet and visible controls have no horizontal overflow");
        if(sheet.getDouble("scrollHeight")>sheet.getDouble("clientHeight")+1)require("auto".equals(sheet.getString("overflowY"))||"scroll".equals(sheet.getString("overflowY")),label+": long sheet permits vertical user scrolling");
    }
    private void swipeSheetToAction(String sheetSelector,String actionSelector,String label)throws Exception {
        for(int swipe=0;swipe<=12;swipe++){
            settleLayout();
            JSONObject position=new JSONObject(js("(()=>{const s=document.querySelector("+JSONObject.quote(sheetSelector)+"),a=document.querySelector("+JSONObject.quote(actionSelector)+"),r=s.getBoundingClientRect(),t=a.getBoundingClientRect(),hit=document.elementFromPoint(t.left+t.width/2,t.top+t.height/2);return{visible:t.width>0&&t.height>0&&t.top>=Math.max(0,r.top)&&t.bottom<=Math.min(innerHeight,r.bottom)&&!!hit&&(hit===a||a.contains(hit)),x:r.right-14,top:Math.max(r.top,0)+60,bottom:Math.min(r.bottom,innerHeight)-60,viewportWidth:innerWidth,scrollTop:s.scrollTop};})()"));
            if(position.getBoolean("visible")){
                assertTouchTargets(actionSelector);assertSheetFits(sheetSelector,label);
                require(true,label+": action reached after "+swipe+" real touch scroll gestures");return;
            }
            if(swipe==12)throw new AssertionError("Sheet action not reachable by touch scrolling: "+actionSelector+"; "+position);
            double from=position.getDouble("bottom"),to=position.getDouble("top");
            require(from-to>=80,label+": sheet has a usable vertical swipe area");
            int[] offset=new int[2],width=new int[1];runOnMainSync(()->{web.getLocationOnScreen(offset);width[0]=web.getWidth();});
            float scale=width[0]/(float)position.getDouble("viewportWidth"),x=offset[0]+(float)position.getDouble("x")*scale,start=offset[1]+(float)from*scale,end=offset[1]+(float)to*scale;
            long down=SystemClock.uptimeMillis();pointer(down,MotionEvent.ACTION_DOWN,x,start);
            for(int step=1;step<=12;step++){SystemClock.sleep(20);pointer(down,MotionEvent.ACTION_MOVE,x,start+(end-start)*step/12);}
            pointer(down,MotionEvent.ACTION_UP,x,end);SystemClock.sleep(250);
        }
    }
    private void verifyAiSheet(String mode)throws Exception {
        require("true".equals(js("document.querySelector('#aiServiceDetails').open")),mode+": service details are initially open");
        assertSheetFits("#aiDialog","ai-"+mode+"-top");
        for(String selector:new String[]{"#aiClose","#aiServiceDetails > summary","#aiEndpoint","#aiModel","#aiKey","#aiMode","#aiPrompt","#aiConsentRow"})reachTarget(selector);
        if("erase".equals(mode)){reachTarget("#aiBrush");reachTarget("#aiUndo");reachTarget("#aiClear");}
        else for(String edge:new String[]{"left","right","top","bottom"})reachTarget("#aiPad-"+edge);
        // Return to the top so the send reachability check must use real scroll
        // gestures on a long sheet, rather than a previous scripted scroll.
        js("document.querySelector('#aiDialog').scrollTop=0;true");settleLayout();
    }
    private void verifyEditorLayout()throws Exception {
        stage="editor-layout";
        assertEditorFits("collapsed");
        assertTouchTargets("#homeBack,#headerMenu summary,#exportBtn,#undoBtn,#redoBtn,#compareBtn,#viewToggle,[data-category]");
        require("true".equals(js("document.querySelector('#viewToggle').getAttribute('aria-expanded')==='false'&&document.querySelector('.view-controls').getBoundingClientRect().height===0")),"zoom controls start collapsed with accessible state");
        js("window.__layoutPixels=document.querySelector('#previewCanvas').toDataURL();true");
        click("#viewToggle");settleLayout();
        require("true".equals(js("document.querySelector('#viewToggle').getAttribute('aria-expanded')==='true'&&document.querySelector('.view-controls').getBoundingClientRect().height>0")),"real touch expands zoom controls");
        assertTouchTargets("#viewFit,#viewPan,#viewZoom");
        click("#viewToggle");assertEditorFits("recollapsed");
        require("true".equals(js("document.querySelector('#viewToggle').getAttribute('aria-expanded')==='false'&&document.querySelector('.view-controls').getBoundingClientRect().height===0&&document.querySelector('#previewCanvas').toDataURL()===window.__layoutPixels")),"zoom controls close without changing photo pixels");
        capture("editor-layout");
    }
    private void verifyParameterRetention()throws Exception {
        stage="parameter-layout";
        until("!!document.querySelector('[data-adjust-param=brightness]')",10000);
        selectParameter("brightness");
        require("true".equals(js("Array.from(document.querySelectorAll('#toolPanel input[type=range]')).filter(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0).length===1")),"adjustment panel displays one parameter slider at a time");
        js("document.querySelector('#brightness').value='17';document.querySelector('#brightness').dispatchEvent(new Event('input',{bubbles:true}));true");settleLayout();
        assertTouchTargets("#brightness,#applyBtn,#cancelBtn");
        selectParameter("contrast");
        js("document.querySelector('#contrast').value='-11';document.querySelector('#contrast').dispatchEvent(new Event('input',{bubbles:true}));true");settleLayout();
        js("window.__parameterPixels=document.querySelector('#previewCanvas').toDataURL();true");
        selectParameter("brightness");
        require("true".equals(js("document.querySelector('#brightness').value==='17'&&document.querySelector('#contrast').value==='-11'&&document.querySelector('#brightnessValue').textContent==='17'&&!document.querySelector('#confirmDialog').open&&document.querySelector('#previewCanvas').toDataURL()===window.__parameterPixels")),"switching parameters preserves both values and rendered preview without tool-switch confirmation");
        assertEditorFits("parameter-preview");capture("parameter-retained");
        js("document.querySelector('#brightness').value='0';document.querySelector('#brightness').dispatchEvent(new Event('input',{bubbles:true}));true");settleLayout();
        selectParameter("contrast");
        js("document.querySelector('#contrast').value='0';document.querySelector('#contrast').dispatchEvent(new Event('input',{bubbles:true}));true");settleLayout();
        selectParameter("brightness");
        assertNeutralAdjustments("after-retention");
    }
    private void selectParameter(String parameter)throws Exception {
        String selector="[data-adjust-param="+parameter+"]";
        click(selector);
        until("document.querySelector("+JSONObject.quote(selector)+").getAttribute('aria-pressed')==='true'&&document.querySelector('#"+parameter+"').getBoundingClientRect().height>0",10000);
        settleLayout();
    }
    private void assertNeutralAdjustments(String label)throws Exception {
        settleLayout();
        JSONObject neutral=new JSONObject(js("(()=>{const keys=['brightness','contrast','saturation','warmth'];return{values:Object.fromEntries(keys.map(k=>[k,Number(document.querySelector('#'+k).value)])),applyBarHidden:document.querySelector('#applyBar').hidden,brightnessSelected:document.querySelector('[data-adjust-param=brightness]').getAttribute('aria-pressed')==='true',matchesImportedPixels:document.querySelector('#previewCanvas').toDataURL()===window.__layoutPixels};})()"));
        write("ai-e2e-adjustments-neutral-"+label+".json",neutral.toString(2));
        JSONObject values=neutral.getJSONObject("values");
        for(String key:new String[]{"brightness","contrast","saturation","warmth"})require(values.getInt(key)==0,label+": "+key+" is explicitly neutral");
        require(neutral.getBoolean("brightnessSelected"),label+": brightness is the selected visible parameter");
        require(neutral.getBoolean("applyBarHidden"),label+": no unapplied adjustment remains");
        require(neutral.getBoolean("matchesImportedPixels"),label+": neutral preview exactly equals the initially imported pixels");
    }
    private void measureAdjustments()throws Exception {
        click("[data-tool=adjust]");
        verifyParameterRetention();
        js("window.__adjustDone=false;window.__adjustSamples=[];(async()=>{let s=document.querySelector('#brightness');for(let i=0;i<12;i++){let t=performance.now();s.value=String(i%2?8:-8);s.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.__adjustSamples.push(performance.now()-t);}s.value='0';s.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.__adjustDone=true;})()");
        until("window.__adjustDone",30000);
        timings.put("brightness12InputToTwoAnimationFrames",new JSONArray(js("window.__adjustSamples")));
        assertNeutralAdjustments("after-measurement");
        require(true,"actual Android brightness inputs rendered; returned to neutral before AI capture");
    }
    private void openAi(String mode,String path)throws Exception {
        until("document.querySelector('#busy').hidden&&!Android.isExportBusy()&&!MintAiUI.isBusy()",30000);
        if("true".equals(js("!document.querySelector('#headerMenu').open")))click("#headerMenu summary");click("#aiBtn");until("document.querySelector('#aiDialog').open&&!document.querySelector('#aiSend').disabled",20000);
        js("document.querySelector('#aiEndpoint').value='https://10.0.2.2:9443"+path+"';document.querySelector('#aiModel').value='mock-png-v1';document.querySelector('#aiKey').value='mint-e2e-not-secret';let m=document.querySelector('#aiMode');m.value='"+mode+"';m.dispatchEvent(new Event('change'));true");
        if("/v1/images/edits".equals(path))verifyAiSheet(mode);
    }
    private void send()throws Exception {
        if(!"true".equals(js("document.querySelector('#aiConsent').checked")))click("#aiConsentRow");
        require("true".equals(js("document.querySelector('#aiConsent').checked")),"upload consent is selected by real touch");
        js("document.querySelector('#aiDialog').scrollTop=0;true");
        swipeSheetToAction("#aiDialog","#aiSend","ai-"+stage+"-send");capture(stage+"-send-reachable");
        requestStarted=SystemClock.uptimeMillis();click("#aiSend");
    }
    private void paint()throws Exception {
        js("document.querySelector('#aiCanvas').scrollIntoView({block:'center'});true");SystemClock.sleep(300);
        JSONArray r=new JSONArray(js("(()=>{let r=document.querySelector('#aiCanvas').getBoundingClientRect();return[r.left,r.top,r.width,r.height,innerWidth,innerHeight]})()"));
        require(r.getDouble(0)>=0&&r.getDouble(0)+r.getDouble(2)<=r.getDouble(4)+1,"AI canvas fits Android viewport horizontally");
        require(r.getDouble(1)+r.getDouble(3)*.45<r.getDouble(5),"erase stroke stays inside Android viewport");
        int[] offset=new int[2];runOnMainSync(()->web.getLocationOnScreen(offset));float scale=web.getWidth()/(float)r.getDouble(4);
        float x=offset[0]+(float)(r.getDouble(0)+r.getDouble(2)*.85)*scale,y=offset[1]+(float)(r.getDouble(1)+r.getDouble(3)*.3)*scale,dy=(float)r.getDouble(3)*.15f*scale;
        long down=SystemClock.uptimeMillis();pointer(down,MotionEvent.ACTION_DOWN,x,y);for(int i=1;i<=8;i++)pointer(down,MotionEvent.ACTION_MOVE,x,y+dy*i/8);pointer(down,MotionEvent.ACTION_UP,x,y+dy);
        until("document.querySelector('#aiStatus').textContent.includes('1 笔')",10000);
    }
    private void pointer(long down,int action,float x,float y){MotionEvent e=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,x,y,0);e.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);sendPointerSync(e);e.recycle();}
    private void checkPixels(boolean expanded)throws Exception {
        timings.put(expanded?"outpaintRequestToPreview":"eraseRequestToPreview",SystemClock.uptimeMillis()-requestStarted);
        String script="(async()=>{const load=async src=>{let i=new Image();i.src=src;await i.decode();let c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;c.getContext('2d',{willReadFrequently:true}).drawImage(i,0,0);return c;};let a=await load(window.__sentImage),m=await load(window.__sentMask),c=await load(document.querySelector('#aiResult').src),v=await load(window.__beforeAi),p=a.getContext('2d').getImageData(0,0,a.width,a.height).data,mask=m.getContext('2d').getImageData(0,0,m.width,m.height).data,d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,before=v.getContext('2d').getImageData(0,0,v.width,v.height).data;let same=true,n=0,protectedPixels=0,mismatchPixels=0,previewChangedPixels=0,previewMaxDelta=0;for(let i=0;i<p.length;i+=4){let diff=false;for(let k=0;k<4;k++)if(d[i+k]!==p[i+k])diff=true;if(mask[i+3]===255){protectedPixels++;if(diff){same=false;mismatchPixels++;}}else if(diff)n++;}for(let y=0;y<v.height;y++)for(let x=0;x<v.width;x++){let i=(y*v.width+x)*4,j=((y+"+(expanded?102:0)+")*a.width+x+"+(expanded?102:0)+")*4,diff=false;for(let k=0;k<4;k++){let delta=Math.abs(p[j+k]-before[i+k]);if(delta)diff=true;previewMaxDelta=Math.max(previewMaxDelta,delta);}if(diff)previewChangedPixels++;}window.__pixelCheck={same,changed:n,w:c.width,h:c.height,protectedPixels,mismatchPixels,previewChangedPixels,previewMaxDelta};window.__resultPng=c.toDataURL();})()";
        js(script);until("!!window.__pixelCheck",10000);JSONObject p=new JSONObject(js("window.__pixelCheck"));
        write("ai-e2e-"+(expanded?"outpaint":"erase")+"-pixels.json",p.toString(2));writePng("ai-e2e-"+(expanded?"outpaint":"erase")+"-preview.png","window.__resultPng");
        require(p.getBoolean("same"),"every protected "+(expanded?"outpaint":"erase")+" pixel equals the actual sent PNG; "+p.toString());require(p.getInt("changed")>0,"mock output changes selected pixels");require(p.getInt("w")== (expanded?716:512),"result dimensions correct");js("delete window.__pixelCheck;true");
    }
    private void writePng(String name,String expression)throws Exception {String data=new JSONArray(js("["+expression+"]")).getString(0);if(!data.startsWith("data:image/png;base64,"))throw new AssertionError("PNG evidence missing");try(FileOutputStream out=getTargetContext().openFileOutput(name,0)){out.write(android.util.Base64.decode(data.substring(22),android.util.Base64.DEFAULT));}}

    private void accept()throws Exception {
        js("window.__acceptedPng=document.querySelector('#aiResult').src;true");
        reachTarget("#aiAccept");click("#aiAccept");
        for(int i=0;i<30;i++){if("true".equals(js("!!document.querySelector('#confirmDialog')?.open")))click("#confirmYes");if("true".equals(js("!document.querySelector('#aiDialog').open&&document.querySelector('#busy').hidden")))break;SystemClock.sleep(300);}
        until("!document.querySelector('#aiDialog').open&&document.querySelector('#busy').hidden",20000);
    }
    private void saveAndReopen(String mode,int w,int h)throws Exception {
        stage=mode+"-save";long saveStart=SystemClock.uptimeMillis();js("window.__savedPreview=document.querySelector('#previewCanvas').toDataURL();true");click("#exportBtn");until("document.querySelector('#exportDialog').open",10000);
        assertSheetFits("#exportDialog",mode+"-save-top");
        for(String selector:new String[]{"[data-close=exportDialog]","[data-format='image/jpeg']","[data-format='image/png']","#exportResolution","#exportSize"})reachTarget(selector);
        click("[data-format='image/jpeg']");reachTarget("#quality");click("[data-format='image/png']");
        js("document.querySelector('#exportDialog').scrollTop=0;true");
        swipeSheetToAction("#exportDialog","#saveBtn",mode+"-save-action");capture(mode+"-save-reachable");click("#saveBtn");
        waitPicker();chooseDownloads();capture(mode+"-save-picker");AccessibilityNodeInfo edit=findClass(getUiAutomation().getRootInActiveWindow(),"android.widget.EditText");require(edit!=null,"system filename input exists");Bundle text=new Bundle();text.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,"mint-e2e-"+mode+".png");require(edit.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,text),"system filename set");tapText("Save");
        until("!Android.isExportBusy()&&document.querySelector('#toast').textContent.includes('已保存')",30000);timings.put(mode+"SaveWithSystemPicker",SystemClock.uptimeMillis()-saveStart);require(true,"native PNG write completed");capture(mode+"-saved");
        stage=mode+"-reopen";long reopenStart=SystemClock.uptimeMillis();js("window.__previousSourceRevision=document.querySelector('#imageInfo').dataset.sourceRevision;window.__fileChosen=false;document.querySelector('#fileInput').addEventListener('change',()=>{window.__fileChosen=true;},{once:true});true");if("true".equals(js("!document.querySelector('#headerMenu').open")))click("#headerMenu summary");click("#openTop");waitPicker();chooseDownloads();tapText("mint-e2e-"+mode+".png");until("window.__fileChosen",20000);
        for(int i=0;i<40;i++){if("true".equals(js("!!document.querySelector('#confirmDialog')?.open")))click("#confirmYes");if("true".equals(js("document.querySelector('#imageInfo').textContent.includes('"+w+" × "+h+"')&&!Android.isExportBusy()")))break;SystemClock.sleep(300);}
        until("window.__fileChosen&&document.querySelector('#busy').hidden&&!Android.isExportBusy()&&document.querySelector('#imageInfo').dataset.sourceRevision!==window.__previousSourceRevision&&document.querySelector('#imageInfo').textContent.includes('"+w+" × "+h+"')&&document.querySelector('#previewCanvas').toDataURL()===window.__savedPreview",30000);timings.put(mode+"ReopenWithSystemPicker",SystemClock.uptimeMillis()-reopenStart);require(true,"saved "+mode+" PNG reopened with identical rendered pixels and dimensions");capture(mode+"-reopened");
    }
    private void waitPicker()throws Exception {long end=SystemClock.uptimeMillis()+20000;while(SystemClock.uptimeMillis()<end){AccessibilityNodeInfo n=getUiAutomation().getRootInActiveWindow();if(n!=null&&String.valueOf(n.getPackageName()).contains("documentsui"))return;SystemClock.sleep(300);}throw new AssertionError("system DocumentsUI not visible; state="+js("JSON.stringify({toast:document.querySelector('#toast')?.textContent,busy:document.querySelector('#busy')?.hidden,nativeBusy:Android.isExportBusy()})"));}
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
            write("ai-e2e-click-trace.json",clickTraces.toString(2));
        }
    }
    private void until(String expression,long timeout)throws Exception {long end=SystemClock.uptimeMillis()+timeout;while(SystemClock.uptimeMillis()<end){if("true".equals(js("!!("+expression+")")))return;SystemClock.sleep(250);}throw new AssertionError("Timeout: "+expression+"; state="+js("JSON.stringify({toast:document.querySelector('#toast')?.textContent,busy:document.querySelector('#busy')?.hidden,nativeBusy:typeof Android!=='undefined'?Android.isExportBusy():null,ai:document.querySelector('#aiStatus')?.textContent})"));}
    private String js(String code)throws Exception {CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();runOnMainSync(()->web.evaluateJavascript("try{"+code+"}catch(e){'__MINT_E2E_JS_ERROR__'+String(e)}",v->{value.set(v);latch.countDown();}));if(!latch.await(30,TimeUnit.SECONDS))throw new AssertionError("JS timeout");if(value.get()!=null&&value.get().contains("__MINT_E2E_JS_ERROR__"))throw new AssertionError(value.get());return value.get();}
    private void capture(String name)throws Exception {
        AccessibilityNodeInfo active=getUiAutomation().getRootInActiveWindow();
        if(active!=null&&getTargetContext().getPackageName().equals(String.valueOf(active.getPackageName()))){
            CountDownLatch drawn=new CountDownLatch(1);runOnMainSync(()->web.postVisualStateCallback(1,new WebView.VisualStateCallback(){@Override public void onComplete(long id){drawn.countDown();}}));
            if(!drawn.await(10,TimeUnit.SECONDS))throw new AssertionError("WebView visual state not ready for screenshot");
        } // DocumentsUI pauses WebView; capture the actual native window directly.

        try{getUiAutomation().waitForIdle(200,3000);}catch(java.util.concurrent.TimeoutException ignored){}
        Bitmap image=getUiAutomation().takeScreenshot();if(image==null)throw new AssertionError("Missing screenshot");try(FileOutputStream out=getTargetContext().openFileOutput("ai-e2e-"+name+".png",0)){image.compress(Bitmap.CompressFormat.PNG,100,out);}image.recycle();}
    private void write(String name,String text)throws Exception {try(FileOutputStream out=getTargetContext().openFileOutput(name,0)){out.write(text.getBytes(StandardCharsets.UTF_8));}}
    private WebView findWeb(View v){if(v instanceof WebView)return(WebView)v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){WebView w=findWeb(g.getChildAt(i));if(w!=null)return w;}}return null;}
}
