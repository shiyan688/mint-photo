package com.qingyan.editor;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** No test dependencies: compile with PresetPayload.java and run on the installed JDK. */
public final class PresetPayloadTest {
    private static int checks;
    private static final String VALID = "{\"format\":\"mint-adjustment-preset\",\"version\":1,\"name\":\"自然柔光\","
            + "\"controls\":{\"basic\":{\"exposure\":0,\"contrast\":0,\"saturation\":0,\"temperature\":0},"
            + "\"beauty\":{\"smooth\":0,\"brighten\":0,\"warmth\":0,\"underEye\":0,\"redness\":0,\"lip\":0,\"blush\":0,\"palette\":\"natural\"},\"advancedTone\":null}}";

    public static void main(String[] args) throws Exception {
        check(Arrays.equals(VALID.getBytes(StandardCharsets.UTF_8), PresetPayload.validate(VALID)), "UTF-8 export round-trip");
        check(Arrays.equals(PresetPayload.validate(VALID), PresetPayload.read(stream(VALID))), "Import round-trip");
        valid(" \r\n\t" + VALID + "\n");
        valid(VALID.replace("自然柔光", "\uD83C\uDF3F 柔光"));
        valid(VALID.replace("自然柔光", "\\uD83C\\uDF3F 柔光"));
        for (String unit : new String[]{"a", "汉", "\uD83C\uDF3F", "\\uD83C\\uDF3F"}) {
            valid(VALID.replace("自然柔光", unit.repeat(48)));
            reject(() -> PresetPayload.validate(VALID.replace("自然柔光", unit.repeat(49))),
                    "Name rejects 49 Unicode code points");
        }
        valid(VALID.replace("自然柔光", "a".repeat(47) + "\uD83C\uDF3F"));
        reject(() -> PresetPayload.validate(VALID.replace("自然柔光", "a".repeat(48) + "\uD83C\uDF3F")),
                "Mixed ASCII/emoji count is not UTF-16 length");
        for (String whitespace : new String[]{" ", "\u00A0", "\u1680", "\u2003", "\u2028", "\u2029", "\u202F", "\u205F", "\u3000", "\uFEFF"}) {
            valid(VALID.replace("自然柔光", whitespace + "\uD83C\uDF3F".repeat(48) + whitespace));
            reject(() -> PresetPayload.validate(VALID.replace("自然柔光", whitespace)),
                    "Whitespace-only name is empty after ECMAScript trim");
            reject(() -> PresetPayload.validate(VALID.replace("自然柔光", whitespace + "a".repeat(49) + whitespace)),
                    "Trimmed name still rejects 49 code points");
        }
        valid(VALID.replace("\"exposure\":0", "\"exposure\":-1.25e+1"));
        valid(VALID.replace("\"warmth\":0", "\"warmth\":-100"));
        String curve = "{\"version\":1,\"enabled\":true,\"strength\":0.75,\"curveMode\":\"monotone\","
                + "\"curves\":{\"rgb\":[0,0.25,0.5,0.75,1],\"red\":[0,0.25,0.5,0.75,1],"
                + "\"green\":[0,0.25,0.5,0.75,1],\"blue\":[0,0.25,0.5,0.75,1]},"
                + "\"hsl\":[" + String.join(",", java.util.Collections.nCopies(8, "{\"hue\":0,\"saturation\":0,\"luminance\":0}")) + "]}";
        String advanced = VALID.replace("\"advancedTone\":null", "\"advancedTone\":" + curve);
        valid(advanced);
        valid(advanced.replace("monotone", "free").replace("[0,0.25,0.5,0.75,1]", "[1,0.2,0.8,0.1,0]"));
        valid(advanced.replace("\"enabled\":true", "\"enabled\":false"));

        for (String bad : new String[]{"", "null", "[]", "true", "{}", "NaN", "{}{}", "\uFEFF" + VALID,
                VALID + "false", "/*comment*/" + VALID, VALID.replace("\"name\"", "name"),
                VALID.replace("\"name\"", "'name'"), VALID.replace("\"name\"", "\"name\":\"x\",\"name\""),
                VALID.replace("\"name\"", "\"na\\u006de\":\"x\",\"name\""),
                VALID.replace("\"exposure\":0", "\"exposure\":0,\"exposure\":1"),
                VALID.replace("\"version\":1", "\"version\":2"), VALID.replace("\"version\":1", "\"version\":\"1\""),
                VALID.replace("mint-adjustment-preset", "mint-photo-project"),
                VALID.replace("\"controls\":", "\"photo\":\"data:image/png;base64,AAAA\",\"controls\":"),
                VALID.replace("\"controls\":", "\"path\":\"/tmp/photo\",\"controls\":"),
                VALID.replace("\"basic\":", "\"sourceId\":\"private\",\"basic\":"),
                VALID.replace("\"palette\":\"natural\"", "\"palette\":\"natural\",\"landmarks\":[]"),
                VALID.replace("\"exposure\":0,", ""), VALID.replace("\"exposure\":0", "\"brightness\":0"),
                VALID.replace("\"exposure\":0", "\"exposure\":{}"), VALID.replace("\"exposure\":0", "\"exposure\":true"),
                VALID.replace("\"exposure\":0", "\"exposure\":1e309"), VALID.replace("\"exposure\":0", "\"exposure\":100.1"),
                VALID.replace("\"exposure\":0", "\"exposure\":-101"), VALID.replace("\"exposure\":0", "\"exposure\":01"),
                VALID.replace("\"exposure\":0", "\"exposure\":+1"), VALID.replace("\"exposure\":0", "\"exposure\":.1"),
                VALID.replace("\"exposure\":0", "\"exposure\":1."), VALID.replace("\"exposure\":0", "\"exposure\":0x0"),
                VALID.replace("\"exposure\":0", "\"exposure\":NaN"), VALID.replace("\"warmth\":0", "\"warmth\":-101"),
                VALID.replace("\"smooth\":0", "\"smooth\":-1"), VALID.replace("\"palette\":\"natural\"", "\"palette\":\"data:image/png\""),
                VALID.replace("自然柔光", ""), VALID.replace("自然柔光", "   "), VALID.replace("自然柔光", "x".repeat(97)),
                VALID.replace("自然柔光", "a\\nb"), VALID.replace("自然柔光", "a\nb"), VALID.replace("自然柔光", "\\u007f"),
                VALID.replace("自然柔光", "\\uD800"), VALID.replace("自然柔光", "\\uDC00"), VALID.replace("自然柔光", "\uD800"),
                VALID.replace("自然柔光", "\\x41"), VALID.replace("自然柔光", "\\uZZZZ"), VALID.replace("自然柔光", "\\u１２３４"),
                advanced.replace("\"enabled\":true", "\"enabled\":1"), advanced.replace("monotone", "cubic"),
                advanced.replace("[0,0.25,0.5,0.75,1]", "[0,0.75,0.5,0.25,1]"),
                advanced.replace("[0,0.25,0.5,0.75,1]", "[0,0.25,0.5,1]"),
                advanced.replace("\"hue\":0", "\"hue\":31"), advanced.replace("\"strength\":0.75", "\"strength\":1.01"),
                advanced.replace("\"luminance\":0", "\"luminance\":0,\"image\":\"secret\""),
                VALID.substring(0, VALID.length() - 1) + ",}",
                VALID.replace("\"advancedTone\":null", "\"advancedTone\":" + "[".repeat(30) + "0" + "]".repeat(30))}) {
            reject(() -> PresetPayload.validate(bad), "Reject malformed, private or unsupported recipe");
        }
        reject(() -> PresetPayload.validate(null), "Reject null string");
        reject(() -> PresetPayload.read(null), "Reject null stream");
        reject(() -> PresetPayload.read(new ByteArrayInputStream(new byte[]{(byte)0xC3, (byte)0x28})), "Reject malformed UTF-8");
        reject(() -> PresetPayload.read(new ByteArrayInputStream(new byte[]{(byte)0xED, (byte)0xA0, (byte)0x80})), "Reject UTF-8 surrogate");
        String exact = VALID + " ".repeat(PresetPayload.MAX_BYTES - VALID.getBytes(StandardCharsets.UTF_8).length);
        check(PresetPayload.validate(exact).length == PresetPayload.MAX_BYTES, "Exactly 64 KiB export");
        check(PresetPayload.read(stream(exact)).length == PresetPayload.MAX_BYTES, "Exactly 64 KiB import");
        reject(() -> PresetPayload.validate(exact + " "), "Reject 64 KiB plus one byte export");
        reject(() -> PresetPayload.read(stream(exact + " ")), "Reject 64 KiB plus one byte import");
        CountingStream huge = new CountingStream();
        reject(() -> PresetPayload.read(huge), "Reject unlimited provider");
        check(huge.count == PresetPayload.MAX_BYTES + 1, "Read no more than 64 KiB plus one byte");
        reject(() -> PresetPayload.validate(VALID.replace("自然柔光", "汉".repeat(22000))), "UTF-8 bytes, not character count");

        for (String type : new String[]{"application/json", "text/json", "APPLICATION/JSON; charset=utf-8", "application/vnd.mint+json", "application/octet-stream"}) {
            check(PresetPayload.isJsonMime(type), "Allow JSON MIME with schema gate");
        }
        for (String type : new String[]{null, "", "text/plain", "image/png", "image/svg+xml", "text/html", "*/*"}) {
            check(!PresetPayload.isJsonMime(type), "Reject unrelated provider MIME");
        }
        check(PresetPayload.chooserKind(new String[]{"application/json", ".json"}) == PresetPayload.CHOOSER_PRESET, "JSON accept list");
        check(PresetPayload.chooserKind(new String[]{"application/json,.json"}) == PresetPayload.CHOOSER_PRESET, "Comma JSON accept list");
        check(PresetPayload.chooserKind(new String[]{".mintpreset.json"}) == PresetPayload.CHOOSER_PRESET, "Preset extension");
        check(PresetPayload.chooserKind(new String[]{"image/*"}) == PresetPayload.CHOOSER_IMAGE, "Photo accept unchanged");
        check(PresetPayload.chooserKind(new String[]{".png", "image/jpeg"}) == PresetPayload.CHOOSER_IMAGE, "Specific photo types");
        check(PresetPayload.chooserKind(new String[]{""}) == PresetPayload.CHOOSER_IMAGE, "Empty accept remains photo-only");
        for (String[] types : new String[][]{{"*/*"}, {"text/html"}, {"application/octet-stream"}, {"text/plain", ".json"}, {"image/*", ".json"}, {"image/svg+xml"}, {"application/json,"}}) {
            check(PresetPayload.chooserKind(types) == PresetPayload.CHOOSER_INVALID, "Reject broadened accept request");
        }
        check("柔光.mintpreset.json".equals(PresetPayload.fileName("柔光")), "Preset filename suffix");
        check("柔光.mintpreset.json".equals(PresetPayload.fileName("柔光.MINTPRESET.JSON")), "Normalize preset suffix");
        check("柔光.mintpreset.json".equals(PresetPayload.fileName("柔光.json")), "Normalize generic JSON suffix");
        check("薄荷预设.mintpreset.json".equals(PresetPayload.fileName(null)), "Default preset filename");
        String safe = PresetPayload.fileName("../folder\\photo\u0000?*.json");
        check(!safe.contains("/") && !safe.contains("\\") && !safe.contains("\u0000") && !safe.startsWith("."), "Sanitize paths and control chars");
        check(PresetPayload.fileName("x".repeat(1000)).length() <= 80 + PresetPayload.SUFFIX.length(), "Bound filename");
        String v2 = VALID.replace("\"version\":1", "\"version\":2").replace("\"advancedTone\":null", "\"levels\":null,\"advancedTone\":null");
        valid(v2); check(Arrays.equals(v2.getBytes(StandardCharsets.UTF_8), PresetPayload.read(stream(v2))), "v2 original UTF-8 bytes retained");
        String channel = "{\"inputBlack\":0,\"inputWhite\":255,\"gamma\":1,\"outputBlack\":0,\"outputWhite\":255}";
        String lvl = "{\"version\":1,\"strength\":1,\"channels\":{\"rgb\":" + channel + ",\"red\":" + channel + ",\"green\":" + channel + ",\"blue\":" + channel + "}}";
        String withLevels = v2.replace("\"levels\":null", "\"levels\":" + lvl);
        valid(withLevels); valid(withLevels.replace("\"gamma\":1", "\"gamma\":0.1")); valid(withLevels.replace("\"gamma\":1", "\"gamma\":10"));
        valid(withLevels.replace("\"outputBlack\":0", "\"outputBlack\":255"));
        valid(withLevels.replace("\"strength\":1", "\"strength\":0"));
        for (String key : new String[]{"inputBlack","inputWhite","outputBlack","outputWhite"}) {
            String old = "\""+key+"\":"+(key.endsWith("Black")?"0":"255");
            for (String n : new String[]{"-1","256","12.5","null","true","\"1\""}) reject(() -> PresetPayload.validate(withLevels.replace(old,"\""+key+"\":"+n)), "reject invalid levels integer "+key);
        }
        for (String n : new String[]{"0","0.09","10.01","null","true","\"1\"","1e999"}) reject(() -> PresetPayload.validate(withLevels.replace("\"gamma\":1","\"gamma\":"+n)), "reject invalid gamma");
        for (String n : new String[]{"-0.1","1.1","null","true","\"1\""}) reject(() -> PresetPayload.validate(withLevels.replace("\"strength\":1","\"strength\":"+n)), "reject invalid strength");
        reject(() -> PresetPayload.validate(withLevels.replace("\"inputBlack\":0","\"inputBlack\":255")), "reject equal inputs");
        reject(() -> PresetPayload.validate(withLevels.replace("\"outputWhite\":255","\"outputWhite\":2").replace("\"outputBlack\":0","\"outputBlack\":3")), "reject reversed outputs");
        reject(() -> PresetPayload.validate(withLevels.replace("\"gamma\":1","\"gamma\":1,\"gamma\":2")), "reject duplicate nested levels field");
        reject(() -> PresetPayload.validate(withLevels.replace("\"gamma\":1,","")), "reject missing levels field");
        reject(() -> PresetPayload.validate(withLevels.replace("\"gamma\":1","\"gamma\":1,\"enabled\":true")), "reject unknown levels field");
        reject(() -> PresetPayload.validate(VALID.replace("\"advancedTone\":null","\"levels\":null,\"advancedTone\":null")), "v1 cannot smuggle v2 field");
        reject(() -> PresetPayload.validate(v2.replace("\"version\":2","\"version\":3")), "v3 requires explicit lightBalance");
        reject(() -> PresetPayload.validate(v2.replace("\"version\":2","\"version\":1.5")), "reject fractional version");
        // Match the shared strict JSON codec before accepting bytes from Android SAF.
        for (String doc : new String[]{VALID, v2, withLevels}) {
            for (String n : new String[]{"1e-999", "-1e-999", "1e-324", "0." + "0".repeat(126) + "1", "0e" + "0".repeat(127)})
                reject(() -> PresetPayload.validate(doc.replace("\"exposure\":0", "\"exposure\":" + n)), "reject underflow or oversized token in v1/v2");
            for (String n : new String[]{"0e-999", "-0e-999", "5e-324", "0." + "0".repeat(126)})
                valid(doc.replace("\"exposure\":0", "\"exposure\":" + n));
        }
        reject(() -> PresetPayload.validate(withLevels.replace("\"strength\":1", "\"strength\":1e-999")), "reject levels underflow");
        lightBalanceChecks(v2, withLevels, curve);
        System.out.println("PASS: " + checks + " native preset boundary checks");
    }

