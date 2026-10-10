# Origami L01 — shared Melogic account foundation

Baseline: `8b84f95da53d90830d47d7a8901a27cbf2481f1d`.
Final revision is the commit containing this report; its hash is returned in the
completion message. No production deployment or personal-account login occurred.

1. **Existing auth:** reused `melogic-records`, us-central1 Functions, existing
   Firebase email/password/Google web flows, private `users/{uid}`, Firebase web
   session persistence and canonical `/auth` → `/profile` routes. Provider
   configuration was audited in source, not live Console. Existing App Check
   skips auth routes; no prior shared native account service was found.
2. **Flow:** native CSPRNG request + secret verifier; RFC 7636 S256 proof; existing
   browser authentication and explicit matching-code approval; server-only,
   transactional, five-minute, single-consumption grant; Firebase custom-token
   exchange and authoritative account lookup. No listener/deep link/token URL.
3. **Sharing:** reusable `shared/melogic/account`, retained process/module service,
   worker-only Keychain and file locking, one canonical per-user/project session.
   Separate AU/VST3 modules coordinate through the same OS store even when their
   C++ statics are distinct. Two-second observation interval; shared deadlines
   prevent each editor/format refreshing independently.
4. **Persistence:** macOS generic-password Keychain holds the refresh token and
   versioned identity together. Application Support holds only a lock and UUID
   generation/tombstone, with restrictive file permissions. No plaintext fallback.
   First restore revalidates older sessions; offline cached identity is explicit.
5. **Host access:** automatic restoration never prompts. User-initiated Retry
   Account Access allows OS permission for an existing session without a second
   browser login. Distributed signatures/host ACL approvals still require real
   Standalone→Logic AU→VST3 qualification. Auth is currently macOS-only.
6. **Global UI:** restrained ACCOUNT area inside the existing identity strip;
   sign-in, explicit pending code/cancel, name/email, Open Account, logout, offline
   and error states. No other Global panels or synth controls were redesigned.
   Signed-out captures inspected at 960/1440 and captured at 1920 plus Settings.
7. **Open Account:** message-thread browser launch to the existing private
   `https://melogicrecords.studio/profile`; web login may still be necessary.
8. **Logout:** shared tombstone, secure-item deletion, propagation to open editors,
   cancellation of pending/late sign-in results. Delete errors remain visible and
   old generations cannot restore. Does not globally revoke other machines/web
   sessions, change patches, or destroy future activation state.
9. **Backend/rules:** added three scoped desktop-auth callables; server-only grants,
   rate buckets and license-key collection; owner-read/server-write activations.
   Existing owner-read/backend-write nested entitlements remain canonical.
   Reserved `products/origami` against marketplace client creation/edit/deletion.
10. **Licensing foundation:** product/beta, hashed high-entropy key, canonical
    entitlement and activation contracts documented in
    `docs/melogic-desktop-auth.md`. No raw keys, entitlement grants, production
    seeded product, redemption endpoint or DRM were added. L02 owns transactional
    redemption, idempotence/capacity/revocation and signed offline activation.
11. **Security:** Firebase remains the identity authority; approval verifies token
    revocation and disabled users. Desktop requires secret proof and validates
    request identity before adopting Firebase-verified UID. Custom/ID tokens stay
    transient; refresh credentials stay in Keychain. HTTPS redirects disabled,
    response/time bounds, cancellation, no token logging, no embedded Admin or
    signing credentials. Public Firebase client identifiers are intentionally
    shared client configuration, not administrative secrets.
12. **Realtime evidence:** account library is absent from DSP/core dependency
    graph; no account references in processor/codec/Nodes/Matrix state. Only Global
    invokes public snapshots/browser actions. HTTP, storage, JSON and refresh run
    on a dedicated worker; callback does not call it or acquire its mutex.
    An authenticated-service callback allocation test passed. Allocation tracking
    remains active and detects current-thread new/delete; background allocations
    are correctly excluded with a tested thread-local guard.
13. **Patch boundary:** complete plugin-state byte comparisons cover login/logout;
    preset and DAW-state loads preserve the existing machine account; Undo/Redo
    never replay identity. Complete state includes Nodes and Matrix. No account
    field was added to history, codec, parameters or processor serialization.
14. **Failures:** tests cover signed-out startup, adoption/persistence/restart,
    Standalone/AU/VST3-facing shared coordinators, multiple instances, logout
    propagation, missing tokens, orphaned generations, invalid/revoked sessions,
    offline/shared retry, callback mismatch/expiry/cancel, storage read/write/delete
    failure, lock contention, late-result rejection, worker shutdown cancellation
    and shared ownership after editor-owner destruction. Isolated real macOS
    Keychain tests cover create/read/update/delete, independent-store locking,
    generation propagation and malformed JSON rejection. Fixture accounts/tokens
    are explicitly invalid; temporary Keychain is deleted afterward.
15. **Automated results:** see `validation.txt` for final native/Web/emulator counts.
    Node full Functions suite: 119 tests, 117 pass, 1 fail, 1 emulator-only skip.
    The failure is pre-existing `musicDistribution.test.js:75`: its
    `/Spotify or Apple Music/` assertion does not match the existing
    `Add Melogic-hosted audio, Spotify, or Apple Music playback.` message.
    Both source/test are unchanged from baseline. The desktop emulator test was
    separately executed with all three auth tests passing and zero skips.
16. **DSP regression:** full Release CTest includes existing state/history,
    dedicated B01 torture and EQ headroom. No DSP implementation changed. Exact
    current totals are retained in `validation.txt`.
17. **Visual QA:** Global captures are retained beside this report. No personal
    account is rendered; browser approval styling uses the existing dark/red
    language. Live authenticated browser and signed-host screenshots remain part
    of deployment qualification, not claimed automated evidence.
18. **Known limitations:** production Functions/Hosting/rules/IAM/API restrictions
    and TTL configuration are not deployed/verified. Real Firebase token exchange,
    provider availability and signed DAW-host Keychain prompts remain unqualified.
    OS permission prompts cannot be cancelled by transport cancellation; users
    must approve/dismiss them before host shutdown. Native HTTP lifecycle is
    cancellable; OS security-service behavior needs host qualification. Per-IP
    throttle is not comprehensive distributed abuse protection. No Windows store.
19. **L02:** actual key generation/redemption, entitlement policy, activation limits,
    signed offline issuance/verification and revocation semantics remain separate.
    Firebase cached identity grants no offline license and audio is never gated.
20. **Beta decision:** no new DSP regression demonstrated. **Account-enabled private
    beta distribution must wait for backend deployment and signed-host end-to-end
    qualification.** This is a code foundation, not a claim of live auth readiness.
    The existing ASan runtime/toolchain validation gap remains open exactly as
    documented in `../memory-asan/REPORT.md`; it was neither reopened nor treated
    as passing. No overall Beta 0.1 sign-off is claimed by L01.
21. **Delivery:** source, focused tests, rules, schema/deployment documentation and
    concise evidence committed and pushed. Generated build directories, tokens,
    personal account data, local Keychains and machine secrets are excluded.
