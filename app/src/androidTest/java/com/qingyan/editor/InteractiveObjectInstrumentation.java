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
import com.google.mediapipe.tasks.vision.interactivesegmenterlegacy.InteractiveSegmenterLegacy;
import com.google.mediapipe.tasks.vision.imagesegmenter.ImageSegmenterResult;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.List;

/** Isolated Android model-compatibility experiment, not a shipped feature or quality benchmark. */
public final class InteractiveObjectInstrumentation extends Instrumentation {
    private static final String MODEL_SHA = "38431bc66b883404e8397f74c3579404315b9b52b04a46c6346fe906a7309b03";
    private static final String LEGACY_SHA = "e24338a717c1b7ad8d159666677ef400babb7f33b8ad60c4d96db4ecf694cd25";
    private boolean legacy;
    private boolean legacyPixel;
    private String stage = "launch";
    private final JSONObject report = new JSONObject();
    private final JSONArray images = new JSONArray();
    @Override public void onCreate(Bundle args) {
        String model = args == null ? "v2" : args.getString("objectModel", "v2");
        legacyPixel = "legacy-pixel".equals(model);
        legacy = legacyPixel || "legacy".equals(model);
        super.onCreate(args); start();
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        java.io.File modelFile = null;
        int resultCode = 1;
        try {
            require(getTargetContext().getPackageName().endsWith(".e2e"), "disposable app ID");
            report.put("androidApi", android.os.Build.VERSION.SDK_INT).put("abi", android.os.Build.SUPPORTED_ABIS[0])
                .put("scope", "Disposable Android emulator instrumentation and pinned research model. No product UI, physical phone, peak memory, segmentation ground truth, or model distribution claim.")
                .put("modelSha256", legacy ? LEGACY_SHA : MODEL_SHA)
                .put("modelVariant", legacyPixel ? "legacy-pixel" : legacy ? "legacy" : "v2")
                .put("roiCoordinateMode", legacyPixel ? "pixel coordinates, experimental 1.0.0-only shim" : "normalized coordinates")
                .put("testOnlyModel", true).put("results", images)
                .put("memoryScope", "Debug.getMemoryInfo total PSS of the instrumentation target process at a few moments, KiB; not peak memory or whole-device memory.");
            report.put("memoryBeforeKiB", memory());
            stage = "model-read";
            int modelSize = legacy ? 6227884 : 30525312;
            byte[] model = asset(legacy ? "interactive-legacy.tflite" : "interactive-research.task", modelSize);
            require(model.length == modelSize && sha(model).equals(legacy ? LEGACY_SHA : MODEL_SHA), "pinned model bytes and SHA");
            // Unique private disposable file: the test APK asset is not part of the
            // application package, and is never exported or retained after this test.
            modelFile = java.io.File.createTempFile("interactive-research-", ".task", getTargetContext().getCacheDir());
            try (OutputStream output = new java.io.FileOutputStream(modelFile)) { output.write(model); }
            model = null;
            stage = "model-create"; long start = SystemClock.elapsedRealtime();
            if (legacy) {
                try (InteractiveSegmenterLegacy segmenter = InteractiveSegmenterLegacy.createFromOptions(getTargetContext(),
                        InteractiveSegmenterLegacy.InteractiveSegmenterLegacyOptions.builder().setBaseOptions(BaseOptions.builder()
                                .setDelegate(Delegate.CPU).setModelAssetPath(modelFile.getAbsolutePath()).build())
                                .setOutputConfidenceMasks(true).setOutputCategoryMask(false).build())) {
                    report.put("createMs", SystemClock.elapsedRealtime() - start).put("memoryAfterCreateKiB", memory());
                    runImages(null, segmenter);
                }
            } else try (InteractiveSegmenter segmenter = InteractiveSegmenter.createFromOptions(getTargetContext(),
                    InteractiveSegmenterOptions.builder().setBaseOptions(BaseOptions.builder()
                            .setDelegate(Delegate.CPU).setModelAssetPath(modelFile.getAbsolutePath()).build()).build())) {
                report.put("createMs", SystemClock.elapsedRealtime() - start).put("memoryAfterCreateKiB", memory());
                runImages(segmenter, null);
            }
            report.put("memoryAfterCloseKiB", memory()).put("result", "PASS").put("stage", stage);
            write("interactive-result.json", report.toString(2));
            result.putString("result", "PASS Android interactive object model research; 2 masks; no quality or device acceptance claim");
            resultCode = 0;
        } catch (Throwable error) {
            try { report.put("result", "FAIL").put("stage", stage).put("error", error.toString());
                write("interactive-result.json", report.toString(2)); } catch (Exception ignored) { }
            result.putString("result", "FAIL Android interactive object model research at " + stage + ": " + error);
            result.putString("stack", android.util.Log.getStackTraceString(error));
        } finally {
            if (modelFile != null && modelFile.exists() && !modelFile.delete()) {
                android.util.Log.w("InteractiveResearch", "Unable to remove the disposable test model from private cache.");
                resultCode = 1;
                result.putString("result", "FAIL Android interactive object model research: unable to remove temporary model");
                try { report.put("result", "FAIL").put("stage", "model-cleanup");
                    write("interactive-result.json", report.toString(2)); } catch (Exception ignored) { }
            }
        }
        finish(resultCode, result);
    }

