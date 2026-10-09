# Qualify an ASan runtime before building Origami

This independent CMake project links no Origami/JUCE code and is never included
by the plugin build. It checks an unsanitized control, normal allocation/free
under ASan, then an explicit deliberate heap-use-after-free. The invalid mode is
an expected diagnostic control, **not a passing production test**.

```sh
python3 origami/tools/sanitizer-probe/run.py \
  --compiler "$(xcrun --find clang++)" \
  --build "$TMPDIR/origami-asan-probe" --deployment-target 26.0
```

Use a **new directory** per compiler/runtime/configuration. An alternate Clang
can be passed via `--compiler`; this does not change `xcode-select` or install
anything. `--sanitizers address` isolates ASan from the default ASan+UBSan.
The deployment target above reproduces B01; choose the intended target when
qualifying another environment. The probe requires a Clang-compatible POSIX host.
`--architecture x86_64` can qualify an alternate macOS architecture when its
execution support is already installed; this runner never installs Rosetta.

Exit codes: 0 means normal execution and the deliberate ASan diagnostic both
worked; 2 means normal sanitized execution failed/timed out; 3 means the invalid
access was not diagnosed as expected. Configuration/control failures are errors.
An exit 2 does not by itself establish a pre-main failure: inspect the markers,
normal output and stack. On macOS, a timeout collects a two-second `sample` then
kills/reaps that process. Default execution timeout is ten seconds per mode.

`build.log`, `control.txt`, `normal.txt`, optional `invalid.txt`, sampled stacks
and `metadata.json` remain in the selected build directory. No competing malloc
interceptor or sanitizer suppression is used. Sanitizer/DYLD variables inherited
from the shell are removed only in probe children; fail-fast ASan/UBSan options
are set there. Leak detection is not disabled; a successful normal/UAF probe does
not validate leak-detection support. Qualify that separately on a working runtime.

Only after exit 0, configure Origami in a separate clean build directory with
`ORIGAMI_SANITIZE=ON`, `ORIGAMI_SANITIZERS=address,undefined`, explicit compatible
C/C++/Objective-C++ compilers and `ORIGAMI_BUILD_PLUGIN=ON`. Keep the Release
directory unsanitized. Run progressively through core construction, processor
construction/destruction, prepare/process/release, focused tests, state/routing/
lifecycle and finally complete B01 including its long render. Existing callback
allocation interception is deliberately excluded by `ORIGAMI_SANITIZED`; the
DSP scenarios must remain enabled. Do not call a failed runtime probe ASan-clean.
