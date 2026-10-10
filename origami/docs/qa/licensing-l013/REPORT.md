# L01.3 — native authentication latency repair

## 1. Baseline

`e91c83dc7a2dd1867eb601be8187ce02213dd12d`, branch `mct-origami-nodes-visual-feedback-p03`. Investigation on October 9–10, 2026. The supplied personal screenshots and raw Cloud logs are intentionally excluded from this repository.

## 2. First failing transition and evidence

The strongest supported reconstruction is **native pending poll → transport timeout → request discarded**, before custom-token exchange and key redemption. The original binary had no detailed native trace, so the specific screenshot transaction cannot be conclusively correlated by request ID without exposing proof material. This is an evidence-based inference, supported by live timings and a deterministic reproduction, not a claim that the original client emitted a captured timeout diagnostic.

Read-only production request logs in the user's test window, UTC:

| Request start | Function | HTTP | Server latency |
| --- | --- | --- | --- |
| 2026-10-10 01:14:30.153877 | beginDesktopLogin | 200 | 3.528626858 s |
| 2026-10-10 01:15:36.572690 | beginDesktopLogin | 200 | 0.290598999 s |
| 2026-10-10 01:15:40.206086 | pollDesktopLogin | 200 | 3.969689019 s |
| 2026-10-10 01:16:14.879527 | approveDesktopLogin | 200 | 5.000812719 s |

No redemption or authorization HTTP request appeared in the inspected test-window results. Browser approval came after the slow poll. The screenshot independently shows signed-out native state and an unconsumed key.

## 3. Root cause and repair

`FirebaseBackend::post` configured JUCE `withConnectionTimeout(2000)`. On macOS, JUCE passes this to `NSMutableURLRequest` as its request timeout; it is not merely a TCP handshake limit. Successful server requests exceeding two seconds therefore fail natively. Coordinator then clears the pending request and proof, terminating polling. The old path classified failed `connect()` as Network, producing the generic connection message. The first begin request also exceeded this budget.

All auth requests now use a bounded 30-second worker-thread timeout, accommodating the deployed 15-second Functions timeout plus startup/transit. Response size remains bounded at 64 KiB; redirects stay disabled; cancellation remains connected to the active transport. The response deadline starts before connect. No automatic token replay or authentication bypass was added.

A loopback transport regression sends the identical response after three seconds: the legacy two-second setting fails, the new default succeeds. The full contract test holds the first pending poll for four seconds and then completes approval, exchange and activation.

## 4. Why previous tests missed it

Coordinator/activation mocks returned immediately. The earlier actual-JUCE byte test proved query/body construction but returned its HTTP response immediately. Neither exercised server latency through the actual native transport. The new tests cover both the old/new timing boundary and real native requests against the production backend cores with Firestore transactions.

## 5. Browser approval before/after

The existing browser code already awaited `approveDesktopLogin`; success was not optimistic. It now displays Approving/Cancelling while waiting, requires `result.data.ok === true`, and distinguishes expiration from unconfirmed approval. Duplicate clicks remain guarded. Only a confirmed approved result instructs returning to Origami. Layout/branding are unchanged.

## 6. Polling lifecycle before/after

The worker polls on its existing two-second interval after each completed operation; login lifetime remains five minutes. The backend atomically moves pending → approved/cancelled, and approved → consumed. Native recognizes pending, approved and cancelled, validates request identity, and now explains consumed transactions separately. Previously a slow pending response prematurely ended polling; now a four-second pending response survives.

An approved poll consumes the grant before token issuance. A lost response after consumption still requires a fresh sign-in; silently reissuing a token would weaken one-time semantics. Epoch checks discard old work, duplicate Activate is guarded, and UI sync does not create another login. Cancel and logout still interrupt transport.

## 7. Firebase exchange

