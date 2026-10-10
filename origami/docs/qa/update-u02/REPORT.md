# Origami U02 — release identity and optional availability

## 1. Baseline and final commit

Baseline: `6c88487c03d61b8c22e9fb93d92759b974f46558`, branch
`mct-origami-nodes-visual-feedback-p03`. The final implementation is the commit
containing this report; its exact ID is returned in the completion message.
The unrelated `public/wasm/soura-dsp/soura-dsp-engine.json` modification is preserved
and excluded. No production deployment, catalog writes, uploads or installed-bundle
replacement took place.

Before changes: existing native account CTest passed (8.25 s). Backend tests without
an emulator passed 3 tests and skipped 3 emulator-dependent tests; all relevant
backend cases were subsequently exercised against a fresh local emulator.

## 2. Files changed

- `.github/workflows/origami-native-ci.yml`: include shared native/config changes.
- `origami/CMakeLists.txt`, `origami/cmake/ReleaseIdentity.cmake`,
  `origami/cmake/OrigamiBuildIdentity.h.in`, `origami/cmake/WriteBuildIdentity.cmake`: identity, bundle build version, update
  library and tests.
- `functions/src/releases/{origamiReleasesCore,origamiReleases,releasePublication}.js`,
  `functions/index.js`: selection, authenticated callable and trusted publication.
- `firestore.rules`: explicit denied client access to release documents.
- `shared/melogic/update/{ReleaseManifest,UpdateService}.{h,cpp}`: independent client.
- `shared/melogic/account/{AccountService.h,AccountService.cpp,FirebaseBackend.cpp}`:
  opaque authenticated transport bridge, internal token snapshot, update endpoint.
- `origami/plugin/{PluginProcessor.h,PluginProcessor.cpp,StandaloneApp.cpp}`:
  lifetime leases and explicit Standalone shutdown only; canonical app version.
- `origami/plugin/ui/GlobalPanel.{h,cpp}`: optional status/notes/dismissal.
- `functions/test/origamiReleases.test.js`, `origami/tests/UpdateTests.cpp`,
  `origami/tests/{AccountTests,PluginTests}.cpp`: release, lifecycle and boundary tests.
- This report and its fixture/evidence files.

## 3. Canonical release identity

`installedIdentity()` supplies productId, version, buildNumber, channel,
sourceRevision, platform and running architecture. Product ID comes from the
generated identity header; version comes from the CMake project numeric core plus
an optional validated SemVer prerelease suffix. Git revision identifies source
only. Platform/architecture are selected at compile time. Global and Standalone
read the canonical identity.

## 4. Build-number mechanism

`ReleaseIdentity.cmake` validates `ORIGAMI_BUILD_CHANNEL` and
`ORIGAMI_BUILD_NUMBER`. Development requires exactly 0 and displays DEVELOPMENT.
Internal/beta/stable require an explicit positive integer <= 2147483647. No Git or
time-derived number exists. Release automation supplies its allocated number;
trusted publication transactionally enforces a product-wide increasing high-water
mark, rejecting duplicate concurrent allocations. Published identity cannot change.

`ORIGAMI_VERSION_PRERELEASE` optionally supplies identifiers such as `beta.1`.
`CFBundleShortVersionString`/JUCE's numeric version retain PROJECT_VERSION;
`CFBundleVersion` uses the explicit build number. Native human-facing identity
includes the optional suffix. The local build remains development/0/0.1.0.

## 5. Firestore release schema

Canonical path: `products/origami/releases/{releaseId}`. Strict allowlist:
`schemaVersion: 1`, `productId: origami`, bounded safe `releaseId`, strict SemVer
`version`, positive integer `buildNumber`, bounded `sourceRevision`, `channel`,
`platform: macos`, `architecture: arm64|x86_64|universal`,
`status: draft|published|unpublished`, Firestore timestamp/Date `publishedAt`,
UTF-8 `releaseNotes` <=8192 bytes, numeric dotted `minimumOS`.

No artifact fields or URLs are present. U03 can explicitly extend this schema.
Malformed records are ignored; an over-limit active catalog fails closed.

`releasePublication.writeRelease` is server-side automation code, not a callable
or public administration endpoint. It checks identity, publication time,
immutability, increasing build number and obvious numeric-core SemVer regressions;
records an audit; and permits status changes without replacing published metadata.
The active published window is limited to 100 records per channel. Older releases
must be unpublished before exceeding it. Trusted publishers must use this helper;
privileged direct Admin SDK writes remain outside client Security Rules.

