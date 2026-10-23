package com.qingyan.editor;

import android.app.Instrumentation;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.util.Base64;

import com.google.mediapipe.tasks.components.containers.NormalizedLandmark;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Deterministic native smoke using public NASA photograph, never the user's photos. */
public final class PortraitSmokeInstrumentation extends Instrumentation {
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }

    @Override public void onStart() {
        Bundle out = new Bundle();
        int checks = 0;
        try (PortraitAnalyzer analyzer = new PortraitAnalyzer(getTargetContext())) {
            checks += payloadContractChecks();
            byte[] fixture;
            try (InputStream in = getContext().getAssets().open("astronaut.png")) {
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int n;
                while ((n = in.read(buffer)) != -1) bytes.write(buffer, 0, n);
                fixture = bytes.toByteArray();
            }
            String image = "data:image/png;base64," + Base64.encodeToString(fixture, Base64.NO_WRAP);
            long start = System.nanoTime();
            JSONObject face = analyzer.analyze(image, "face");
            JSONArray faces = face.getJSONArray("faces");
            check(face.getBoolean("ok") && faces.length() == 1, "One actual fixture face"); checks++;
            JSONArray points = faces.getJSONObject(0).getJSONArray("landmarks");
            check(points.length() == 478, "478 actual landmarks"); checks++;
            check(face.getInt("faceLimit") == 5 && !face.has("landmarks") && !face.has("selectedFaceId"),
                    "Bounded candidates without implicit native selection"); checks++;
            check(face.getJSONObject("detectionSize").getInt("width") == 512
                    && face.getJSONObject("detectionSize").getInt("height") == 512,
                    "Actual decoded fixture dimensions"); checks++;
            check(face.getJSONObject("detector").getString("id").equals("mediapipe-face-landmarker")
                    && face.getJSONObject("detector").getString("topology").equals("MediaPipe478")
                    && face.getJSONObject("detector").getString("modelSha256").equals(MODEL_SHA),
                    "Pinned bundled model provenance"); checks++;
            for (int i = 0; i < points.length(); i++) {
                JSONObject point = points.getJSONObject(i);
                check(point.getDouble("x") > 0 && point.getDouble("x") < 1
                        && point.getDouble("y") > 0 && point.getDouble("y") < 1
                        && Double.isFinite(point.getDouble("z")),
                        "Normalized landmark " + i);
            }
            checks++;
            check(points.getJSONObject(1).getDouble("y") < points.getJSONObject(152).getDouble("y"),
                    "Nose above chin"); checks++;
            long faceMs = (System.nanoTime() - start) / 1_000_000;
            start = System.nanoTime();
            JSONObject person = analyzer.analyze(image, "person");
            try (java.io.FileOutputStream saved = getTargetContext().openFileOutput(
                    "public-astronaut-analysis.json", android.content.Context.MODE_PRIVATE)) {
                saved.write(new JSONObject().put("face", face).put("person", person)
                        .toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            JSONObject mask = person.getJSONObject("mask");
            int w = mask.getInt("width"), h = mask.getInt("height");
            byte[] confidence = Base64.decode(mask.getString("data"), Base64.NO_WRAP);
            check(w == 256 && h == 256 && confidence.length == w * h, "256-square confidence mask"); checks++;
            int low = 0, high = 0;
            for (byte value : confidence) { if ((value & 255) < 25) low++; if ((value & 255) > 230) high++; }
            check(low > 500 && high > 500, "Both foreground and background present"); checks++;
            // Astronaut's suit covers lower center; upper-right corner is background wall.
            check((confidence[(h * 3 / 4) * w + w / 2] & 255) > 200, "Suit is foreground"); checks++;
            check((confidence[(h / 16) * w + w * 15 / 16] & 255) < 100, "Wall is background"); checks++;
            long personMs = (System.nanoTime() - start) / 1_000_000;
            Bitmap small = PortraitAnalyzer.decode(image, 100);
            check(small.getWidth() == 100 && small.getHeight() == 100, "Decode bounded dimensions");
            small.recycle(); checks++;
            try { analyzer.analyze("https://example.com/image.png", "face"); throw new AssertionError("URL accepted"); }
            catch (java.io.IOException expected) { checks++; }
            try { analyzer.analyze(image, "unknown"); throw new AssertionError("Unknown mode accepted"); }
            catch (java.io.IOException expected) { checks++; }
            out.putString("result", "PASS " + checks + " checks; face=" + faceMs
                    + "ms person=" + personMs + "ms; landmarks=" + points.length()
                    + "; backgroundPixels=" + low + "; foregroundPixels=" + high);
            try (java.io.FileOutputStream saved = getTargetContext().openFileOutput(
                    "public-astronaut-native-result.txt", android.content.Context.MODE_PRIVATE)) {
                saved.write(out.getString("result").getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            finish(0, out);
        } catch (Throwable error) {
            out.putString("result", "FAIL after " + checks + " checks: " + error);
            out.putString("stack", android.util.Log.getStackTraceString(error));
            try (java.io.FileOutputStream saved = getTargetContext().openFileOutput(
                    "public-astronaut-native-result.txt", android.content.Context.MODE_PRIVATE)) {
                saved.write(out.getString("result").getBytes(java.nio.charset.StandardCharsets.UTF_8));
            } catch (java.io.IOException writeError) {
                out.putString("resultWriteError", writeError.toString());
            }
            finish(1, out);
        }
    }

    private static void check(boolean value, String label) {
        if (!value) throw new AssertionError(label);
    }

    private static final String MODEL_SHA =
            "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff";

    /** Contract-only synthetic arrays: not a claim of detecting five actual people. */
    private static int payloadContractChecks() throws Exception {
        int checks = 0;
        check(PortraitAnalyzer.sha256(new ByteArrayInputStream(new byte[]{97, 98, 99}))
                .equals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
                "SHA-256 known-answer test"); checks++;
        List<NormalizedLandmark> points = new ArrayList<>();
        for (int i = 0; i < 478; i++) points.add(NormalizedLandmark.create(.25f, .5f, -.01f));
        for (int count = 1; count <= 5; count++) {
            JSONObject payload = PortraitAnalyzer.facePayload(Collections.nCopies(count, points), 900, 680, MODEL_SHA);
            JSONArray faces = payload.getJSONArray("faces");
            check(payload.getBoolean("ok") && faces.length() == count && payload.getInt("faceLimit") == 5,
                    "Serialize all " + count + " candidates"); checks++;
            for (int i = 0; i < count; i++) {
                check(faces.getJSONObject(i).getJSONArray("landmarks").length() == 478,
                        "Complete candidate " + i); checks++;
            }
        }
        reject(() -> PortraitAnalyzer.facePayload(null, 900, 680, MODEL_SHA)); checks++;
        reject(() -> PortraitAnalyzer.facePayload(Collections.emptyList(), 900, 680, MODEL_SHA)); checks++;
        reject(() -> PortraitAnalyzer.facePayload(Collections.nCopies(6, points), 900, 680, MODEL_SHA)); checks++;
        reject(() -> PortraitAnalyzer.facePayload(Collections.singletonList(null), 900, 680, MODEL_SHA)); checks++;
        reject(() -> PortraitAnalyzer.facePayload(Collections.singletonList(points.subList(0, 477)), 900, 680, MODEL_SHA)); checks++;
        List<NormalizedLandmark> tooMany = new ArrayList<>(points);
        tooMany.add(points.get(0));
        reject(() -> PortraitAnalyzer.facePayload(Collections.singletonList(tooMany), 900, 680, MODEL_SHA)); checks++;
        List<NormalizedLandmark> malformed = new ArrayList<>(points);
        malformed.set(13, null);
        reject(() -> PortraitAnalyzer.facePayload(Collections.singletonList(malformed), 900, 680, MODEL_SHA)); checks++;
        // An invalid later face must fail the entire result, not silently drop that candidate.
        reject(() -> PortraitAnalyzer.facePayload(java.util.Arrays.asList(points, malformed), 900, 680, MODEL_SHA)); checks++;
        for (float bad : new float[]{Float.NaN, Float.NEGATIVE_INFINITY, Float.POSITIVE_INFINITY}) {
            for (int axis = 0; axis < 3; axis++) {
                malformed.set(13, NormalizedLandmark.create(axis == 0 ? bad : .5f,
                        axis == 1 ? bad : .5f, axis == 2 ? bad : .01f));
                reject(() -> PortraitAnalyzer.facePayload(Collections.singletonList(malformed), 900, 680, MODEL_SHA)); checks++;
            }
        }
        for (int[] size : new int[][]{{0, 680}, {900, 0}, {-1, 680}, {1201, 680}, {900, 1201}}) {
            reject(() -> PortraitAnalyzer.facePayload(Collections.singletonList(points), size[0], size[1], MODEL_SHA)); checks++;
        }
        for (String sha : new String[]{null, "", "not-a-hash", MODEL_SHA.toUpperCase(java.util.Locale.ROOT)}) {
            reject(() -> PortraitAnalyzer.facePayload(Collections.singletonList(points), 900, 680, sha)); checks++;
        }
        // Valid off-image normalized values must not be clamped to fabricate geometry.
        malformed.set(13, NormalizedLandmark.create(-.1f, 1.1f, -.2f));
        JSONObject offImage = PortraitAnalyzer.facePayload(Collections.singletonList(malformed), 900, 680, MODEL_SHA)
                .getJSONArray("faces").getJSONObject(0).getJSONArray("landmarks").getJSONObject(13);
        check(offImage.getDouble("x") < 0 && offImage.getDouble("y") > 1, "Preserve finite off-image coordinates"); checks++;
        return checks;
    }

    private interface Throwing { void run() throws Exception; }
    private static void reject(Throwing action) throws Exception {
        try { action.run(); }
        catch (java.io.IOException expected) { return; }
        throw new AssertionError("Malformed face payload was accepted");
    }
}