    private void runImages(InteractiveSegmenter segmenter, InteractiveSegmenterLegacy old) throws Exception {
        String firstFailure = null, firstStage = null;
        try {
            runImage(segmenter, old, "melvin", "interactive-melvin.jpg", 720, 900, .285f, .68f,
                    "34471604e6f19bdbc31e8a556caa9d20bab29c417a7817a1c352740458dcf0eb");
        } catch (AssertionError error) {
            firstFailure = error.toString(); firstStage = stage;
            if (images.length() == 0) images.put(new JSONObject().put("name", "melvin"));
            images.getJSONObject(images.length() - 1).put("result", "FAIL").put("error", firstFailure);
        }
        int previousCount = images.length();
        try {
            runImage(segmenter, old, "collins", "astronaut.png", 512, 512, .74f, .82f,
                    "88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5");
        } catch (AssertionError error) {
            if (images.length() == previousCount) images.put(new JSONObject().put("name", "collins"));
            images.getJSONObject(images.length() - 1).put("result", "FAIL").put("error", error.toString());
            if (firstFailure == null) { firstFailure = error.toString(); firstStage = stage; }
        }
        if (firstFailure != null) { stage = firstStage; throw new AssertionError(firstFailure); }
    }

    private void runImage(InteractiveSegmenter segmenter, InteractiveSegmenterLegacy old, String name, String file, int width, int height,
                          float px, float py, String expectedSha) throws Exception {
        stage = name + "-decode";
        byte[] encoded = asset(file, 2 * 1024 * 1024);
        require(sha(encoded).equals(expectedSha), name + " source SHA");
        Bitmap decoded = BitmapFactory.decodeByteArray(encoded, 0, encoded.length);
        require(decoded != null, name + " source decode");
        Bitmap bitmap = Bitmap.createScaledBitmap(decoded, width, height, true);
        if (bitmap != decoded) decoded.recycle();
        // Preserve the actual decoded/resized input so Android versus host
        // preprocessing can be inspected independently on either PASS or FAIL.
        try (OutputStream out = getTargetContext().openFileOutput("interactive-" + name + "-input.png", 0)) {
            require(bitmap.compress(Bitmap.CompressFormat.PNG, 100, out), name + " input PNG encoded");
        }
        MPImage image = new BitmapImageBuilder(bitmap).build();
        JSONObject row = new JSONObject().put("name", name).put("sourceSha256", expectedSha)
                .put("width", width).put("height", height).put("point", new JSONArray().put(px).put(py))
                .put("apiPoint", new JSONArray().put(legacyPixel ? Math.min(width - 1f, px * width) : px)
                        .put(legacyPixel ? Math.min(height - 1f, py * height) : py))
                .put("memoryBeforeSetImageKiB", memory());
        images.put(row);
        try {
            stage = name + "-set-image"; long start = SystemClock.elapsedRealtime();
            if (segmenter != null) segmenter.setImage(image);
            row.put("setImageMs", segmenter != null ? SystemClock.elapsedRealtime() - start : JSONObject.NULL)
                    .put("memoryAfterSetImageKiB", memory()).put("legacySegmentIncludesImage", old != null);
            stage = name + "-segment"; start = SystemClock.elapsedRealtime();
            ImageSegmenterResult legacyResult = null;
            MPImage mask;
            if (old != null) {
                legacyResult = old.segment(image, InteractiveSegmenterLegacy.RegionOfInterest.create(legacyPoint(px, py, width, height)));
                if (!legacyResult.confidenceMasks().isPresent()) {
                    if (legacyResult.categoryMask().isPresent()) legacyResult.categoryMask().get().close();
                    throw new AssertionError("legacy confidence masks absent");
                }
                List<MPImage> masks = legacyResult.confidenceMasks().get();
                row.put("legacyConfidenceChannels", masks.size()).put("legacyCategoryMaskPresent", legacyResult.categoryMask().isPresent());
                if (masks.size() != 1) {
                    for (MPImage value : masks) value.close();
                    if (legacyResult.categoryMask().isPresent()) legacyResult.categoryMask().get().close();
                    throw new AssertionError("legacy output must have exactly one foreground confidence mask, received " + masks.size());
                }
                mask = masks.get(0);
            } else {
                Stroke stroke = Stroke.builder().setBrushMode(Stroke.BrushMode.POSITIVE)
                        .setPoints(Collections.singletonList(NormalizedKeypoint.create(px, py))).setCompleted(true).build();
                mask = segmenter.segment(Collections.singletonList(stroke));
            }
            long segmentMs = SystemClock.elapsedRealtime() - start;
            try {
                int w = mask.getWidth(), h = mask.getHeight();
                row.put("maskWidth", w).put("maskHeight", h).put("segmentMs", segmentMs);
                require(w == width && h == height, name + " mask matches input dimensions");
                ByteBuffer pixels = ByteBufferExtractor.extract(mask).order(ByteOrder.nativeOrder());
                JSONArray representations = new JSONArray();
                for (com.google.mediapipe.framework.image.MPImageProperties property : mask.getContainedImageProperties()) {
                    representations.put(new JSONObject().put("format", property.getImageFormat()).put("storage", property.getStorageType()));
                }
                row.put("segmentMs", segmentMs).put("maskWidth", w).put("maskHeight", h)
                    .put("maskRepresentations", representations).put("bufferBytes", pixels.remaining())
                    .put("byteOrder", ByteOrder.nativeOrder().toString()).put("memoryAfterSegmentKiB", memory());
                require(pixels.remaining() == w * h * Float.BYTES, name + " expected float confidence mask");
                int[] gray = new int[w * h]; int high = 0, low = 0, bad = 0, finite = 0, swappedInRange = 0;
                float clicked = 0, min = Float.POSITIVE_INFINITY, max = Float.NEGATIVE_INFINITY;
                Float clickedRaw = null, clickedSwapped = null;
                int picked = Math.min(h - 1, (int)(py * h)) * w + Math.min(w - 1, (int)(px * w));
                for (int i = 0; i < gray.length; i++) {
                    float value = pixels.getFloat(i * Float.BYTES);
                    float swapped = Float.intBitsToFloat(Integer.reverseBytes(Float.floatToRawIntBits(value)));
                    if (Float.isFinite(swapped) && swapped >= 0 && swapped <= 1) swappedInRange++;
                    if (i == picked && Float.isFinite(swapped)) clickedSwapped = swapped;
                    if (Float.isFinite(value)) {
                        finite++; min = Math.min(min, value); max = Math.max(max, value);
                        if (i == picked) clickedRaw = value;
                        if (value < 0 || value > 1) { bad++; value = Math.max(0, Math.min(1, value)); }
                    } else { bad++; value = 0; }
                    if (value > .5f) high++; if (value < .1f) low++; if (i == picked) clicked = value;
                    int v = Math.round(value * 255); gray[i] = 0xff000000 | v << 16 | v << 8 | v;
                }
                row.put("finitePixels", finite).put("invalidOrOutOfRangePixels", bad)
                    .put("rawMin", finite > 0 ? min : JSONObject.NULL).put("rawMax", finite > 0 ? max : JSONObject.NULL)
                    .put("clickedRaw", clickedRaw != null ? clickedRaw : JSONObject.NULL)
                    .put("oppositeByteOrderInRangePixels", swappedInRange).put("oppositeByteOrderClickedRaw", clickedSwapped != null ? clickedSwapped : JSONObject.NULL)
                    .put("clickedConfidence", clicked).put("aboveHalfPixels", high).put("belowTenthPixels", low)
                    .put("diagnosticPngClipped", bad != 0);
                // Save the diagnostic output even when the assertion below fails.
                // When values were invalid or outside [0,1], the PNG is explicitly
                // marked as clipped and cannot be used as a valid confidence mask.
                Bitmap imageMask = Bitmap.createBitmap(gray, w, h, Bitmap.Config.ARGB_8888);
                try (OutputStream out = getTargetContext().openFileOutput("interactive-" + name + "-mask.png", 0)) {
                    require(imageMask.compress(Bitmap.CompressFormat.PNG, 100, out), "mask PNG encoded");
                } finally { imageMask.recycle(); }
                if (old != null && "melvin".equals(name)) {
                    JSONArray grid = new JSONArray();
                    row.put("pointGrid", grid);
                    diagnosticLegacyPoints(old, image, name, width, height, grid);
                    stage = name + "-segment";
                }
                require(bad == 0 && high > 0 && low > 0 && clicked > .5f, name + " plausible confidence and selected point");
                row.put("result", "PASS");
            } finally { mask.close(); if (legacyResult != null && legacyResult.categoryMask().isPresent()) legacyResult.categoryMask().get().close(); }
        } finally { image.close(); bitmap.recycle(); }
    }