## 6. Security-rule changes

All client reads and writes to `products/{productId}/releases/{releaseId}` are
explicitly denied. Parent product read permission does not grant release access.
Existing product, entitlement and key rules are unchanged. Emulator tests deny
reads, lists and publication even for a client with owner claims.

## 7. checkOrigamiUpdate contract

Input: `installedVersion`, `installedBuildNumber`, `installedChannel`, `platform`,
`architecture`. Unknown fields (including caller UID/entitlement) are rejected.

Response: `schemaVersion`, `status`, ISO UTC `checkedAt`, `expiresAt` (six hours).
Statuses: `up_to_date`, `update_available`, `no_eligible_release`. Only the update
result contains `releaseId`, `version`, `buildNumber`, `channel`, `releaseNotes`,
`minimumOS`. No URL, Storage path, token, entitlement record or privileged metadata
is returned.

## 8. Selection algorithm

Validate the installation and identity, enforce beta access, query published beta
rows with a 101-row sentinel, reject oversized active windows, discard malformed,
future-dated and wrong-platform/architecture rows, then select the highest build.
Universal artifacts match either supported running architecture. A release-ID tie
break makes selection deterministic. Equal/older builds produce `up_to_date`.
Runtime ordering is exclusively `candidate.buildNumber > installed.buildNumber`;
SemVer is validated but does not create a second ordering rule.

## 9. Beta entitlement enforcement

The callable verifies the bearer ID token with revocation checking and requires
its UID to match callable Auth. It reads the canonical user's Origami entitlement,
requires active/unexpired beta ownership and a configured enabled beta product.
Missing, expired, revoked, malformed or wrong-edition access returns no eligible
release, without revealing private metadata or changing installed authorization.

## 10. Channel behavior

Development discovery is disabled locally. Internal and stable have explicit
unsupported policy boundaries and return no eligible release. Internal records
are never selected for beta clients. No channel-switching UI or commerce policy
was introduced. Mocks inject beta identity without a production bypass.

## 11. Native UpdateService architecture

A separate `melogic_update` library depends on the account library. Its own worker
performs requests and parsing; editors poll copied snapshots. No UI pointer or
callback is retained by the worker. Update implementation is absent from DSP/core.

## 12. Authenticated request architecture

Account's existing worker privately publishes an already validated access token
and expiry. `AuthenticatedUpdateRequest` is an opaque independent transport: its
backend and credentials are inaccessible to callers. `Service::checkUpdates`
copies a valid token under the account state lock and performs the update request
outside that lock. It never restores Keychain, refreshes a token, changes account
commands, writes authorization or consumes the account transport. An unavailable
or expiring token simply fails the update check. Only tests define the private
bridge-injection friend; no shipping test bypass is implemented.

The existing POST transport supplies a 30-second timeout, 64-KiB response bound,
zero redirects, cancellation and sanitized stage diagnostics.

## 13. Ownership and shutdown

The registry holds a weak pointer. Processor members retain a lifetime lease only;
editors may disappear/reappear without owning requests. Standalone explicitly
stops updates before the account service and window/framework teardown. Last-owner
destruction joins the worker. Shutdown is terminal and serialized; no state or
transport lock is held during join. Outer and per-request macOS autorelease pools
drain before thread exit/wait. No detached threads or static strong owner exist.

## 14. State machine

`Idle -> Checking -> UpToDate|UpdateAvailable|CheckFailed`.
Only UpdateAvailable carries candidate metadata. No download or install states
exist. Stale account-generation results are hidden/discarded.

## 15. Cache and coalescing

A shared service coalesces simultaneous requests within one loaded service domain.
Successful results use a server expiry bounded to six hours. Automatic failure
backoff is 15 minutes; manual failure retry is limited to at least one minute.
The worker waits for commands instead of polling. Account UID/state/command epoch
invalidate private cached results. There are no filesystem leases or persistent
update cache; separate processes may check independently.

## 16. UI behavior

Global retains its layout and adds a compact status, Check for Updates, and—only
for an available candidate—View Update / Later. View displays notes, version,
build and minimum OS; it performs no download. Later dismisses that editor's
presentation. `update-available-fixture.png` is a dependency-injected test image,
not a production release or signed-in account. UI bounds were checked at 960,
1440 and 1920 widths.

