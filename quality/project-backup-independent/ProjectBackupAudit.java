package com.qingyan.editor;
import java.io.*;
import java.nio.file.*;
/** Independent audit adapter: production reader, one accept/reject line per file. */
public final class ProjectBackupAudit {
  public static void main(String[] args) throws Exception {
    for (String file : args) {
      boolean ok = false;
      try (InputStream in = Files.newInputStream(Path.of(file))) { ProjectBackupPayload.read(in); ok = true; }
      catch (IOException | RuntimeException expected) { }
      System.out.println(Path.of(file).getFileName() + "\t" + (ok ? "accept" : "reject"));
    }
  }
}
