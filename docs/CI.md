# Reproducible checks and Android previews

The workflow in `.github/workflows/android.yml` runs on pushes, pull requests,
and manual dispatch. Actions are pinned to immutable commit IDs. It needs no
repository secrets and has read-only repository permissions.

The JavaScript/JVM job requires Node.js 24 and a full JDK 17 or newer:

```sh
node tests/run-ci.cjs
sh tests/native/run.sh
```

`run-ci.cjs` takes its inventory from `tests/run-pure.sh`, preserves its pure
paint mode, and supplies Java for the cross-language project-backup checks.
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

The package ID stays `com.qingyan.editor.portrait`; version code increases to 4
and the visible version becomes `0.2.0-preview`, with app label `薄荷修图`.
Matching the package ID alone does not make a differently signed older APK
upgradable. Release builds remain unsigned until a release identity is configured.

Passing this workflow demonstrates source tests, compilation, lint, and APK
signing. It does not demonstrate real WebView behavior, Android file-provider
recovery, touch/keyboard behavior, database durability, photographic quality,
or phone performance. The older dated validation reports are historical evidence.

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
