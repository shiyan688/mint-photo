package com.qingyan.editor;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Strict, bounded, photo-free JSON recipe boundary. No Android or external dependencies. */
final class PresetPayload {
    static final int MAX_BYTES = 64 * 1024;
    static final String MIME = "application/json";
    static final String FORMAT = "mint-adjustment-preset";
    static final String SUFFIX = ".mintpreset.json";
    static final int CHOOSER_INVALID = 0, CHOOSER_IMAGE = 1, CHOOSER_PRESET = 2;

    private PresetPayload() { }

    /** Never turn an unrelated or mixed accept request into a broad file picker. */
    static int chooserKind(String[] acceptTypes) {
        int kind = CHOOSER_INVALID;
        if (acceptTypes == null || acceptTypes.length == 0) return CHOOSER_IMAGE;
        for (String group : acceptTypes) {
            if (group == null || group.trim().isEmpty()) continue;
            for (String raw : group.split(",", -1)) {
                String type = raw.trim().toLowerCase(Locale.ROOT);
                int next;
                if (MIME.equals(type) || ".json".equals(type) || SUFFIX.equals(type)) {
                    next = CHOOSER_PRESET;
                } else if ("image/*".equals(type) || "image/jpeg".equals(type)
                        || "image/png".equals(type) || "image/webp".equals(type)
                        || "image/gif".equals(type) || "image/heic".equals(type)
                        || "image/heif".equals(type) || "image/bmp".equals(type)
                        || Arrays.asList(".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif", ".bmp").contains(type)) {
                    next = CHOOSER_IMAGE;
                } else return CHOOSER_INVALID;
                if (kind != CHOOSER_INVALID && kind != next) return CHOOSER_INVALID;
                kind = next;
            }
        }
        return kind == CHOOSER_INVALID ? CHOOSER_IMAGE : kind;
    }

    static boolean isJsonMime(String mime) {
        if (mime == null) return false;
        String type = mime.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        // Octet-stream is used by some document providers. It is permitted ONLY after the
        // same bounded UTF-8 and exact recipe validation as application/json.
        return MIME.equals(type) || "text/json".equals(type)
                || (type.startsWith("application/") && type.endsWith("+json"))
                || "application/octet-stream".equals(type);
    }

    static String fileName(String requested) {
        String base = requested == null ? "" : requested.substring(0, Math.min(requested.length(), 256)).trim();
        String lower = base.toLowerCase(Locale.ROOT);
        if (lower.endsWith(SUFFIX)) base = base.substring(0, base.length() - SUFFIX.length());
        else if (lower.endsWith(".json")) base = base.substring(0, base.length() - 5);
        // This is only an ACTION_CREATE_DOCUMENT suggestion, never a filesystem path.
        base = base.replaceAll("[^\\p{L}\\p{N} _().-]", "_").replaceAll("^[. ]+|[. ]+$", "");
        if (base.length() > 80) {
            base = base.substring(0, Character.isHighSurrogate(base.charAt(79)) ? 79 : 80).trim();
        }
        if (base.isEmpty()) base = "薄荷预设";
        return base + SUFFIX;
    }

    static byte[] validate(String json) throws IOException {
        if (json == null || json.isEmpty() || json.length() > MAX_BYTES) throw invalid();
        byte[] bytes;
        try {
            ByteBuffer encoded = StandardCharsets.UTF_8.newEncoder()
                    .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                    .encode(CharBuffer.wrap(json));
            if (encoded.remaining() > MAX_BYTES) throw invalid();
            bytes = new byte[encoded.remaining()];
            encoded.get(bytes);
        } catch (CharacterCodingException error) { throw invalid(); }
        validateShape(new Parser(json).parse());
        return bytes;
    }

    static byte[] read(InputStream input) throws IOException {
        if (input == null) throw invalid();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int count;
        while ((count = input.read(buffer, 0, Math.min(buffer.length, MAX_BYTES + 1 - out.size()))) != -1) {
            if (count == 0) { // Defensive handling of a provider that yields empty reads.
                int next = input.read();
                if (next == -1) break;
                out.write(next);
            } else out.write(buffer, 0, count);
            if (out.size() > MAX_BYTES) throw invalid();
        }
        byte[] bytes = out.toByteArray();
        String json;
        try {
            json = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException error) { throw invalid(); }
        validateShape(new Parser(json).parse());
        return bytes;
    }