    /** Diagnostic only: compare distinct ROI inputs, retaining each real output. */
    private void diagnosticLegacyPoints(InteractiveSegmenterLegacy old, MPImage image, String name, int width, int height, JSONArray results) throws Exception {
        final float[][] points = {{.285f,.68f},{0f,0f},{.1f,.2f},{.68f,.285f},{.5f,.5f}};
        boolean[] firstSelection = null;
        boolean pointAffectsMask = false;
        for (int number = 0; number < points.length; number++) {
            float px = points[number][0], py = points[number][1];
            stage = name + "-point-grid-" + number;
            long started = SystemClock.elapsedRealtime();
            ImageSegmenterResult response = old.segment(image, InteractiveSegmenterLegacy.RegionOfInterest.create(legacyPoint(px, py, width, height)));
            long elapsed = SystemClock.elapsedRealtime() - started;
            List<MPImage> masks = response.confidenceMasks().orElse(Collections.emptyList());
            try {
                require(masks.size() == 1, "point grid requires one foreground confidence mask");
                MPImage mask = masks.get(0);
                int w = mask.getWidth(), h = mask.getHeight();
                require(w == width && h == height, "point grid mask dimensions");
                ByteBuffer buffer = ByteBufferExtractor.extract(mask).order(ByteOrder.nativeOrder());
                require(buffer.remaining() == w * h * Float.BYTES, "point grid float confidence buffer");
                int[] gray = new int[w * h]; int invalid = 0, high = 0, changed = 0; float selected = 0;
                if (firstSelection == null) firstSelection = new boolean[w * h];
                int pointIndex = Math.min(h - 1, (int)(py * h)) * w + Math.min(w - 1, (int)(px * w));
                for (int i = 0; i < gray.length; i++) {
                    float value = buffer.getFloat(i * Float.BYTES);
                    if (!Float.isFinite(value) || value < 0 || value > 1) { invalid++; value = 0; }
                    if (value > .5f) high++;
                    if (number == 0) firstSelection[i] = value > .5f;
                    else if (firstSelection[i] != (value > .5f)) changed++;
                    if (i == pointIndex) selected = value;
                    int pixel = Math.round(value * 255); gray[i] = 0xff000000 | pixel << 16 | pixel << 8 | pixel;
                }
                Bitmap png = Bitmap.createBitmap(gray, w, h, Bitmap.Config.ARGB_8888);
                try (OutputStream out = getTargetContext().openFileOutput("interactive-" + name + "-point-" + number + ".png", 0)) {
                    require(png.compress(Bitmap.CompressFormat.PNG, 100, out), "point grid PNG encoded");
                } finally { png.recycle(); }
                results.put(new JSONObject().put("point", new JSONArray().put(px).put(py)).put("segmentMs", elapsed)
                        .put("apiPoint", new JSONArray().put(legacyPixel ? Math.min(width - 1f, px * width) : px)
                                .put(legacyPixel ? Math.min(height - 1f, py * height) : py))
                        .put("selectedConfidence", selected).put("aboveHalfPixels", high).put("invalidPixels", invalid)
                        .put("binaryChangedVsFirst", changed)
                        .put("diagnosticPngClipped", invalid != 0));
                require(invalid == 0, "point grid returned invalid confidence values");
                if (legacyPixel) require(selected > .5f, "pixel-coordinate point grid selected point");
                if (changed >= 1000) pointAffectsMask = true;
            } finally {
                for (MPImage mask : masks) mask.close();
                if (response.categoryMask().isPresent()) response.categoryMask().get().close();
            }
        }
        if (legacyPixel) require(pointAffectsMask, "different pixel points must change the binary mask");
    }

    private NormalizedKeypoint legacyPoint(float x, float y, int width, int height) {
        require(Float.isFinite(x) && Float.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1, "normalized test point in bounds");
        // The pinned 1.0.0 legacy Java implementation fails to mark these values
        // normalized. This explicit, test-only mode tries pixel coordinates;
        // other MediaPipe versions may have different semantics.
        return NormalizedKeypoint.create(legacyPixel ? Math.min(width - 1f, x * width) : x,
                legacyPixel ? Math.min(height - 1f, y * height) : y);
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