The prior query/body repair remains intact: JUCE `WebInputStream(URL.withPOSTData(body), false)` keeps the public API identifier in `?key=…`, with only JSON in the POST body. Exchange uses `accounts:signInWithCustomToken`, `{token, returnSecureToken:true}`; lookup uses `accounts:lookup`, `{idToken}`. Both exact serialized requests are asserted independently by the loopback HTTP server. Token field names and identity response parsing are exercised. HTTP 4xx custom-token rejection now has its own category; 5xx is temporary server unavailability. No tokens are printed.

## 8. Session publication

After lookup, Coordinator validates the session, saves it securely, assigns a generation, and publishes SignedIn. The initiating ActivationPanel observes the shared Service snapshot. The contract test uses the real Service/worker and actual controls, with a memory store; injected secure-store write failure fails closed. Existing account tests exercise a separate, disposable macOS Keychain, generation sharing, rotation, deletion, corrupt storage, multiple instances and publication. No user Keychain data was inspected or exported.

## 9. Pending-key continuation

The L01.2 behavior is preserved. The initiating editor keeps the key only transiently. On SignedIn, it consumes pendingKey before submitting redemption, clears the entry, and cannot submit twice on repeated sync. Added diagnostics report only `pending_key present` and `pending_key_continue redeem_requested`. Tests use duplicate Activate clicks and verify exactly one redemption. Cancellation, failed login and destruction clean pending input; existing focused tests cover editor destruction.

## 10. Redemption transaction

The HTTP contract fixture generates an actual A01-format synthetic key using `adminLicensingCore`, then passes the native request to the unchanged production `origamiLicensingCore` with Firestore emulator storage. A successful transaction produces one receipt, redemptionCount 1, and canonical active Origami/beta entitlement. Invalid, revoked, expired, exhausted and wrong-product cases do not create entitlement or alter count. Existing emulator tests cover competing users, idempotent retry and revocation races. No production key was redeemed, revoked, modified or generated by this investigation.

## 11. Authorization

`redeemOrigamiLicense` already returns the authoritative authorization result from its transaction; Coordinator adopts it immediately, saves the generation, and the worker opens the shared authorization atomic. An extra HTTP authorization round trip is not required before opening the gate. The contract also exercises `getOrigamiAuthorization` before redemption and through Restore afterward. No restart, editor reopen or manual Recheck is needed after successful redemption. Existing UI/audio gate tests verify overlay visibility and silent/usable audio state.

## 12. A01 compatibility

A01 generates `MELOGIC-` plus 64 lowercase hexadecimal characters using 32 random bytes. Generation and redemption import the same `keyDigest`: trim outer whitespace, SHA-256 UTF-8 bytes. The contract verifies clipboard whitespace compatibility and case sensitivity. No Unicode normalization or case folding is added. The native client treats the credential as opaque, with only empty/maximum transport bounds. Raw historical keys are absent from database/audit records.

## 13. Live deployment and Release configuration

All five named callable Functions are deployed and ACTIVE in `melogic-records/us-central1`, gen2 Node20, configured for 15 seconds. Read-only downloads of each Function's deployed source archive match the workspace's desktop wrapper/core, licensing core, admin core and index byte for byte. Sanitized fingerprints are in `deployment-evidence.txt`. Runtime signer IAM was inspected read-only and includes Service Account Token Creator; no permissions were modified.

Native CMake derives the production project and public API identifier from `config/firebase-client.json`. Production defaults remain the us-central1 cloudfunctions.net endpoints, Google Identity Toolkit/Secure Token, and `https://melogicrecords.studio/auth/desktop`. The loopback constructor/factory exists only under `MELOGIC_ACCOUNT_TESTING`; it is absent from the tests-OFF shipping binary symbol table. No emulator/staging override is available in the shipping factory. The browser uses the same public Firebase configuration.

Callable POST requests use JSON Content-Type, `{data:…}` and `{result:…}` envelopes. Begin sends requestId/challenge; poll sends requestId/verifier; approval binds authenticated UID; challenge uses S256/base64url with RFC 7636 coverage. Request IDs, five-minute expiry, approved customToken field, error status encoding, bearer redemption and authorization are checked through native wire tests.