    private static void validateShape(Object value) throws IOException {
        Map<String, Object> root = record(value, "format", "version", "name", "controls");
        if (!FORMAT.equals(root.get("format"))) throw invalid();
        double version = number(root.get("version"), 1, 3);
        if (version != Math.rint(version)) throw invalid();
        Object title = root.get("name");
        if (!(title instanceof String)) throw invalid();
        String name = (String) title;
        for (int i = 0; i < name.length(); i++) if (Character.isISOControl(name.charAt(i))) throw invalid();
        // Match the shared codec's String.trim() then Unicode code-point count. Java trim()
        // alone would retain NBSP, Unicode spaces and BOM; UTF-16 length would count emoji twice.
        int start = 0, end = name.length();
        while (start < end && nameSpace(name.charAt(start))) start++;
        while (end > start && nameSpace(name.charAt(end - 1))) end--;
        int nameLength = name.codePointCount(start, end);
        if (nameLength < 1 || nameLength > 48) throw invalid();
        // Keep historical versions exact: accepting a newer active control in an old
        // version would let it be silently dropped by legacy readers.
        Map<String, Object> controls = version == 1
                ? record(root.get("controls"), "basic", "beauty", "advancedTone")
                : version == 2
                ? record(root.get("controls"), "basic", "beauty", "levels", "advancedTone")
                : record(root.get("controls"), "basic", "beauty", "lightBalance", "levels", "advancedTone");
        if (version >= 2) validateLevels(controls.get("levels"));
        if (version == 3) validateLightBalance(controls.get("lightBalance"));
        Map<String, Object> basic = record(controls.get("basic"), "exposure", "contrast", "saturation", "temperature");
        for (Object entry : basic.values()) number(entry, -100, 100);
        Map<String, Object> beauty = record(controls.get("beauty"),
                "smooth", "brighten", "warmth", "underEye", "redness", "lip", "blush", "palette");
        for (String key : beauty.keySet()) if (!"palette".equals(key)) {
            number(beauty.get(key), "warmth".equals(key) ? -100 : 0, 100);
        }
        if (!Arrays.asList("natural", "peach", "rose").contains(beauty.get("palette"))) throw invalid();
        Object advanced = controls.get("advancedTone");
        if (advanced == null) return;
        Map<String, Object> tone = record(advanced, "version", "enabled", "strength", "curveMode", "curves", "hsl");
        number(tone.get("version"), 1, 1);
        if (!(tone.get("enabled") instanceof Boolean)) throw invalid();
        number(tone.get("strength"), 0, 1);
        if (!Arrays.asList("monotone", "free").contains(tone.get("curveMode"))) throw invalid();
        Map<String, Object> curves = record(tone.get("curves"), "rgb", "red", "green", "blue");
        for (Object curve : curves.values()) {
            double previous = -1;
            for (Object point : array(curve, 5)) {
                double next = number(point, 0, 1);
                if ("monotone".equals(tone.get("curveMode")) && next < previous) throw invalid();
                previous = next;
            }
        }
        for (Object band : array(tone.get("hsl"), 8)) {
            Map<String, Object> hsl = record(band, "hue", "saturation", "luminance");
            number(hsl.get("hue"), -30, 30);
            number(hsl.get("saturation"), -100, 100);
            number(hsl.get("luminance"), -100, 100);
        }
    }

    private static void validateLightBalance(Object value) throws IOException {
        if (value == null) return;
        Map<String, Object> light = record(value, "version", "shadows", "highlights", "whiteBalance");
        number(light.get("version"), 1, 1);
        number(light.get("shadows"), -100, 100);
        number(light.get("highlights"), -100, 100);
        Map<String, Object> gains = record(light.get("whiteBalance"), "r", "g", "b");
        for (Object gain : gains.values()) number(gain, .25, 4);
    }