## 17. Automatic versus manual checks

A signed-in editor session may request an automatic check; cache/coalescing
prevents timer-driven network polling. Automatic errors remain visually silent.
Manual requests can show the copied failure message. Request origin is stored in
the snapshot so a previous manual check does not expose a later automatic error.
Development status explains that release discovery is disabled.

## 18. Backend tests

Final fresh-emulator account/licensing/release run: **26 passed, 0 failed,
0 skipped**. Coverage includes strict schema/SemVer, note bounds, unknown fields,
no/equal/older/newer builds, highest build, wrong platform/architecture, universal
architecture, drafts/unpublished/internal exclusion, unauthorized/expired/revoked
ownership, verified UID/revocation, caller spoofing, denied client publication,
malformed records, bounded catalog, immutable metadata, Date/Timestamp equivalence,
concurrent build-number publication and CMake channel/build/prerelease validation.
See `backend-tests.txt`.

## 19. Native tests

The update executable tests copied state transitions, cache/coalescing, development
exclusion, context invalidation, service destruction/recreation and terminal
shutdown. Loopback JUCE requests cover success, malformed JSON, oversized payload,
HTTP errors, revoked-auth response, real timeout and cancellation during a request.
Dependency-injected account tests prove update failures preserve authorization.
UI tests destroy/recreate a panel during pending work and verify arrival/dismissal
leave authorization, serialized state and history unchanged.

## 20. DSP/realtime separation

Compared against baseline, these function bodies are byte-for-byte unchanged:

- processBlock SHA-256: `dca5af8f0499925eac11741f568706d9a772aedef85427883e4882eefe19ffb2`
- getStateInformation: `e3851b77ad225c599362afaf8c8b63f93461b8e206771d51e224c13e55128e1d`
- setStateInformation: `07131f10ea93b321f9a93b4414faf1760220bfd696404857a1e7a7e7d3262152`

The processor change is a constructor/lifetime lease, with no updater access in
audio callbacks or codecs. Update code does not access voices, MIDI, routing,
APVTS, patch/preset state, UndoManager, Nodes or Matrix. The native CI contract
verification passes; shared native/config edits now trigger that CI.

## 21. Existing regressions

Final CTest: **13/13 passed**, 388.41 seconds. Focused Global/activation: **3818 checks passed**. The update executable passed **56 checks**, including real HTTP timeout/cancellation. EQ inspected 157,011,364 samples with 373,552 checks; B01 completed 2,844,658 checks over 318,781,890 samples with zero failures. Evidence is recorded in `native-tests.txt`. It covers state,
foundation, wavetable, modulation, FX, spectral/quality, plugin/UI activation and
history, content, account, update, EQ headroom and B01 DSP torture. No ASan-clean
claim is made; the independent known ASan runtime limitation remains.

## 22. Standalone / AU / VST3 builds

Both the regression tree and a tests-disabled Release tree build the three
formats. Shipping validation uses `ORIGAMI_BUILD_TESTS=OFF` and
`ORIGAMI_ACCOUNT_QUIT_PROBE=OFF`. No Developer ID signing identity was supplied;
only the existing compiler/JUCE development-signature behavior applies. Outputs
remain in local build trees; installed copies are untouched. Bundle inspection is
recorded in `build-artifacts.txt`.

## 23. Known limitations

No endpoint/rule deployment or live release provisioning occurred. Private checks
need an already validated, non-expiring-soon account token; they do not initiate
sign-in or session refresh. Internal/stable policy remains unsupported. Cache and
coalescing are process/service-domain local. Later dismissal is editor-local.
Minimum OS is displayed, not an installer compatibility decision. Trusted release
automation must allocate build numbers and use the publication helper. No metadata
signature or artifact cryptographic validation exists in U02.

## 24. Remaining U03 work

Extend the schema for immutable artifact object generation/path, size and SHA-256;
implement a separately authorized download endpoint with publication/access
rechecks; bound redirects/hosts and download storage; verify completed bytes and
Apple publisher identity; design signed metadata and key rotation; provide optional
download/verification UX. Installer execution, signing/notarization and privileged
helpers require their separately scoped release work. Nothing in U02 downloads,
installs, overwrites loaded plugins or enforces updates.
