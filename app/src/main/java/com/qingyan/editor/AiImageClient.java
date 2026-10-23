package com.qingyan.editor;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.UUID;
import javax.net.ssl.HttpsURLConnection;

/** Explicit, ephemeral BYO image API request. No cookies, disk cache, redirects or logging. */
final class AiImageClient {
    static final int MAX_JSON = 20 * 1024 * 1024;
    static final int MAX_PNG = 12 * 1024 * 1024;
    static final class UserFailure extends IOException { UserFailure(String message) { super(message); } }
    interface Connections { HttpsURLConnection open(URL url) throws IOException; }
    private final Connections connections;
    private volatile HttpsURLConnection active;
    private volatile boolean cancelled;
    AiImageClient() { this(url -> (HttpsURLConnection) url.openConnection()); }
    AiImageClient(Connections connections) { this.connections = connections; }

    static final class Request {
        final URL url;
        final String key, model, prompt;
        final byte[] image, mask;
        Request(String endpoint, String key, String model, String prompt, String image, String mask) throws IOException {
            try {
                URI uri = new URI(endpoint);
                if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null
                        || uri.getRawQuery() != null || uri.getRawFragment() != null || endpoint.length() > 2048) throw new Exception();
                this.url = uri.toURL();
            } catch (Exception e) { throw new UserFailure("接口必须是无账号、查询参数的完整 HTTPS 地址"); }
            this.key = field(key, 4096); this.model = field(model, 200); this.prompt = field(prompt, 8000);
            if (!key.matches("[\\x21-\\x7e]+")) throw new UserFailure("密钥格式无效");
            this.image = decodePng(image);
            this.mask = mask == null || mask.isEmpty() ? null : decodePng(mask);
            if (this.mask != null && (dimension(this.image, 16) != dimension(this.mask, 16)
                    || dimension(this.image, 20) != dimension(this.mask, 20))) throw new UserFailure("蒙版和图片尺寸不一致");
            if (this.mask != null && this.image.length + this.mask.length > MAX_PNG) throw new UserFailure("图片与蒙版合计超过 12MiB");
        }
    }
    private static String field(String value, int max) throws IOException {
        if (value == null || value.trim().isEmpty() || value.length() > max || value.indexOf('\0') >= 0) throw new UserFailure("请填写有效密钥、模型和编辑说明");
        return value.trim();
    }
    static byte[] decodePng(String value) throws IOException {
        if (value == null || !value.startsWith("data:image/png;base64,") || value.length() > MAX_PNG * 4 / 3 + 22) throw new UserFailure("PNG 超过 12MiB 或格式无效");
        try { byte[] bytes = Base64.getDecoder().decode(value.substring(22)); validatePng(bytes); return bytes; }
        catch (IllegalArgumentException e) { throw new UserFailure("PNG 编码无效"); }
    }
    static void validatePng(byte[] bytes) throws IOException {
        byte[] signature = {(byte)137,80,78,71,13,10,26,10};
        if (bytes.length < 33 || bytes.length > MAX_PNG) throw new UserFailure("PNG 大小无效");
        for (int i = 0; i < 8; i++) if (bytes[i] != signature[i]) throw new UserFailure("结果必须是 PNG");
        if (dimension(bytes, 8) != 13 || bytes[12] != 'I' || bytes[13] != 'H' || bytes[14] != 'D' || bytes[15] != 'R') throw new UserFailure("PNG 头无效");
        long w = dimension(bytes, 16), h = dimension(bytes, 20);
        if (w < 1 || h < 1 || w > 4096 || h > 4096 || w * h > 8000000) throw new UserFailure("PNG 超过 800万像素 / 最长边4096");
    }
    private static long dimension(byte[] bytes, int offset) {
        return ((long)(bytes[offset]&255)<<24)|((long)(bytes[offset+1]&255)<<16)|((long)(bytes[offset+2]&255)<<8)|(bytes[offset+3]&255);
    }
    void cancel() { cancelled = true; HttpsURLConnection c = active; if (c != null) c.disconnect(); }
    private void checkpoint() throws IOException { if (cancelled || Thread.currentThread().isInterrupted()) throw new UserFailure("请求已取消"); }

    String edit(Request request) throws IOException {
        checkpoint();
        HttpsURLConnection c = connections.open(request.url); active = c;
        try {
            checkpoint();
            c.setConnectTimeout(20000); c.setReadTimeout(180000); c.setInstanceFollowRedirects(false);
            c.setUseCaches(false); c.setRequestMethod("POST"); c.setDoOutput(true);
            c.setRequestProperty("Authorization", "Bearer " + request.key);
            c.setRequestProperty("Accept", "application/json");
            String boundary = "Mint" + UUID.randomUUID().toString().replace("-", "");
            c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
            c.setChunkedStreamingMode(32768);
            try (OutputStream out = c.getOutputStream()) {
                part(out, boundary, "model", request.model); part(out, boundary, "prompt", request.prompt);
                part(out, boundary, "n", "1"); part(out, boundary, "output_format", "png");
                file(out, boundary, "image", request.image);
                if (request.mask != null) file(out, boundary, "mask", request.mask);
                write(out, "--" + boundary + "--\r\n");
            }
            checkpoint(); int status = c.getResponseCode();
            if (status < 200 || status >= 300) throw new UserFailure("服务返回 HTTP " + status + "；请核对接口、模型和余额");
            if (c.getContentLengthLong() > 24L * 1024 * 1024) throw new UserFailure("服务结果超过 24MiB");
            try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[32768]; int count;
                while ((count = in.read(buffer)) != -1) {
                    checkpoint(); if (out.size() + count > 24 * 1024 * 1024) throw new UserFailure("服务结果超过 24MiB");
                    out.write(buffer, 0, count);
                }
                checkpoint(); return out.toString(StandardCharsets.UTF_8.name());
            }
        } finally { active = null; c.disconnect(); }
    }
    private void file(OutputStream out, String boundary, String name, byte[] bytes) throws IOException {
        write(out, "--"+boundary+"\r\nContent-Disposition: form-data; name=\""+name+"\"; filename=\"mint-"+name+".png\"\r\nContent-Type: image/png\r\n\r\n");
        for (int offset = 0; offset < bytes.length; offset += 32768) { checkpoint(); out.write(bytes, offset, Math.min(32768, bytes.length-offset)); }
        write(out, "\r\n");
    }
    private void part(OutputStream out, String boundary, String name, String value) throws IOException {
        checkpoint(); write(out, "--"+boundary+"\r\nContent-Disposition: form-data; name=\""+name+"\"\r\n\r\n"+value+"\r\n");
    }
    private static void write(OutputStream out, String value) throws IOException { out.write(value.getBytes(StandardCharsets.UTF_8)); }
}
