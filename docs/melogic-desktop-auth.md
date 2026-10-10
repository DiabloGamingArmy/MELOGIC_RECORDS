# Melogic shared desktop account foundation (L01)

## Canonical infrastructure

The existing project is `melogic-records`, region `us-central1`, website
`https://melogicrecords.studio`. Public client identifiers now live in
`config/firebase-client.json`; the web configuration retains its existing Vite
environment overrides. CMake derives native project/API identifiers from the same
file. A staging native build requires deliberately supplying the corresponding
configuration and matching browser origin; it is not selected by a web-only env
variable. No administrative credentials are distributed.

The existing web account uses Firebase Authentication, email/password and Google
provider flows, and IndexedDB/localStorage Firebase persistence. Providers are
identified from repository configuration, not a live Firebase Console audit.
`users/{uid}` is the canonical private platform profile; native minimal identity
comes from Firebase Auth's authoritative account lookup. Existing login/signup is
`/auth`; authenticated self-management is `/profile`, with `/profile/edit` and
`/account/security`. There was no reusable native desktop auth mechanism.
Existing App Check uses reCAPTCHA Enterprise and skips authentication routes.

## Browser rendezvous and trust boundary

1. Native CSPRNG generates a 256-bit request ID and independent 256-bit verifier.
   Native sends the verifier's RFC 7636 S256 challenge to `beginDesktopLogin`.
2. The worker publishes the canonical `/auth/desktop?request=<id>` URL. Global
   opens it on the message thread. No password, verifier or token enters the URL.
3. The browser uses the existing Firebase session/login route. The user explicitly
   confirms their account and compares the eight-character code with Origami.
   It does not automatically approve a request just because the browser is signed in.
4. `approveDesktopLogin` verifies the Firebase ID token with revocation checking;
   UID comes from Firebase, never the submitted body. Disabled users are rejected.
5. Native polls with its secret verifier. A Firestore transaction consumes an
   approved grant before Admin SDK issues a custom token. Concurrent polls cannot
   issue two tokens. Native exchanges the token through Firebase Auth REST and
   looks up authoritative identity before publishing/persisting a session.

There is no loopback listener, arbitrary redirect, deep-link receiver, custom
identity provider, callback-supplied UID, or client-side entitlement grant.
Requests expire after five minutes. A consumed grant whose response is lost must
be restarted; it is never replayed. Cancelling locally discards the proof and
ignores late results; an unused server request expires. Browser cancellation
marks the request cancelled. Signing in through this exchange does not grant a
product. Firebase's custom-token mechanism is retained; there is no custom token
signature implementation in the desktop client.

The backend hashes IP/operation/minute into short-lived throttle bucket IDs:
20 begins and 240 polls per minute per IP, transactional. Shared NATs can hit
these conservative limits. App Check is not enforced on these native-callable
functions; authenticated browser approval and proof possession protect issuance.
Throttling and `maxInstances=10` bound ordinary abuse, but are not a comprehensive
Internet-wide cost/DoS control. Existing infrastructure monitoring and deployment
budgets still apply. No telemetry is added to the synth.

## Secure persistence and sharing

`shared/melogic/account` owns the worker, coordinator, injectable backend and
storage interfaces. `Service::shared()` retains one service per loaded module;
all its plugin editors use that service. Separate plugin modules/processes share
the same OS session, not necessarily the same C++ static object.

macOS generic-password Keychain service:
`studio.melogic.account.firebase.<firebase-project>`, account `shared-session-v1`.
It is local/non-synchronizing, device-only where supported. The refresh token,
minimal identity, validation/deadline and generation are one versioned Keychain
item. ID/custom tokens are transient memory only. No token or identity is stored
in a plaintext sidecar. Malformed/oversized cache data fails closed. No password,
Admin credential, signing key, fingerprint or license is persisted by L01.

`~/Library/Application Support/Melogic/Account` contains only a non-secret UUID
`generation-v1` and `session-v1.lock`. Directory permissions are 0700, files 0600;
lock opening rejects symlinks. Nonblocking `flock` serializes worker-only IO and
refresh across processes. Login changes generation only after secure persistence;
logout publishes a tombstone before deleting the Keychain item. Generation
mismatches invalidate stale caches and pending logins, including deletion errors.
The coordination files are coordination, not proof of authentication/licensing.

First restoration revalidates an older session against Firebase. Recently shared
validation and refresh deadlines prevent each format refreshing independently.
Offline failures preserve an explicitly unverified cached identity and share a
60-second retry deadline. Revoked/invalid sessions are deleted. Other processes
observe login/logout on their two-second worker poll, after any current bounded
transport operation releases the lock. No UI thread waits for this lock.

Automatic reads/refresh persistence suppress Keychain permission UI. User-initiated
sign-in, logout or **Retry Account Access** may require OS authorization. Retry
reads the existing item interactively, so a newly authorized DAW can restore the
same login without another browser authentication. macOS Keychain ACLs are tied
to the executing host/signature: secure sharing across arbitrary DAW hosts must
be qualified with the distributed signatures and user approval. No broad
"any application" Keychain ACL or plaintext fallback is installed. An OS Keychain
permission prompt is OS-controlled and cannot be cancelled through the HTTP
transport; approve/dismiss it before closing the host. Actual signed-host prompt
and shutdown behavior remains a manual release qualification item.

