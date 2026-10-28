package com.qingyan.editor;

import android.app.Instrumentation;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.os.Debug;
import android.os.SystemClock;
import android.util.Base64;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.FloatBuffer;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicInteger;

/** Isolated inference benchmark; not ImageToolbox UI, production integration or a quality verdict. */
public final class MobileSamBenchInstrumentation extends Instrumentation {
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    private long pss() { Debug.MemoryInfo i = new Debug.MemoryInfo(); Debug.getMemoryInfo(i); return i.getTotalPss(); }
    private static String hex(byte[] bytes) { StringBuilder out = new StringBuilder(); for (byte b:bytes) out.append(String.format(Locale.ROOT,"%02x",b&255)); return out.toString(); }
    private File copyModel(String name,String sha) throws Exception {
        File f = File.createTempFile("sam-bench-", ".onnx", getTargetContext().getCacheDir());
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in=getContext().getAssets().open(name); OutputStream out=new FileOutputStream(f)) {
            byte[] b=new byte[65536]; int n; while ((n=in.read(b))!=-1) { out.write(b,0,n); digest.update(b,0,n); }
        }
        if (!hex(digest.digest()).equals(sha)) { f.delete(); throw new AssertionError("SHA mismatch: "+name); }
        return f;
    }
    private void write(String name,String data) throws Exception { try(OutputStream out=getTargetContext().openFileOutput(name,0)){out.write(data.getBytes(java.nio.charset.StandardCharsets.UTF_8));} }
    @Override public void onStart() {
        Bundle out=new Bundle(); JSONObject report=new JSONObject(); File encoderFile=null,decoderFile=null;
        AtomicBoolean sampling=new AtomicBoolean(true); AtomicLong peak=new AtomicLong(0),baselinePeak=new AtomicLong(0),samPeak=new AtomicLong(0); AtomicInteger phase=new AtomicInteger(0);
        Thread sampler=new Thread(()->{while(sampling.get()){long p=pss();peak.accumulateAndGet(p,Math::max);if(phase.get()==1)baselinePeak.accumulateAndGet(p,Math::max);if(phase.get()==2)samPeak.accumulateAndGet(p,Math::max);SystemClock.sleep(25);}},"pss-sampler"); sampler.start();
        try {
            report.put("scope","API35 x86_64 emulator; isolated reimplementation of ImageToolbox MobileSAM; CPU only; sampled test-process PSS every ~25ms, not device peak, full UI, saving, or phone performance")
                .put("abi",android.os.Build.SUPPORTED_ABIS[0]).put("androidApi",android.os.Build.VERSION.SDK_INT)
                .put("encoderSha256","580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749")
                .put("decoderSha256","93915fc7c993ab9d59ab8c9ccd3bce37f7509c81ab4150a74abd4d2abbd8570d");
            byte[] bytes; try(InputStream in=getContext().getAssets().open("melvin.jpg")){bytes=in.readAllBytes();}
            if(!hex(MessageDigest.getInstance("SHA-256").digest(bytes)).equals("34471604e6f19bdbc31e8a556caa9d20bab29c417a7817a1c352740458dcf0eb")) throw new AssertionError("photo SHA");
            Bitmap decoded=BitmapFactory.decodeByteArray(bytes,0,bytes.length); if(decoded==null)throw new AssertionError("decode");
            Bitmap image=Bitmap.createScaledBitmap(decoded,720,900,true); if(image!=decoded)decoded.recycle();
            ByteArrayOutputStream encoded=new ByteArrayOutputStream(); if(!image.compress(Bitmap.CompressFormat.PNG,100,encoded))throw new AssertionError("encode");
            try(OutputStream saved=getTargetContext().openFileOutput("sam-input.png",0)){saved.write(encoded.toByteArray());}
            String data="data:image/png;base64,"+Base64.encodeToString(encoded.toByteArray(),Base64.NO_WRAP);
            report.put("photo","NASA Melvin; Android decoded/resized 720x900; point (0.285,0.68)").put("pssBeforeBaselineKiB",pss());
            JSONArray baseline=new JSONArray();phase.set(1);
            try(PortraitAnalyzer a=new PortraitAnalyzer(getTargetContext())){for(int i=0;i<3;i++){long t=SystemClock.elapsedRealtime();JSONObject v=a.analyze(data,"person");baseline.put(new JSONObject().put("elapsedMs",SystemClock.elapsedRealtime()-t).put("pssKiB",pss()).put("width",v.getJSONObject("mask").getInt("width")).put("height",v.getJSONObject("mask").getInt("height")));if(i==0)write("baseline.json",v.toString());}}
            phase.set(2);report.put("baseline",baseline).put("pssAfterBaselineKiB",pss());
            encoderFile=copyModel("encoder.onnx","580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749");
            decoderFile=copyModel("decoder.onnx","93915fc7c993ab9d59ab8c9ccd3bce37f7509c81ab4150a74abd4d2abbd8570d");
            long t=SystemClock.elapsedRealtime();int w=819,h=1024; Bitmap resized=Bitmap.createScaledBitmap(image,w,h,true);int[] pixels=new int[w*h];resized.getPixels(pixels,0,w,0,0,w,h);resized.recycle();
            FloatBuffer buffer=FloatBuffer.allocate(1024*1024*3);
            for(int y=0;y<h;y++)for(int x=0;x<w;x++){int c=pixels[y*w+x],i=(y*1024+x)*3;buffer.put(i,(c>>16)&255);buffer.put(i+1,(c>>8)&255);buffer.put(i+2,c&255);}
            report.put("samPreprocessMs",SystemClock.elapsedRealtime()-t).put("pssAfterInputKiB",pss());
            OrtEnvironment env=OrtEnvironment.getEnvironment(); int threads=Math.min(4,Math.max(1,Runtime.getRuntime().availableProcessors()));
            try(OrtSession.SessionOptions opt=new OrtSession.SessionOptions()) {
                opt.addConfigEntry("mlas.disable_kleidiai","1");opt.setIntraOpNumThreads(threads);report.put("threads",threads);
                t=SystemClock.elapsedRealtime();
                try(OrtSession enc=env.createSession(encoderFile.getAbsolutePath(),opt);OnnxTensor input=OnnxTensor.createTensor(env,buffer,new long[]{1024,1024,3})){
                    report.put("samEncoderCreateMs",SystemClock.elapsedRealtime()-t).put("pssAfterEncoderCreateKiB",pss());t=SystemClock.elapsedRealtime();
                    try(OrtSession.Result result=enc.run(Collections.singletonMap("input_image",input))){
                        OnnxTensor value=(OnnxTensor)result.get(0);FloatBuffer f=value.getFloatBuffer();float[] copy=new float[f.remaining()];f.get(copy);
                        report.put("samEncodeMs",SystemClock.elapsedRealtime()-t).put("pssAfterEncodeKiB",pss());
                        try(OnnxTensor embedding=OnnxTensor.createTensor(env,FloatBuffer.wrap(copy),value.getInfo().getShape())){runDecoder(env,opt,decoderFile,embedding,w,h,report);}
                    }
                }
            }
            image.recycle();report.put("result","PASS");out.putString("result","PASS MobileSAM isolated benchmark");
        } catch(Throwable error){try{report.put("result","FAIL").put("error",error.toString());}catch(Exception ignored){}out.putString("result","FAIL MobileSAM isolated benchmark: "+error);out.putString("stack",android.util.Log.getStackTraceString(error));}
        finally { sampling.set(false);try{sampler.join(2000);report.put("sampledPeakPssKiB",peak.get()).put("baselineSampledPeakPssKiB",baselinePeak.get()).put("samSampledPeakPssKiB",samPeak.get());write("mobile-sam-report.json",report.toString(2));}catch(Exception ignored){} if(encoderFile!=null)encoderFile.delete();if(decoderFile!=null)decoderFile.delete(); }
        finish("PASS".equals(report.optString("result"))?0:1,out);
    }
    private void runDecoder(OrtEnvironment env,OrtSession.SessionOptions opt,File file,OnnxTensor embedding,int w,int h,JSONObject report)throws Exception{
        long t=SystemClock.elapsedRealtime();try(OrtSession decoder=env.createSession(file.getAbsolutePath(),opt)){
            report.put("samDecoderCreateMs",SystemClock.elapsedRealtime()-t).put("pssAfterDecoderCreateKiB",pss());JSONArray runs=new JSONArray();
            for(int run=0;run<3;run++)try(OnnxTensor coords=OnnxTensor.createTensor(env,FloatBuffer.wrap(new float[]{.285f*w,.68f*h,0,0}),new long[]{1,2,2});OnnxTensor labels=OnnxTensor.createTensor(env,FloatBuffer.wrap(new float[]{1,-1}),new long[]{1,2});OnnxTensor mask=OnnxTensor.createTensor(env,FloatBuffer.allocate(256*256),new long[]{1,1,256,256});OnnxTensor has=OnnxTensor.createTensor(env,new float[]{0});OnnxTensor size=OnnxTensor.createTensor(env,new float[]{900,720})){
                Map<String,OnnxTensor> inputs=new HashMap<>();inputs.put("point_coords",coords);inputs.put("point_labels",labels);inputs.put("mask_input",mask);inputs.put("has_mask_input",has);inputs.put("orig_im_size",size);inputs.put("image_embeddings",embedding);
                t=SystemClock.elapsedRealtime();try(OrtSession.Result output=decoder.run(inputs)){FloatBuffer values=((OnnxTensor)output.get(0)).getFloatBuffer();if(values.remaining()!=720*900)throw new AssertionError("mask size: "+values.remaining());int[] gray=new int[720*900];int high=0;for(int i=0;i<gray.length;i++){float v=values.get(i);if(!Float.isFinite(v))throw new AssertionError("nonfinite mask");int a=(int)Math.round(255/(1+Math.exp(-Math.max(-20,Math.min(20,v)))));if(a>127)high++;gray[i]=0xff000000|(a<<16)|(a<<8)|a;}long elapsed=SystemClock.elapsedRealtime()-t;runs.put(new JSONObject().put("decodeAndMaskMs",elapsed).put("pssKiB",pss()).put("aboveHalf",high));if(run==0){Bitmap b=Bitmap.createBitmap(gray,720,900,Bitmap.Config.ARGB_8888);try(OutputStream stream=getTargetContext().openFileOutput("sam-mask.png",0)){if(!b.compress(Bitmap.CompressFormat.PNG,100,stream))throw new AssertionError("PNG");}finally{b.recycle();}}}
            }
            report.put("samDecoderRuns",runs);
        }
    }
}