## 14. Diagnostics and errors

Set `MELOGIC_ACCOUNT_DIAGNOSTICS=1` when launching a development test binary to emit constant stage/outcome identifiers and HTTP status to stderr. Off by default, including Release. No URL, account, code, proof, key/digest, token or server body is logged.

Stages include begin_login, poll_login (pending/approved_custom_token_received), firebase_exchange, firebase_identity, firebase_refresh, session_publish, pending_key, pending_key_continue, redeem_key, entitlement and authorization. Safe categories include connection_failed, timeout, server_unavailable, rate_limited, session_rejected, keychain_failed, endpoint_unavailable, transaction_expired/consumed, custom_token_rejected, malformed_response and key failure categories. HTTP status remains visible for diagnosis. JUCE does not expose enough structured information here to truthfully distinguish DNS from TLS, so these remain connection_failed rather than invented classifications.

## 15. New contract coverage

`functions/test/nativeDesktopContract.test.js` runs `origami_plugin_tests` as an actual native subprocess. Its loopback adapter validates serialized requests and calls unchanged production cores with an emulator database. It does not reuse native request builders or mock Backend. Firebase identity/token endpoints are explicit synthetic fixtures, not real Google credentials. Browser approval commits through the production core; the browser JavaScript confirmation UI has separate deferred-promise tests.

Native test-only configuration cannot redirect shipping builds. Every synthetic run uses unique account identities so earlier grants cannot hide a missing redemption. No production Firebase database or account operation occurs in these automated tests.

## 16. Validation

See `validation.txt` for final results and commands. Coverage includes delayed pending, cancellation, expiration, malformed approval, consumed grant, rejected custom token, server exchange failure, rejected/revoked account, five key rejection categories, lost network at begin/poll/exchange/lookup/redeem/authorization, storage failure and a full 30-second poll timeout. Duplicate approvals/polls cannot issue twice; duplicate Activate redeems once. Existing tests cover isolated Keychain behavior, shared instances, editor destruction and interruptible Service shutdown. These deterministic lifecycle tests do not reproduce or close the separate reported P0.

## 17. Shutdown P0 relationship

The observed failure is explained by request latency while the application remains alive; the inspected request logs contain no evidence of Service destruction. Service ownership, destructor, thread joins and Objective-C autorelease handling are unchanged. Cancellation paths were audited and existing lifecycle tests pass. This does **not** establish that the independently reported `Service::~Service` / `std::thread::join` / autorelease-teardown crash is fixed. That P0 remains open and needs its own crash reproduction and repair. A longer request budget makes correct cancellation important; existing active-stream cancellation is preserved.

## 18. Realtime safety

No processor or DSP source changed. `processBlock()` reads the existing acquire-loaded authorization atomic and performs its existing closed-gate behavior. HTTP, JSON, storage, Keychain, browser work, diagnostic output and joins remain outside the audio callback. The focused audio-gate checks and DSP regressions pass.

## 19. Native build/install

The tests-OFF Release build completed for Standalone, AU and VST3 from the current sources:

```sh
cmake --build origami/build-l012-release --target OrigamiPlugin_Standalone OrigamiPlugin_AU OrigamiPlugin_VST3 --parallel 4
```

Artifacts are under `origami/build-l012-release/OrigamiPlugin_artefacts/Release/{Standalone,AU,VST3}`. The existing tree name records its origin, not the code version. These are rebuilt L01.3 artifacts. No installed application or plugin was overwritten by this investigation.

Quit Origami and all DAW/plugin hosts before installation. From repository root, install the rebuilt artifacts using the normal installation process, or:

