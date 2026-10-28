#!/usr/bin/env bash
set -euo pipefail
export ANDROID_SERIAL=emulator-5554
mode="${MINT_INTERACTIVE_MODEL:-v2}"
case "$mode" in
  v2) evidence=.work/interactive-android-evidence; instrument_args=() ;;
  legacy) evidence=.work/interactive-legacy-android-evidence; instrument_args=(-e objectModel legacy) ;;
  legacy-pixel) evidence=.work/interactive-legacy-pixel-android-evidence; instrument_args=(-e objectModel legacy-pixel) ;;
  *) echo 'MINT_INTERACTIVE_MODEL must be v2, legacy or legacy-pixel' >&2; exit 2 ;;
esac
mkdir -p "$evidence"
collect() {
  for name in interactive-result.json interactive-melvin-input.png interactive-melvin-mask.png interactive-collins-input.png interactive-collins-mask.png interactive-melvin-point-{0,1,2,3,4}.png; do
    # Some Android shells emit cat errors on stdout, even if stderr is hidden.
    # Do not save those messages as apparent PNG files when inference failed.
    if adb -s "$ANDROID_SERIAL" shell run-as com.qingyan.editor.portrait.e2e test -f "files/$name" >/dev/null 2>&1; then
      tmp="$evidence/$name.partial"
      kind=json
      case "$name" in *.png) kind=png ;; esac
      if adb -s "$ANDROID_SERIAL" exec-out run-as com.qingyan.editor.portrait.e2e cat "files/$name" > "$tmp" 2>/dev/null &&
        python3 tests/validate-interactive-evidence.py "$tmp" "$kind"; then
        mv "$tmp" "$evidence/$name"
      else
        mv "$tmp" "$evidence/$name.invalid"
        printf '%s\n' "Failed to read or validate $name; retained the output with an .invalid suffix." >&2
      fi
    fi
  done
  printf '%s\n' "Exploratory $mode test only. The model and test APK are not uploaded. API35 x86_64 emulator, one primary point per image; legacy variants also run a five-point diagnostic on Melvin. The legacy-pixel mode is a version-specific coordinate compatibility experiment. No physical-device, perceptual, ground-truth, or peak-memory acceptance." > "$evidence/scope.txt"
}
trap collect EXIT
timeout 120 adb -s "$ANDROID_SERIAL" wait-for-device
for i in $(seq 1 90); do
  [ "$(adb -s "$ANDROID_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break
  sleep 2
done
test "$(adb -s "$ANDROID_SERIAL" shell getprop sys.boot_completed | tr -d '\r')" = 1
adb -s "$ANDROID_SERIAL" install -r app/build/outputs/apk/debug/app-debug.apk
adb -s "$ANDROID_SERIAL" install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s "$ANDROID_SERIAL" shell am force-stop com.qingyan.editor.portrait.e2e
adb -s "$ANDROID_SERIAL" shell pm clear com.qingyan.editor.portrait.e2e
adb -s "$ANDROID_SERIAL" shell am instrument -w "${instrument_args[@]}" com.qingyan.editor.portrait.e2e.test/com.qingyan.editor.InteractiveObjectInstrumentation | tee "$evidence/instrumentation.txt"
grep -q 'result=PASS Android interactive object model research' "$evidence/instrumentation.txt"
