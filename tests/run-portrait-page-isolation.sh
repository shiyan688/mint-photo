#!/usr/bin/env bash
# Run only after building with -PaiE2eTest -PportraitPageIsolationTest.
# Uses the disposable .e2e package. Does not clear or uninstall existing apps.
set -euo pipefail
: "${ANDROID_SERIAL:?Set ANDROID_SERIAL to the intended disposable emulator}"
: "${ANDROID_HOME:?Set ANDROID_HOME to the installed Android SDK}"
evidence=.work/portrait-page-isolation-evidence
mkdir -p "$evidence"
tool="$ANDROID_HOME/build-tools/35.0.0/aapt"
app_badging=$("$tool" dump badging app/build/outputs/apk/debug/app-debug.apk)
test_badging=$("$tool" dump badging app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk)
test_manifest=$("$tool" dump xmltree app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk AndroidManifest.xml)
grep -Fq "package: name='com.qingyan.editor.portrait.e2e'" <<< "$app_badging"
grep -Fq "package: name='com.qingyan.editor.portrait.e2e.test'" <<< "$test_badging"
grep -Fq 'com.qingyan.editor.PortraitPageIsolationInstrumentation' <<< "$test_manifest"
timeout 120 adb -s "$ANDROID_SERIAL" wait-for-device
for i in $(seq 1 90); do
  [ "$(adb -s "$ANDROID_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break
  sleep 2
done
test "$(adb -s "$ANDROID_SERIAL" shell getprop sys.boot_completed | tr -d '\r')" = 1
adb -s "$ANDROID_SERIAL" install -r app/build/outputs/apk/debug/app-debug.apk
adb -s "$ANDROID_SERIAL" install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s "$ANDROID_SERIAL" shell am instrument -w com.qingyan.editor.portrait.e2e.test/com.qingyan.editor.PortraitPageIsolationInstrumentation | tee "$evidence/instrumentation.txt"
grep -Fq 'result=PASS portrait page isolation' "$evidence/instrumentation.txt"
