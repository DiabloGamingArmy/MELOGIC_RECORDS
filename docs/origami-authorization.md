# Origami L01.1 authorization and deployment

Baseline: `783d2baeef3b1b296a02904dc891826905bd4c8d`, branch
`mct-origami-nodes-visual-feedback-p03`. The working tree was clean. Current
Release wrappers built and baseline state/account/plugin/EQ CTest passed 4/4
before changes. L01 architecture is documented in `melogic-desktop-auth.md`.
This document supersedes L01's statement that authentication never gates audio:
**L01.1 gates the editor and output using authorization, separately from identity.**

## Sign-in diagnosis and repair

The current production `beginDesktopLogin` endpoint and `/auth/desktop` page both
return HTTP 404. The native controlled probe reproduces `begin_login`, HTTP 404,
ServiceUnavailable before any browser/callback/token/Keychain stage. L01 added
source but did not deploy these services. Changing an error label cannot repair
that deployment gap; the five Functions and Hosting route must be deployed.

Two additional native defects were found and repaired before deployment:

- JUCE `WebInputStream(URL, true)` moves URL parameters into the request body.
  Firebase Auth REST's public API identifier therefore left `?key=...`, and its
  parameter text was prefixed onto JSON. `makeAuthPostStream` now keeps query
  parameters in the URL (`false`) and sends only the supplied JSON/form body.
  A loopback server regression checks actual request bytes using this production
  helper. A live Google endpoint probe using an intentionally invalid, non-secret
  fixture token returned **legacy HTTP 403 / API identifier rejected**, versus
  **repaired HTTP 400 / INVALID_CUSTOM_TOKEN**. The repaired request reaches the
  intended Firebase credential validator; this is not a successful account login.
- Server absolute deadlines were compared against the client timestamp captured
  before network transit with zero tolerance. A valid five-minute request or
  15-minute validation result could be rejected as too far in the future.
  Bounded 30-second transit/clock tolerance now clamps to the original local
  lifetime; expired or implausible values remain rejected.

Stage and HTTP status are carried as non-secret failure metadata. Debug builds
log only fixed stage names/status codes. Test executables expose explicit probe
arguments; shipping plugins do not expose a probe or bypass. Production messages
separate network, expired/revoked session, unavailable service, unverifiable
response and secure-storage failures. No token, password, UID, submitted key,
HTTP request body or raw backend error is logged. Repeated submissions are
immediately disabled; cancel remains available during browser initiation.
Completed/cancelled browser requests cannot reopen from a stale URL.

The existing browser S256 rendezvous remains the authentication path. It is a
valid Firebase custom-token exchange after explicit browser approval, not a
second account database. Browser approval verifies revocation; grant consumption
also checks disabled users and `tokensValidAfterTime` against the authenticated
browser's `auth_time`. Transactions prevent grant replay and double issuance.

## Authorization policy (explicit beta policy)

Authentication alone does not authorize Origami. Trusted backend
`getOrigamiAuthorization` accepts only canonical
`users/{uid}/entitlements/origami` with `productId=origami`, `edition=beta`,
`status=active`, and no expired/invalid entitlement deadline. The Functions
wrapper verifies the bearer ID token with revocation checking. A normal client
cannot write this entitlement.

The non-realtime service publishes `AuthorizationState`: Restoring, Unauthorized,
Authenticating, RedeemingKey, Authorized or Error. Each fresh application/module
startup starts closed and validates the entitlement online. It never trusts a
cached identity, Keychain metadata or an account existing as ownership proof.
An authorization result has at most a **15-minute in-memory validation lease**,
checked again near expiry; failures close the gate. An unlicensed account retries
automatically after 60 seconds and has a Recheck Origami Access action.

There is no persisted unsigned authorization flag, signed offline license or
permanent offline grant in L01.1. Authorization is not serialized or restored
from a DAW project. This interim policy requires connectivity for startup and
periodic non-realtime validation; the audio callback never waits for the network.
L02 must replace this provider/policy with signed offline activation if required
for distribution. It is not marketed here as completed offline licensing.

