#!/usr/bin/env python3
"""Verify actual Android portrait PNG evidence, never perceptual image quality.

Requires Pillow and numpy. The source JPEG is required so its identity/dimensions
are checked from bytes, rather than trusting copied source metadata. No download
or model inference is performed. Missing, failed or inconsistent evidence fails.

Example:
  python tools/verify-portrait-large-evidence.py .work/portrait-large-evidence \
    --source .work/ai-e2e-large-inputs/mint-e2e-large-source.jpg \
    --output .work/portrait-large-independent.json
"""
import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image


SOURCE_SHA = "34471604e6f19bdbc31e8a556caa9d20bab29c417a7817a1c352740458dcf0eb"
FACE_MODEL_SHA = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"
SOURCE_SIZE = (2400, 3000)
SOURCE_BYTES = 1545361
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class EvidenceError(ValueError):
    pass


def require(condition, message):
    # Deliberately not Python assert: checks must still run under python -O.
    if not condition:
        raise EvidenceError(message)


def read_json(path):
    require(path.is_file(), f"missing evidence: {path.name}")
    require(path.stat().st_size <= 10 * 1024 * 1024, f"oversized JSON: {path.name}")
    return json.loads(path.read_text(encoding="utf-8-sig"))


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def png_pixels(path):
    require(path.is_file(), f"missing saved PNG: {path.name}")
    require(24 <= path.stat().st_size <= 64 * 1024 * 1024, f"invalid PNG file size: {path.name}")
    with path.open("rb") as stream:
        header = stream.read(24)
    require(header[:8] == PNG_SIGNATURE and header[12:16] == b"IHDR", f"invalid PNG header: {path.name}")
    size = struct.unpack(">II", header[16:24])
    require(min(size) >= 1 and max(size) <= 4096 and math.prod(size) <= 8_000_000,
            f"PNG exceeds the product output budget: {path.name}: {size}")
    with Image.open(path) as image:
        require(image.format == "PNG" and image.size == size, f"PNG decoder/header mismatch: {path.name}")
        require(not getattr(image, "is_animated", False), f"unexpected animated PNG: {path.name}")
        image.verify()
    with Image.open(path) as image:
        rgba = np.array(image.convert("RGBA"))
    return size, rgba


def alpha_stats(rgba):
    alpha = rgba[:, :, 3]
    return {
        "lowAlphaPixels": int(np.count_nonzero(alpha < 16)),
        "highAlphaPixels": int(np.count_nonzero(alpha > 239)),
        "partialAlphaPixels": int(np.count_nonzero((alpha > 0) & (alpha < 255))),
    }


def compare_source(before, after):
    same_size = before.shape == after.shape
    if not same_size:
        # Diagnostic only: Pillow and Android do not promise identical resampling.
        before = np.array(Image.fromarray(before).resize(
            (after.shape[1], after.shape[0]), Image.Resampling.LANCZOS))
    changed = np.any(before != after, axis=2)
    return {
        "sourceChanged": bool(changed.any()),
        "changedPixels": int(np.count_nonzero(changed)),
        "comparedPixels": int(changed.size),
        "sameDimensions": same_size,
        "comparisonResize": None if same_size else "Pillow LANCZOS diagnostic",
    }


