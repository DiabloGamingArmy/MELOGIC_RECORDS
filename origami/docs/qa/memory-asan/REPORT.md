# B01 memory / ASan validation

**Final classification D — ASAN COVERAGE UNAVAILABLE DUE TO TOOLCHAIN/RUNTIME FAILURE.**
This is not an ASan-clean result. No Origami memory defect was discovered by ASan,
because no instrumented Origami execution was possible with the available runtimes.
No production source, DSP, state format, ownership or assertions were changed.

## Baseline

Branch `mct-origami-nodes-visual-feedback-p03`, HEAD
`88667d480ff0a1f6edb0459dbf485c961f44cc61`, initially clean. Before adding test
infrastructure, existing Release CTest passed **11/11**, 131.78 seconds, including
the dedicated EQ regression and complete B01 (2,844,658 checks, 318,781,890 samples,
392,344 callbacks, zero failures). Adjacent baseline evidence retains the results.
The EQ-domain blocker remains closed.

## Original failure, independently confirmed

The original `beta-b01/asan-startup-stack.txt` shows dyld invoking
`libSystem_initializer` → `__malloc_init` → ASan initialization → shadow mapping →
`MemoryRangeIsAvailable` → dyld shared-cache iteration → block allocation → ASan
initialization again → `StaticSpinMutex::LockSlow`. This is during libSystem's
initializer, before application initializers/main, not an Origami processing or
JUCE ownership stack. The surviving historical `build-sanitizers` Debug cache/executable links the dynamic
Clang ASan runtime through its compiler-resource rpath; compiler/link flags
include `-fsanitize=address,undefined -fno-omit-frame-pointer`. Its deployment
target is macOS 26.0 with SDK 26.2. The B01 sanitizer directory is now configured for UBSan alone, so its overwritten
ASan cache is not presented as recovered original evidence. The surviving cache
was inspected, not assumed to be the exact failed B01 executable. Neither
historical directory was reused for the fresh probes.

Three **clean, independently configured native probe builds** reproduce that same lock
without linking any Origami, JUCE or application frameworks. Each unsanitized
control prints constructor/main markers, allocates/frees, and exits 0. Each
sanitized normal execution prints neither marker, times out at ten seconds, is
sampled for two seconds, then killed and reaped. This confirms the previous
diagnosis independently and rules out Origami/JUCE static initialization as a
necessary trigger. No repeated multi-minute spins were allowed.

## Available compilers / runtimes

Environment: arm64, macOS **26.6.2 (25G83)**. Active developer directory is
`/Applications/Xcode.app/Contents/Developer`; JUCE is **9.0.2**. No sanitizer or
DYLD variables were present in the invoking environment. Normal Release uses
Apple clang 17, arm64, minimum macOS 26.0 / SDK 26.2.

| Candidate | Compiler | Clean probe | Result |
|---|---|---|---|
| Active Xcode | Apple clang 17.0.0, `clang-1700.6.3.2` | ASan+UBSan | pre-constructor/main initialization lock |
| Command Line Tools | Apple clang 17.0.0, `clang-1700.0.13.5` | ASan+UBSan | same lock |
| Active Xcode, isolated ASan | same Xcode compiler | ASan only | same lock; UBSan combination not responsible |
| Xcode under existing Rosetta | same Xcode compiler, x86_64 | ASan+UBSan | SIGILL during pre-main runtime initialization |
| CLT under existing Rosetta | same CLT compiler, x86_64 | ASan+UBSan | same pre-main SIGILL |

Exact compiler/resource paths, runtime SHA256 hashes, linkage, instrumented
symbols, deployment target and sampled call graphs are recorded in the
`probe-*.txt` files. The two runtime hashes differ. `/usr/bin/clang` resolves
through the active developer selection and is not a third independent runtime.
Installed Xcode apps/toolchains, `/Library/Developer/Toolchains`, Command Line
Tools, and Homebrew LLVM locations were inspected; only those two compatible
compiler/runtime installations were found. No upstream/Homebrew LLVM or other
Xcode toolchain was installed. No system selection, library or package was changed.

Rosetta was already available (`arch -x86_64 /usr/bin/true` exited 0). Two additional
clean x86_64 probes were therefore attempted, one per compiler. Both unsanitized
controls passed. Both ASan+UBSan probes exited with SIGILL before either marker.
The corresponding macOS crash reports show translated x86_64 execution in
libSystem/pthread initialization called through dyld introspection from
`__sanitizer::get_dyld_hdr` → shadow-memory initialization. This is a distinct
pre-main runtime/platform failure, not the native spin and not an Origami stack.
Relevant crash frames are retained without personal/machine identifiers. No
working native or translated runtime was found; no Rosetta installation occurred.

