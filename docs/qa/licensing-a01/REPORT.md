# A01 implementation and validation report

1. **Baseline:** `3546d0c9958f5609609a52d05d3eec834d7dfefb`, branch
   `mct-origami-nodes-visual-feedback-p03`; working tree clean before changes.
2. **Existing architecture:** Firebase Auth; canonical admin claims, permission
   helpers, MFA step-up, Users context menu, marketplace Give Product,
   `products`, owner-readable/server-written entitlements, server-only key
   digests/receipts, existing `adminLogs`. L01.1 already supplied native gating,
   `getOrigamiAuthorization` and `redeemOrigamiLicense`.
3. **Products:** Extends `products/{id}` with validated name/status and
   `licensing.enabled/editions`, server timestamps. Admin configures Origami Beta
   explicitly; no production seed or pricing. Generic selectors support future products.
4. **Entitlements:** One canonical user/product document with edition, active or
   revoked status, expiry, UID, source, timestamps, actor, reason and generation.
   Expired records display expired without deleting history.
5. **Users UI:** Adds Manage Products to the existing ⋯ menu, preserving other
   actions. Focused access surface shows edition, status, source, dates, safe key
   identifier and revocation history. Existing commerce views remain available.
6. **Direct grant:** Product/edition/optional expiry/reason → MFA step-up → trusted
   backend → target Auth existence and canonical product validation → transaction.
   Browser source/actor/timestamps never control ownership provenance.
7. **Revoke:** Confirmation and required reason → status transition with server
   revoke timestamp/actor/reason. Original creation/source/references remain.
8. **Re-grant:** Same document, new generation and grant provenance; before-state
   retained in audit. Identical active admin grants and repeated revokes are no-ops.
   Distinct concurrent changes serialize; no duplicate effective ownership.
9. **License Keys:** `/admin/license-keys`, product configuration, generation,
   masked table, server status, campaign, creation date, capacity, 50-key pagination
   and filtering of loaded pages by product. No historical reveal endpoint.
10. **Entropy:** Node `crypto.randomBytes(32)` per credential (256 bits), hex with
    `MELOGIC-` prefix. Batches bounded to 100 keys; redemptions/key bounded to 1000.
11. **Plaintext:** Returned only on generation, shown in ephemeral dialog with
    one-time warning and Copy All. DOM values cleared on close/disposal; no browser
    persistence, server export, database/audit/raw-key logging.
12. **Storage:** Existing SHA-256 digest document IDs, trim-only opaque input;
    random UUID management IDs and masked suffixes in admin responses. Neither
    key digests nor credentials appear in admin history/pagination or owner records.
13. **Key lifecycle:** Server derives available/partially redeemed/redeemed/expired/
    revoked from authoritative state. Revoke prevents future redemption and keeps
    history; previously granted entitlements require separate explicit revocation.
14. **Shared service:** `licensing/entitlements.js` centralizes product validation,
    expiry/state semantics and grant transition for admin, redemption and future
    verified purchase callers. Existing payment processing was not implemented or changed.
15. **Redemption:** Existing `{key}` endpoint and native contract retained, now
    using canonical grant metadata and transactional existing audit. No second
    redemption API. Legacy normalization, receipts and key compatibility retained.
16. **Authorization:** Active/unexpired Origami Beta only. Disabled configured
    product also closes access. Existing native RAM lease/refresh remains ≤15m;
    revocation is not instantaneous push delivery.
17. **Audit:** Existing `adminLogs` captures product create/edit, grant/re-grant,
    revoke, batch generation, key revoke and redemption atomically with mutations.
    Server timestamp, actor, target, product and safe references; no plaintext keys.
18. **Admin security:** Each of eight callables verifies canonical settingsManage
    authority independently. Mutations reuse verified-email/MFA/recent-auth guards.
    Live claims, disabled state, token revocation and admin role active metadata
    reject removed/stale staff. Client-supplied admin flags cannot grant authority.
19. **Rules:** Generic licensing product create/update/delete denied to client
    writers, including adding licensing metadata to marketplace products.
    Entitlements/keys/audit retain server-only writes. Existing product-shell and
    manifest server operations also reject reserved/licensing identities; legacy
    Give Product cannot bypass edition-aware grant administration.
20. **Concurrency:** Transaction tests cover capacity winner, same-user retry,
    key-revoke/redemption race, post-revoke validation, duplicate grant,
    revoke/re-grant, repeated revoke, expiry and multi-use capacity. Existing
    revoked ownership cannot be resurrected by a key receipt.
21. **Generate → redeem → authorize:** Automated Firestore emulator lifecycle passed
    through the same core used by existing public Origami endpoints.
22. **Revoke → unauthorized:** Automated, retains document/provenance; passed.
23. **Direct grant → authorize:** Automated re-grant after revocation; passed.
24. **Frontend:** Four deterministic jsdom tests pass: actual existing menu rendering,
    access/grant/revoke/re-grant, confirmation/cancellation, API error state,
    navigation declaration, generation/one-time clearing/Copy All/masked history,
    key revoke, product configuration and unauthorized surface with no API calls.
    Local browser fixture visually inspected at 1280×720; generation dialog fits.
    Screenshots are local fixtures, not production admin acceptance evidence.
25. **Backend/rules:** Rules emulator 10/10, focused backend emulator 21/21 with
    zero skips (A01, L01.1, desktop auth and existing product storage regressions).
    Endpoint tests invoke all eight real callable handlers anonymously and as an
    ordinary user and reject them before IO. Additional actual marketplace shell/
    manifest rejection checks pass. Full Functions run: 125 total, 121 pass,
    one pre-existing musicDistribution assertion failure, three emulator-only skips;
    skipped suites were separately exercised in emulator with zero skips.
26. **Origami:** Existing account and plugin/editor CTest suites passed 2/2 in
    43.70s. No native/Origami/account/DSP source changes. Existing gate/authorization
    contracts preserved. Web config check and Vite production build pass with the
    existing large-chunk advisory. No real-account host end-to-end claim.
27. **Deployment:** NOT performed. Eight new and five updated Functions, Hosting
    `web`, Firestore rules. Exact scoped command and missing-L01 prerequisites in
    [administration guide](../../licensing-administration.md). No index changes,
    signing keys, payment deployment or production data mutations.
28. **Migration:** No destructive migration. Configure/upgrade reserved Origami
    catalog explicitly. Legacy entitlements/keys remain compatible; legacy keys
    without management IDs do not appear in the new generated-key list. Optional
    metadata-only legacy backfill requires separate review; plaintext unrecoverable.
29. **L02:** Device activation, signed proof, secure server signing, public-key
    verification and bounded offline policy remain future work.
30. **Separate P0:** No dedicated proven account-Service shutdown crash repair was
    found in current HEAD/history. It remains independently open and release-blocking.
    Passing A01 regressions do not close it. ASan qualification unchanged.
31. **Security review:** No credentials/private signing keys/service-account data,
    plaintext generated production keys, client entitlement writes, raw key logs,
    digest exposure to ordinary users or production test admin bypass added.
    Emulator credentials and UI fixture identifiers are synthetic only. No
    production user/entitlement/key created, granted or revoked.
32. **Commit:** Implementation/tests/docs/screenshots committed and pushed; the
    exact resulting commit hash is supplied in the delivery response.

Full Functions failure is the unchanged `musicDistribution.test.js:75` regex
`/Spotify or Apple Music/` against existing copy containing “Spotify, or Apple Music”.
That unrelated test/source was not edited. This pass does not declare beta readiness.
