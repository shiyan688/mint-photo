# Portable independent straighten audit

Copy this entire directory to `quality/straighten-independent` in the app repository. No production source files are included. See REPORT.md for results, accepted numerical limitations, exact audited source hashes, and native-vs-device distinctions.

Run:

    export NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules
    node --test quality/straighten-independent/core-audit.test.cjs quality/straighten-independent/editor-audit.test.cjs
    python quality/straighten-independent/decimal-geometry-audit.py
    python quality/straighten-independent/structured-boundary-audit.py
    node quality/straighten-independent/boundary-pixel-audit.cjs
    node quality/straighten-independent/render-axis-phase.cjs

The default app root is two directories above this directory. MINT_APP_ROOT can explicitly override it. Re-running writes updated evidence only into this directory. No installs or network are needed. The native backend is the existing installed adapter, not an Android device.