A successful redemption publishes a new shared generation after secure session
persistence. Other modules/processes invalidate their old authorization and query
trusted entitlement state on their next two-second storage observation, rather
than waiting out an unlicensed retry timer. Same-module editors/processors share
one service/atomic. A second format need not redeem the key or create a new
account. macOS Keychain host ACL approval still applies, as documented in L01.

Logout immediately closes the local service's flag before storage IO; shared
session tombstones propagate to other formats. It does not delete/revoke
Firestore ownership or consume another key. There is no separate signed offline
activation in this pass, so local logout necessarily returns to Unauthorized.
Browser login and other machines are not globally signed out.

## Editor and audio boundary

The full-editor activation surface sits over one parent containing the entire
normal workspace. Disabling that parent blocks knobs, page controls, preset
selection, Nodes, Matrix, Mixer and Global together. The editor refreshes this
boundary at 15 Hz. Root history/shortcut, mouse editing and drop handlers also
check the current atomic state. Open transient menus are dismissed when gating.
Activation controls remain keyboard/mouse accessible, including paste and Return
submission. Key text is masked, trimmed only at its outer edges, never normalized
in case/separators, and never persisted. In L01.2, any trimmed nonempty key enables
Activate directly from the editor's text notification, independent of the 15 Hz
account refresh. Return invokes the same guarded submission path. The native
transport bounds input size but leaves key format and validity to the backend.

Signed-out users see Sign In, a simple OR separator, masked key entry and Activate.
Logout is absent from their component tree. The duplicate Open Melogic Account
link and redundant signed-out status/account prose are removed. The original
centred branding frame and wordmark/tagline drawing geometry remain unchanged.

Activating while signed out retains the key only in the initiating panel's memory
and starts canonical browser authentication. The panel observes the shared service
snapshot and consumes the pending key once after verified sign-in. If the account
already has authorization, no redemption is attempted. Cancellation, authentication
failure or panel destruction discards the pending key. Destroying a panel does not
cancel another editor's shared account flow; there is no destroyed-UI callback,
and no deferred redemption survives the initiating panel. A redemption already
submitted to the shared worker may finish independently of editor lifetime.

Authenticated unlicensed users stay gated, can recheck access, log out or redeem a
key. A Firebase identity alone never dismisses the gate. Submission disables the
controls and uses the existing worker; safe classified errors appear below the
activation controls. Success clears input/pending state and stale messages even
when the overlay becomes hidden, and the existing atomic gate opens the editor
and audio. Global retains its account controls. No DSP or serialization changes.
The independent account-service shutdown P0 is not fixed by this UI pass.

All shipping wrappers construct the same processor using the canonical service's
read-only atomic flag. The processor constructor starts asynchronous restoration
without an editor. `processBlock` reads one lock-free atomic bool at its entry.
When false it explicitly clears every host output channel, MIDI and output
meters and returns before rendering. On loss it invokes the existing audio-owner
engine/FX/ARP emergency reset and clears pending UI notes/controllers. It ignores
unauthorized MIDI and drains queued UI state. Reopening discards old UI notes;
new MIDI plays the intact patch. Pending project restores remain available and
are applied at the next normal audio boundary.

Silence begins at the next callback boundary, including while a note or FX tail
is sounding. This pass uses immediate zero output rather than allowing residual
samples to continue after authorization closes; a boundary cut can be audible as
a click. It never adds a limiter or changes the authorized DSP signal path.
The reset path clears voices, expression controllers, FX/delay memory and meters,
not the synth document. A restored project can be saved while unauthorized.

