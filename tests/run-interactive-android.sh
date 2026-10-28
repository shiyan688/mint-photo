#!/usr/bin/env bash
set -euo pipefail
export ANDROID_SERIAL=emulator-5554
evidence=.work/interactive-android-evidence
mkdir -p "$evidence"
collect() {
  for name in interactive-result.json interactive-melvin-mask.png interactive-collins-mask.png; do
    adb -s "$ANDROID_SERIAL" exec-out run-as com.qingyan.editor.portrait.e2e cat "files/$name" > "$evidence/$name" 2>/dev/null || true
  done
  printf '%s\n' 'Exploratory test only. The model and test APK are not uploaded. API35 x86_64 emulator, single point, no physical-device, perceptual, ground-truth, or peak-memory acceptance.' > "$evidence/scope.txt"
}
trap collect EXIT
adb -s "$ANDROID_SERIAL" install -r app/build/outputs/apk/debug/app-debug.apk
adb -s "$ANDROID_SERIAL" install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s "$ANDROID_SERIAL" shell am force-stop com.qingyan.editor.portrait.e2e
adb -s "$ANDROID_SERIAL" shell pm clear com.qingyan.editor.portrait.e2e
adb -s "$ANDROID_SERIAL" shell am instrument -w com.qingyan.editor.portrait.e2e.test/com.qingyan.editor.InteractiveObjectInstrumentation | tee "$evidence/instrumentation.txt"
grep -q 'result=PASS Android interactive object model research' "$evidence/instrumentation.txt"
