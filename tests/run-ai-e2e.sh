#!/usr/bin/env bash
set -euo pipefail
export ANDROID_SERIAL=emulator-5554
mode="${MINT_E2E_MODE:-small}"
runner=com.qingyan.editor.AiFlowInstrumentation
pass_marker='result=PASS Android AI mock workflow'
case "$mode" in
  small) evidence=.work/ai-e2e-evidence; service=.work/ai-e2e; instrument_args=() ;;
  large)
    evidence=.work/ai-e2e-large-evidence; service=.work/ai-e2e-large; instrument_args=(-e largePhoto true)
    node tests/prepare-large-photo.cjs
    mkdir -p "$service"
    cp .work/ai-e2e/server.key .work/ai-e2e/server.pem .work/ai-e2e/ca.pem "$service/"
    ;;
  portrait)
    evidence=.work/portrait-large-evidence; service=.work/portrait-large-service; instrument_args=()
    runner=com.qingyan.editor.PortraitLargeInstrumentation
    pass_marker='result=PASS Android portrait large workflow'
    node tests/prepare-large-photo.cjs
    ;;
  *) echo 'MINT_E2E_MODE must be small, large or portrait' >&2; exit 2 ;;
esac
mkdir -p "$evidence"
export MINT_E2E_DIR="$service"
server_pid=
collect() {
  adb -s "$ANDROID_SERIAL" logcat -d > "$evidence/logcat.txt" 2>&1 || true
  adb -s "$ANDROID_SERIAL" shell dumpsys meminfo com.qingyan.editor.portrait.e2e > "$evidence/app-memory-after.txt" 2>&1 || true
  printf '%s\n' 'Single app-process snapshot after the run on a disposable emulator; not peak memory, renderer-total memory, physical-device performance, or FPS.' > "$evidence/memory-scope.txt"
  for name in $(adb -s "$ANDROID_SERIAL" shell run-as com.qingyan.editor.portrait.e2e ls files 2>/dev/null | tr -d '\r' | grep -E '^(ai-e2e-|portrait-large-)' || true); do
    adb -s "$ANDROID_SERIAL" exec-out run-as com.qingyan.editor.portrait.e2e cat "files/$name" > "$evidence/$name" || true
  done
  if [ "$mode" = portrait ]; then saved_modes='portrait-skin portrait-background'; else saved_modes='original erase outpaint'; fi
  for saved_mode in $saved_modes; do
    adb -s "$ANDROID_SERIAL" pull "/sdcard/Download/mint-e2e-$saved_mode.png" "$evidence/saved-$saved_mode.png" || true
  done
  cp "$service/requests.json" "$evidence/" 2>/dev/null || true
  cp "$service/"*-image.png "$service/"*-mask.png "$service/"mock-*.png "$evidence/" 2>/dev/null || true
  if [ "$mode" != small ]; then cp .work/ai-e2e-large-inputs/source.json "$evidence/source.json"; fi
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
}
trap collect EXIT
if [ "$mode" != portrait ]; then
  node tools/ai-e2e-server.cjs > "$evidence/mock-server.txt" 2>&1 &
  server_pid=$!
  healthy=false
  for i in $(seq 1 30); do
    if curl --silent --fail --cacert .work/ai-e2e/ca.pem https://127.0.0.1:9443/health >/dev/null; then healthy=true; break; fi
    sleep 1
  done
  "$healthy"
  kill -0 "$server_pid"
fi
timeout 120 adb -s "$ANDROID_SERIAL" wait-for-device
for i in $(seq 1 90); do
  [ "$(adb -s "$ANDROID_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break
  sleep 2
done
test "$(adb -s "$ANDROID_SERIAL" shell getprop sys.boot_completed | tr -d '\r')" = 1
adb -s "$ANDROID_SERIAL" shell wm size 540x1200
adb -s "$ANDROID_SERIAL" shell wm density 210
adb -s "$ANDROID_SERIAL" shell getprop > "$evidence/device-properties.txt"
adb -s "$ANDROID_SERIAL" shell wm size > "$evidence/display-size.txt"
adb -s "$ANDROID_SERIAL" shell wm density >> "$evidence/display-size.txt"
adb -s "$ANDROID_SERIAL" shell input keyevent 82
adb -s "$ANDROID_SERIAL" shell settings put global window_animation_scale 0
adb -s "$ANDROID_SERIAL" shell settings put global transition_animation_scale 0
adb -s "$ANDROID_SERIAL" shell settings put global animator_duration_scale 0
adb -s "$ANDROID_SERIAL" install -r app/build/outputs/apk/debug/app-debug.apk
adb -s "$ANDROID_SERIAL" install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s "$ANDROID_SERIAL" shell am force-stop com.qingyan.editor.portrait.e2e
adb -s "$ANDROID_SERIAL" shell pm clear com.qingyan.editor.portrait.e2e
adb -s "$ANDROID_SERIAL" shell rm -f /sdcard/Download/mint-e2e-original.png /sdcard/Download/mint-e2e-erase.png /sdcard/Download/mint-e2e-outpaint.png /sdcard/Download/mint-e2e-portrait-skin.png /sdcard/Download/mint-e2e-portrait-background.png
if [ "$mode" != small ]; then
  adb -s "$ANDROID_SERIAL" push .work/ai-e2e-large-inputs/mint-e2e-large-source.jpg /sdcard/Download/mint-e2e-large-source.jpg
  if [ "$mode" = large ]; then adb -s "$ANDROID_SERIAL" push .work/ai-e2e-large-inputs/mint-e2e-large-over40mib.jpg /sdcard/Download/mint-e2e-large-over40mib.jpg; fi
else
  adb -s "$ANDROID_SERIAL" push app/src/main/assets/demo/astronaut.png /sdcard/Download/mint-e2e-source.png
fi
# The disposable Google image's launcher can ANR during first-boot background setup.
# Stop that unrelated process before launching the app; application ANRs still fail.
adb -s "$ANDROID_SERIAL" shell am force-stop com.google.android.apps.nexuslauncher
adb -s "$ANDROID_SERIAL" shell am instrument -w "${instrument_args[@]}" "com.qingyan.editor.portrait.e2e.test/$runner" | tee "$evidence/instrumentation.txt"
grep -q "$pass_marker" "$evidence/instrumentation.txt"
