package com.qingyan.editor;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.Normalizer;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Streaming native boundary. JS additionally validates every operation and decodes the source. */
final class ProjectBackupPayload {
    static final String MIME = "application/vnd.mint.photo-project";
    static final String SUFFIX = ".mintproject";
    static final int CHOOSER_PROJECT = 3;
    static final int HEADER_BYTES = 80;
    static final int MAX_BYTES = 64 * 1024 * 1024;
    static final int MAX_MANIFEST_BYTES = 24 * 1024 * 1024;
    static final int MAX_SOURCE_BYTES = 40 * 1024 * 1024;
    static final int MAX_DEPTH = 64;
    static final int MAX_NODES = 2000000;
    static final int MAX_STRING_BYTES = 6 * 1024 * 1024;
    private static final byte[] MAGIC = "MINTPRJ1".getBytes(StandardCharsets.US_ASCII);
    private static final Object COMPOSITE = new Object();

    private ProjectBackupPayload() { }

    /** Project accepts are deliberately separate: never broaden mixed or generic requests. */
    static int chooserKind(String[] accepts) {
        boolean project = false, other = false;
        if (accepts != null) for (String group : accepts) {
            if (group == null || group.trim().isEmpty()) continue;
            for (String raw : group.split(",", -1)) {
                String type = raw.trim().toLowerCase(Locale.ROOT);
                if (SUFFIX.equals(type) || MIME.equals(type)) project = true;
                else other = true;
            }
        }
        if (project) return other ? PresetPayload.CHOOSER_INVALID : CHOOSER_PROJECT;
        return PresetPayload.chooserKind(accepts);
    }

    static boolean isProjectMime(String mime) {
        if (mime == null) return false;
        String type = mime.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return MIME.equals(type) || "application/octet-stream".equals(type);
    }

    static boolean validRequestId(String id) {
        return id != null && id.matches("[A-Za-z0-9_-]{1,80}");
    }

    static String fileName(String requested) {
        String base = requested == null ? "" : requested.substring(0, Math.min(requested.length(), 1024)).trim();
        if (base.toLowerCase(Locale.ROOT).endsWith(SUFFIX)) base = base.substring(0, base.length() - SUFFIX.length());
        base = base.replaceAll("[^\\p{L}\\p{N} _().-]", "_").replaceAll("^[. ]+|[. ]+$", "");
        if (base.codePointCount(0, base.length()) > 80) base = base.substring(0, base.offsetByCodePoints(0, 80)).trim();
        if (base.isEmpty()) base = "薄荷项目";
        return base + SUFFIX;
    }

