# Portable adjustment preset contract, version 1

Status: isolated candidate only. No desktop or Android source, pixel engine, UI, image asset, project format, or dependency was changed. Integration belongs after the parent task's geometry checkpoint.

## Runtime and injection

`preset-codec.js` and `preset-codec.cjs` contain identical bytes. The dependency-free UMD file provides `globalThis.MintAdjustmentPreset` in a browser/WebView and `module.exports` in CommonJS. The only exported member is `createCodec`.

```js
// CommonJS; provide the existing authored module, not a new implementation.
const { createCodec } = require('./preset-codec.cjs');
const advancedTone = require('./advanced-tone.cjs');
const codec = createCodec({ advancedTone });

// Browser/WebView: load existing advanced-tone.cjs as a script first,
// then preset-codec.js. Both must run in the same realm.
const codec = MintAdjustmentPreset.createCodec({
  advancedTone: MintAdvancedTone
});
```

The dependency must be the trusted existing authored advanced-tone module. Its own enumerable data-property `validate` function is captured at codec creation. The codec calls that validator, never copies its tone mathematics, and sanitizes/clones both the validator input and output. It does not import modules, read files, use a network, load models, or process pixels. It never calls the dependency for a null recipe.

## API

- `defaults(name)` returns a neutral full preset. The name is required.
- `validate(document)` validates without mutating and returns a fully owned canonical deep copy.
- `parse(text)` accepts a primitive JavaScript string containing bounded JSON, rejects duplicates before schema validation, and returns a fully owned canonical preset.
- `stringify(document)` validates and returns deterministic compact JSON in schema field order. It does not call `JSON.stringify`, `toJSON`, or user coercion hooks.
- `hasPortraitEffect(document)` validates the whole document, then returns true iff any of `smooth`, `brighten`, `warmth`, `underEye`, `redness`, `lip`, or `blush` is nonzero. Basic controls, tone recipes and palette alone do not imply a portrait effect.
- `colorOnly(document)` returns a full valid owned preset with all numeric beauty controls zero and palette `natural`. It preserves the normalized name, basic controls, and entire validated tone recipe, including disabled recipes. It never changes the source.

The exported API and each codec API object are frozen. Returned data is intentionally editable. All returned records have null prototypes; arrays are ordinary dense arrays. Callers should not assume methods such as `hasOwnProperty` exist on a returned record. Use `Object.hasOwn`, or the codec APIs. No returned object or array is shared with the source or a prior call.

Invalid ordinary inputs and malformed JSON throw `TypeError`; there is no silent fallback, partial import, clamping, or unknown-field stripping. Error text is descriptive, not a stable API code.

## Exact document schema

```json
{
  "format": "mint-adjustment-preset",
  "version": 1,
  "name": "Portrait",
  "controls": {
    "basic": {
      "exposure": 0,
      "contrast": 0,
      "saturation": 0,
      "temperature": 0
    },
    "beauty": {
      "smooth": 0,
      "brighten": 0,
      "warmth": 0,
      "underEye": 0,
      "redness": 0,
      "lip": 0,
      "blush": 0,
      "palette": "natural"
    },
    "advancedTone": null
  }
}
```

Every illustrated field is mandatory, including `advancedTone`. No other fields are permitted at any structural or control level. The format marker and numeric schema version are exact; no legacy aliases, unknown/future versions, or automatic migrations are supported.

- All four basic controls and beauty `warmth`: primitive finite numbers in `[-100, 100]`.
- All other numeric beauty controls: primitive finite numbers in `[0, 100]`.
- `palette`: exactly `natural`, `peach`, or `rose`.
- `name`: a primitive scalar-Unicode string, trimmed using ECMAScript `String.prototype.trim`, then 1–48 Unicode code points. All C0/C1 control characters (U+0000–U+001F and U+007F–U+009F) and lone surrogates are rejected before trimming. Grapheme clusters and Unicode normalization are not conflated with code points. Raw names are bounded to 4,096 UTF-16 code units. Names are not file paths or storage identifiers; never use an untrusted name directly as a path.
- `advancedTone`: null or a version-1 shared tone recipe accepted by the existing `advancedTone.validate`. This retains its existing exact schema: `version`, `enabled`, `strength`, `curveMode`, `curves` (rgb/red/green/blue five-node arrays), and `hsl` (eight hue/saturation/luminance band records). Existing ranges, array lengths, enum and monotonicity rules remain that module's responsibility.

