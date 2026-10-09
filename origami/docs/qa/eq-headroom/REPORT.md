# B01 — EQ headroom correction

Baseline: `6cb28da5d17b4b3c275060919664b32322b6972c`. Feature freeze preserved: no new effect, limiter, output clipping, gain compensation, UI redesign or unrelated DSP change. Classification: **B — parameter-domain / product-safety defect**. The original recurrence and parameter mappings were correct; allowing eight unrestricted resonant cuts/shelves and eight independently maximal boosts was not an appropriate domain for this embedded EQ.

## Exact original reproduction (before DSP changes)

Production peak **52,983,876**, at 48,000 Hz, block 1,024, sample 447 of the block starting at frame 10,602 (absolute frame 11,049). Winning block left RMS **16,114,423.0591**; whole-fixture left RMS **919,536.2669**. Left input peak **8**, winning-block RMS **5.6567183**; right input is −0.5 × left.

All eight bands: **ON / HIGH CUT / target frequency 20,000 Hz / stored gain +24 dB / target Q 12**. Gain is inactive for High Cut. This was not an eight-Bell +24 dB case.

Exact fixture sequence: default EQ, then every normalized parameter zero, then every normalized parameter one, followed by other B01 cases. Each setting processes blocks **1, 2, 3, 8, 16, 17, 32, 63, 64, 127, 128, 256, 257, 512, 1,024, 2,048**, without resetting between settings. At each block, `offset` is its starting frame: when `offset % 4 == 0 or 3`, input is zero; when it equals 1, input is `0.25f * float(sin((offset+i)*0.03))`; when it equals 2, input is `8.f * float(sin((offset+i)*0.27))`. The winning block uses the last case, **2,062.648 Hz** at 48 kHz. B01's fixed PRNG seed is `0xb010cafe`; the maximum precedes the random setting. The original executable output is retained beside this report.

Production uses 30 ms smoothing of log frequency, dB gain and physical Q, with coefficient designs every 32 samples within each processing call. At the maximum, the legacy reference's actual coefficient frequencies were **3,226.527 / 3,277.319 / 3,337.254 / 3,389.556 / 3,311.157 / 3,311.157 / 3,311.157 / 3,311.157 Hz**, all at coefficient Q **8.8839264**. Unequal starting frequencies reflect the preceding default/disabled states' still-running smoothers.

Measured production after each stage in the winning block (prefix processors replayed the identical history; these are real production stage outputs, not solely an analytic estimate):

| Stage | Peak | RMS | Peak-envelope ratio to prior stage |
|---|---:|---:|---:|
| Input | 8 | 5.65672 | — |
| 1 | 56.8217 | 15.9489 | 7.103× |
| 2 | 378.752 | 87.7436 | 6.666× |
| 3 | 2,443.487 | 578.839 | 6.451× |
| 4 | 15,280.086 | 3,893.718 | 6.253× |
| 5 | 108,870.961 | 29,929.155 | 7.125× |
| 6 | 828,918.875 | 237,784.279 | 7.614× |
| 7 | 6,563,462 | 1,937,564.196 | 7.918× |
| 8 | 52,983,876 | 16,114,423.059 | 8.073× |

Peak ratios describe stage envelopes; individual maxima need not occur at the same sample. The frozen-coefficient cascade at the peak has its maximum response near **3,297.69 Hz**, approximately **31.78 million ×**. Its response at the input tone is only 44.28×, so the observed waveform cannot be explained by a steady sine at that frozen tone alone: resonant stored energy is being excited and transported during the sweep. There is no unique stationary output frequency for this transient. The steady final 20 kHz/Q12 cut cascade has a peak of **432,980,685×**, near **19,993.35 Hz**; its response at the 2,062.648 Hz input tone is 1.01062×.

## Root cause and characterization

Primary mechanisms: **B + D + E**, plus expected transient excitation under **F** from the request's mechanism list. Each High/Low Cut has a resonance peak of `Q / sqrt(1 - 1/(4 Q²))` for Q > 1/√2: Q12 gives **12.01043×**. Eight overlapping sections multiply. Stored Q was also used unchanged for shelving filters: +24 dB/Q12 shelves reach approximately **178.43× per band**, far above the nominal shelf plateau. Ordinary Bell peaks are correctly bounded by their gain setting, but eight overlapping +24 dB Bells still multiply to **+192 dB / 3.981 billion×**. Per-band boost alone was therefore not a sufficient product invariant.

