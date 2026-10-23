#!/usr/bin/env bash
set -euo pipefail
export ANDROID_SERIAL=emulator-5554
mkdir -p .work/ai-e2e-evidence
collect() {
  adb -s "$ANDROID_SERIAL" logcat -d > .work/ai-e2e-evidence/logcat.txt 2>&1 || true
  for name in $(adb -s "$ANDROID_SERIAL" shell run-as com.qingyan.editor.portrait.e2e ls files 2>/dev/null | tr -d '\r' | grep '^ai-e2e-' || true); do
    adb -s "$ANDROID_SERIAL" exec-out run-as com.qingyan.editor.portrait.e2e cat "files/$name" > ".work/ai-e2e-evidence/$name" || true
  done
  for mode in erase outpaint; do
    adb -s "$ANDROID_SERIAL" pull "/sdcard/Download/mint-e2e-$mode.png" ".work/ai-e2e-evidence/saved-$mode.png" || true
  done
  cp .work/ai-e2e/requests.json .work/ai-e2e-evidence/ 2>/dev/null || true
  cp .work/ai-e2e/*-mask.png .work/ai-e2e-evidence/ 2>/dev/null || true
  cp .work/ai-e2e/mock-*.png .work/ai-e2e-evidence/ 2>/dev/null || true
}
trap collect EXIT
node tools/ai-e2e-server.cjs > .work/ai-e2e-evidence/mock-server.txt 2>&1 &
for i in $(seq 1 30); do curl --silent --fail --cacert .work/ai-e2e/ca.pem https://127.0.0.1:9443/health >/dev/null && break || sleep 1; done
timeout 120 adb -s "$ANDROID_SERIAL" wait-for-device
for i in $(seq 1 90); do
  [ "$(adb -s "$ANDROID_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break
  sleep 2
done
test "$(adb -s "$ANDROID_SERIAL" shell getprop sys.boot_completed | tr -d '\r')" = 1
adb -s "$ANDROID_SERIAL" shell getprop > .work/ai-e2e-evidence/device-properties.txt
adb -s "$ANDROID_SERIAL" shell input keyevent 82
adb -s "$ANDROID_SERIAL" shell settings put global window_animation_scale 0
adb -s "$ANDROID_SERIAL" shell settings put global transition_animation_scale 0
adb -s "$ANDROID_SERIAL" shell settings put global animator_duration_scale 0
adb -s "$ANDROID_SERIAL" install -r app/build/outputs/apk/debug/app-debug.apk
adb -s "$ANDROID_SERIAL" install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s "$ANDROID_SERIAL" shell am instrument -w com.qingyan.editor.portrait.e2e.test/com.qingyan.editor.AiFlowInstrumentation | tee .work/ai-e2e-evidence/instrumentation.txt
grep -q 'result=PASS Android AI mock workflow' .work/ai-e2e-evidence/instrumentation.txt
