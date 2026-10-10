# Origami U03 — immutable release artifact and optional verified download

## 1. Baseline / final commit

Branch: `mct-origami-nodes-visual-feedback-p03`.
Baseline: `307c812f78360735ce5c632a9c7a1b90325e9e62` (U02).
Final: the U03 commit containing this report; the delivery response records its exact SHA.
The pre-existing modification to `public/wasm/soura-dsp/soura-dsp-engine.json` was preserved and excluded.
Before modification, U02 account/update CTest passed (2/2), and release backend tests passed (9/9 with Firestore emulator).

## 2. Files changed

Backend: `functions/src/releases/{releaseArtifact,origamiDownloadCore,origamiReleasesCore,origamiReleases,releasePublication}.js`, `functions/index.js`, `storage.rules`; backend release/download tests.
Native: `shared/melogic/update/{ArtifactDownload,UpdateService,ReleaseManifest}.{h,cpp}`; narrow account bridge additions in `AccountService.{h,cpp}` and `FirebaseBackend.cpp`.
Integration: `origami/CMakeLists.txt`, `origami/plugin/ui/GlobalPanel.cpp`, native Account/Update/Download/Plugin tests, and this QA directory. Processor, DSP, preset codecs, history and authorization decisions are unchanged.

## 3. Artifact schema

Each release requires exactly one `artifact` object:

```text
artifactId       [A-Za-z0-9_-]{1,128}
kind             pkg
storagePath      server-constructed canonical path
objectGeneration canonical positive decimal string, exactly representable by installed GCS SDK
sizeBytes        integer 1..1073741824 (1 GiB)
sha256           exactly 64 lowercase hexadecimal characters
```

The existing release binds product, release ID, version/build/revision, channel, macOS and architecture. The path also binds release ID/architecture/artifact ID. Unknown artifact fields fail validation. Legacy release rows without a complete artifact now fail closed during selection; prepare a new complete release rather than silently changing an already published record.

## 4. Storage namespace / rules

`software-releases/origami/{releaseId}/macos/{architecture}/{artifactId}.pkg`, in the existing default Firebase bucket (`melogic-records.firebasestorage.app`). An explicit rule denies all direct client reads/writes under `software-releases/**`; no broad allow matches this namespace. Anonymous, beta and admin-owner clients are tested against Storage emulator rules.

