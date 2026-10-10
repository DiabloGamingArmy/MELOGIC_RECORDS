#!/usr/bin/env python3
"""Bounded runtime qualification before investing in a full Origami ASan build."""
import argparse
import json
import os
from pathlib import Path
import platform
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compiler", required=True, help="clang++ path")
    parser.add_argument("--build", required=True, type=Path, help="new build directory")
    parser.add_argument("--sanitizers", choices=["address", "address,undefined"],
                        default="address,undefined")
    parser.add_argument("--deployment-target", help="explicit macOS target, if desired")
    parser.add_argument("--architecture", choices=["arm64", "x86_64"],
                        default=platform.machine(), help="macOS target architecture")
    parser.add_argument("--timeout", type=float, default=10)
    args = parser.parse_args()
    if not 0 < args.timeout <= 60:
        parser.error("timeout must be greater than zero and at most 60 seconds")
    build = args.build.resolve()
    if (build / "CMakeCache.txt").exists():
        parser.error("use a fresh directory; existing compiler/runtime caches are not reused")
    build.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    # No interposition/suppression inherited from the invoking shell.
    for name in list(env):
        if name.startswith(("ASAN_", "UBSAN_", "LSAN_", "DYLD_")):
            del env[name]
    env["ASAN_OPTIONS"] = "halt_on_error=1:abort_on_error=1:detect_stack_use_after_return=1"
    env["UBSAN_OPTIONS"] = "halt_on_error=1:print_stacktrace=1"
    metadata = {"compiler": args.compiler, "sanitizers": args.sanitizers,
                "architecture": args.architecture, "environment": {
                    name: env[name] for name in ("ASAN_OPTIONS", "UBSAN_OPTIONS")}}
    (build / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    config = ["cmake", "-S", str(Path(__file__).resolve().parent), "-B", str(build),
              "-DCMAKE_BUILD_TYPE=RelWithDebInfo", f"-DCMAKE_CXX_COMPILER={args.compiler}",
              f"-DPROBE_SANITIZERS={args.sanitizers}"]
    if platform.system() == "Darwin":
        config += [f"-DCMAKE_OSX_ARCHITECTURES={args.architecture}"]
        if args.deployment_target:
            config += [f"-DCMAKE_OSX_DEPLOYMENT_TARGET={args.deployment_target}"]
    with (build / "build.log").open("w") as log:
        subprocess.run(config, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        subprocess.run(["cmake", "--build", str(build), "--parallel", "2"],
                       env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
    control = subprocess.run([str(build / "sanitizer_probe_control")], env=env,
                             capture_output=True, timeout=args.timeout)
    (build / "control.txt").write_bytes(control.stdout + control.stderr)
    if control.returncode or b"PROBE main entered" not in control.stderr:
        raise RuntimeError("unsanitized control failed")

    def execute(name, extra):
        with (build / f"{name}.txt").open("wb") as log:
            process = subprocess.Popen([str(build / "sanitizer_probe"), *extra],
                                       env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                code = process.wait(timeout=args.timeout)
            except subprocess.TimeoutExpired:
                try:
                    if platform.system() == "Darwin":
                        subprocess.run(["sample", str(process.pid), "2", "1", "-file",
                                        str(build / f"{name}-stack.txt")],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       timeout=8, check=False)
                finally:
                    process.kill()
                    process.wait()
                return None
            except BaseException:
                process.kill()
                process.wait()
                raise
        return code

    code = execute("normal", [])
    normal = (build / "normal.txt").read_text(errors="replace")
    if code != 0 or "PROBE main entered" not in normal:
        print(f"Runtime unavailable: exit={code}, main={'PROBE main entered' in normal}; {build}")
        return 2
    code = execute("invalid", ["--invalid"])
    invalid = (build / "invalid.txt").read_text(errors="replace")
    if (code is None or code == 0 or "heap-use-after-free" not in invalid
            or "PROBE main entered" not in invalid):
        print(f"Runtime diagnostic control failed: {build}")
        return 3
    print(f"ASan runtime operational: allocation/free passed; deliberate UAF diagnosed; {build}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
