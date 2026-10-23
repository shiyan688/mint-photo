package com.qingyan.editor;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Base64;

/** Bounded image-only data URL decoder, independent of Android for local testing. */
final class ExportPayload {
    static final int MAX_BYTES = 48 * 1024 * 1024;
    static final int MAX_URL_LENGTH = ((MAX_BYTES + 2) / 3) * 4 + 64;

    private ExportPayload() { }

    static String fileName(String requestedName, String mime) throws IOException {
        String extension = extension(mime);
        if (requestedName == null || requestedName.length() > 120
                || requestedName.trim().isEmpty() || requestedName.trim().startsWith(".")
                || !requestedName.matches("[\\p{L}\\p{N} _().-]+")) {
            throw new IOException("文件名无效，请使用文字、数字或短横线。");
        }
        String base = requestedName.trim();
        int dot = base.lastIndexOf('.');
        if (dot > 0) {
            base = base.substring(0, dot);
        }
        if (base.trim().isEmpty()) {
            throw new IOException("文件名不能为空。");
        }
        return base + extension;
    }

    static String extension(String mime) throws IOException {
        if ("image/png".equals(mime)) return ".png";
        if ("image/jpeg".equals(mime)) return ".jpg";
        if ("image/webp".equals(mime)) return ".webp";
        throw new IOException("仅支持 PNG、JPG 或 WebP 图片。");
    }

    static long decode(String dataUrl, String mime, OutputStream out) throws IOException {
        extension(mime);
        String prefix = "data:" + mime + ";base64,";
        if (dataUrl == null || dataUrl.length() > MAX_URL_LENGTH || !dataUrl.startsWith(prefix)) {
            throw new IOException("图片格式无效，或超过 48 MB。请降低导出尺寸。");
        }
        int length = dataUrl.length() - prefix.length();
        if (length < 8 || length % 4 != 0) {
            throw new IOException("图片编码不完整，请重新导出。");
        }
        // Decoder streams stop at padding; validate the entire input to reject hidden trailers.
        int padding = 0;
        for (int i = prefix.length(); i < dataUrl.length(); i++) {
            char next = dataUrl.charAt(i);
            if (next == '=') {
                padding++;
                if (padding > 2 || i < dataUrl.length() - 2) {
                    throw new IOException("图片编码无效，请重新导出。");
                }
            } else if (padding != 0 || !((next >= 'A' && next <= 'Z')
                    || (next >= 'a' && next <= 'z') || (next >= '0' && next <= '9')
                    || next == '+' || next == '/')) {
                throw new IOException("图片编码无效，请重新导出。");
            }
        }
        byte[] head = new byte[12];
        int headSize = 0;
        long count = 0;
        byte[] buffer = new byte[32 * 1024];
        try (InputStream in = Base64.getDecoder().wrap(new AsciiStringStream(dataUrl, prefix.length()))) {
            int read;
            while ((read = in.read(buffer)) != -1) {
                count += read;
                if (count > MAX_BYTES) {
                    throw new IOException("图片超过 48 MB，请降低导出尺寸。");
                }
                if (headSize < head.length) {
                    int copy = Math.min(read, head.length - headSize);
                    System.arraycopy(buffer, 0, head, headSize, copy);
                    headSize += copy;
                }
                out.write(buffer, 0, read);
            }
        } catch (IllegalArgumentException error) {
            throw new IOException("图片编码无效，请重新导出。", error);
        }
        if (!matchesSignature(head, headSize, mime)) {
            throw new IOException("图片内容与导出格式不符。");
        }
        return count;
    }

    private static boolean matchesSignature(byte[] bytes, int size, String mime) {
        if ("image/png".equals(mime)) {
            int[] png = {137, 80, 78, 71, 13, 10, 26, 10};
            if (size < png.length) return false;
            for (int i = 0; i < png.length; i++) {
                if ((bytes[i] & 255) != png[i]) return false;
            }
            return true;
        }
        if ("image/jpeg".equals(mime)) {
            return size >= 3 && (bytes[0] & 255) == 255 && (bytes[1] & 255) == 216
                    && (bytes[2] & 255) == 255;
        }
        return size >= 12 && bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F'
                && bytes[3] == 'F' && bytes[8] == 'W' && bytes[9] == 'E'
                && bytes[10] == 'B' && bytes[11] == 'P';
    }

    /** Avoid a second 64 MB copy of the data URL while decoding. */
    private static final class AsciiStringStream extends InputStream {
        private final String value;
        private int offset;

        AsciiStringStream(String value, int offset) {
            this.value = value;
            this.offset = offset;
        }

        @Override public int read() throws IOException {
            if (offset >= value.length()) return -1;
            char next = value.charAt(offset++);
            if (next > 127) throw new IOException("图片编码包含无效字符。");
            return next;
        }

        @Override public int read(byte[] bytes, int start, int length) throws IOException {
            if (bytes == null) throw new NullPointerException();
            if (start < 0 || length < 0 || length > bytes.length - start) {
                throw new IndexOutOfBoundsException();
            }
            if (length == 0) return 0;
            if (offset >= value.length()) return -1;
            int size = Math.min(length, value.length() - offset);
            for (int i = 0; i < size; i++) bytes[start + i] = (byte) read();
            return size;
        }
    }
}