def verify(args):
    root = args.evidence
    report = read_json(root / "portrait-large-result.json")
    require(report.get("result") == "PASS", "Android instrumentation did not report PASS")
    require(report.get("realBundledPortraitModels") is True, "report does not identify real bundled portrait models")
    require(report.get("physicalDevice") is False and report.get("remoteGenerativeAiTested") is False,
            "evidence scope does not match this emulator/local-model verifier")
    require(report.get("systemDocumentPicker") is True, "system document workflow is not reported")
    require(report.get("skinOption") == "detail-v2 experimental, smooth 65", "wrong skin option/strength")
    require(report.get("cutoutOption") == "edge-aware v2 experimental, transparent", "wrong cutout option")
    checks = report.get("checks")
    require(isinstance(checks, list) and checks and all(isinstance(x, str) for x in checks), "missing instrumentation checks")
    require(args.source.is_file(), "the pinned original source JPEG is required")
    require(args.source.stat().st_size == SOURCE_BYTES and sha256(args.source) == SOURCE_SHA,
            "source JPEG bytes/SHA do not match the pinned NASA original")
    with Image.open(args.source) as source_image:
        require(source_image.format == "JPEG" and source_image.size == SOURCE_SIZE, "source JPEG dimensions or format differ")
        source_pixels = np.array(source_image.convert("RGBA"))
    meta = read_json(root / "source.json")
    require(meta.get("sha256") == meta.get("downloadedSha256") == report.get("originalSha256") == SOURCE_SHA,
            "source hashes in metadata/report disagree with actual source bytes")
    require((meta.get("width"), meta.get("height")) == SOURCE_SIZE
            and (report.get("originalWidth"), report.get("originalHeight")) == SOURCE_SIZE
            and meta.get("pixels") == 7_200_000 and meta.get("bytes") == SOURCE_BYTES,
            "source dimensions/byte metadata disagree")
    instrumentation = (root / "instrumentation.txt").read_text(encoding="utf-8", errors="replace")
    require("result=PASS Android portrait large workflow" in instrumentation
            and "result=FAIL Android portrait large workflow" not in instrumentation,
            "missing or contradictory instrumentation completion marker")

    callbacks = report.get("nativeCallbacks", [])
    require(any(e.get("ok") is True and 1 <= e.get("faceCount", 0) <= 5
                and e.get("landmarkCount") == 478 and e.get("modelSha256") == FACE_MODEL_SHA
                for e in callbacks if e.get("faceCount") is not None), "missing matching native face-model callback")
    require(any(e.get("ok") is True and (e.get("maskWidth"), e.get("maskHeight")) == (205, 256)
                for e in callbacks), "missing aspect-correct native person-mask callback")
    trace = read_json(root / "portrait-large-click-trace.json")
    require(isinstance(trace, list) and trace, "empty real-pointer trace")
    for action in trace:
        require(action.get("result") == "intended-target-touched", "failed/unfinished pointer action: " + str(action.get("selector")))
        events = action.get("pointerEvents", [])
        require(len(events) == 2 and [e.get("type") for e in events] == ["pointerdown", "pointerup"]
                and all(e.get("intended") is True for e in events), "pointer trace did not reach the intended control")
    selectors = [action.get("selector") for action in trace]
    for selector, count in {
        "[data-tool=portrait]": 1, "[data-tool=background]": 1,
        "#detectPortrait": 2, "#person-face-1": 1, "#detailSkin": 1,
        "#edgeAware": 1, "#bgMode-transparent": 1, "#applyBtn": 2,
        "[data-format='image/png']": 2, "#saveBtn": 2, "#openTop": 2,
    }.items():
        require(selectors.count(selector) >= count, f"missing real-pointer action: {selector}")

    skin_preview = read_json(root / "portrait-large-skin-preview-pixels.json")
    require((skin_preview.get("width"), skin_preview.get("height")) == (720, 900)
            and 0 < skin_preview.get("changedPixels", 0) <= 648_000
            and 0 < skin_preview.get("maxChannelDelta", 0) <= 255,
            "instrumentation did not measure a nonzero skin preview change")
    saves = report.get("saves", [])
    require([s.get("name") for s in saves] == ["skin", "background"], "save sequence is incomplete or reordered")
    output_records = []
    current_size, current_pixels = SOURCE_SIZE, source_pixels
    working_choices = 0
    for name, choice in zip(("skin", "background"), saves):
        require(type(choice.get("originalDisabled")) is bool
                and type(choice.get("explicitWorkingChoice")) is bool, f"missing resolution decision: {name}")
        if choice["originalDisabled"]:
            require(choice["selected"] == "choose" and choice["explicitWorkingChoice"] is True
                    and bool(choice.get("details", "").strip()), f"original-budget refusal was silently bypassed: {name}")
            require("original-budget refusal requires an explicit resolution choice" in checks
                    and "saving stays disabled before choosing working resolution" in checks,
                    f"missing original-budget refusal assertions: {name}")
            scale = min(1, 2560 / max(current_size))
            expected = tuple(math.floor(v * scale + .5) for v in current_size)
            working_choices += 1
        else:
            require(choice["selected"] == "original" and choice["explicitWorkingChoice"] is False,
                    f"available original resolution was not preserved: {name}")
            expected = current_size
        require((choice.get("expectedWidth"), choice.get("expectedHeight")) == expected,
                f"declared output dimensions break the source/resolution chain: {name}")
        require(f"{expected[0]} × {expected[1]}" in choice.get("finalDetails", ""), f"final visible dimensions disagree: {name}")
        path = root / f"saved-portrait-{name}.png"
        size, rgba = png_pixels(path)
        require(size == expected, f"actual saved dimensions differ from the explicit resolution choice: {name}")
        android = read_json(root / f"portrait-large-{name}-saved-png.json")
        require(android.get("name") == f"mint-e2e-portrait-{name}.png", f"Android read the wrong saved file: {name}")
        require((android.get("ihdrWidth"), android.get("ihdrHeight")) == size
                and (android.get("decodedWidth"), android.get("decodedHeight")) == size,
                f"Android PNG header/decode dimensions disagree with independent decode: {name}")
        actual_sha = sha256(path)
        require(android.get("sha256") == actual_sha and android.get("bytes") == path.stat().st_size,
                f"pulled PNG bytes differ from the actual File read back in Android: {name}")
        alpha = alpha_stats(rgba)
        require(all(android.get(key) == value for key, value in alpha.items()),
                f"independent alpha histogram disagrees with Android's saved-file read: {name}")
        if name == "skin":
            require(np.all(rgba[:, :, 3] == 255), "skin save changed the opaque photograph's alpha")
        else:
            require(alpha["lowAlphaPixels"] > 0 and alpha["highAlphaPixels"] > 0,
                    "background save lacks retained or transparent pixels")
        difference = compare_source(current_pixels, rgba)
        require(difference["sourceChanged"], f"saved {name} has no decoded pixel changes from its source")
        if name == "background" and rgba.shape == current_pixels.shape:
            opaque = rgba[:, :, 3] == 255
            # The transparent operation only changes alpha. At exactly opaque
            # pixels there is no premultiplication ambiguity or scaling here.
            mismatches = int(np.count_nonzero(np.any(rgba[opaque, :3] != current_pixels[opaque, :3], axis=1)))
            require(mismatches == 0, "transparent background altered RGB of fully opaque saved-skin pixels")
            difference["opaqueRgbCheckedPixels"] = int(np.count_nonzero(opaque))
            difference["opaqueRgbMismatchPixels"] = mismatches
        reopen_check = f"{name} saved PNG reopened as a new source at the explicitly chosen dimensions"
        require(reopen_check in checks, f"missing successful source-revision/dimension reopen assertion: {name}")
        output_records.append({"name": name, "file": path.name, "width": size[0], "height": size[1],
                               "bytes": path.stat().st_size, "sha256": actual_sha, **alpha, **difference,
                               "sourceRevisionChanged": {"reported": True, "basis": reopen_check,
                                   "independentlyRecomputed": False}})
        current_size, current_pixels = size, rgba
    require(selectors.count("#exportResolution") >= working_choices, "working-resolution choices lack control interactions")
    timings = report.get("timingsMsIncludingAutomationAndPolling", {})
    require(isinstance(timings, dict) and timings and all(type(v) in (int, float) and math.isfinite(v) and v >= 0
            for v in timings.values()), "missing/invalid workflow timing observations")
    return {
        "result": "PASS", "sourceCommit": args.commit, "runUrl": args.run_url,
        "scope": "Independent bytes/PNG/alpha/resolution checks for one Android emulator workflow using bundled local models. Not skin naturalness, hair accuracy, remote AI quality, physical-device performance, FPS, or peak memory acceptance.",
        "source": {"sha256": SOURCE_SHA, "width": 2400, "height": 3000, "bytes": SOURCE_BYTES},
        "savedPngs": output_records, "instrumentationCheckCount": len(checks), "verifiedPointerActions": len(trace),
        "timingsMsIncludingAutomationAndPolling": timings,
        "limits": [
            "Source revision changes are asserted by the instrumentation; old/new revision values are not present in this evidence format.",
            "Skin pixel differences against the original may include JPEG decoder/color differences. A working-size comparison also includes different resampling. Neither difference count measures enhancement quality.",
            "The alpha histogram confirms a transparent result, not whether its segmentation follows hair or the intended subject.",
            "Matching SHA proves the pulled PNG equals the File read back by Android, not that every UI behavior can be independently reconstructed from PNGs.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--source", type=Path, required=True, help="pinned original 2400x3000 NASA JPEG")
    parser.add_argument("--output", type=Path, help="optional verification JSON; FAIL replaces an old report too")
    parser.add_argument("--commit", help="provenance label supplied by the caller, not verified from files")
    parser.add_argument("--run-url", help="provenance label supplied by the caller, not verified from files")
    args = parser.parse_args()
    try:
        result = verify(args)
    except Exception as error:
        result = {"result": "FAIL", "error": str(error), "sourceCommit": args.commit, "runUrl": args.run_url}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["result"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