    static void read(InputStream input) throws IOException {
        if (input == null) throw invalid();
        byte[] header = new byte[HEADER_BYTES];
        readExactly(input, header, header.length);
        if (!Arrays.equals(Arrays.copyOf(header, 8), MAGIC)) throw invalid();
        long manifestLength = uint32(header, 8), sourceLength = uint32(header, 12);
        if (manifestLength < 1 || manifestLength > MAX_MANIFEST_BYTES || sourceLength < 12
                || sourceLength > MAX_SOURCE_BYTES || HEADER_BYTES + manifestLength + sourceLength > MAX_BYTES) throw invalid();
        MessageDigest manifestHash = sha256();
        LimitedDigestInput manifest = new LimitedDigestInput(input, manifestLength, manifestHash);
        InputStreamReader decoder = new InputStreamReader(manifest, StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT));
        Object parsed = new Parser(new BufferedReader(decoder, 8192)).parse();
        if (manifest.remaining != 0 || !MessageDigest.isEqual(manifestHash.digest(), Arrays.copyOfRange(header, 16, 48))) throw invalid();
        String declaredMime = validateShape(parsed);
        MessageDigest sourceHash = sha256();
        byte[] buffer = new byte[32 * 1024];
        readExactly(input, buffer, 12);
        String actualMime = sourceMime(buffer);
        if (declaredMime != null && !"application/octet-stream".equals(declaredMime) && !actualMime.equals(declaredMime)) throw invalid();
        sourceHash.update(buffer, 0, 12);
        long remaining = sourceLength - 12;
        while (remaining > 0) {
            int count = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
            if (count < 0) throw invalid();
            if (count == 0) { int next = input.read(); if (next < 0) throw invalid(); buffer[0] = (byte) next; count = 1; }
            sourceHash.update(buffer, 0, count);
            remaining -= count;
        }
        if (!MessageDigest.isEqual(sourceHash.digest(), Arrays.copyOfRange(header, 48, 80)) || input.read() != -1) throw invalid();
    }

    private static String sourceMime(byte[] b) throws IOException {
        if (b[0] == (byte) 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G'
                && b[4] == 13 && b[5] == 10 && b[6] == 26 && b[7] == 10) return "image/png";
        if (b[0] == (byte) 0xff && b[1] == (byte) 0xd8 && b[2] == (byte) 0xff) return "image/jpeg";
        if (b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') return "image/webp";
        throw invalid();
    }

    private static String validateShape(Object value) throws IOException {
        Map<String, Object> root = object(value, "format", "version", "name", "record");
        if (!"mint-photo-project".equals(root.get("format")) || number(root.get("version"), 1, 1) != 1) throw invalid();
        safeName(root.get("name"), 80, 320);
        if (!(root.get("record") instanceof Map)) throw invalid();
        Map<?, ?> raw = (Map<?, ?>) root.get("record");
        double version = number(raw.get("version"), 1, 2);
        Map<String, Object> record;
        String mime = null;
        if (version == 2) {
            record = object(raw, "version", "source", "ops", "redo");
            Map<String, Object> source = object(record.get("source"), "blob", "name", "width", "height", "mime", "origin");
            if (source.get("blob") != null) throw invalid();
            safeSourceName(source.get("name"));
            double width = number(source.get("width"), 1, 1000000), height = number(source.get("height"), 1, 1000000);
            if (width != Math.rint(width) || height != Math.rint(height) || width * height > 80000000) throw invalid();
            if (!Arrays.asList("original", "legacy-working-copy").contains(source.get("origin"))) throw invalid();
            if (!Arrays.asList("image/png", "image/jpeg", "image/webp", "application/octet-stream").contains(source.get("mime"))) throw invalid();
            mime = (String) source.get("mime");
        } else if (version == 1) {
            record = object(raw, "version", "blob", "name", "ops", "redo");
            if (record.get("blob") != null) throw invalid();
            safeSourceName(record.get("name"));
        } else throw invalid();
        if (!(record.get("ops") instanceof ArrayCount) || !(record.get("redo") instanceof ArrayCount)
                || ((ArrayCount) record.get("ops")).count + ((ArrayCount) record.get("redo")).count > 60) throw invalid();
        return mime;
    }

    private static void safeSourceName(Object value) throws IOException {
        if (!(value instanceof String) || ((String) value).length() < 1 || ((String) value).length() > 1024) throw invalid();
        String name = (String) value;
        for (int i = 0; i < name.length(); i++) if (name.charAt(i) < 0x20) throw invalid();
    }

    private static void safeName(Object value, int codepoints, int bytes) throws IOException {
        if (!(value instanceof String)) throw invalid();
        String name = (String) value;
        if (name.isEmpty() || name.codePointCount(0, name.length()) > codepoints || name.getBytes(StandardCharsets.UTF_8).length > bytes) throw invalid();
        if (!Normalizer.isNormalized(name, Normalizer.Form.NFC) || nameSpace(name.charAt(0)) || nameSpace(name.charAt(name.length() - 1))) throw invalid();
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (Character.isISOControl(c) || c == '\u061c' || c == '\u200e' || c == '\u200f'
                    || (c >= '\u2028' && c <= '\u202e') || (c >= '\u2066' && c <= '\u2069')) throw invalid();
        }
    }

    private static boolean nameSpace(char c) {
        return c <= 0x20 || c == '\u00a0' || c == '\u1680' || (c >= '\u2000' && c <= '\u200a')
                || c == '\u2028' || c == '\u2029' || c == '\u202f' || c == '\u205f' || c == '\u3000' || c == '\ufeff';
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> object(Object value, String... keys) throws IOException {
        if (!(value instanceof Map)) throw invalid();
        Map<String, Object> map = (Map<String, Object>) value;
        if (map.size() != keys.length) throw invalid();
        for (String key : keys) if (!map.containsKey(key)) throw invalid();
        return map;
    }
    private static double number(Object value, double min, double max) throws IOException {
        if (!(value instanceof Double)) throw invalid();
        double number = (Double) value;
        if (!Double.isFinite(number) || number < min || number > max) throw invalid();
        return number;
    }
    private static long uint32(byte[] bytes, int at) {
        return (bytes[at] & 255L) | ((bytes[at + 1] & 255L) << 8) | ((bytes[at + 2] & 255L) << 16) | ((bytes[at + 3] & 255L) << 24);
    }
    private static void readExactly(InputStream in, byte[] out, int length) throws IOException {
        int at = 0;
        while (at < length) {
            int count = in.read(out, at, length - at);
            if (count < 0) throw invalid();
            if (count == 0) { int next = in.read(); if (next < 0) throw invalid(); out[at++] = (byte) next; }
            else at += count;
        }
    }
    private static MessageDigest sha256() throws IOException {
        try { return MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException error) { throw new IOException("项目校验不可用。", error); }
    }
    static IOException invalid() { return new IOException("项目备份无效、已损坏或超过大小限制。"); }

    private static final class LimitedDigestInput extends InputStream {
        private final InputStream input;
        private final MessageDigest digest;
        private long remaining;
        LimitedDigestInput(InputStream input, long remaining, MessageDigest digest) { this.input = input; this.remaining = remaining; this.digest = digest; }
        @Override public int read() throws IOException {
            if (remaining == 0) return -1;
            int next = input.read();
            if (next == -1) throw invalid();
            remaining--; digest.update((byte) next); return next;
        }
        @Override public int read(byte[] bytes, int offset, int length) throws IOException {
            if (length == 0) return 0;
            if (remaining == 0) return -1;
            int count = input.read(bytes, offset, (int) Math.min(length, remaining));
            if (count < 0) throw invalid();
            if (count == 0) { bytes[offset] = (byte) read(); return 1; }
            remaining -= count; digest.update(bytes, offset, count); return count;
        }
    }
    private static final class ArrayCount { final int count; ArrayCount(int count) { this.count = count; } }

    /** Retains only the small envelope/source shell; operation data is validated without allocation. */
    private static final class Parser {
        private final BufferedReader input;
        private int next = -2, nodes, stringBytes;
        Parser(BufferedReader input) { this.input = input; }
        Object parse() throws IOException { Object result = value(0, true); space(); if (peek() != -1) throw invalid(); return result; }
        private int peek() throws IOException { if (next == -2) next = input.read(); return next; }
        private int get() throws IOException { int c = peek(); next = -2; return c; }
        private boolean take(int c) throws IOException { if (peek() != c) return false; get(); return true; }
        private void space() throws IOException { while (peek() == ' ' || peek() == '\n' || peek() == '\r' || peek() == '\t') get(); }
        private Object value(int depth, boolean keep) throws IOException {
            if (depth > MAX_DEPTH || ++nodes > MAX_NODES) throw invalid();
            space(); int c = peek();
            if (c == '{') {
                get(); Set<String> keys = new HashSet<>(); Map<String, Object> map = keep ? new LinkedHashMap<>() : null;
                space(); if (take('}')) return keep ? map : COMPOSITE;
                do {
                    space(); String key = string(true, 256);
                    if ("__proto__".equals(key) || "prototype".equals(key) || "constructor".equals(key)
                            || !keys.add(key) || keys.size() > 1024) throw invalid();
                    space(); if (!take(':')) throw invalid();
                    boolean childKeep = keep && depth < 3 && !"ops".equals(key) && !"redo".equals(key);
                    Object item = value(depth + 1, childKeep);
                    if (keep) map.put(key, item);
                    space(); if (take('}')) return keep ? map : COMPOSITE;
                } while (take(','));
                throw invalid();
            }
            if (c == '[') {
                get(); int count = 0; space(); if (take(']')) return new ArrayCount(0);
                do { value(depth + 1, false); count++; space(); if (take(']')) return new ArrayCount(count); } while (take(','));
                throw invalid();
            }
            if (c == '"') return string(keep, keep ? 4096 : MAX_STRING_BYTES);
            if (c == 't') { literal("true"); return Boolean.TRUE; }
            if (c == 'f') { literal("false"); return Boolean.FALSE; }
            if (c == 'n') { literal("null"); return null; }
            StringBuilder token = new StringBuilder();
            if (take('-')) token.append('-');
            if (take('0')) token.append('0');
            else { if (peek() < '1' || peek() > '9') throw invalid(); digits(token); }
            if (take('.')) { token.append('.'); if (!digit()) throw invalid(); digits(token); }
            if (peek() == 'e' || peek() == 'E') {
                token.append((char) get()); if (peek() == '+' || peek() == '-') token.append((char) get());
                if (!digit()) throw invalid(); digits(token);
            }
            try {
                double number = Double.parseDouble(token.toString());
                boolean nonzero = false;
                for (int i = 0; i < token.length() && token.charAt(i) != 'e' && token.charAt(i) != 'E'; i++)
                    if (token.charAt(i) >= '1' && token.charAt(i) <= '9') nonzero = true;
                if (!Double.isFinite(number) || (number == 0 && nonzero)) throw invalid();
                return number == 0 ? 0d : number;
            } catch (NumberFormatException error) { throw invalid(); }
        }
        private boolean digit() throws IOException { return peek() >= '0' && peek() <= '9'; }
        private void digits(StringBuilder out) throws IOException {
            while (digit()) { if (out.length() >= 128) throw invalid(); out.append((char) get()); }
        }
        private void literal(String text) throws IOException { for (int i = 0; i < text.length(); i++) if (get() != text.charAt(i)) throw invalid(); }
        private String string(boolean keep, int max) throws IOException {
            if (!take('"')) throw invalid();
            StringBuilder out = keep ? new StringBuilder() : null;
            int length = 0; boolean high = false;
            while (true) {
                int c = get(); if (c < 0 || c < 0x20) throw invalid();
                if (c == '"') { if (high) throw invalid(); return keep ? out.toString() : ""; }
                if (c == '\\') {
                    c = get();
                    switch (c) {
                        case '"': case '\\': case '/': break;
                        case 'b': c = '\b'; break; case 'f': c = '\f'; break; case 'n': c = '\n'; break;
                        case 'r': c = '\r'; break; case 't': c = '\t'; break;
                        case 'u':
                            c = 0;
                            for (int i = 0; i < 4; i++) {
                                int hex = get(); int digit = hex >= '0' && hex <= '9' ? hex - '0' : hex >= 'a' && hex <= 'f' ? hex - 'a' + 10 : hex >= 'A' && hex <= 'F' ? hex - 'A' + 10 : -1;
                                if (digit < 0) throw invalid(); c = c * 16 + digit;
                            }
                            break;
                        default: throw invalid();
                    }
                }
                if (high && !Character.isLowSurrogate((char) c)) throw invalid();
                if (!high && Character.isLowSurrogate((char) c)) throw invalid();
                int bytes = Character.isHighSurrogate((char) c) ? 0 : high ? 4 : c < 128 ? 1 : c < 2048 ? 2 : 3;
                high = Character.isHighSurrogate((char) c);
                length += bytes; stringBytes += bytes;
                if (length > max || stringBytes > MAX_MANIFEST_BYTES) throw invalid(); if (keep) out.append((char) c);
            }
        }
    }
}
