"""Independently compare actual Android saved PNGs with captured mock inputs/masks.

Requires Pillow and numpy. This checks transport/compositing/storage, never AI quality.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--run-url", required=True)
    args = parser.parse_args()
    root = args.evidence
    result = json.loads((root / "ai-e2e-result.json").read_text(encoding="utf-8"))
    assert result["result"] == "PASS"
    assert result["mockService"] and not result["realAiModel"] and not result["physicalDevice"]
    assert result["systemDocumentPicker"] and result["savedFilesReopened"]
    requests = json.loads((root / "requests.json").read_text(encoding="utf-8"))
    checks = []

    def rgba(name):
        with Image.open(root / name) as image:
            return np.array(image.convert("RGBA"))

    def equal(a, b, message):
        assert np.array_equal(a, b), message
        checks.append(message)

    saved = {}
    for mode, edge in (("erase", 512), ("outpaint", 716)):
        request = next(r for r in requests if r["mode"] == mode and r["path"] == "/v1/images/edits")
        prefix = f"request-{request['id']}-{mode}"
        image = rgba(prefix + "-image.png")
        mask = rgba(prefix + "-mask.png")
        output = rgba(f"saved-{mode}.png")
        generated = rgba(f"mock-{request['id']}-{mode}.png")
        assert output.shape == image.shape == mask.shape == generated.shape == (edge, edge, 4)
        protected = mask[:, :, 3] == 255
        selected = mask[:, :, 3] == 0
        assert protected.any() and selected.any() and np.all(protected | selected)
        equal(output[protected], image[protected], f"saved {mode}: every protected pixel equals the actual sent image")
        assert np.any(output[selected] != image[selected]), f"saved {mode}: no selected pixel changed"
        checks.append(f"saved {mode}: selected pixels changed, output dimensions {edge}x{edge}")
        if mode == "outpaint":
            equal(image[102:614, 102:614], saved["erase"], "outpaint request contains the previously saved erase image, pixel exact")
            equal(output[102:614, 102:614], saved["erase"], "saved outpaint original center equals saved erase image, pixel exact")
            equal(output[selected], generated[selected], "saved outpaint border equals the synthetic provider output, pixel exact")
            assert int(selected.sum()) == 716 * 716 - 512 * 512
        saved[mode] = output
    files = sorted(root.glob("*.png"))
    report = {
        "result": "PASS",
        "sourceCommit": args.commit,
        "runUrl": args.run_url,
        "scope": "Android emulator HTTPS mock, real WebView and system document save/reopen; NOT real AI quality or physical device acceptance",
        "androidInstrumentation": result,
        "independentSavedPngChecks": checks,
        "pngSha256": {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in files},
    }
    samples = result.get("timingsMsIncludingAutomationPolling", {}).get("brightness12InputToTwoAnimationFrames", [])
    if samples:
        report["emulatorBrightnessFrameTiming"] = {
            "samples": len(samples), "medianMs": float(np.median(samples)),
            "p95Ms": float(np.percentile(samples, 95)), "maxMs": max(samples),
            "boundary": "12 alternating brightness inputs, 512x512 public photo, two animation frames; emulator with automation, NOT device FPS or large-image performance",
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"PASS: {len(checks)} independent saved PNG checks; report: {args.output}")


if __name__ == "__main__":
    main()