[Firebase Storage Rules](https://firebase.google.com/docs/storage/security) govern Firebase client access. They do not establish Cloud IAM, object ACLs, public access prevention, retention or release-publisher authority. **Live IAM/ACL/public-access configuration was not inspected or changed.** Trusted deployment must verify it before distributing any private artifact.

## 5. Trusted publication validation

`storageArtifacts(bucket).prepare(releaseIdentity, artifactId)` constructs the canonical path, reads Storage metadata, derives generation/size, and streams the exact generation to compute SHA-256. No public callable exposes prepare/publication. Trusted release tooling uses:

```js
const artifacts = storageArtifacts(getStorage().bucket())
const artifact = await artifacts.prepare(releaseIdentity, artifactId)
await writeRelease(db, { ...releaseIdentity, artifact }, trustedActorUid, artifacts)
```

`writeRelease` now requires this trusted Storage verifier before publication. It independently rechecks existence, exact generation, size and SHA-256 from the bytes. Encoded objects are rejected so Storage decompression cannot change the byte identity. Hashing has byte and 120-second wall bounds, and SDK failures become generic errors. Firestore still enforces transactional monotonic build allocation and a bounded active publication window. Unpublication requires no object read, allowing a broken/missing artifact to be withdrawn.

## 6. Immutable generation binding

Published/unpublished metadata remains immutable except status, including the entire artifact. Every metadata/hash/sign operation addresses the exact stored generation. The installed GCS SDK converts generation strings to numbers, so generation values outside safe integer representation are explicitly rejected. No rounding or fallback to the latest object is allowed.

If a replacement generation is uploaded under the same name, the original generation is served if retained. If it no longer exists, issuance fails closed. A bad release must be unpublished and replaced by a new build. This is application-level publication immutability under trusted publisher IAM, not a claim of bucket WORM retention.

## 7. Download callable contract

`getOrigamiReleaseDownload` (us-central1) accepts only `{releaseId, artifactId}`. It rejects caller UID, entitlement, bucket, path, generation, hash, URL and any other extra fields.

It returns only:

```text
schemaVersion: 1
releaseId
artifact: {artifactId, sizeBytes, sha256, downloadUrl, expiresAt}
```

The native decoder checks strict object sizes, field types, identifiers, size/hash format, expiry and URL policy. Callable responses retain the existing 64 KiB transport bound. Signed URLs remain worker-local and are absent from snapshots, logs, project state and persisted metadata.

## 8. Eligibility / publication revalidation

The callable verifies the Firebase bearer with revocation checking and matches its UID to callable authentication. It re-reads the canonical user entitlement, enabled Origami product and exact release. Active/unexpired beta entitlement and a published, non-future beta release with the requested canonical artifact are required. Availability results confer no authority.

After Storage inspection, eligibility/publication are checked again before signing. Concurrent changes after that check remain subject to the short-lived capability boundary below; Firestore and GCS signing are not one atomic transaction. Internal/stable commerce policies remain disabled.

## 9. Signed URL lifetime / security

V4 signed read URLs last **10 minutes**, allowing a reasonably sized installer transfer while limiting bearer exposure. The exact generation is included in the signed query. Issuance validates HTTPS, the expected Google host, generation and an 8192-character URL bound. No Firebase ID/refresh token is included.

[GCS signed URLs](https://docs.cloud.google.com/storage/docs/access-control/signed-urls) are bearer capabilities. Unpublishing or revoking entitlement blocks new issuance; it cannot necessarily invalidate an existing URL before its expiry. Existing HTTP transfers can also outlive the point when a new request would be denied. The native worker conservatively stops at the descriptor deadline. Tests establish the issuance/revocation boundary and the signed expiry; they do not claim live GCS expiry enforcement was tested. A real installed-SDK V4 signer test uses an ephemeral in-memory fixture RSA key, without publishing or saving credentials.

## 10. Native architecture

The existing owned UpdateService worker performs authenticated download requests, transfer, file IO and hashing only after `download()`. Automatic availability checks never call it. The authenticated opaque account transport gains one specific download operation and cancellable request; tokens never enter downloader/UI APIs. Production instances share the existing weak-registry service, coalescing active requests within the shared service/module domain.

ArtifactDownload owns its active stream. A scoped watchdog owns and joins its thread; it cancels on a 30-second stall, ten-minute total deadline, expiry or stale account context. Outer/per-operation autorelease pools drain native owners before framework teardown. No detached worker, UI capture or static strong service owner is introduced.

## 11. Staging safety

A fresh `Melogic-Origami-update-XXXXXX` directory is atomically created in the current user's OS temporary directory, mode 0700. Fixed local names are used: `artifact.pkg.part` and `artifact.pkg`. Remote filenames and IDs never form local paths. Directory/file descriptors use `O_NOFOLLOW`, exclusive creation and mode 0600. Free space must cover the expected artifact plus a 16 MiB reserve; write, flush, seek and publication failures fail closed.

Only after verification is the partial atomically linked to the verified name with **no overwrite**, then unlinked. Errors/cancellation remove only the two owned filenames. Stale cleanup considers old (>24h), owned, mode-0700 staging directories; it does not recurse or follow directory symlinks. Fixtures prove partial symlinks cannot delete external targets and unrelated files are preserved.

Verified staging is service-owned and deleted on shutdown/destruction or the next transfer. U03 does not persist resumable downloads or an installer handoff. It never writes Applications, plugin bundles, presets or Melogic account data. Same-user malicious processes are outside the filesystem isolation provided by 0700 permissions.

## 12. Redirect / credential policy

Artifact transfer accepts only HTTPS `storage.googleapis.com` URLs under the existing bucket's Origami release namespace. Custom ports, other buckets/hosts, credentials, fragments and unexpected schemes are rejected. JUCE follows **zero redirects**; only HTTP 200 is accepted. Signed query parameters stay in the GET URL. The artifact transport has no account credential parameter and sets only `Accept-Encoding: identity`; it never forwards the callable Authorization header.

The installed macOS JUCE implementation was inspected: redirect count is passed to its NSURLSession delegate, connection timeout is 30 seconds, and received data is consumed by its InputStream. JUCE/OS networking may buffer data internally; the application bounds accepted/written bytes and the trusted object itself to 1 GiB, rather than claiming a strict transport heap cap. Loopback fixtures exercise real GET framing, absence of Authorization/Cookie headers, HTTP errors, redirects, cancellation and timeout. Production transfer validation has no HTTP/loopback exception.

## 13. Byte-size verification

The descriptor must be 1..1 GiB. Content-Length, when available, must equal the expected size. Actual bytes are checked throughout transfer, and exact equality is required at completion. Oversized or truncated bodies never become verified. Chunk IO uses a 64 KiB buffer, and all write/flush errors reject the artifact.

## 14. SHA-256 verification

After complete size verification and flushing, the worker rereads the opened file through a buffered cancellable input stream and computes JUCE SHA-256. Comparison uses a strictly validated lowercase 64-digit representation. Hashing failure, cancellation, incomplete reads or mismatch removes staged data and cannot publish VerifiedDownload. No retry path accepts previously mismatched bytes without full fresh verification.

## 15. Apple signature verification boundary

VerifiedDownload means **size and SHA-256 verified only**. There is no Apple publisher/team/notarization success flag and no fake production identity. U04 must establish the real Melogic Developer ID Installer identity/team and package-signing/notarization pipeline, then implement read-only package signature/certificate-chain/team verification and Gatekeeper install assessment before any installation offer. `pkgutil --check-signature`, `spctl --assess --type install`, and staple validation are tooling candidates, to be implemented against the actual signed package and supported macOS policy rather than simulated success. See [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

## 16. State machine

U02 Idle / Checking / UpToDate / UpdateAvailable / CheckFailed remain. Explicit action adds RequestingDownload → Downloading → Verifying → VerifiedDownload. DownloadFailed provides request/transport failure feedback; VerificationFailed distinguishes size/hash failures. Cancel restores an optional UpdateAvailable presentation. Operation epochs prevent late results after cancel from overwriting newer state. Shutdown is terminal and hides snapshots. No Installing, Installed or RestartRequired state exists.

## 17. UI behavior

Global offers Download Update and Later; notes/minimum OS remain in the tooltip. During a requested download it shows restrained percentage/received/total MiB feedback and Cancel. Failures offer Retry Download. Verified state shows Update Downloaded / SHA-256 verified and a details control explicitly stating installation support and Apple identity verification are unavailable. No Install button or installation-success claim exists. `update-available.png` is an injected beta-candidate fixture on the development Global panel, not a live signed-in production release. Later stays editor-local, following U02 behavior, and no automatic failure modal interrupts synthesis.

## 18. Cancellation / shutdown

Cancel increments the operation epoch, interrupts the isolated callable/artifact transport and removes partial data. Quit uses the existing Standalone update shutdown before account/framework teardown. Service destruction cancels and joins; the watchdog also joins before stream/native owners disappear. Editor destruction leaves the independently owned service safe. Cancellation/shutdown are terminal for that operation and do not invoke account sign-out, license actions, audio mute or project edits.

## 19. Account / publication changes

A changed account UID/state/command epoch hides stale snapshots immediately and cancels an active artifact stream through the watchdog. Completion cannot associate a stale result with a different account/context. Release identity remains fixed for the operation; newer UI requests cannot overwrite an active candidate.

Entitlement expiry or unpublication after URL issuance does not magically revoke the GCS bearer. A same-context transfer may finish before expiry, but that is only a verified download, never installation authority. U04 must revalidate access/publication and Apple trust before a future installation handoff. Updater failures never alter account or authorization state.

## 20. Backend tests

Final full regression: **35/35 pass, no skips**, including desktop authentication, licensing, admin permission/security/owner access, release selection/publication and the new download suite. A subsequent final focused release/download run passes **18/18**, after the malformed timestamp guard was tightened. Evidence: `backend-tests.txt` and `backend-final-focused.txt`.

Coverage includes input spoofing, unverified/revoked identity, expired/revoked entitlement, disabled product, draft/unpublished/future release, wrong artifact, incomplete metadata, missing generation/object, size/hash/encoding failures, replacement generations, exact V4 signing, bounded expiry, post-inspection revocation, immutable metadata and concurrent Firestore publication. Firestore and Storage emulator privacy rules run without skips. No live signing identity or production release was used.

## 21. Native tests

`origami_download` uses deterministic memory streams plus real loopback transport fixtures: explicit action, success/progress, malformed/expired response, scheme/host rejection, truncation/oversize/content-length/hash mismatch, errors/redirects, connection timeout, stalled-body watchdog, cancellation, context change, destruction/shutdown, coalescing, staged-file visibility/permissions, symlink/stale cleanup and no artifact Authorization header. Account tests exercise the new opaque bridge for every existing transport failure classification and prove authorization unchanged. Plugin tests destroy/recreate the Global editor during a download request and prove project bytes/history/authorization remain unchanged.

During implementation, tests caught and corrected EOF handling for hash-block-aligned files, then the seek contract required by BufferedInputStream. Final regression results below refer to the corrected source. Tests use isolated fake accounts/credentials; no real-account launch loop or repeated login-Keychain prompts were needed.

## 22. Realtime separation evidence

`PluginProcessor.cpp` and `.h` are byte-for-byte unchanged from baseline. The entire .cpp SHA-256 is `47aa9481f95b235529c8857b99d5fdc6bad88212c9577d7ef6dc66ae01bfd7b9`. Thus processBlock and project/preset serialization are unchanged. Download/network/hash/filesystem/Firebase/Keychain/locking/allocation remain worker-side, with UI snapshot polling on the message thread. The DSP/core targets do not depend on download code. Evidence: `realtime-evidence.txt`.

## 23. Regression results

The full native CTest run passed **14/14** in 265.75 seconds. The final cancellation-publication-window cleanup is additionally checked by rerunning the affected Update/Download suites and focused Global integration. The affected Update/Download rerun passed **2/2** in 95.00 seconds, and focused Global integration passed **3817 checks**. Evidence is recorded in `native-tests.txt`, `native-final-focused.txt`, `global-integration.txt` and `native-check-counts.txt`. Suites include account, update, download, activation/UI, state, history, presets, content, wavetable, modulation, FX, Spectral Tune/quality, EQ headroom and B01 DSP torture. The CI/sanitizer/plugin-validation contract checker passes. **No ASan-clean claim is made**; this pass runs the normal native regression and does not resolve the previously documented ASan runtime limitation.

## 24. Build results

Tests-off Release Standalone, AU and VST3 builds are recorded in `build-artifacts.txt`, with tests-only fixture symbols checked absent. They retain U02's local development release identity (0.1.0 / development / build 0); U03 does not invent a beta build identity. JUCE's existing development ad-hoc VST3 signing step is not Developer ID signing. No package was constructed, notarized, installed, executed, or deployed; installed application/plugins were untouched.

## 25. Known limitations

No Functions/rules deployment, real release upload, live IAM/public-access audit or real authorized production download occurred. GCS bearer revocation/expiry behavior is documented and issuance-tested rather than tested against a live bucket. Publication is trusted server tooling, not an admin web upload UI. Internal/stable policy, cross-process or cross-format-binary locks, resume, delta updates and persistent staging handoff remain absent. Host/bucket allowlist deliberately matches the current production client configuration; staging deployment needs its own reviewed native bucket/config binding. Disk-full handling is implemented and inspected; tests do not exhaust the user's disk. Same-user hostile filesystem processes and a strict JUCE networking heap cap are not claimed to be covered.

## 26. Exact U04 work

Establish the actual Melogic Developer ID Installer/team, reproducible production .pkg layout for Standalone/AU/VST3, hardened signing/notarization/stapling and retention/publisher IAM policy. Audit/deploy the private backend/rules and signing runtime permissions, then exercise an actual private release end to end in a controlled environment. Add package signature/expected-team/notarization checks and failure tests. Separately design/review explicit installation, host/plugin unload requirements, privileges/helper policy, verified-file persistence/handoff, compatibility checks, rollback and any relaunch UX. Revalidate eligibility/publication/trust immediately before installation. U03 deliberately ends at VerifiedDownload.
