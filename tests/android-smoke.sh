#!/bin/sh
# Current portrait-version smoke entry point. See docs/ANDROID.md before running.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$ROOT/tests/portrait-android-smoke.sh" "$@"
