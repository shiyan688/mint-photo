package com.qingyan.editor;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;

/** JVM-only boundaries and transport state; does not claim Android runtime/picker coverage. */
public final class ProjectBackupPayloadTest {
    private static int checks;
    private static final byte[] PNG = new byte[]{(byte) 137,80,78,71,13,10,26,10,0,0,0,0,73,72,68,82};
    private static final String VALID = "{\"format\":\"mint-photo-project\",\"version\":1,\"name\":\"自然项目\",\"record\":{\"version\":2,\"source\":{\"blob\":null,\"name\":\"原图.png\",\"width\":1,\"height\":1,\"mime\":\"image/png\",\"origin\":\"original\"},\"ops\":[],\"redo\":[]}}";

    public static void main(String[] args) throws Exception {
        for (String file : args) { try (InputStream in = Files.newInputStream(new File(file).toPath())) { ProjectBackupPayload.read(in); checks++; } }
        byte[] valid = container(VALID, PNG);
        valid(valid);
        valid(container(VALID.replace("image/png", "application/octet-stream"), PNG));
        valid(container(VALID.replace("\"version\":2,\"source\":{\"blob\":null,\"name\":\"原图.png\",\"width\":1,\"height\":1,\"mime\":\"image/png\",\"origin\":\"original\"}", "\"version\":1,\"blob\":null,\"name\":\"旧照片\""), PNG));
        for (String mime : new String[]{"image/jpeg", "image/webp"}) {
            byte[] source = mime.equals("image/jpeg") ? new byte[]{-1,-40,-1,0,0,0,0,0,0,0,0,0}
                    : new byte[]{82,73,70,70,4,0,0,0,87,69,66,80};
            valid(container(VALID.replace("image/png", mime), source));
        }
        for (int i = 0; i < valid.length; i++) {
            final int length = i;
            reject(() -> valid(Arrays.copyOf(valid, length)), "every truncation boundary " + i);
        }
        for (int i : new int[]{0,7,8,12,16,47,48,79,80,valid.length-1}) {
            byte[] corrupt = valid.clone(); corrupt[i] ^= 1;
            reject(() -> valid(corrupt), "corruption at " + i);
        }
        reject(() -> valid(Arrays.copyOf(valid, valid.length + 1)), "extra trailing bytes");
        for (long length : new long[]{0, 24L * 1024 * 1024 + 1, 0xffffffffL}) {
            byte[] bad = valid.clone(); put32(bad, 8, length);
            reject(() -> valid(bad), "manifest length bound");
        }
        for (long length : new long[]{0, 40L * 1024 * 1024 + 1, 0xffffffffL}) {
            byte[] bad = valid.clone(); put32(bad, 12, length);
            reject(() -> valid(bad), "source length bound");
        }
        byte[] tooLarge = valid.clone(); put32(tooLarge,8,ProjectBackupPayload.MAX_MANIFEST_BYTES); put32(tooLarge,12,ProjectBackupPayload.MAX_SOURCE_BYTES);
        reject(() -> valid(tooLarge), "total includes header");
        for (String bad : new String[]{"", "null", "[]", VALID+"{}", "\ufeff"+VALID,
                VALID.replace("\"name\":\"自然项目\"", "\"name\":\"自然项目\",\"name\":\"重复\""),
                VALID.replace("\"name\":\"自然项目\"", "\"na\\u006de\":\"自然项目\",\"name\":\"重复\""),
                VALID.replace("\"blob\":null", "\"blob\":\"AAAA\""),
                VALID.replace("\"ops\":[]", "\"ops\":null"),
                VALID.replace("\"ops\":[]", "\"ops\":[{\"x\":1,\"x\":2}]"),
                VALID.replace("\"ops\":[]", "\"ops\":[{\"x\":1e309}]"),
                VALID.replace("\"ops\":[]", "\"ops\":[{\"x\":1e-400}]"),
                VALID.replace("\"ops\":[]", "\"ops\":[{\"x\":NaN}]"),
                VALID.replace("\"ops\":[]", "\"ops\":[{\"x\":01}]"),
                VALID.replace("\"ops\":[]", "\"ops\":[{\"x\":\"\\ud800\"}]"),
                VALID.replace("\"ops\":[]", "\"ops\":[{\"x\":\"\\udc00\"}]"),
                VALID.replace("\"width\":1", "\"width\":1.1"),
                VALID.replace("\"height\":1", "\"height\":1000001"),
                VALID.replace("\"width\":1,\"height\":1", "\"width\":10000,\"height\":10000"),
                VALID.replace("\"version\":2", "\"version\":3"),
                VALID.replace("\"version\":2", "\"version\":1.5"),
                VALID.replace("\"origin\":\"original\"", "\"origin\":\"remote\""),
                VALID.replace("\"source\":", "\"path\":\"/tmp/private\",\"source\":"),
                VALID.replace("image/png", "image/svg+xml"), VALID.replace("image/png", "image/jpeg")}) {
            reject(() -> valid(container(bad, PNG)), "invalid manifest");
        }
        // Reject dangerous object keys at every layer, including escaped equivalents,
        // while preserving those words when they are ordinary string content.
        for (String key : new String[]{"__proto__", "prototype", "constructor", "__pro\\u0074o__", "proto\\u0074ype", "constr\\u0075ctor"}) {
            for (String json : new String[]{
                    VALID.replace("\"format\":", "\"" + key + "\":0,\"format\":"),
                    VALID.replace("\"source\":", "\"" + key + "\":0,\"source\":"),
                    VALID.replace("\"width\":1", "\"width\":1,\"" + key + "\":0"),
                    VALID.replace("\"ops\":[]", "\"ops\":[{\"" + key + "\":0}]"),
                    VALID.replace("\"redo\":[]", "\"redo\":[{\"nested\":[{\"" + key + "\":0}]}]")}) {
                reject(() -> valid(container(json, PNG)), "unsafe object key at any depth");
            }
        }
        for (String content : new String[]{"__proto__", "prototype", "constructor"}) {
            valid(container(VALID.replace("自然项目", content), PNG));
            valid(container(VALID.replace("\"ops\":[]", "\"ops\":[{\"text\":\"" + content + "\"}]"), PNG));
        }
        for (String name : new String[]{"", " ", " a", "a ", "a\u0085", "a\u061c", "a\u202e", "a\u2069", "e\u0301", "a".repeat(81)})
            reject(() -> valid(container(VALID.replace("自然项目", name), PNG)), "unsafe project name");
        valid(container(VALID.replace("自然项目", "🌿".repeat(80)), PNG));
        valid(container(VALID.replace("\"ops\":[]", "\"ops\":[{\"x\":1e30,\"y\":-0e999}]"), PNG));
        valid(container(VALID.replace("\"ops\":[]", "\"ops\":[{\"x\":\"\\ud83c\\udf3f\"}]"), PNG));
        String deep = "[".repeat(65) + "0" + "]".repeat(65);
        reject(() -> valid(container(VALID.replace("\"ops\":[]", "\"ops\":" + deep), PNG)), "depth bound");
        reject(() -> valid(container(VALID.replace("\"ops\":[]", "\"ops\":[" + "0,".repeat(60)+"0]"), PNG)), "history bound");
        reject(() -> valid(container(VALID.replace("\"ops\":[]", "\"ops\":[{\""+"汉".repeat(86)+"\":0}]"), PNG)), "UTF8 key bound");
        reject(() -> valid(container(VALID.replace("\"ops\":[]", "\"ops\":[{\"x\":\""+"a".repeat(ProjectBackupPayload.MAX_STRING_BYTES+1)+"\"}]"), PNG)), "string bound");
        byte[] utf8 = VALID.getBytes(StandardCharsets.UTF_8); utf8[utf8.length-4] = (byte)0xff;
        reject(() -> valid(container(utf8, PNG)), "strict UTF8 even with matching hash");
        reject(() -> valid(container(VALID, new byte[16])), "source magic");
        // Readers may report unknown lengths, tiny reads, and intermittent zero reads.
        ProjectBackupPayload.read(new InputStream() { int i; boolean zero;
            public int read() { return i < valid.length ? valid[i++] & 255 : -1; }
            public int read(byte[] b, int off, int len) { if ((zero = !zero)) return 0; if (i == valid.length) return -1; b[off]=valid[i++]; return 1; }
        }); checks++;
        testChooserAndNames();
        testTransfer(valid);
        System.out.println("ProjectBackupPayloadTest: " + checks + " checks passed (JVM only).");
    }

