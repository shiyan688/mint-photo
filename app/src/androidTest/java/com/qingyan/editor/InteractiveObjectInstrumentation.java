package com.qingyan.editor;

import android.app.Instrumentation;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.os.Debug;
import android.os.SystemClock;

import com.google.mediapipe.framework.image.BitmapImageBuilder;
import com.google.mediapipe.framework.image.ByteBufferExtractor;
import com.google.mediapipe.framework.image.MPImage;
import com.google.mediapipe.tasks.components.containers.NormalizedKeypoint;
import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.core.Delegate;
import com.google.mediapipe.tasks.vision.interactivesegmenter.InteractiveSegmenter;
import com.google.mediapipe.tasks.vision.interactivesegmenter.InteractiveSegmenterOptions;
import com.google.mediapipe.tasks.vision.interactivesegmenter.Stroke;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.MessageDigest;
import java.util.Collections;

/** Isolated Android model-compatibility experiment, not a shipped feature or quality benchmark. */
public final class InteractiveObjectInstrumentation extends Instrumentation {
    private static final String MODEL_SHA = "38431bc66b883404e8397f74c3579404315b9b52b04a46c6346fe906a7309b03";
    private String stage = "launch";
    private final JSONObject report = new JSONObject();
    private final JSONArray images = new JSONArray();
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }

    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            require(getTargetContext().getPackageName().endsWith(".e2e"), "disposable app ID");
            report.put("androidApi", android.os.Build.VERSION.SDK_INT).put("abi", android.os.Build.SUPPORTED_ABIS[0])
                .put("scope", "Disposable Android emulator instrumentation and pinned research model. No product UI, physical phone, peak memory, segmentation ground truth, or model distribution claim.")
                .put("modelSha256", MODEL_SHA).put("testOnlyModel", true).put("results", images)
                .put("memoryScope", "Debug.getMemoryInfo total PSS of the instrumentation target process at a few moments, KiB; not peak memory or whole-device memory.");
            report.put("memoryBeforeKiB", memory());
            stage = "model-read";
            byte[] model = asset("interactive-research.task", 30525312);
            require(model.length == 30525312 && sha(model).equals(MODEL_SHA), "pinned model bytes and SHA");
            ByteBuffer direct = ByteBuffer.allocateDirect(model.length).order(ByteOrder.nativeOrder());
            direct.put(model).rewind(); model = null;
            stage = "model-create"; long start = SystemClock.elapsedRealtime();
            try (InteractiveSegmenter segmenter = InteractiveSegmenter.createFromOptions(getTargetContext(),
                    InteractiveSegmenterOptions.builder().setBaseOptions(BaseOptions.builder()
                            .setDelegate(Delegate.CPU).setModelAssetBuffer(direct).build()).build())) {
                report.put("createMs", SystemClock.elapsedRealtime() - start).put("memoryAfterCreateKiB", memory());
                runImage(segmenter, "melvin", "interactive-melvin.jpg", 720, 900, .285f, .68f,
                        "34471604e6f19bdbc31e8a556caa9d20bab29c417a7817a1c352740458dcf0eb");
                runImage(segmenter, "collins", "astronaut.png", 512, 512, .74f, .82f,
                        "88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5");
            }
            report.put("memoryAfterCloseKiB", memory()).put("result", "PASS").put("stage", stage);
            write("interactive-result.json", report.toString(2));
            result.putString("result", "PASS Android interactive object model research; 2 masks; no quality or device acceptance claim");
            finish(0, result);
        } catch (Throwable error) {
            try { report.put("result", "FAIL").put("stage", stage).put("error", error.toString());
                write("interactive-result.json", report.toString(2)); } catch (Exception ignored) { }
            result.putString("result", "FAIL Android interactive object model research at " + stage + ": " + error);
            result.putString("stack", android.util.Log.getStackTraceString(error));
            finish(1, result);
        }
    }

    private void runImage(InteractiveSegmenter segmenter, String name, String file, int width, int height,
                          float px, float py, String expectedSha) throws Exception {
        stage = name + "-decode";
        byte[] encoded = asset(file, 2 * 1024 * 1024);
        require(sha(encoded).equals(expectedSha), name + " source SHA");
        Bitmap decoded = BitmapFactory.decodeByteArray(encoded, 0, encoded.length);
        require(decoded != null, name + " source decode");
        Bitmap bitmap = Bitmap.createScaledBitmap(decoded, width, height, true);
        if (bitmap != decoded) decoded.recycle();
        MPImage image = new BitmapImageBuilder(bitmap).build();
        JSONObject row = new JSONObject().put("name", name).put("sourceSha256", expectedSha)
                .put("width", width).put("height", height).put("point", new JSONArray().put(px).put(py))
                .put("memoryBeforeSetImageKiB", memory());
        images.put(row);
        try {
            stage = name + "-set-image"; long start = SystemClock.elapsedRealtime(); segmenter.setImage(image);
            row.put("setImageMs", SystemClock.elapsedRealtime() - start).put("memoryAfterSetImageKiB", memory());
            Stroke stroke = Stroke.builder().setBrushMode(Stroke.BrushMode.POSITIVE)
                    .setPoints(Collections.singletonList(NormalizedKeypoint.create(px, py))).setCompleted(true).build();
            stage = name + "-segment"; start = SystemClock.elapsedRealtime();
            MPImage mask = segmenter.segment(Collections.singletonList(stroke));
            long segmentMs = SystemClock.elapsedRealtime() - start;
            try {
                int w = mask.getWidth(), h = mask.getHeight();
                require(w == width && h == height, name + " mask matches input dimensions");
                ByteBuffer pixels = ByteBufferExtractor.extract(mask).order(ByteOrder.nativeOrder());
                require(pixels.remaining() == w * h * Float.BYTES, name + " expected float confidence mask");
                int[] gray = new int[w * h]; int high = 0, low = 0, bad = 0; float clicked = 0;
                int picked = Math.min(h - 1, (int)(py * h)) * w + Math.min(w - 1, (int)(px * w));
                for (int i = 0; i < gray.length; i++) {
                    float value = pixels.getFloat(i * Float.BYTES);
                    if (!Float.isFinite(value) || value < 0 || value > 1) { bad++; value = 0; }
                    if (value > .5f) high++; if (value < .1f) low++; if (i == picked) clicked = value;
                    int v = Math.round(value * 255); gray[i] = 0xff000000 | v << 16 | v << 8 | v;
                }
                require(bad == 0 && high > 0 && low > 0 && clicked > .5f, name + " plausible confidence and selected point");
                Bitmap imageMask = Bitmap.createBitmap(gray, w, h, Bitmap.Config.ARGB_8888);
                try (OutputStream out = getTargetContext().openFileOutput("interactive-" + name + "-mask.png", 0)) {
                    require(imageMask.compress(Bitmap.CompressFormat.PNG, 100, out), "mask PNG encoded");
                } finally { imageMask.recycle(); }
                row.put("segmentMs", segmentMs).put("maskWidth", w).put("maskHeight", h)
                    .put("aboveHalfPixels", high).put("belowTenthPixels", low).put("clickedConfidence", clicked)
                    .put("memoryAfterSegmentKiB", memory()).put("result", "PASS");
            } finally { mask.close(); }
        } finally { image.close(); bitmap.recycle(); }
    }

    private byte[] asset(String name, int limit) throws Exception {
        try (InputStream in = getContext().getAssets().open(name); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] b = new byte[16384]; int n; while ((n = in.read(b)) != -1) { out.write(b, 0, n); if (out.size() > limit) throw new IllegalStateException("asset exceeds limit"); }
            return out.toByteArray();
        }
    }
    private void write(String name, String contents) throws Exception {
        try (OutputStream out = getTargetContext().openFileOutput(name, 0)) { out.write(contents.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
    }
    private static long memory() { Debug.MemoryInfo info = new Debug.MemoryInfo(); Debug.getMemoryInfo(info); return info.getTotalPss(); }
    private static String sha(byte[] data) throws Exception { byte[] digest = MessageDigest.getInstance("SHA-256").digest(data); StringBuilder s = new StringBuilder(); for (byte b : digest) s.append(String.format(java.util.Locale.ROOT, "%02x", b & 255)); return s.toString(); }
    private static void require(boolean yes, String message) { if (!yes) throw new AssertionError(message); }
}