No duplicated gain conversion, invalid normalized mapping, coefficient normalization error or numerically unstable interpolation was found. An independent double-state/coefficient oracle reproduces the original peak at **52,983,838.76** (relative difference about 7×10⁻⁷). Legacy/current transition measurements separate initialized, slow sweep, rapid alternating targets and a single jump; all use the same bounded input and the legacy equations remain finite. See the recorded transition table. The high-Q domain can create large onset ringing even without automation; slowly crossing resonance can be worse than the original fast sweep. The original maximum is **transient**, not settled gain at the final cutoff.

Original single-band audit: six shapes × frequencies 100/1,000/15,000 Hz × gain −24/0/+6/+24 dB × Q 0.3/Butterworth/4/12. Early RMS measurements had up to 2.8% error because a short window did not settle the boosted Bell pole Q (`Q*A`) and depended on phase. The final regression uses longer pole-based settling and sine/cosine least-squares amplitude, rather than weakening a tolerance; it checks production against an independently calculated transfer within **0.2%**. Cascade regression measures 1–8 active bands: identical Bells at moderate/max Q, nearby centers, musical spectral spacing, maximum-Q cuts and mixed shelves, against the independent product response within **0.5%**.

Professional EQs can reasonably expose large individual ranges: [FabFilter's official Pro-Q 3 manual](https://www.fabfilter.com/downloads/pdf/help/ffproq3-manual.pdf) documents ±30 dB and Q up to 40, and cautions that Q interpretations differ across EQs. This does not justify copying those ranges or assume that Origami's raw cut/shelf Q has the same musical meaning. The chosen bound is an Origami product decision tied to its existing single-band +24 dB capability and downstream headroom, not an asserted industry standard.

## Correction and explicit invariant

Frequency remains **20–20,000 Hz**, gain descriptors remain **−24…+24 dB**, and their normalized mappings/IDs/defaults are unchanged. **Bell and Notch Q remain 0.3–12**. **Low/High Cut and Low/High Shelf Q are restricted to 0.3–1/√2** (≈0.70710678). Shelves become monotonic and cuts cannot add resonant gain. Bell retains narrow, explicitly gain-controlled resonant sound design; the separate production Filter effect retains its existing resonant modes/ranges.

All eight **stored positive gains share +24 dB**, including disabled and non-gain shapes. Reserving the stored settings makes enable/type transitions safe without a latent over-budget setting. Cuts retain −24 dB. Live gain edits clamp the edited band to the remaining budget, preserving other bands; bulk restoration/raw modulation proportionally project positive gains when the sum exceeds the budget. This intentionally restricts some legacy disabled-band banks as well as sounding over-budget states; it is not hidden output attenuation.

For these legal shapes, `|H_band(f)| <= max(1, 10^(gain/20))`. Therefore `|H_EQ(f)| <= 10^(sum_positive_gains/20) <= 10^(24/20) = 15.848932` (float tolerance only). Eight coincident maximum requests become eight +3 dB Bell gains on bulk adoption, or one +24 dB and zero remaining boost when entered sequentially. Both stay within the same defined domain. No sample is clipped, normalized, limited or automatically level-compensated by this correction.

The shared domain is applied by graph editing and graph decoding, and again to raw/modulated DSP targets. A Bell→cut/shelf switch also caps the existing smoothed Q immediately; resetting the band's integrators alone would otherwise leave a high-Q smoothing trajectory in the new shape. Common 30 ms gain smoothing preserves the convex positive-gain budget. Coefficients and the signal recurrence are unchanged. The existing EQ editor's control ranges/readouts now follow the legal remaining gain and shape-specific Q; tooltips explain the constraints. No layout changes.

The invariant is **static frequency-response gain**, not an assertion that all time-varying output peaks are at most 15.85×. Regression additionally compares automation waveforms with the independent legal-domain recurrence, including frequency/gain/Q/on/type changes and bypass; it does not hide transients behind a final limiter or simply substitute an arbitrary ceiling.

## Result, compatibility and downstream headroom

The entire original B01 EQ fixture now peaks at **12.196966**. The formerly winning High-Cut block and cumulative corrected stage measurements are retained in `corrected-reproduction.txt`. The **maximum legal static EQ transfer is +24 dB / 15.848932×**, reached by coincident positive Bells and shelves; legal cuts/notches do not exceed unity. Ordinary fixtures—gentle shaping, bass/presence boosts, narrow corrective cut, broad shelf, multiple moderate bands, and a +12 dB/Q12 sound-design Bell—retain their exact normalized parameters and match the legacy transfer reference. This is not a promise that formerly over-budget or high-Q shelf/cut presets sound unchanged.

No codec version or normalized frequency/dB/Q interpretation changes. Structurally valid old graph, effect preset, workspace and host-state paths all pass through graph decoding and canonical projection. Unsafe stored Q/boost combinations are constrained; ordinary legal documents round-trip byte-for-byte. Repeated projected save/load is idempotent. Direct raw parameter/modulation callers cannot bypass the same DSP bounds. Older application versions do not know this new policy.

Existing headroom trace: EQ input already uses the production finite/±64 input guard; individual bands have no added clipping; EQ output passes through graph routing/bus summation/GLOBAL FX and the one final Master stage. Most downstream production FX, including Spectral Tune, already guard their input at ±64. Compressor detectors, nonlinear Drive and feedback FX are not transparent at arbitrarily large amplitudes. A unit-peak input with worst static EQ becomes 15.85; **4× input becomes 63.40**, within that established downstream input guard. An 8× fixture can still exceed it and intentionally exercise existing protection. With EQ input at its preexisting ±64 guard, the legal static output bound is approximately 1,014.33, rather than millions/billions.

Direct downstream tests feed valid worst-domain EQ output into **all 15 production FX**, and separately feed each downstream algorithm raw amplitudes **2/4/16/100/1,000/1,000,000**. Every observed output remains finite and settles after 90 seconds of silence, including Delay/Reverb/Diffuse/Spectral Tune. These high-level cases exercise preexisting clamps/nonlinear behavior; they do not establish transparent sound at those levels. The actual auxiliary-bus EQ→GLOBAL-FX environment→Master path is additionally tested at five rates, small/irregular/large blocks, graph bypass transitions, final +6 dB gain and exact Master mute, with callback allocation guards.

There is still no universal normalized-output guarantee: deliberate FX/global gain, coherent bus summation and +6 dB Master can exceed full scale. Multiple EQ instances remain bounded by their individual policies and existing input guards. This pass closes the extreme **EQ-domain** headroom defect; it does not add a general limiter or certify every gain-staging combination for monitoring.

## Validation and beta decision

- Clean Release build: core, AU, VST3 and Standalone succeeded. Complete CTest: **11/11 passed**, 282.95 seconds.
- B01 Release: **2,844,658 checks / 318,781,890 samples / 392,344 callbacks / 0 failures**.
- UBSan RelWithDebInfo, B01's existing configuration: **11/11 passed**, 591.20 seconds; halt-on-error enabled, no UBSan diagnostics. B01: **2,438,180 checks / 318,781,890 samples / 392,344 callbacks / 0 failures**. The check-count difference is the deliberately disabled allocator interposition under sanitizers, not missing DSP scenarios.
- New EQ regression in each configuration: **373,552 checks / 157,011,364 inspected samples**. Inspected samples include reference and repeated measurements, not exclusively unique production frames.
- Focused actual host/preset/Undo/Redo and EQ→GLOBAL FX→Master check: Release **750,700 checks**, UBSan **748,139 checks**; each **1,486,848 samples / 1,281 callbacks / 0 failures**.
- Seven ordinary musical fixtures preserve their parameters and legacy response. All 15 downstream FX remain finite and settle; B01 also covers their full parameter endpoints/choices at five sample rates.
- Four-rate automation matrix maximum: **3.397416** on input peak 0.5. Original high-Q cut transition audit (initialized / slow / rapid / jump) produced legacy peaks **1,568,492.75 / 3,398,698,752 / 22,392,714 / 682,326,848**; corrected peaks **8.004477 / 7.999878 / 0.0791885 / 8.000504** on input peak 8. Full RMS and final-quarter RMS are in the retained EQ output.

Raw EQ, B01, focused integration and CTest evidence is stored beside this report; legacy evidence was captured before changing DSP. Developer bundle signature checks are recorded separately; these are local ad-hoc builds, not notarized distribution artifacts or interactive DAW qualification.

**EQ headroom need not remain a Beta 0.1 blocker under the defined domain and passing regressions.** The original unrestricted domain was not product-safe; the corrected EQ has an explicit bounded static transfer and tested transient/state behavior. The separate B01 ASan runtime-startup blocker remains unresolved by this focused pass; this is not an overall beta-ready declaration. Interactive listening/DAW coverage and general output gain staging remain outside the automated EQ guarantee.

Reproduce: configure/build as B01, then `ctest --test-dir origami/build-multihost --output-on-failure`. New executable `origami_eq_headroom` runs all sections by default, or accepts `reproduce`, `characterize`, `domain`, `cascade`, `musical`, `automation`, `transitions`, `downstream`. `origami_dsp_torture eqMaster` isolates the bus/GLOBAL-FX/Master integration. UBSan uses `ORIGAMI_SANITIZE=ON`, `ORIGAMI_SANITIZERS=undefined`, and `UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1`, as in B01. ASan was not retried or claimed to pass.