    private static void testChooserAndNames() throws Exception {
        check(ProjectBackupPayload.chooserKind(new String[]{".mintproject,"+ProjectBackupPayload.MIME}) == 3, "exact project accepts");
        for (String accept : new String[]{".mintproject,image/*", ".mintproject,application/json", ".mintproject,*/*", ".mintproject,"})
            check(ProjectBackupPayload.chooserKind(new String[]{accept}) == 0, "mixed/generic denied");
        check(ProjectBackupPayload.chooserKind(new String[]{"application/json"}) == 2, "preset unchanged");
        check(ProjectBackupPayload.chooserKind(new String[]{"image/*"}) == 1, "image unchanged");
        check(ProjectBackupPayload.chooserKind(null) == 1, "default unchanged");
        check(ProjectBackupPayload.isProjectMime(ProjectBackupPayload.MIME), "project MIME");
        check(ProjectBackupPayload.isProjectMime("application/octet-stream"), "binary MIME with validation");
        check(!ProjectBackupPayload.isProjectMime("application/json"), "JSON not project");
        check(ProjectBackupPayload.fileName("../../照片.mintproject").equals("_.._照片.mintproject"), "filename strips paths");
        check(ProjectBackupPayload.fileName(null).equals("薄荷项目.mintproject"), "default filename");
        check(ProjectBackupPayload.fileName("x.MINTPROJECT").equals("x.mintproject"), "suffix normalized");
        for (String id : new String[]{"", "../a", "x y", "汉", "a".repeat(81), "a\n"}) check(!ProjectBackupPayload.validRequestId(id), "invalid request ID");
        check(ProjectBackupPayload.validRequestId("p-1_A"), "safe request ID");
    }

