"""Install pinned official Linux SDK archives after byte-length/SHA1 verification.

SDK Manager twice accepted truncated downloads before failing to unzip. This is
CI-only; --metadata-only can validate the package descriptions without installing.
Pins were checked against Google's SDK repository manifests on 2026-10-24.
"""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

PACKAGES = [
    {
        "path": "emulator", "directory": "emulator", "prefix": "emulator/",
        "url": "https://dl.google.com/android/repository/emulator-linux_x64-16428233.zip",
        "bytes": 349654171, "sha1": "cd7362ea55dfb86a418958138dc396e74165dd01",
        "details": '<type-details xsi:type="generic:genericDetailsType"/>',
        "revision": '<major>37</major><minor>2</minor><micro>12</micro>',
        "display": "Android Emulator",
    },
    {
        "path": "system-images;android-35;google_apis;x86_64",
        "directory": "system-images/android-35/google_apis/x86_64", "prefix": "x86_64/",
        "url": "https://dl.google.com/android/repository/sys-img/google_apis/x86_64-35_r09.zip",
        "bytes": 1738815903, "sha1": "0103e6dab21290c4b9d16550a3ce99476f884eef",
        "details": '<type-details xsi:type="sys-img:sysImgDetailsType"><api-level>35</api-level><extension-level>13</extension-level><base-extension>true</base-extension><tag><id>google_apis</id><display>Google APIs</display></tag><vendor><id>google</id><display>Google Inc.</display></vendor><abi>x86_64</abi></type-details>',
        "revision": '<major>9</major>', "display": "Google APIs Intel x86_64 Atom System Image",
    },
]
MANIFEST = "https://dl.google.com/android/repository/repository2-3.xml"


def metadata(package, license_xml):
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<repo:repository xmlns:repo="http://schemas.android.com/repository/android/common/02"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
 xmlns:generic="http://schemas.android.com/repository/android/generic/02"
 xmlns:sys-img="http://schemas.android.com/sdk/android/repo/sys-img2/03">
{license_xml}<localPackage path="{package['path']}" obsolete="false">
{package['details']}<revision>{package['revision']}</revision>
<display-name>{package['display']}</display-name><uses-license ref="android-sdk-license"/>
</localPackage></repo:repository>'''


def verified(package, archive):
    if not archive.is_file() or archive.stat().st_size != package["bytes"]:
        return False
    with archive.open("rb") as stream:
        return hashlib.file_digest(stream, "sha1").hexdigest() == package["sha1"]


def download(package, archive):
    for attempt in range(4):
        if verified(package, archive):
            return
        if archive.exists() and archive.stat().st_size >= package["bytes"]:
            archive.unlink()  # Only this disposable download, never SDK directories.
        print(f"Download verified SDK archive, attempt {attempt + 1}: {package['path']}", flush=True)
        result = subprocess.run([
            "curl", "--fail", "--location", "--retry", "2", "--retry-all-errors",
            "--connect-timeout", "30", "--max-time", "300", "--continue-at", "-",
            "--output", str(archive), package["url"] + f"?mint_verify={attempt}",
        ], check=False)
        if verified(package, archive):
            return
        if result.returncode == 33 and archive.exists():
            archive.unlink()  # This server did not support resuming that attempt.
        print("Archive length/hash not yet valid; no extraction performed.", flush=True)
    raise RuntimeError(f"Official archive unavailable or corrupt: {package['path']}")


def install(package, archive, sdk):
    target = (sdk / package["directory"]).resolve()
    target.relative_to(sdk)
    parent = target.parent
    # Emulator ZIP includes emulator/; image ZIP includes x86_64/.
    with zipfile.ZipFile(archive) as z:
        for entry in z.infolist():
            if not entry.filename.startswith(package["prefix"]) or "\\" in entry.filename:
                raise RuntimeError("Unexpected SDK archive path")
            destination = (parent / entry.filename).resolve()
            destination.relative_to(target)
            if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                link = z.read(entry).decode("utf-8")
                (destination.parent / link).resolve().relative_to(target)
    parent.mkdir(parents=True, exist_ok=True)
    # unzip preserves the official executable permissions and symlinks.
    subprocess.run(["unzip", "-q", "-o", str(archive), "-d", str(parent)], check=True)
    return target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--metadata-only", type=Path)
    args = parser.parse_args()
    if args.metadata_only:
        sdk = args.metadata_only.resolve()
    else:
        if sys.platform != "linux" or os.environ.get("GITHUB_ACTIONS") != "true":
            raise RuntimeError("Archive installation is restricted to disposable Linux GitHub Actions runners")
        sdk = Path(os.environ["ANDROID_HOME"]).resolve()
    with urllib.request.urlopen(MANIFEST, timeout=30) as response:
        manifest = ET.fromstring(response.read(2 * 1024 * 1024))
    license_node = next(p for p in manifest if p.tag == "license" and p.get("id") == "android-sdk-license")
    license_xml = ET.tostring(license_node, encoding="unicode")
    downloads = Path(".work/ci-sdk-downloads").resolve()
    downloads.mkdir(parents=True, exist_ok=True)
    for package in PACKAGES:
        if args.metadata_only:
            target = sdk / package["directory"]
            target.mkdir(parents=True, exist_ok=True)
        else:
            archive = downloads / package["url"].rsplit("/", 1)[1]
            download(package, archive)
            target = install(package, archive, sdk)
            archive.unlink()
        (target / "package.xml").write_text(metadata(package, license_xml), encoding="utf-8")
        print(f"Package metadata ready: {package['path']}", flush=True)


if __name__ == "__main__":
    main()
