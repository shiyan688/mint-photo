package com.qingyan.editor;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;

/** Test-only bridge: one base64 UTF-8 JSON input per line, one acceptance result per line. */
public final class PresetPayloadParity {
    public static void main(String[] args) throws Exception {
        BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String line;
        while ((line = input.readLine()) != null) {
            byte[] bytes = Base64.getDecoder().decode(line);
            boolean imported = false, exported = false;
            try {
                if (!Arrays.equals(bytes, PresetPayload.read(new ByteArrayInputStream(bytes)))) {
                    throw new AssertionError("Import changed original bytes");
                }
                imported = true;
            } catch (IOException invalid) { /* Rejection is the expected result for hostile inputs. */ }
            try {
                if (!Arrays.equals(bytes, PresetPayload.validate(new String(bytes, StandardCharsets.UTF_8)))) {
                    throw new AssertionError("Export changed original bytes");
                }
                exported = true;
            } catch (IOException invalid) { /* Compare the export boundary independently. */ }
            if (imported != exported) throw new AssertionError("Import/export acceptance mismatch");
            System.out.println(imported ? "1" : "0");
        }
    }
}
