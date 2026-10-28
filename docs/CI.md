# Reproducible checks and Android previews

The workflow in `.github/workflows/android.yml` runs on pushes, pull requests,
and manual dispatch. Actions are pinned to immutable commit IDs. It needs no
repository secrets and has read-only repository permissions.

The JavaScript/JVM job requires Node.js 24 and a full JDK 17 or newer:

```sh
node tests/run-ci.cjs
sh tests/native/run.sh
```

`run-ci.cjs` first verifies the generated initial HTML icons with
`tools/prerender-icons.cjs --check`, then takes its test inventory from
`tests/run-pure.sh`, preserves its pure paint mode, and supplies Java for the
cross-language project-backup checks.
One historical suite, `beauty-protection-independent.test.cjs`, is explicitly
excluded: the original `quality/portrait-people-independent/2.rgba.gz` and
`5.rgba.gz` photographs are absent from this source package. The fixture-dependent
audit is not reported as passing. The synthetic beauty-protection core,
operation, UI, and selection suites still run. A holder of the original audit
fixtures can run `node tests/run-ci.cjs --include-archived-fixtures`.

The separate Android job uses the checked-in Gradle 8.9 wrapper, whose download
SHA-256 is fixed in `gradle-wrapper.properties`, JDK 17, Android platform 35,
and build-tools 35.0.0. It builds ARM64 and ARM32 debug APKs, runs lint, verifies
their signatures, checks that every asset matches the source, verifies ZIP/native
16 KiB alignment, and uploads the APKs with SHA-256 hashes. Locally:

```sh
./gradlew -PportraitAbiSplits :app:assembleDebug :app:lintDebug
```

Use `gradlew.bat` on Windows. Set `JAVA_HOME` and `ANDROID_HOME` to your local
JDK/SDK, or set `sdk.dir` in an untracked `local.properties`. The normal Android
debug certificate is used; `MINT_TEST_KEYSTORE` remains an optional override for
an existing debug keystore with standard Android debug credentials. No production
signing key is created or published. CI debug certificates are ephemeral, so
different CI runs may not update one another in place. Export important projects
before uninstalling a previous preview.

The package ID stays `com.qingyan.editor.portrait`; version code is 8
and the visible development version is `0.3.3-dev`, with app label `薄荷修图`.
Matching the package ID alone does not make a differently signed older APK
upgradable. Release builds remain unsigned until a release identity is configured.

Passing the source and APK jobs alone demonstrates source tests, compilation,
lint, and APK signing. The separate emulator job below checks a bounded set of
WebView and system-save interactions; neither layer establishes physical-device
keyboard behavior, database durability, photographic quality, or phone
performance. The older dated validation reports are historical evidence.

## Optional native Canvas checks

The `tests/native-canvas/*.test.cjs` suite runs the production pixel code with
`@napi-rs/canvas` 0.1.100. Install that package outside the source tree or under
ignored `.tools/canvas/`, set `NODE_PATH` to its `node_modules`, and set
`MINT_TEST_FONT` to an installed `NotoSansCJK-Regular.ttc` when the default Linux
font path is unavailable. Fonts and npm binaries are not committed to this repo.

```sh
npm install --prefix .tools/canvas --no-fund --no-audit @napi-rs/canvas@0.1.100
NODE_PATH="$PWD/.tools/canvas/node_modules" node --test --test-concurrency=2 tests/native-canvas/*.test.cjs
```

Three beauty-protection photo cases and one photo case each for sharpness,
manual deformation, and mask refinement explicitly report `SKIP` if their
original archived portraits are absent. Their synthetic
tests still run. Skipped photo cases are not counted as passing or replaced
with fabricated fixtures. This optional suite uses native Skia pixels and PNG
encoding; its DOM, storage scheduling and Android bridge are controlled test
adapters, not a real browser or phone.


## Isolated Android mock workflow

The `ai-e2e` push job builds a separate `.e2e` package and runs an API 35 x86_64
emulator. It creates an ephemeral CA trusted only for the mock host 10.0.2.2 in
that test variant. Normal debug/release builds do not include that CA or network
configuration. Private CA/server keys are never uploaded.

The test imports a public NASA PNG using Android DocumentsUI, drives real WebView
touch input, uses the native HTTPS multipart client with a fixed non-secret test
credential, and saves/reopens PNGs through the actual system picker. Error,
wrong-ratio and cancellation cases are included. The fixture returns an obvious
synthetic color pattern, never an AI photograph. `tools/verify-ai-e2e-evidence.py`
independently compares actual saved PNGs with captured request images and masks.
Only a PASS report counts; build success or partial screenshots do not.

The disposable emulator is reduced to 540x1200 pixels at density 210 to reduce
software-GPU load while keeping the phone CSS viewport. Its unrelated Pixel
Launcher is stopped before instrumentation after an observed launcher ANR.
Application ANRs are not dismissed. WebView visual-state acknowledgments precede
screenshots. These are emulated functional checks, not physical-device frame
rate, memory, keyboard, photographic quality, or real-provider acceptance.


The SDK Manager twice received truncated archives. The mock job now verifies
pinned official Linux emulator 37.2.12 and API35 Google APIs x86_64 revision9
archives against the byte sizes and SHA1 values from Google's SDK manifests
before extracting; executable permissions and package metadata are preserved.
`tests/check-ai-mock-cancel.cjs` additionally verifies real TLS upload cancellation
followed by a successful new multipart request before the Android build.

Latest successful mock run: [40120891206](https://github.com/shiyan688/mint-photo/actions/runs/40120891206),
source `1058180c00b0e972ee5b5f46d04c4103aef6f6f4`, version `0.3.3-dev` / code 8.
The [2026-10-25 report](quality/surfaces-android-20261025/report.json) records
278 flow/layout checks, 53 emulator touches reaching the intended targets, and
7 independent saved-PNG checks. These counts are not feature counts or real-AI
acceptance. The [surface review](SURFACE-STYLE-QUALITY.md) separates this final
source from the earlier 390 × 844 browser evidence.

Historical [2026-10-24 evidence](quality/android-ai-e2e-20261024/README.md)
remains available for its corresponding source version.
