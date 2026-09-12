#!/usr/bin/env python3
# mct-origami-audio-reengineer-p19-aux-rt-thread-decision-gate
from pathlib import Path
import csv
import sys

ROOT = Path(__file__).resolve().parent.parent
BUILD = Path(
    __import__("os").environ.get(
        "ORIGAMI_SIMD_PROFILE_BUILD_ROOT",
        str(ROOT / "build-simd-profile"),
    )
)

baseline = BUILD / "baseline/results.txt"
no_autovec = BUILD / "no_autovec/results.txt"

print("===== MCT ORIGAMI AUXILIARY RT THREADING DECISION GATE =====")
print("Policy: one realtime DSP thread (host callback) unless profiling proves otherwise.")
print()

if not baseline.exists() or not no_autovec.exists():
    print("DECISION: NO-GO")
    print("Reason: Patch 18 profiling evidence is incomplete.")
    print("Required first: ./scripts/run-simd-profile.sh")
    print("No auxiliary realtime render threads should be implemented.")
    sys.exit(0)

def parse(path: Path):
    rows = {}
    spectral = None
    in_table = False
    with path.open() as f:
        for raw in f:
            line = raw.strip()
            if line == "scenario,realtime_fraction,headroom_percent":
                in_table = True
                continue
            if line.startswith("spectral_transform_us,"):
                spectral = float(line.split(",",1)[1])
                in_table = False
                continue
            if in_table and line and "," in line:
                parts = line.split(",")
                if len(parts) == 3:
                    rows[parts[0]] = {
                        "rt": float(parts[1]),
                        "headroom": float(parts[2]),
                    }
    return rows, spectral

base_rows, base_spectral = parse(baseline)
novec_rows, novec_spectral = parse(no_autovec)

required = {
    "1voice_1module_1unison",
    "8voice_4module_4unison",
    "16voice_4module_8unison",
    "16voice_4module_16unison",
}
if not required.issubset(base_rows) or not required.issubset(novec_rows):
    print("DECISION: NO-GO")
    print("Reason: profiling output is incomplete or from an incompatible Patch 18 harness.")
    sys.exit(0)

print("Scenario                                    baseline RT   no-autovec RT   delta")
print("-"*82)
for name in sorted(required):
    b=base_rows[name]["rt"]
    n=novec_rows[name]["rt"]
    delta=(n-b)/max(b,1.0e-9)*100.0
    print(f"{name:42s} {b:10.4f} {n:15.4f} {delta:8.2f}%")

print()
if base_spectral is not None and novec_spectral is not None:
    print(f"Spectral transform: baseline={base_spectral:.3f} us "
          f"no-autovec={novec_spectral:.3f} us")

# The extreme benchmarks are intentionally not "normal shipping presets".
# This gate therefore cannot approve threading automatically. It can only say
# whether the data is severe enough to justify a manual architecture review.
heavy = [
    base_rows["16voice_4module_8unison"]["rt"],
    base_rows["16voice_4module_16unison"]["rt"],
]
moderate = base_rows["8voice_4module_4unison"]["rt"]

print()
if moderate < 0.50 and max(heavy) < 0.75:
    print("DECISION: NO-GO")
    print("Reason: measured single-thread DSP remains within the architecture's "
          "callback-headroom targets for these profiling scenarios.")
    print("Keep the host-callback-only renderer.")
elif moderate < 0.75:
    print("DECISION: NO-GO FOR IMPLEMENTATION; REVIEW HOTSPOTS FIRST")
    print("Reason: pressure appears concentrated in extreme density.")
    print("Use SIMD/compiler evidence, QoS, algorithmic changes, and topology limits "
          "before introducing deadline-join synchronization.")
else:
    print("DECISION: ELIGIBLE FOR MANUAL AUX-THREAD FEASIBILITY REVIEW")
    print("This is NOT approval to enable worker rendering.")
    print("Before any code change, prove:")
    print("  1. p95/p99 callback misses persist in a real plugin/host stress test.")
    print("  2. lower-risk scalar/SIMD/algorithm/QoS work is exhausted.")
    print("  3. work can be partitioned into bounded independent jobs.")
    print("  4. the host callback has a bounded no-wait fallback if a worker is late.")
    print("  5. Apple auxiliary RT threads join the host Audio Workgroup.")
    print("  6. Windows uses appropriate pro-audio scheduling; never hijack host priority.")
    print("  7. no heap allocation, mutex, condition-variable wait, or unbounded barrier "
          "enters processBlock().")

print()
print("Patch 19 policy remains: ORIGAMI_ENABLE_AUX_RT_THREADS=OFF.")
