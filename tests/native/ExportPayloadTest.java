package com.qingyan.editor;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.Base64;

/** No JUnit dependency: run with a local JDK using tests/native/run.sh. */
public final class ExportPayloadTest {
    private static int checks;

    public static void main(String[] args) throws Exception {
        check("薄荷-照片 (1).jpg".equals(ExportPayload.fileName("薄荷-照片 (1).png", "image/jpeg")),
                "Normalize extension, preserve Unicode name");
        check("photo.png".equals(ExportPayload.fileName("photo", "image/png")), "Append extension");
        rejectName("../escape.png");
        rejectName("folder/photo.png");
        rejectName("folder\\photo.png");
        rejectName(".hidden");
        rejectName(" .hidden");
        rejectName(" .. ");
        rejectName(" ");
        rejectName("image\u0000.png");
        rejectName("a".repeat(121));
        reject(() -> ExportPayload.fileName("photo", "text/html"), "Reject unsupported MIME");
        byte[] png = {(byte)137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0};
        byte[] jpeg = {(byte)255, (byte)216, (byte)255, 1, 2, 3};
        byte[] webp = {'R', 'I', 'F', 'F', 0, 0, 0, 0, 'W', 'E', 'B', 'P'};
        testImage(png, "image/png");
        testImage(jpeg, "image/jpeg");
        testImage(webp, "image/webp");
        reject(() -> decode(url(png, "image/png"), "image/jpeg"), "Reject MIME mismatch");
        reject(() -> decode(url(new byte[12], "image/png"), "image/png"), "Reject bad signature");
        reject(() -> decode("data:image/png;base64,!!!!====", "image/png"), "Reject bad base64");
        reject(() -> decode("data:image/png;base64,AAAA==AA", "image/png"), "Reject interior padding");
        reject(() -> decode("data:image/png;base64,AAAA====", "image/png"), "Reject extra padding");
        reject(() -> decode("data:image/png;base64,AA==AAAA", "image/png"), "Reject trailers");
        reject(() -> decode(url(png, "image/png") + "\n", "image/png"), "Reject whitespace");
        reject(() -> decode("data:image/png;charset=utf-8;base64,AAAAAAAA", "image/png"), "Reject extra metadata");
        reject(() -> decode(null, "image/png"), "Reject null");
        reject(() -> decode("data:image/png;base64,AAAA", "image/png"), "Reject truncated image");
        byte[] paddedPng = Arrays.copyOf(png, 13);
        testImage(paddedPng, "image/png");
        System.out.println("PASS: " + checks + " native export-validation checks");
    }

    private static void testImage(byte[] bytes, String mime) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        long length = ExportPayload.decode(url(bytes, mime), mime, out);
        check(length == bytes.length && Arrays.equals(bytes, out.toByteArray()), "Round-trip " + mime);
    }

    private static String url(byte[] bytes, String mime) {
        return "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(bytes);
    }

    private static void decode(String value, String mime) throws IOException {
        ExportPayload.decode(value, mime, new ByteArrayOutputStream());
    }

    private static void rejectName(String name) throws Exception {
        reject(() -> ExportPayload.fileName(name, "image/png"), "Reject unsafe name");
    }

    private static void reject(Throwing action, String label) throws Exception {
        try { action.run(); } catch (IOException expected) { checks++; return; }
        throw new AssertionError(label);
    }

    private static void check(boolean ok, String label) {
        if (!ok) throw new AssertionError(label);
        checks++;
    }

    private interface Throwing { void run() throws Exception; }
}