    private static void testTransfer(byte[] bytes) throws Exception {
        File directory = Files.createTempDirectory("mint-project-test-").toFile();
        try {
            ProjectBackupTransfer transfer = new ProjectBackupTransfer(directory, "p-1", bytes.length);
            File file = transfer.file;
            for (int start = 0, index = 0; start < bytes.length; index++) {
                int end = Math.min(bytes.length, start + 17);
                transfer.append(index, Base64.getEncoder().encodeToString(Arrays.copyOfRange(bytes, start, end))); start = end;
            }
            check(transfer.finish().equals(file), "finished transfer");
            check(Arrays.equals(Files.readAllBytes(file.toPath()), bytes), "exact chunk bytes");
            reject(() -> transfer.append(20, "AAAA"), "append after finish");
            reject(transfer::finish, "finish twice");
            transfer.close(); check(!file.exists(), "completed cleanup");
            for (String encoded : new String[]{"", "A", "AAA", "A===", "!!!!", "AA A", "AB==", "AAB=", "AAAA\n", "A".repeat(ProjectBackupTransfer.MAX_BASE64_CHARS+4)})
                reject(() -> ProjectBackupTransfer.validateChunk(encoded), "strict bounded canonical base64");
            ProjectBackupTransfer.validateChunk(Base64.getEncoder().encodeToString(new byte[ProjectBackupTransfer.MAX_CHUNK_BYTES])); checks++;
            reject(() -> ProjectBackupTransfer.validateChunk(Base64.getEncoder().encodeToString(new byte[ProjectBackupTransfer.MAX_CHUNK_BYTES+1])), "decoded chunk cap");
            try (ProjectBackupTransfer shortTransfer = new ProjectBackupTransfer(directory, "p-2", bytes.length)) {
                reject(() -> shortTransfer.append(1, "AAAA"), "sequence mismatch");
                shortTransfer.append(0,"AAAA");
                reject(() -> shortTransfer.append(0,"AAAA"), "duplicate chunk");
                reject(shortTransfer::finish, "incomplete length");
            }
            try (ProjectBackupTransfer over = new ProjectBackupTransfer(directory, "p-3", 81)) {
                reject(() -> over.append(0, Base64.getEncoder().encodeToString(bytes)), "declared total overflow");
            }
            for (long size : new long[]{0,80,ProjectBackupPayload.MAX_BYTES+1L,Long.MAX_VALUE})
                reject(() -> new ProjectBackupTransfer(directory,"p-4",size), "total cap before temp");
            reject(() -> new ProjectBackupTransfer(directory,"../p",bytes.length), "ID before temp");
            check(directory.list().length == 0, "no orphan private temp files");
        } finally { for (File file : directory.listFiles()) file.delete(); directory.delete(); }
    }

    static byte[] container(String json, byte[] source) throws Exception { return container(json.getBytes(StandardCharsets.UTF_8), source); }
    static byte[] container(byte[] json, byte[] source) throws Exception {
        byte[] header = new byte[80]; System.arraycopy("MINTPRJ1".getBytes(StandardCharsets.US_ASCII),0,header,0,8);
        put32(header,8,json.length); put32(header,12,source.length);
        System.arraycopy(MessageDigest.getInstance("SHA-256").digest(json),0,header,16,32);
        System.arraycopy(MessageDigest.getInstance("SHA-256").digest(source),0,header,48,32);
        ByteArrayOutputStream out = new ByteArrayOutputStream(); out.write(header); out.write(json); out.write(source); return out.toByteArray();
    }
    private static void put32(byte[] b, int at, long n) { for (int i=0;i<4;i++) b[at+i]=(byte)(n>>(8*i)); }
    private static void valid(byte[] bytes) throws Exception { ProjectBackupPayload.read(new ByteArrayInputStream(bytes)); checks++; }
    private static void reject(Throwing action, String label) throws Exception { try { action.run(); } catch (IOException expected) { checks++; return; } throw new AssertionError(label); }
    private static void check(boolean ok, String label) { if (!ok) throw new AssertionError(label); checks++; }
    private interface Throwing { void run() throws Exception; }
}