    private static void validateLevels(Object value) throws IOException {
        if (value == null) return;
        Map<String, Object> levels = record(value, "version", "strength", "channels");
        number(levels.get("version"), 1, 1); number(levels.get("strength"), 0, 1);
        Map<String, Object> channels = record(levels.get("channels"), "rgb", "red", "green", "blue");
        for (Object channel : channels.values()) {
            Map<String, Object> c = record(channel, "inputBlack", "inputWhite", "gamma", "outputBlack", "outputWhite");
            for (String k : Arrays.asList("inputBlack", "inputWhite", "outputBlack", "outputWhite")) {
                double n = number(c.get(k), 0, 255); if (n != Math.rint(n)) throw invalid();
            }
            number(c.get("gamma"), .1, 10);
            if ((Double)c.get("inputBlack") >= (Double)c.get("inputWhite") || (Double)c.get("outputBlack") > (Double)c.get("outputWhite")) throw invalid();
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> record(Object value, String... keys) throws IOException {
        if (!(value instanceof Map)) throw invalid();
        Map<String, Object> record = (Map<String, Object>) value;
        if (record.size() != keys.length) throw invalid();
        for (String key : keys) if (!record.containsKey(key)) throw invalid();
        return record;
    }

    private static List<?> array(Object value, int length) throws IOException {
        if (!(value instanceof List) || ((List<?>) value).size() != length) throw invalid();
        return (List<?>) value;
    }

    private static double number(Object value, double min, double max) throws IOException {
        if (!(value instanceof Double)) throw invalid();
        double result = (Double) value;
        if (!Double.isFinite(result) || result < min || result > max) throw invalid();
        return result;
    }

    private static boolean nameSpace(char value) {
        // ECMAScript whitespace/line terminators. ISO control characters have already failed.
        return value == ' ' || value == '\t' || value == '\n' || value == '\r'
                || value == '\u000B' || value == '\f' || value == '\u00A0'
                || value == '\u1680' || (value >= '\u2000' && value <= '\u200A')
                || value == '\u2028' || value == '\u2029' || value == '\u202F'
                || value == '\u205F' || value == '\u3000' || value == '\uFEFF';
    }

    private static IOException invalid() {
        return new IOException("预设无效：仅支持 64 KB 内、不含照片的第 1、2 或 3 版薄荷调整预设。");
    }

    /** RFC 8259 subset with duplicate-key rejection and bounded depth/node count. */
    private static final class Parser {
        private final String text;
        private int at, nodes;
        Parser(String text) { this.text = text; }
        Object parse() throws IOException {
            Object value = value(0);
            space();
            if (at != text.length()) throw invalid();
            return value;
        }
        private Object value(int depth) throws IOException {
            if (depth > 12 || ++nodes > 4096) throw invalid();
            space();
            if (at >= text.length()) throw invalid();
            char c = text.charAt(at);
            if (c == '{') {
                at++;
                Map<String, Object> map = new LinkedHashMap<>();
                space();
                if (take('}')) return map;
                do {
                    space();
                    String key = string();
                    if (map.containsKey(key)) throw invalid();
                    space();
                    if (!take(':')) throw invalid();
                    map.put(key, value(depth + 1));
                    space();
                    if (take('}')) return map;
                } while (take(','));
                throw invalid();
            }
            if (c == '[') {
                at++;
                List<Object> list = new ArrayList<>();
                space();
                if (take(']')) return list;
                do {
                    list.add(value(depth + 1));
                    space();
                    if (take(']')) return list;
                } while (take(','));
                throw invalid();
            }
            if (c == '"') return string();
            if (literal("true")) return Boolean.TRUE;
            if (literal("false")) return Boolean.FALSE;
            if (literal("null")) return null;
            int start = at;
            take('-');
            if (!take('0')) {
                if (at >= text.length() || text.charAt(at) < '1' || text.charAt(at) > '9') throw invalid();
                while (digit()) at++;
            }
            if (take('.')) {
                if (!digit()) throw invalid();
                while (digit()) at++;
            }
            if (take('e') || take('E')) {
                if (!take('+')) take('-');
                if (!digit()) throw invalid();
                while (digit()) at++;
            }
            try {
                if (at - start > 128) throw invalid();
                String token = text.substring(start, at);
                boolean nonzeroMantissa = false;
                for (int i = 0; i < token.length(); i++) {
                    char digit = token.charAt(i);
                    if (digit == 'e' || digit == 'E') break;
                    if (digit >= '1' && digit <= '9') nonzeroMantissa = true;
                }
                double number = Double.parseDouble(token);
                if (!Double.isFinite(number) || (number == 0 && nonzeroMantissa)) throw invalid();
                return number == 0 ? 0.0 : number;
            } catch (NumberFormatException error) { throw invalid(); }
        }
        private String string() throws IOException {
            if (!take('"')) throw invalid();
            StringBuilder out = new StringBuilder();
            while (at < text.length()) {
                char c = text.charAt(at++);
                if (c == '"') {
                    for (int i = 0; i < out.length(); i++) {
                        char value = out.charAt(i);
                        if (Character.isHighSurrogate(value)) {
                            if (++i >= out.length() || !Character.isLowSurrogate(out.charAt(i))) throw invalid();
                        } else if (Character.isLowSurrogate(value)) throw invalid();
                    }
                    return out.toString();
                }
                if (c < 0x20) throw invalid();
                if (c == '\\') {
                    if (at >= text.length()) throw invalid();
                    c = text.charAt(at++);
                    switch (c) {
                        case '"': case '\\': case '/': break;
                        case 'b': c = '\b'; break;
                        case 'f': c = '\f'; break;
                        case 'n': c = '\n'; break;
                        case 'r': c = '\r'; break;
                        case 't': c = '\t'; break;
                        case 'u':
                            if (at + 4 > text.length()) throw invalid();
                            int code = 0;
                            for (int i = 0; i < 4; i++) {
                                char hex = text.charAt(at++);
                                int digit = hex >= '0' && hex <= '9' ? hex - '0'
                                        : hex >= 'a' && hex <= 'f' ? hex - 'a' + 10
                                        : hex >= 'A' && hex <= 'F' ? hex - 'A' + 10 : -1;
                                if (digit < 0) throw invalid();
                                code = code * 16 + digit;
                            }
                            c = (char) code;
                            break;
                        default: throw invalid();
                    }
                }
                out.append(c);
            }
            throw invalid();
        }
        private boolean digit() { return at < text.length() && text.charAt(at) >= '0' && text.charAt(at) <= '9'; }
        private boolean take(char c) {
            if (at >= text.length() || text.charAt(at) != c) return false;
            at++; return true;
        }
        private boolean literal(String word) {
            if (!text.startsWith(word, at)) return false;
            at += word.length(); return true;
        }
        private void space() {
            while (at < text.length()) {
                char c = text.charAt(at);
                if (c != ' ' && c != '\n' && c != '\r' && c != '\t') return;
                at++;
            }
        }
    }
}