Only two values normalize: surrounding name whitespace is trimmed, and signed zero becomes positive zero. Neutral defaults use zero numbers, `natural`, and a null tone recipe. The codec does not decide how a host editor applies or merges presets.

The strict whitelist excludes photos, images, paths, IDs, timestamps, landmarks, masks, strokes, geometry and reshape. A field with any of these meanings is not allowed by inventing an extra key. `constructor`, `prototype`, and `__proto__` are additionally forbidden in parsed/generic recipe objects, including escaped spellings.

## File/parser and object safety limits

| Limit | Value |
| --- | --- |
| UTF-8 encoded JSON text | 65,536 bytes, inclusive |
| JSON nesting depth | 12, root value at depth 1 |
| Parsed value nodes | 512 (containers and primitive values) |
| Lexical JSON tokens | 2,048 (keys, values, punctuation) |
| Raw content of a string token | 4,096 UTF-16 code units, including escapes |
| Number token | 128 characters |

Text type, code-unit upper bound, scalar-Unicode validity and actual UTF-8 byte length are checked before JSON tokenization or parsed-object allocation. Trailing JSON whitespace is allowed and counts toward the byte cap. A BOM is not JSON whitespace and is rejected. Duplicate keys are rejected at every depth after escape decoding, including keys spelled differently using `\u` escapes. Unquoted keys, trailing commas, comments and multiple documents are rejected.

Numbers use JSON's grammar and normal finite IEEE-754 conversion. Overflow and nonzero underflow to zero are rejected; finite subnormal values remain valid when their control range allows them. Negative zero canonicalizes to zero. Normal floating-point rounding of representable JSON decimal values remains standard JavaScript behavior.

The host owns file I/O. It must enforce a raw-file size cap and decode UTF-8 strictly, without replacing malformed bytes, before calling `parse`. A string-only API cannot detect byte-decoding damage already hidden by a lossy decoder. A host using `TextDecoder` can use fatal decoding and preserve/reject a BOM instead of silently discarding it.

`validate` accepts only same-realm ordinary/null-prototype records and same-realm ordinary dense arrays. It examines own property descriptors before reading values. Custom/inherited prototypes, accessors, symbols, hidden fields, sparse arrays, array extra keys and unexpected record keys are rejected. Cycles and very deep/wide recipe graphs fail bounded traversal. Returned copies are created with own data properties using null-prototype property descriptors, so inherited `get`, `set`, or `value` getters cannot execute during property creation.

The existing tone validator uses ordinary array methods and object assignments. Before invoking it, the codec rejects added accessors on `Object.prototype` or `Array.prototype` (except the unused native `__proto__` slot). This deliberately fails closed for a non-null tone recipe in an accessor-polluted realm; neutral presets still avoid inherited getters. Trusted JavaScript intrinsics and the trusted injected validator are prerequisites. This is not a sandbox for malicious executable code or Proxy traps: JavaScript reflection on a Proxy can execute its traps, so do not pass live untrusted Proxies or objects from arbitrary plugin code. External data should enter through the text parser.

## Verification and integration

From this candidate directory:

```sh
node --test preset-codec.test.cjs
```

The tests use only Node built-ins and read the existing authored tone module at `../installer-feedback/MintPortrait-Source/src/advanced-tone.cjs`. To run after integration, set `MINT_ADVANCED_TONE_PATH` to that integration's existing tone module. No copied or substitute tone module is included.

27 tests cover exact neutral/schema roundtrips; all numeric boundaries; missing/unknown/future fields; Unicode names and surrogate handling; JSON grammar/numeric edge cases; duplicate escaped aliases; the 64-KiB UTF-8 boundary before parsing; depth/node/token limits; descriptor/accessor/prototype/array attacks; isolated-VM inherited getter/setter attacks before and after codec initialization; color-only semantics; owned copies; byte-identical UMD/CommonJS behavior; 250 deterministic full-preset roundtrips; and 1,500 deterministic grammar mutations.

This proves the candidate codec's unit contract, not desktop/Android UI wiring, storage permissions, image rendering parity, APK installation, or installer behavior. Integrators must retain the same byte-identical shared codec, use the existing same-realm tone module, and run host-specific import/export/UI checks separately.
