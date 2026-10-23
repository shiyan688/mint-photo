package com.qingyan.editor;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Base64;

/** Single worker-owned chunk receiver. Never writes outside an app-private temporary file. */
final class ProjectBackupTransfer implements AutoCloseable {
    static final int MAX_CHUNK_BYTES = 128 * 1024;
    static final int MAX_BASE64_CHARS = ((MAX_CHUNK_BYTES + 2) / 3) * 4;
    final String requestId;
    final File file;
    private final long expectedBytes;
    private OutputStream output;
    private long receivedBytes;
    private int nextIndex;
    private boolean completed;

    ProjectBackupTransfer(File directory, String requestId, long expectedBytes) throws IOException {
        if (!ProjectBackupPayload.validRequestId(requestId) || expectedBytes <= ProjectBackupPayload.HEADER_BYTES
                || expectedBytes > ProjectBackupPayload.MAX_BYTES) throw ProjectBackupPayload.invalid();
        this.requestId = requestId;
        this.expectedBytes = expectedBytes;
        file = File.createTempFile("mint-export-", ".tmp", directory);
        try { output = new FileOutputStream(file); }
        catch (IOException | RuntimeException error) { file.delete(); throw error; }
    }

    static void validateChunk(String encoded) throws IOException {
        if (encoded == null || encoded.isEmpty() || encoded.length() > MAX_BASE64_CHARS || (encoded.length() & 3) != 0) throw ProjectBackupPayload.invalid();
        int padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
        int length = encoded.length();
        if ((long) length / 4 * 3 - padding > MAX_CHUNK_BYTES) throw ProjectBackupPayload.invalid();
        for (int i = 0; i < length; i++) {
            char c = encoded.charAt(i);
            if (i >= length - padding) { if (c != '=') throw ProjectBackupPayload.invalid(); }
            else if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '/')) throw ProjectBackupPayload.invalid();
        }
        // Canonical pad bits: different text must not silently decode to the same chunk.
        if (padding > 0) {
            char c = encoded.charAt(length - padding - 1);
            int n = c >= 'A' && c <= 'Z' ? c - 'A' : c >= 'a' && c <= 'z' ? c - 'a' + 26 : c >= '0' && c <= '9' ? c - '0' + 52 : c == '+' ? 62 : 63;
            if ((padding == 2 && (n & 15) != 0) || (padding == 1 && (n & 3) != 0)) throw ProjectBackupPayload.invalid();
        }
    }

    void append(int index, String encoded) throws IOException {
        if (completed || output == null || index != nextIndex) throw ProjectBackupPayload.invalid();
        validateChunk(encoded); // Bound encoded and decoded lengths before allocating.
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(encoded); }
        catch (IllegalArgumentException error) { throw ProjectBackupPayload.invalid(); }
        if (receivedBytes + bytes.length > expectedBytes) throw ProjectBackupPayload.invalid();
        output.write(bytes);
        receivedBytes += bytes.length;
        nextIndex++;
    }

    File finish() throws IOException {
        if (completed || output == null || receivedBytes != expectedBytes) throw ProjectBackupPayload.invalid();
        output.close(); output = null;
        try (InputStream input = new FileInputStream(file)) { ProjectBackupPayload.read(input); }
        if (file.length() != expectedBytes) throw ProjectBackupPayload.invalid();
        completed = true;
        return file;
    }

    /** Call only on the receiver's serial worker, including cancel/error/lifecycle cleanup. */
    @Override public void close() {
        if (output != null) {
            try { output.close(); } catch (IOException ignored) { /* Delete private cache below. */ }
            output = null;
        }
        file.delete();
    }
}