```sh
ditto 'origami/build-l012-release/OrigamiPlugin_artefacts/Release/Standalone/MCT Origami.app' '/Applications/MCT Origami.app'
ditto 'origami/build-l012-release/OrigamiPlugin_artefacts/Release/AU/MCT Origami.component' "$HOME/Library/Audio/Plug-Ins/Components/MCT Origami.component"
ditto 'origami/build-l012-release/OrigamiPlugin_artefacts/Release/VST3/MCT Origami.vst3' "$HOME/Library/Audio/Plug-Ins/VST3/MCT Origami.vst3"
```

Rescan the host's plugins if necessary. Avoid leaving another older global/user copy selected by the host. Test Standalone first to establish the installed native version.

## 20. Deployment scope

- **Native rebuild/install: required** for the timeout repair. Hosting deployment alone cannot repair an old binary.
- **Hosting: required** for the explicit confirmation/progress refinement:

```sh
npm run build
firebase deploy --project melogic-records --only hosting:web
```

- **Functions: no deployment required**; no Function source changed and deployed cores match.
- **Firestore rules: no deployment required.**
- **Indexes: no deployment required.**

Nothing was deployed during this task. Do not deploy everything.

## 21. Manual production acceptance — user action, one new key

Use one newly generated Origami/beta key with maxRedemptions 1. Do not use automated tests against production.

For optional safe diagnostics, launch the freshly installed Standalone executable:

```sh
MELOGIC_ACCOUNT_DIAGNOSTICS=1 '/Applications/MCT Origami.app/Contents/MacOS/MCT Origami'
```

1. In admin, generate one beta key; verify **Available 0/1**. Keep it private.
2. Start signed out in Origami; paste that key into the existing field.
3. Verify Activate is enabled; click once. `pending_key present` should appear.
4. Browser opens after `begin_login response_success`. If no browser opens, inspect begin_login failure/HTTP and OS browser behavior.
5. Confirm the correct account and matching verification code in Origami/browser. Do not approve a mismatch.
6. Click Connect Origami; browser displays Approving while the backend runs.
7. Browser reports Approved only after confirmed success. Expired/unconfirmed requires a fresh sign-in.
8. Native reports `poll_login approved_custom_token_received`, `firebase_exchange response_success`, `firebase_identity response_success`, then `session_publish signed_in`. If missing, the last stage and safe category identify the boundary.
9. `pending_key_continue redeem_requested` occurs once, followed by `redeem_key authorized`. Storage failure identifies keychain_failed. Key rejection remains a categorized activation error.
10. Activation overlay disappears automatically; no restart/Recheck/editor reopen.
11. Play a note; synth outputs audio. Gate tests establish expected behavior, but verify the installed build and actual audio device here.
12. Refresh admin: key is **Redeemed 1/1**, with one receipt. Never manually edit the count.
13. Users → Manage Products shows **Origami / beta / active** for the signed-in account.
14. Quit and restart Origami.
15. Verify session/authorization restores under current online policy: firebase_refresh/firebase_identity as needed, entitlement response_success and authorization authorized. Offline identity alone does not grant access.

If a network response is lost after the server commits redemption, check admin/account state before retrying; same-account redemption is idempotent. Do not create additional keys to hide an unexplained failure. If login was consumed before a lost token response, begin a new login rather than replaying the consumed grant.

## 22. Limits and remaining blockers

Production acceptance with a real key remains deliberately unperformed because the user forbids automated production mutation. The emulator substitutes Google custom-token mint/exchange/lookup and the contract store; it cannot prove real Google credentials, device Keychain prompts, browser session, installed-host selection or production audio output. Read-only deployment/source/IAM checks reduce configuration uncertainty. Original screenshot transaction correlation is inferred from timings, not a captured native trace. The shutdown P0 remains open. No authorization was faked in shipping code.

## 23. Final commit

The commit containing this report is the L01.3 repair commit; obtain its immutable hash with `git log -1 --format=%H -- origami/docs/qa/licensing-l013/REPORT.md`. The final user-facing delivery records the pushed hash.
