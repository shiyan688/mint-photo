#!/bin/sh
# Use a connected disposable Android test device/emulator. Never uninstalls the original editor.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
: "${ANDROID_SERIAL:?Set ANDROID_SERIAL to the intended authorized test device/emulator}"
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug
adb -s "$ANDROID_SERIAL" install -r app/build/outputs/apk/debug/app-debug.apk
adb -s "$ANDROID_SERIAL" install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
mkdir -p tests/model-fixture-results
adb -s "$ANDROID_SERIAL" shell am instrument -w com.qingyan.editor.portrait.test/com.qingyan.editor.PortraitSmokeInstrumentation > tests/model-fixture-results/native-smoke.txt
cat tests/model-fixture-results/native-smoke.txt
grep -q "result=PASS" tests/model-fixture-results/native-smoke.txt
adb -s "$ANDROID_SERIAL" exec-out run-as com.qingyan.editor.portrait cat files/public-astronaut-analysis.json > tests/model-fixture-results/astronaut-analysis.json
./gradlew -PportraitBridgeTest :app:assembleDebugAndroidTest
adb -s "$ANDROID_SERIAL" install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s "$ANDROID_SERIAL" shell am instrument -w com.qingyan.editor.portrait.test/com.qingyan.editor.PortraitBridgeSmokeInstrumentation > tests/model-fixture-results/bridge-smoke.txt
cat tests/model-fixture-results/bridge-smoke.txt
grep -q "result=PASS" tests/model-fixture-results/bridge-smoke.txt
