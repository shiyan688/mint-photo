#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT HUP INT TERM
if command -v javac >/dev/null 2>&1; then
  javac -encoding UTF-8 --release 17 -d "$OUT" \
    "$ROOT/app/src/main/java/com/qingyan/editor/ExportPayload.java" \
    "$ROOT/tests/native/ExportPayloadTest.java" \
    "$ROOT/app/src/main/java/com/qingyan/editor/PresetPayload.java" \
    "$ROOT/tests/native/PresetPayloadTest.java" \
    "$ROOT/app/src/main/java/com/qingyan/editor/ProjectBackupPayload.java" \
    "$ROOT/app/src/main/java/com/qingyan/editor/ProjectBackupTransfer.java" \
    "$ROOT/tests/native/ProjectBackupPayloadTest.java"
elif java --list-modules 2>/dev/null | grep -q '^jdk.compiler@'; then
  # Some runtime-only distributions contain jdk.compiler but no javac/ct.sym.
  # This fallback tests current-JVM behavior, not Android API compatibility.
  java -m jdk.compiler/com.sun.tools.javac.Main -encoding UTF-8 -source 17 -target 17 -d "$OUT" \
    "$ROOT/app/src/main/java/com/qingyan/editor/ExportPayload.java" \
    "$ROOT/tests/native/ExportPayloadTest.java" \
    "$ROOT/app/src/main/java/com/qingyan/editor/PresetPayload.java" \
    "$ROOT/tests/native/PresetPayloadTest.java" \
    "$ROOT/app/src/main/java/com/qingyan/editor/ProjectBackupPayload.java" \
    "$ROOT/app/src/main/java/com/qingyan/editor/ProjectBackupTransfer.java" \
    "$ROOT/tests/native/ProjectBackupPayloadTest.java"
else
  echo "A JDK 17 or newer is required (Java compiler is missing)." >&2
  exit 1
fi
java -cp "$OUT" com.qingyan.editor.ExportPayloadTest

java -cp "$OUT" com.qingyan.editor.PresetPayloadTest

java -cp "$OUT" com.qingyan.editor.ProjectBackupPayloadTest \
  "$ROOT/tests/fixtures/project-backup/minimal-v2.mintproject" \
  "$ROOT/tests/fixtures/project-backup/legacy-v1.mintproject"
python3 "$ROOT/tests/native/project-backup-source-check.py"
