package com.qingyan.editor;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import com.google.mediapipe.framework.image.BitmapImageBuilder;
import com.google.mediapipe.framework.image.ByteBufferExtractor;
import com.google.mediapipe.framework.image.MPImage;
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark;
import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.core.Delegate;
import com.google.mediapipe.tasks.vision.core.RunningMode;
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker;
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult;
import com.google.mediapipe.tasks.vision.imagesegmenter.ImageSegmenter;
import com.google.mediapipe.tasks.vision.imagesegmenter.ImageSegmenterResult;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;

/** On-device photo geometry only. No identity matching, network, camera or photo persistence. */
final class PortraitAnalyzer implements AutoCloseable {
    static final int MAX_DATA_URL_LENGTH = 8 * 1024 * 1024;
    static final int FACE_LIMIT = 5;
    static final int FACE_LANDMARK_COUNT = 478;
    static final String FACE_MODEL_ASSET = "models/face_landmarker.task";
    private final Context context;
    private FaceLandmarker face;
    private ImageSegmenter person;
    private String faceModelSha256;

    PortraitAnalyzer(Context context) { this.context = context.getApplicationContext(); }

    // All calls, including close(), are serialized on the Activity's portrait worker.
    JSONObject analyze(String dataUrl, String kind) throws IOException, JSONException {
        if (!"face".equals(kind) && !"person".equals(kind)) {
            throw new IOException("不支持的人像分析类型。");
        }
        Bitmap bitmap = decode(dataUrl, "person".equals(kind) ? 256 : 1200);
        MPImage image = null;
        try {
            image = new BitmapImageBuilder(bitmap).build();
            return "face".equals(kind) ? landmarks(image) : mask(image);
        } finally {
            if (image != null) image.close();
            if (!bitmap.isRecycled()) bitmap.recycle();
        }
    }

    private JSONObject landmarks(MPImage image) throws IOException, JSONException {
        // Hash the exact bundled bytes once on the same serialized worker as inference.
        // Never substitute a model name/version for actual artifact provenance.
        if (faceModelSha256 == null) {
            try (InputStream asset = context.getAssets().open(FACE_MODEL_ASSET)) {
                faceModelSha256 = sha256(asset);
            }
        }
        if (face == null) {
            face = FaceLandmarker.createFromOptions(context,
                    FaceLandmarker.FaceLandmarkerOptions.builder()
                    .setBaseOptions(BaseOptions.builder().setDelegate(Delegate.CPU)
                            .setModelAssetPath(FACE_MODEL_ASSET).build())
                    .setRunningMode(RunningMode.IMAGE).setNumFaces(FACE_LIMIT)
                    .setMinFaceDetectionConfidence(0.5f).setMinFacePresenceConfidence(0.5f)
                    .setOutputFaceBlendshapes(false).setOutputFacialTransformationMatrixes(false)
                    .build());
        }
        FaceLandmarkerResult result = face.detect(image);
        return facePayload(result.faceLandmarks(), image.getWidth(), image.getHeight(), faceModelSha256);
    }

    // Package-visible for focused boundary tests. Reject the entire callback on malformed
    // data rather than dropping an invalid face and silently changing selection indexes.
    static JSONObject facePayload(List<List<NormalizedLandmark>> detected, int width, int height,
            String modelSha256) throws IOException, JSONException {
        if (detected == null || detected.isEmpty()) {
            throw new IOException("没有识别到清晰正脸，请换一张照片或手动调整定位。");
        }
        if (detected.size() > FACE_LIMIT || width <= 0 || height <= 0
                || width > 1200 || height > 1200 || modelSha256 == null
                || !modelSha256.matches("[a-f0-9]{64}")) {
            throw new IOException("人脸分析结果格式异常，请重新识别。");
        }
        JSONArray faces = new JSONArray();
        for (List<NormalizedLandmark> landmarks : detected) {
            if (landmarks == null || landmarks.size() != FACE_LANDMARK_COUNT) {
                throw new IOException("人脸关键点数量不匹配，请重新识别。");
            }
            JSONArray points = new JSONArray();
            for (NormalizedLandmark point : landmarks) {
                if (point == null || !Float.isFinite(point.x()) || !Float.isFinite(point.y())
                        || !Float.isFinite(point.z())) {
                    throw new IOException("人脸关键点无效，请重新识别。");
                }
                // Do not clamp or synthesize coordinates: real landmarks may extend beyond
                // the image boundary for a partially visible face.
                points.put(new JSONObject().put("x", point.x()).put("y", point.y()).put("z", point.z()));
            }
            faces.put(new JSONObject().put("landmarks", points));
        }
        return new JSONObject().put("ok", true).put("faces", faces)
                .put("detector", new JSONObject().put("id", "mediapipe-face-landmarker")
                        .put("modelSha256", modelSha256).put("topology", "MediaPipe478"))
                .put("detectionSize", new JSONObject().put("width", width).put("height", height))
                .put("faceLimit", FACE_LIMIT);
    }

    static String sha256(InputStream input) throws IOException {
        final MessageDigest digest;
        try { digest = MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException impossible) { throw new IOException("无法校验人脸模型。", impossible); }
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        StringBuilder hex = new StringBuilder(64);
        final char[] digits = "0123456789abcdef".toCharArray();
        for (byte value : digest.digest()) {
            hex.append(digits[(value & 255) >>> 4]).append(digits[value & 15]);
        }
        return hex.toString();
    }