    private static void lightBalanceChecks(String v2, String withLevels, String curve) throws Exception {
        String v3 = v2.replace("\"version\":2", "\"version\":3")
                .replace("\"levels\":null", "\"lightBalance\":null,\"levels\":null");
        String light = "{\"version\":1,\"shadows\":0,\"highlights\":0,\"whiteBalance\":{\"r\":1,\"g\":1,\"b\":1}}";
        String identity = v3.replace("\"lightBalance\":null", "\"lightBalance\":" + light);
        String active = identity.replace("\"shadows\":0", "\"shadows\":42.5")
                .replace("\"highlights\":0", "\"highlights\":-31.25")
                .replace("\"r\":1", "\"r\":1.125").replace("\"b\":1", "\"b\":0.875");
        String combined = withLevels.replace("\"version\":2", "\"version\":3")
                .replace("\"levels\":", "\"lightBalance\":" + light + ",\"levels\":")
                .replace("\"advancedTone\":null", "\"advancedTone\":" + curve);
        for (String doc : new String[]{v3, identity, active, combined, " \r\n\t" + active + "\n"}) {
            boundaryValid(doc, "v3 null, identity, active and combined recipes retain exact original bytes");
        }
        for (String key : new String[]{"shadows", "highlights"}) {
            String field = "\"" + key + "\":0";
            for (String n : new String[]{"-100", "-0.25", "-0", "0", "0.25", "100", "5e-324", "-5e-324", "0e-999", "-0e-999"}) {
                boundaryValid(identity.replace(field, "\"" + key + "\":" + n), "valid light-balance control " + key);
            }
            for (String n : new String[]{"-100.01", "100.01", "null", "true", "\"1\"", "{}", "[]", "1e309", "-1e309", "NaN", "Infinity", "1e-999", "-1e-999", "1e-324", "0." + "0".repeat(127), "0e" + "0".repeat(127)}) {
                boundaryReject(identity.replace(field, "\"" + key + "\":" + n), "reject invalid light-balance control " + key);
            }
            boundaryReject(identity.replace(field + ",", ""), "reject missing " + key);
            boundaryReject(identity.replace(field, field + "," + field), "reject duplicate " + key);
        }
        for (String key : new String[]{"r", "g", "b"}) {
            String field = "\"" + key + "\":1";
            for (String n : new String[]{"0.25", "0.25000000000000006", "1", "1.125", "3.9999999999999996", "4", "25e-2", "4e0"}) {
                boundaryValid(identity.replace(field, "\"" + key + "\":" + n), "valid white-balance gain " + key);
            }
            for (String n : new String[]{"-1", "0", "0.24999999999999997", "4.000000000000001", "null", "false", "\"1\"", "{}", "[]", "1e309", "1e-999", "NaN"}) {
                boundaryReject(identity.replace(field, "\"" + key + "\":" + n), "reject invalid white-balance gain " + key);
            }
            boundaryReject(identity.replace(field, field + "," + field), "reject duplicate gain " + key);
        }
        for (String doc : new String[]{
                v3.replace("\"lightBalance\":null,", ""),
                v3.replace("\"levels\":null,", ""),
                v3.replace("\"advancedTone\":null", "\"advancedTone\":null,\"unsupportedActive\":1"),
                v3.replace("\"lightBalance\":null", "\"lightBalance\":null,\"lightBalance\":null"),
                v3.replace("\"lightBalance\":null", "\"lightBalance\":null,\"lightBala\\u006ece\":null"),
                identity.replace("\"shadows\":0", "\"shadows\":0,\"sha\\u0064ows\":1"),
                identity.replace("\"r\":1", "\"r\":1,\"\\u0072\":2"),
                identity.replace("\"r\":1,", ""),
                identity.replace("\"g\":1,", ""),
                identity.replace(",\"b\":1", ""),
                identity.replace("\"whiteBalance\":{\"r\":1,\"g\":1,\"b\":1}", "\"whiteBalance\":null"),
                identity.replace(",\"whiteBalance\":{\"r\":1,\"g\":1,\"b\":1}", ""),
                identity.replace(light, light.replace("\"version\":1,", "")),
                identity.replace(light, light.replace("\"version\":1", "\"version\":2")),
                identity.replace(light, light.replace("\"version\":1", "\"version\":1.5")),
                identity.replace(light, light.replace("\"version\":1", "\"version\":\"1\"")),
                combined.replace("\"gamma\":1", "\"gamma\":0"),
                combined.replace("\"enabled\":true", "\"enabled\":1"),
                active.replace("\"version\":3", "\"version\":4"),
                active.replace("\"version\":3", "\"version\":2.5"),
                active.replace("\"version\":3", "\"version\":\"3\""),
                active.replace("\"version\":3", "\"version\":2"),
                v3.replace("\"version\":3", "\"version\":1"),
                VALID.replace("\"advancedTone\":null", "\"lightBalance\":null,\"advancedTone\":null"),
                VALID.replace("\"advancedTone\":null", "\"lightBalance\":" + light + ",\"advancedTone\":null"),
                v2.replace("\"levels\":null", "\"lightBalance\":null,\"levels\":null")}) {
            boundaryReject(doc, "reject v3 shape, duplicate, migration or unsupported active fields");
        }
        for (String value : new String[]{"true", "1", "\"identity\"", "[]", "{}"}) {
            boundaryReject(v3.replace("\"lightBalance\":null", "\"lightBalance\":" + value), "reject nonrecipe lightBalance");
            boundaryReject(identity.replace("{\"r\":1,\"g\":1,\"b\":1}", value), "reject nonrecord whiteBalance");
        }
        // Persist controls only, never patch diagnostics, photos, locations or source identity.
        for (String key : new String[]{"enabled", "strength", "temperature", "tint", "sample", "sampleX", "sampleY", "coordinates", "pixels", "photo", "path", "sourceId", "__proto__", "constructor", "prototype"}) {
            boundaryReject(identity.replace("\"shadows\":0", "\"shadows\":0,\"" + key + "\":1"), "reject unsupported recipe field " + key);
            boundaryReject(identity.replace("\"r\":1", "\"r\":1,\"" + key + "\":1"), "reject unsupported gain field " + key);
        }
        // New schema still traverses the same bounded strict JSON parser.
        for (String n : new String[]{"1e-999", "-1e-999", "1e-324", "0e" + "0".repeat(127)}) {
            boundaryReject(v3.replace("\"exposure\":0", "\"exposure\":" + n), "v3 rejects basic underflow and oversized tokens");
        }
        for (String n : new String[]{"0e-999", "-0e-999", "5e-324", "0." + "0".repeat(126)}) {
            boundaryValid(v3.replace("\"exposure\":0", "\"exposure\":" + n), "v3 preserves valid basic zero and subnormal tokens");
        }
        String exact = active + " ".repeat(PresetPayload.MAX_BYTES - active.getBytes(StandardCharsets.UTF_8).length);
        boundaryValid(exact, "v3 allows exactly 64 KiB");
        boundaryReject(exact + " ", "v3 rejects more than 64 KiB");
    }

    private static void boundaryValid(String text, String label) throws IOException {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        check(Arrays.equals(bytes, PresetPayload.validate(text)), label + " (export)");
        check(Arrays.equals(bytes, PresetPayload.read(stream(text))), label + " (import)");
    }
    private static void boundaryReject(String text, String label) throws Exception {
        reject(() -> PresetPayload.validate(text), label + " (export)");
        reject(() -> PresetPayload.read(stream(text)), label + " (import)");
    }

    private static InputStream stream(String text) { return new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)); }
    private static void valid(String text) throws IOException { PresetPayload.validate(text); checks++; }
    private static void check(boolean condition, String label) { if (!condition) throw new AssertionError(label); checks++; }
    private static void reject(Throwing action, String label) throws Exception {
        try { action.run(); } catch (IOException expected) { checks++; return; }
        throw new AssertionError(label);
    }
    private interface Throwing { void run() throws Exception; }
    private static final class CountingStream extends InputStream {
        int count;
        @Override public int read() { count++; return ' '; }
        @Override public int read(byte[] bytes, int offset, int length) {
            Arrays.fill(bytes, offset, offset + length, (byte)' '); count += length; return length;
        }
    }
}