There is no callback-side service mutex, shared_ptr ownership mutation, HTTP,
Keychain/filesystem access, JSON, browser work, UI dispatch or licensing heap
allocation. Existing B01 heap guards/cases remain enabled. Authorized DSP tests
use explicit constructor dependency injection from `tests/TestAuthorization.h`.
The in-memory service installer/backend were moved out of shipping code into
`origami_account_test_support`, linked only to test/benchmark targets. A shipping
build with tests OFF has no test provider/installer or magic UID/key/env bypass.

## Secure key redemption

`redeemOrigamiLicense` requires a revoked-token-checked Firebase identity. It is
rate-limited (20 attempts/minute/IP using existing server-only rate buckets).
Keys are case-sensitive, opaque printable ASCII, 32–256 characters after outer
whitespace trimming. The trusted issuer must use at least 256 random bits; a
length check alone does not create entropy. There is no list of valid keys in the
client and no production key generated by this pass.

The server hashes the exact trimmed key with SHA-256 and transactionally reads:

- `licenseKeys/{digest}`: productId, edition, active status, optional key expiry,
  safe integer capacity/count and optional entitlement expiry;
- `licenseKeys/{digest}/redemptions/{uid}`: immutable server-side receipt;
- `users/{uid}/entitlements/origami`: existing canonical ownership.

Only active Origami/beta keys with capacity grant entitlement and increment
redemption count. Concurrent different UIDs cannot exceed capacity. A same-UID
retry returns the existing active entitlement without consuming capacity again;
a receipt cannot resurrect later-revoked ownership. An admin-revoked account
entitlement is not overwritten by another key. Existing valid ownership is not
shortened. All validation completes before transaction writes. Invalid, used,
wrong-product, expired and unavailable errors are mapped to safe client text.

Firestore L01 rules already deny every client write to entitlements, license
keys and activations; these restrictions are retained, not weakened. Private key
receipts also fall under default deny. Owner-only entitlement reads remain.
Redemption uses Admin SDK exclusively. No direct client grant or anonymous
machine activation is introduced. No raw key is stored in the database/receipt.

Trusted provisioning is an admin operation: generate random bytes, distribute
the raw key intentionally through an approved channel, and store only its SHA-256
digest document with the above fields. Do not put issued keys in git, build
configuration, logs, presets or public product documents. This pass neither
issues keys nor seeds/grants production entitlements.

## Reviewable production deployment (requires explicit approval)

All source and local tests are prepared before requesting a production change.
The missing deployed services are part of the root cause. The following command
is the exact scoped deployment set; **Hosting publishes the current built website
from this branch**, not just a new native binary. Review that site release before
approval. No payment/email/other Functions need deployment for this pass.

```sh
node scripts/check-config.mjs
npx vite build
firebase deploy --project melogic-records --only functions:beginDesktopLogin,functions:approveDesktopLogin,functions:pollDesktopLogin,functions:getOrigamiAuthorization,functions:redeemOrigamiLicense,hosting:web,firestore:rules
```

The CLI's existing authenticated identity/IAM must allow deployment and the
runtime must allow Admin custom-token signing (`iam.serviceAccounts.signBlob`).
Use existing deployment credentials; never bundle or commit a service-account
key. Review/enable Firestore TTL for auth request/rate-bucket `expiresAt` fields.
The logical expiry checks work independently of TTL cleanup.

After approved deployment verify begin callable readiness, `/auth/desktop`,
provider configuration, native API-key restrictions, real browser approval,
Keychain save/restart and entitled/unlicensed outcomes. The deliberate invalid
credential probe already verifies that the repaired native request reaches
Firebase Auth. It does not validate a real user's custom/refresh token exchange.
No source change can make an undeployed endpoint available on its own.

Manual acceptance remains required in distribution-signed Standalone, Logic AU
and a VST3 host: three-instance unauthorized silence, activate #1, propagation,
logout #2, project save/reopen with patch intact, offline/reconnect, revoked access,
permission prompts and host shutdown during a pending flow. Automated tests use
fixture processors/coordinators, not a claimed interactive Logic session.
The existing ASan runtime/toolchain classification remains unchanged.