    private JSONObject mask(MPImage image) throws IOException, JSONException {
        if (person == null) {
            person = ImageSegmenter.createFromOptions(context,
                    ImageSegmenter.ImageSegmenterOptions.builder()
                    .setBaseOptions(BaseOptions.builder().setDelegate(Delegate.CPU)
                            .setModelAssetPath("models/selfie_segmenter.tflite").build())
                    .setRunningMode(RunningMode.IMAGE)
                    .setOutputConfidenceMasks(true).setOutputCategoryMask(false).build());
        }
        ImageSegmenterResult result = person.segment(image);
        if (!result.confidenceMasks().isPresent() || result.confidenceMasks().get().isEmpty()) {
            throw new IOException("未得到人像轮廓，请重试或手动画出主体。");
        }
        List<MPImage> masks = result.confidenceMasks().get();
        try {
            // The pinned file contains labels.txt = "selfie" and a single foreground tensor.
            // Some Tasks releases do not expose that embedded label via getLabels(); an empty
            // list is not an invalid model. Never blindly assume foreground is channel 1.
            List<String> labels = person.getLabels();
            int foreground = -1;
            if (masks.size() == 1 && (labels.isEmpty()
                    || (labels.size() == 1 && "selfie".equals(labels.get(0))))) {
                foreground = 0;
            } else if (labels.size() == masks.size()) {
                for (int i = 0; i < labels.size(); i++) {
                    if ("selfie".equals(labels.get(i)) || "person".equals(labels.get(i))) foreground = i;
                }
            }
            if (foreground < 0) throw new IOException("人像模型格式不匹配（通道="
                    + masks.size() + "，标签=" + labels + "）。");
            MPImage confidence = masks.get(foreground);
            int width = confidence.getWidth(), height = confidence.getHeight();
            if (width <= 0 || height <= 0 || width > 1200 || height > 1200) {
                throw new IOException("人像轮廓尺寸异常。");
            }
            ByteBuffer buffer = ByteBufferExtractor.extract(confidence).order(ByteOrder.nativeOrder());
            if (buffer.remaining() != width * height * Float.BYTES) {
                throw new IOException("人像轮廓格式异常。");
            }
            // Normally already <=256 because inference input is bounded above; retain this
            // explicit output cap for future runtime changes and WebView transport safety.
            float scale = Math.min(1f, 256f / Math.max(width, height));
            int outWidth = Math.max(1, Math.round(width * scale));
            int outHeight = Math.max(1, Math.round(height * scale));
            byte[] values = new byte[outWidth * outHeight];
            for (int y = 0; y < outHeight; y++) {
                int sy = Math.min(height - 1, (int) ((y + 0.5f) * height / outHeight));
                for (int x = 0; x < outWidth; x++) {
                    int sx = Math.min(width - 1, (int) ((x + 0.5f) * width / outWidth));
                    float v = buffer.getFloat((sy * width + sx) * Float.BYTES);
                    if (!Float.isFinite(v)) v = 0;
                    values[y * outWidth + x] = (byte) Math.round(Math.max(0, Math.min(1, v)) * 255);
                }
            }
            JSONObject mask = new JSONObject().put("width", outWidth).put("height", outHeight)
                    .put("data", Base64.encodeToString(values, Base64.NO_WRAP));
            return new JSONObject().put("ok", true).put("mask", mask)
                    .put("model", "MediaPipe Selfie Segmenter")
                    .put("modelMaskChannels", masks.size()).put("modelLabels", new JSONArray(labels));
        } finally {
            for (MPImage mask : masks) mask.close();
            if (result.categoryMask().isPresent()) result.categoryMask().get().close();
        }
    }

    static Bitmap decode(String dataUrl, int maxSide) throws IOException {
        if (dataUrl == null || dataUrl.length() > MAX_DATA_URL_LENGTH) {
            throw new IOException("分析图片过大，请缩小后重试。");
        }
        int semi = dataUrl.indexOf(';');
        if (!dataUrl.startsWith("data:image/") || semi < 0 || semi > 24) {
            throw new IOException("仅支持本地 PNG、JPG 或 WebP 图片。");
        }
        String mime = dataUrl.substring(5, semi);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ExportPayload.decode(dataUrl, mime, bytes);
        byte[] encoded = bytes.toByteArray();
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(encoded, 0, encoded.length, options);
        int width = options.outWidth, height = options.outHeight;
        if (width <= 0 || height <= 0 || width > 20000 || height > 20000
                || (long) width * height > 40_000_000L) {
            throw new IOException("图片尺寸无法用于人像分析。");
        }
        options.inJustDecodeBounds = false;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        options.inSampleSize = 1;
        while (Math.max(width, height) / options.inSampleSize > maxSide * 2) {
            options.inSampleSize *= 2;
        }
        Bitmap bitmap = BitmapFactory.decodeByteArray(encoded, 0, encoded.length, options);
        if (bitmap == null) throw new IOException("无法读取图片，请重新选择。");
        float scale = Math.min(1f, (float) maxSide / Math.max(bitmap.getWidth(), bitmap.getHeight()));
        if (scale < 1) {
            Bitmap small = Bitmap.createScaledBitmap(bitmap,
                    Math.max(1, Math.round(bitmap.getWidth() * scale)),
                    Math.max(1, Math.round(bitmap.getHeight() * scale)), true);
            if (small != bitmap) bitmap.recycle();
            bitmap = small;
        }
        return bitmap;
    }

    @Override public void close() {
        if (face != null) { face.close(); face = null; }
        if (person != null) { person.close(); person = null; }
    }
}