Transport uses fixed HTTPS endpoints, no redirects, bounded JSON responses,
connection timeouts, a body deadline and cancellation. Shutdown/cancel/logout
interrupt active `WebInputStream` work; service destruction joins the worker.
Editors hold shared ownership, have no worker callbacks/observers, and can close
while login remains pending. Non-macOS storage intentionally reports unavailable;
Windows secure storage belongs to a later implementation, not an insecure fallback.

## UI, patch state and realtime boundary

Global adds a compact ACCOUNT region in the existing identity strip. States are
SignedOut, Restoring, SignedIn, Refreshing, AwaitingBrowser, OfflineCached,
SigningOut and Error. Buttons provide sign-in, browser account management,
logout/cancel and secure-storage retry. Open Account launches `/profile`; browser
and native Firebase sessions remain independent, so the site may require its
existing login. No credential is appended to Open Account's URL.

Account/session ownership is absent from the processor, engine, parameter tree,
Nodes/Matrix graphs, preset codec and document history. Only Global's UI reads
public snapshots. The DSP libraries do not depend on the account library.
Keychain, filesystem, JSON, HTTP, refresh and browser launch have no
`processBlock`-reachable account call path. Authentication never gates audio.
Tests compare complete plugin state before/after login/logout and exercise preset,
project and Undo/Redo operations while a fixture machine session stays signed in.
The callback allocation guard is thread-local to measure callback work while
background workers allocate; a self-test verifies both detection and isolation.

Logout removes local shared authentication and invalidates pending local grants.
It does not globally sign out the website/other machines or revoke every Firebase
refresh token. It does not remove or deactivate future offline licenses.

## Licensing foundation and L02 contract

Reuse existing canonical `users/{uid}/entitlements/{productId}`. Owner-only reads
and backend-only writes already exist and are retained. Do not create a competing
root-level entitlement concept. No entitlement is granted by L01 sign-in.

The following is a reserved schema contract, not production seeded documents:

| Path | Intended authoritative fields / boundary |
| --- | --- |
| `products/origami` | Platform-owned software identity; `edition: beta`, `visibility: private`, no public/free marketplace claim. Admin SDK provisioning only. Client create/update/delete denied even for marketplace creators. |
| `licenseKeys/{digest}` | SHA-256 lookup digest of a canonical high-entropy random key; productId, edition, status, expiresAt, maxRedemptions, redemptionCount, createdAt. All client reads/writes denied. No raw redeemable key retained. |
| `users/{uid}/entitlements/origami` | productId, edition/accessClass, authoritative status, grantedAt, source/redemption reference, optional expiry. Only that UID reads; trusted backend writes. |
| `activations/{id}` | uid, productId, entitlement reference, activation status/expiry and future public signing-key version. Owner UID reads; trusted backend writes. No hardware fingerprint added. |
| `desktopAuthRequests/{id}` | challenge, status, expiresAt, authenticated uid after approval. Server-only. |
| `desktopAuthRateLimits/{digest}` | count, expiresAt. Server-only. |

L02's authenticated redemption interface must canonicalize a submitted key, hash
it server-side, then transactionally validate active status, exact product/edition,
expiry and capacity; idempotently create the UID entitlement and consume capacity.
Use at least 256 random bits for generated keys; formatting supplies no entropy.
Never distribute a plaintext key database, log raw keys or let a client write
ownership. Actual generation/redemption is deliberately deferred rather than
exposing a placeholder endpoint. Existing paid-order fulfillment remains separate.

L02/L03 must resolve entitlement policy, activation limits, revocation/expiry and
signed offline license issuance/verification. Signing private keys stay exclusively
on trusted backend infrastructure. Cached Firebase identity is never an offline
license. Authentication logout and activation deactivation remain separate APIs.

## Deployment and qualification (not performed by L01)

Review/deploy the three new Functions, hosting build/rewrite and rules together
using the existing staging→production workflow. Do not silently deploy from a
native build. The Functions runtime service account needs Firebase Admin access
and IAM permission to sign custom tokens (`iam.serviceAccounts.signBlob`, normally
Service Account Token Creator on the intended signer); verify IAM and required
Google APIs with the deployment owner. Never solve this by bundling a key file.
Enable Firestore TTL on `expiresAt` for the two auth coordination collections to
remove expired documents. Logical expiry is enforced independently of TTL delay.

Verify Firebase API-key restrictions permit the intended native Auth REST usage,
provider enablement, deployed origin/redirect behavior and App Check policy.
Perform real sign-in/out, restart, offline/online, revoked-account and permission
prompt checks in signed Standalone, Logic AU and a VST3 host, including concurrent
instances and closing a host during a pending flow. Automated tests use mocks,
Firestore emulator and an isolated temporary Keychain, never a personal login or
production writes. Live login is not claimed until this deployment/host check is
complete. Beta account distribution is gated on that qualification. Existing ASan
runtime qualification remains open as documented in the memory-safety pass.
