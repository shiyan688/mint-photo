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

/** Real Android/WebView/HTTPS/SAF workflow with a synthetic, explicitly non-AI server. */
public final class AiFlowInstrumentation extends Instrumentation {
    private Activity activity;
    private WebView web;
    private final JSONArray checks = new JSONArray();
    private String stage="launch";
    private final JSONObject timings=new JSONObject();
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
            click("#importBtn");waitPicker();chooseDownloads();tapText("mint-e2e-source.png");until("document.querySelector('#imageInfo').textContent.includes('512 × 512')",30000);
            capture("photo-imported");measureAdjustments();js("window.__beforeAi=document.querySelector('#previewCanvas').toDataURL();true");
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
            JSONObject report=new JSONObject();report.put("result","PASS");report.put("androidApi",android.os.Build.VERSION.SDK_INT);report.put("abi",android.os.Build.SUPPORTED_ABIS[0]);report.put("checks",checks);report.put("timingsMsIncludingAutomationPolling",timings);report.put("mockService",true);report.put("realAiModel",false);report.put("physicalDevice",false);report.put("systemDocumentPicker",true);report.put("savedFilesReopened",true);
            write("ai-e2e-result.json",report.toString(2));result.putString("result","PASS Android AI mock workflow, "+checks.length()+" checks; real HTTPS/SAF, no real AI model");finish(0,result);
        } catch(Throwable e) {
            result.putString("result","FAIL "+stage+": "+e);result.putString("stack",android.util.Log.getStackTraceString(e));
            try {capture("FAIL-"+stage);write("ai-e2e-failure.txt",result.toString()+"\n"+tree(getUiAutomation().getRootInActiveWindow(),0)+"\nDOM: "+js("document.body.innerText.slice(-9000)"));}catch(Exception ignored){}
            finish(1,result);
        }
    }
    private void measureAdjustments()throws Exception {
        click("[data-tool=adjust]");
        js("window.__adjustDone=false;window.__adjustSamples=[];(async()=>{let s=document.querySelector('#brightness');for(let i=0;i<12;i++){let t=performance.now();s.value=String(i%2?8:-8);s.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.__adjustSamples.push(performance.now()-t);}s.value='0';s.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.__adjustDone=true;})()");
        until("window.__adjustDone",30000);
        timings.put("brightness12InputToTwoAnimationFrames",new JSONArray(js("window.__adjustSamples")));
        require(true,"actual Android brightness inputs rendered; returned to neutral before AI capture");
    }
    private void openAi(String mode,String path)throws Exception {
        js("if(document.querySelector('#headerMenu')&&!document.querySelector('#headerMenu').open)document.querySelector('#headerMenu summary').click();true");click("#aiBtn");until("document.querySelector('#aiDialog').open&&!document.querySelector('#aiSend').disabled",20000);
        js("document.querySelector('#aiEndpoint').value='https://10.0.2.2:9443"+path+"';document.querySelector('#aiModel').value='mock-png-v1';document.querySelector('#aiKey').value='mint-e2e-not-secret';let m=document.querySelector('#aiMode');m.value='"+mode+"';m.dispatchEvent(new Event('change'));true");
    }
    private void send()throws Exception {requestStarted=SystemClock.uptimeMillis();js("document.querySelector('#aiConsent').checked=true;document.querySelector('#aiSend').click();true");}
    private void paint()throws Exception {
        js("document.querySelector('#aiCanvas').scrollIntoView({block:'center'});true");SystemClock.sleep(300);
        JSONArray r=new JSONArray(js("(()=>{let r=document.querySelector('#aiCanvas').getBoundingClientRect();return[r.left,r.top,r.width,r.height,innerWidth]})()"));
        int[] offset=new int[2];runOnMainSync(()->web.getLocationOnScreen(offset));float scale=web.getWidth()/(float)r.getDouble(4);
        float x=offset[0]+(float)(r.getDouble(0)+r.getDouble(2)*.85)*scale,y=offset[1]+(float)(r.getDouble(1)+r.getDouble(3)*.3)*scale,dy=(float)r.getDouble(3)*.15f*scale;
        long down=SystemClock.uptimeMillis();pointer(down,MotionEvent.ACTION_DOWN,x,y);for(int i=1;i<=8;i++)pointer(down,MotionEvent.ACTION_MOVE,x,y+dy*i/8);pointer(down,MotionEvent.ACTION_UP,x,y+dy);
        until("document.querySelector('#aiStatus').textContent.includes('1 笔')",10000);
    }
    private void pointer(long down,int action,float x,float y){MotionEvent e=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,x,y,0);e.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);sendPointerSync(e);e.recycle();}
    private void checkPixels(boolean expanded)throws Exception {
        timings.put(expanded?"outpaintRequestToPreview":"eraseRequestToPreview",SystemClock.uptimeMillis()-requestStarted);
        String script="(async()=>{let a=new Image();a.src=window.__beforeAi;await a.decode();let b=document.querySelector('#aiResult'),c=document.createElement('canvas');c.width=b.naturalWidth;c.height=b.naturalHeight;c.getContext('2d').drawImage(b,0,0);let d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let o=document.createElement('canvas');o.width=a.width;o.height=a.height;o.getContext('2d').drawImage(a,0,0);let p=o.getContext('2d').getImageData(0,0,a.width,a.height).data;let same=true,n=0;for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){let i=(y*a.width+x)*4,j=((y+"+(expanded?102:0)+")*c.width+x+"+(expanded?102:0)+")*4;if("+(expanded?"true":"x<380")+")for(let k=0;k<4;k++)if(d[j+k]!==p[i+k])same=false;if(d[j]!==p[i])n++;}window.__pixelCheck={same,changed:n,w:c.width,h:c.height};})()";
        js(script);until("!!window.__pixelCheck",10000);JSONObject p=new JSONObject(js("window.__pixelCheck"));require(p.getBoolean("same"),expanded?"outpaint original center pixel-exact":"erase outside selected region pixel-exact");require(expanded||p.getInt("changed")>0,"mock output changes selected pixels");require(p.getInt("w")== (expanded?716:512),"result dimensions correct");js("delete window.__pixelCheck;true");
    }
    private void accept()throws Exception {
        js("window.__acceptedPng=document.querySelector('#aiResult').src;document.querySelector('#aiAccept').click();true");
        for(int i=0;i<30;i++){if("true".equals(js("!!document.querySelector('#confirmDialog')?.open")))click("#confirmYes");if("true".equals(js("!document.querySelector('#aiDialog').open&&document.querySelector('#busy').hidden")))break;SystemClock.sleep(300);}
        until("!document.querySelector('#aiDialog').open&&document.querySelector('#busy').hidden",20000);
    }
    private void saveAndReopen(String mode,int w,int h)throws Exception {
        stage=mode+"-save";long saveStart=SystemClock.uptimeMillis();js("window.__savedPreview=document.querySelector('#previewCanvas').toDataURL();true");click("#exportBtn");until("document.querySelector('#exportDialog').open",10000);click("[data-format='image/png']");click("#saveBtn");
        waitPicker();capture(mode+"-save-picker");AccessibilityNodeInfo edit=findClass(getUiAutomation().getRootInActiveWindow(),"android.widget.EditText");require(edit!=null,"system filename input exists");Bundle text=new Bundle();text.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,"mint-e2e-"+mode+".png");require(edit.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,text),"system filename set");tapText("Save");
        until("!Android.isExportBusy()&&document.querySelector('#toast').textContent.includes('已保存')",30000);timings.put(mode+"SaveWithSystemPicker",SystemClock.uptimeMillis()-saveStart);require(true,"native PNG write completed");capture(mode+"-saved");
        stage=mode+"-reopen";long reopenStart=SystemClock.uptimeMillis();js("window.__fileChosen=false;document.querySelector('#fileInput').addEventListener('change',()=>{window.__fileChosen=true;},{once:true});true");js("if(document.querySelector('#headerMenu')&&!document.querySelector('#headerMenu').open)document.querySelector('#headerMenu summary').click();true");click("#openTop");waitPicker();chooseDownloads();tapText("mint-e2e-"+mode+".png");until("window.__fileChosen",20000);
        for(int i=0;i<40;i++){if("true".equals(js("!!document.querySelector('#confirmDialog')?.open")))click("#confirmYes");if("true".equals(js("document.querySelector('#imageInfo').textContent.includes('"+w+" × "+h+"')&&!Android.isExportBusy()")))break;SystemClock.sleep(300);}
        until("document.querySelector('#imageInfo').textContent.includes('"+w+" × "+h+"')&&document.querySelector('#previewCanvas').toDataURL()===window.__savedPreview",30000);timings.put(mode+"ReopenWithSystemPicker",SystemClock.uptimeMillis()-reopenStart);require(true,"saved "+mode+" PNG reopened with identical rendered pixels and dimensions");capture(mode+"-reopened");
    }
    private void waitPicker()throws Exception {long end=SystemClock.uptimeMillis()+20000;while(SystemClock.uptimeMillis()<end){AccessibilityNodeInfo n=getUiAutomation().getRootInActiveWindow();if(n!=null&&String.valueOf(n.getPackageName()).contains("documentsui"))return;SystemClock.sleep(300);}throw new AssertionError("system DocumentsUI not visible; state="+js("JSON.stringify({toast:document.querySelector('#toast')?.textContent,busy:document.querySelector('#busy')?.hidden,nativeBusy:Android.isExportBusy()})"));}
    private void chooseDownloads()throws Exception {
        AccessibilityNodeInfo root=getUiAutomation().getRootInActiveWindow();
        AccessibilityNodeInfo nav=findDescription(root,"Show roots");
        if(nav!=null){while(nav!=null&&!nav.isClickable())nav=nav.getParent();if(nav!=null)nav.performAction(AccessibilityNodeInfo.ACTION_CLICK);SystemClock.sleep(300);tapText("Downloads");SystemClock.sleep(300);}
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
    private void click(String selector)throws Exception {
        String q=JSONObject.quote(selector);
        js("document.querySelector("+q+").scrollIntoView({block:'center',inline:'center'});true");
        JSONArray r=new JSONArray(js("(()=>{let e=document.querySelector("+q+"),r=e.getBoundingClientRect();if(!r.width||!r.height||e.disabled)throw Error('Control not tappable: '+"+q+");return[r.left+r.width/2,r.top+r.height/2,innerWidth]})()"));
        int[] offset=new int[2],width=new int[1];runOnMainSync(()->{web.getLocationOnScreen(offset);width[0]=web.getWidth();});float scale=width[0]/(float)r.getDouble(2);
        float x=offset[0]+(float)r.getDouble(0)*scale,y=offset[1]+(float)r.getDouble(1)*scale;
        long down=SystemClock.uptimeMillis();pointer(down,MotionEvent.ACTION_DOWN,x,y);pointer(down,MotionEvent.ACTION_UP,x,y);waitForIdleSync();
    }
    private void until(String expression,long timeout)throws Exception {long end=SystemClock.uptimeMillis()+timeout;while(SystemClock.uptimeMillis()<end){if("true".equals(js("!!("+expression+")")))return;SystemClock.sleep(250);}throw new AssertionError("Timeout: "+expression+"; state="+js("JSON.stringify({toast:document.querySelector('#toast')?.textContent,busy:document.querySelector('#busy')?.hidden,nativeBusy:typeof Android!=='undefined'?Android.isExportBusy():null,ai:document.querySelector('#aiStatus')?.textContent})"));}
    private String js(String code)throws Exception {CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();runOnMainSync(()->web.evaluateJavascript("try{"+code+"}catch(e){'__MINT_E2E_JS_ERROR__'+String(e)}",v->{value.set(v);latch.countDown();}));if(!latch.await(30,TimeUnit.SECONDS))throw new AssertionError("JS timeout");if(value.get()!=null&&value.get().contains("__MINT_E2E_JS_ERROR__"))throw new AssertionError(value.get());return value.get();}
    private void capture(String name)throws Exception {Bitmap image=getUiAutomation().takeScreenshot();if(image==null)throw new AssertionError("Missing screenshot");try(FileOutputStream out=getTargetContext().openFileOutput("ai-e2e-"+name+".png",0)){image.compress(Bitmap.CompressFormat.PNG,100,out);}image.recycle();}
    private void write(String name,String text)throws Exception {try(FileOutputStream out=getTargetContext().openFileOutput(name,0)){out.write(text.getBytes(StandardCharsets.UTF_8));}}
    private WebView findWeb(View v){if(v instanceof WebView)return(WebView)v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){WebView w=findWeb(g.getChildAt(i));if(w!=null)return w;}}return null;}
}
