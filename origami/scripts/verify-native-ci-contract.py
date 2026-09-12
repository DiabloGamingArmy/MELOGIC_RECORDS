#!/usr/bin/env python3
# mct-origami-deep-audit-p04-native-ci
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
repo = root.parent
checks = {
    repo / ".github/workflows/origami-native-ci.yml": [
        "realtime-gate:", "sanitizers:", "plugin-validation:",
        "juce-framework/JUCE", "ref: 9.0.2",
        "./origami/scripts/run-rt-gate.sh",
        "./origami/scripts/run-sanitizers.sh",
        "./origami/scripts/validate-plugins-macos.sh",
    ],
    root / "scripts/run-sanitizers.sh": [
        "-DORIGAMI_SANITIZE=ON", "ctest --test-dir", "ASAN_OPTIONS", "UBSAN_OPTIONS",
    ],
    root / "scripts/validate-plugins-macos.sh": [
        "pluginval", "auval -v aumu Orig Mctg",
        "MCT Origami.vst3", "MCT Origami.component", "MCT Origami.app",
    ],
}
failures=[]
for path, needles in checks.items():
    if not path.exists():
        failures.append(f"missing: {path}")
        continue
    text=path.read_text(encoding="utf-8")
    for needle in needles:
        if needle not in text:
            failures.append(f"{path}: missing {needle!r}")
if failures:
    print("NATIVE CI CONTRACT FAILED", file=sys.stderr)
    for f in failures:
        print(" -", f, file=sys.stderr)
    raise SystemExit(1)
print("PASS: native C++ CI/sanitizer/plugin-validation contract")