## Runtime probe and operational limits

`tools/sanitizer-probe` is a standalone CMake project, not referenced by Origami's
root CMake or shipping targets. Its runner uses a fresh build directory, explicit
compiler and deployment target, fail-fast ASan/UBSan options and no suppression
or competing malloc interceptor. See its README for exact reproduction commands.
Fresh probes used RelWithDebInfo, explicit arm64/x86_64 targets and deployment
target 26.0. Five clean candidates were tested in total.

The opt-in deliberate heap-use-after-free control is compiled/instrumented, but
**was not executed**: normal ASan startup must pass first. Instrumentation symbols
are present; this does not demonstrate a functioning diagnostic runtime. The
runner's clean-build/control/timeout/sampling/reaping paths were exercised;
its success/expected-invalid-diagnostic paths remain unqualified here.

The progressive Origami ASan ladder, long-render/lifecycle memory checks and leak
detection are **unavailable**, not passed. No leak detection was suppressed to
obtain green results. No memory finding was dismissed as third-party code: the
only observed failure is the sanitizer initialization deadlock itself. Existing
Release callback allocation interception remains intact and remains excluded
under sanitizers through `ORIGAMI_SANITIZED`.

The next dependency to qualify is a compatible updated Clang/compiler-rt with
allocation-free Darwin shadow-range inspection. Upstream [LLVM PR 167797](https://github.com/llvm/llvm-project/pull/167797),
merged as `6a89439423351be2d63e13e191acd4cb33e0aaff`, changes Darwin
`MemoryRangeIsAvailable` to avoid heap allocation. That is a relevant candidate
fix, not proof that a particular untested release works on this machine. A
standard upstream LLVM or newer Xcode installation should first pass this probe
(including the deliberate ASan diagnostic) before rebuilding Origami. No new
toolchain was installed during this bounded investigation.

## Final functioning validation / production protection

- Clean Release build: core, AU, VST3 and Standalone succeeded. Complete CTest
  **11/11 passed**, 149.48 seconds. B01: **2,844,658 checks / 318,781,890 samples /
  392,344 callbacks / zero failures**.
- Clean RelWithDebInfo UBSan build: core and all three wrappers succeeded.
  `UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1`, complete CTest **11/11 passed**,
  240.57 seconds, no UBSan diagnostics. B01: **2,438,180 checks / 318,781,890 samples /
  392,344 callbacks / zero failures**. Its lower check count excludes allocator
  interposition, with the same DSP samples and callback scenarios as Release.
- Dedicated EQ regression passed in each configuration: **373,552 checks /
  157,011,364 inspected samples**, original corrected fixture peak **12.196966**.
- B01 includes state/preset/history, routing/graph mutation, repeated processor
  lifecycle and five minutes of rendered sample time. All passed in Release and
  UBSan. These are not ASan lifetime/leak checks. ASan and LSan execution remain
  unavailable; no invalid-access diagnostic was operationally qualified.
- The standalone probe's five fresh builds and all five unsanitized controls
  succeeded; three native sanitized starts timed out and two translated starts
  failed with pre-main SIGILL. Help/argument parsing and Python syntax checks pass.
  No Origami tests, assertions or DSP cases were removed.

The complete CTest summaries, compact EQ results and B01 outputs are retained
beside this report. No ASan timing is used as a performance comparison.

The Release AU/VST3/Standalone artifacts were inspected with `otool -L` and
`nm -u`: no ASan/UBSan/LSan dependencies or instrumentation references. Release
uses `ORIGAMI_SANITIZE=OFF`, and requires no sanitizer environment variables.
The probe is a separate CMake project with no shipping dependency; sanitizer-only
allocator exclusions are not active in Release. Final artifact checks are
retained beside this report. Sanitizer build directories remain separate.

## Beta decision and uncertainty

No new Origami memory defect or additional functional blocker was demonstrated.
**The existing ASan validation gap remains open for Beta 0.1 sign-off**; this pass
does not establish memory-safety qualification or overall beta readiness. Release
and UBSan are functioning evidence, not substitutes for invalid-memory-access
coverage. A working ASan runtime still needs the progressive Origami coverage,
including long render, graph replacement, state/preset history and repeated
processor lifetimes. ASan would provide evidence rather than proof of complete
memory safety; races and host-specific behavior would still remain outside it.
TSan was not run and is outside this focused pass.

Repository changes are limited to the reusable isolated probe and concise
validation evidence/documentation; no generated binaries, build trees or runtime
patches are committed. The final response records their commit hash.
