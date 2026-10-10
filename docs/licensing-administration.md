# Licensing administration (A01)

A01 extends the existing Melogic admin console, Firebase Auth custom claims,
`products`, `users/{uid}/entitlements/{productId}`, `licenseKeys`, and `adminLogs`.
It does not introduce a second ownership store or modify Origami DSP/account
lifecycle code. Activation and signed offline tokens remain separate L02 work.

## Admin workflow

Administrators with canonical `licensesManage` permission (owner and admin
role defaults, or an explicitly assigned trusted Auth permission) can open **License Keys** at `/admin/license-keys`. After deployment,
use **+ Product** to create/configure `origami`, name `Origami`, status `beta`,
editions `beta`. This is an explicit administrator action; deployment creates no
products, entitlements, keys or production test accounts. An existing reserved
Origami catalog record without marketplace ownership can be upgraded in place. Other existing marketplace
product IDs cannot be converted accidentally.

Use **+ Generate Keys** after configuring the product. Each request supports 1–100
keys and 1–1000 redemptions per key. Select a canonical product and edition, an
optional credential expiration, and campaign note. Copy the one-time plaintext
result before closing. Copy failure leaves the selectable text available; closing,
Escape, disposal and navigation remove it. No historical reveal/export endpoint
exists. The masked list paginates 50 keys at a time and filters the loaded pages by
product. Product configuration is managed on the same surface.

Users → existing ⋯ menu → **Manage Products** shows product access and its
provenance. Grants require an allowed edition, optional entitlement expiration,
and reason. Revocation requires an explicit confirmation and reason. Expired
entitlements display as expired. Unrelated marketplace purchases remain in their
existing commerce views. **Give Product** remains present but its backend rejects
licensed products/Origami, directing staff to edition-aware Manage Products.

## Canonical records and semantics

- `products/{id}`: `name`, `status` (`beta`, `active`, `disabled`),
  `licensing: {enabled: true, editions: [...]}`, server `createdAt`, `updatedAt`.
  Product IDs and edition IDs are bounded safe identifiers. No pricing is invented.
- `users/{uid}/entitlements/{productId}`: `uid`, `productId`, `edition`, `status`,
  `source`, `createdAt`, `updatedAt`, `grantedAt`, `grantedByUid`, `expiresAt`,
  `reason`, `generation`, plus appropriate safe references. Redemption adds
  `redeemedKeyId` (a random management ID) and `maskedKey`; no digest/credential.
  Existing fields, including purchase references, survive merge transitions.
- Revoke updates `status: revoked`, `revokedAt`, `revokedByUid`,
  `revocationReason`, `updatedAt`. It never deletes ownership or original provenance.
- Re-grant reactivates the same canonical document and increases its generation.
  The latest grant updates grant provenance; the transaction's audit retains the
  previous record. Last revocation fields remain historical, even after re-grant.
  An identical active admin grant (edition, source, reason, expiration) is a no-op;
  repeated revoke is a no-op. Concurrent distinct changes serialize through the
  canonical document. At most one effective ownership document exists per product.
- `licenseKeys/{sha256(trimmedRawKey)}`: random `managementId`, `maskedKey`,
  `productId`, `edition`, `status: active|revoked`, creation actor/time, `expiresAt`,
  `maxRedemptions`, `redemptionCount`, campaign, revocation actor/time/reason.
  SHA-256 is the existing lookup strategy for high-entropy credentials, not a
  password hash. The digest is encoded only in the server-only document ID.
- Display lifecycle `available`, `partially_redeemed`, `redeemed`, `expired`,
  `revoked` is calculated **server-side** from authoritative status, capacity and
  expiration. Consumption and receipt writes remain transactional. Invalid legacy
  state is displayed as unavailable.
- Each key uses `MELOGIC-` plus 32 cryptographically random bytes encoded as 64
  hexadecimal characters (256 random bits). Outer whitespace trimming only;
  case/separators remain opaque. Masked metadata reveals only the last eight hex
  characters. Plaintext is returned once and never stored, audited or logged.
- Key expiration stops future redemptions. It is distinct from entitlement expiry;
  A01-issued keys grant non-expiring ownership unless access is later revoked.
- Key revocation prevents future redemption, including remaining multi-use capacity.
  It does not revoke prior ownership. Revoke the user's entitlement explicitly.

`licensing/entitlements.js` provides shared product validation, expiry validation,
active-state semantics and the canonical `grantRecord` transition. Administrative
grants and existing Origami redemption use it. A future trusted, verified purchase
handler can use this same transition with `source: purchase` and its external
reference, committing ownership and audit atomically. A01 does not change existing
marketplace checkout/payment processing or require a key for future purchases.

## Authorization and security

Every licensing callable independently enforces canonical `licensesManage` admin permission. Mutations
also use the existing verified-email, enrolled MFA and recent-auth step-up policy.
Live Auth claims, disabled status, token revocation time and existing `adminUsers`
active metadata are rechecked; stale browser claims and client-supplied `isAdmin`,
UID or source cannot grant authority. Read operations use the same current admin
permission check, without requiring a fresh MFA challenge for every list request.

Clients cannot mutate authoritative entitlement, key or licensing-product records,
including through existing marketplace product writes. The existing product-shell
and manifest server endpoints also reject reserved/licensing products; this closes
a server-SDK route around the Firestore client reservation. Key digests/receipts remain
server-only. Admin lists return allowlisted fields and random management IDs;
pagination uses those IDs, not digests. Existing audit permissions are retained.
All effective product/grant/revoke/generation/redemption transitions write the
existing `adminLogs` format within the same transaction, using server timestamps
and safe IDs. No separate audit store or unsigned offline grant exists.

`redeemOrigamiLicense` preserves its public request `{key}` and response
`{authorized, edition, validUntil}`. L01.1's existing receipt idempotence, capacity,
revoked ownership protection and no-shortening behavior remain. A01 keys are
accepted by the unchanged native key field. `getOrigamiAuthorization` still
requires active, unexpired `origami`/`beta` ownership. If a canonical product record
exists, disabled licensing or removal of beta also closes authorization. Legacy
L01.1 records without a product definition keep their established compatibility;
new A01 grants and generation always require a configured product.

Revocation is observed on the existing native online refresh. A previously issued
in-memory lease can remain valid for at most 15 minutes; there is no push revocation
or permanent offline activation. No audio callback/network behavior was changed.
The account-Service shutdown crash remains an independent open P0; A01's passing
account/editor regressions do not close or reproduce that dedicated investigation.

## Reviewed deployment scope — approval required, not executed

Canonical project: `melogic-records`; region `us-central1`; Hosting target `web`.
Build with `node scripts/check-config.mjs && npx vite build`.

A01 Functions (8 new, 5 updated):

```
listLicensingProducts
saveLicensingProduct
getAdminProductAccess
grantProductEntitlement
revokeProductEntitlement
generateLicenseKeys
listLicenseKeys
revokeLicenseKey
grantAdminProducts
createOrUpdateProductShell
saveProductManifest
getOrigamiAuthorization
redeemOrigamiLicense
```

Exact A01 deployment command (publishes the entire current website build):

```
firebase deploy --project melogic-records --only functions:listLicensingProducts,functions:saveLicensingProduct,functions:getAdminProductAccess,functions:grantProductEntitlement,functions:revokeProductEntitlement,functions:generateLicenseKeys,functions:listLicenseKeys,functions:revokeLicenseKey,functions:grantAdminProducts,functions:createOrUpdateProductShell,functions:saveProductManifest,functions:getOrigamiAuthorization,functions:redeemOrigamiLicense,hosting:web,firestore:rules
```

L01.1 previously reported missing live desktop login Functions/page. If these are
still undeployed, add `functions:beginDesktopLogin`, `functions:approveDesktopLogin`,
`functions:pollDesktopLogin` to that reviewed scope; Hosting includes `/auth/desktop`.
No other Functions, indexes, payment services or production data are included.
No production deployment or live account/key mutations were performed in A01.

No mandatory destructive migration. Configure the Origami catalog explicitly;
existing entitlements retain their canonical paths and are upgraded on a new
grant. Existing raw-key normalization/digests/receipts remain compatible. Legacy
keys without management IDs still redeem, but are omitted from the A01-generated
key list (which orders by management ID). If legacy key administration is needed,
a separately reviewed trusted backfill can add random management IDs and masked
metadata; historical plaintext cannot and must not be recovered.

L02 still requires device activation policy, secure server signing/key management,
public-key verification and bounded offline refresh/revocation semantics. No private
signing key or activation token is added here.


## A01 permission hotfix

The code-defined admin permission registry now lives in
`functions/src/admin/adminPermissions.json`, shared by the backend and frontend.
This replaces duplicated interpretation of Firebase Auth custom claims; it does
not introduce Firestore role assignments. `roleDefinitions` describes account
roles/badges and presentation, not these admin custom-claim permissions.

An owner token with `admin: true` and `adminRole: owner` inherits all registered
admin capabilities. Admin inherits its explicitly enumerated defaults, including
`licensesManage`; restricted staff need the explicit trusted licensing claim.
Owner/admin do not require rewritten user documents or a new token boolean.
The backend still rechecks live Auth authority and all existing MFA requirements.
Role reassignment strips/rebuilds this permission with the existing claim lifecycle.

For this hotfix, rebuild Hosting and redeploy these nine Functions, including
`setAdminUserRole` so future demotions strip the new permission correctly:

```
firebase deploy --project melogic-records --only functions:listLicensingProducts,functions:saveLicensingProduct,functions:getAdminProductAccess,functions:grantProductEntitlement,functions:revokeProductEntitlement,functions:generateLicenseKeys,functions:listLicenseKeys,functions:revokeLicenseKey,functions:setAdminUserRole,hosting:web
```

No rules/index changes or Firestore permission/role seed is required. No command
is required after deployment. Refresh the admin page. If the catalog shows **No
products configured**, use **+ Product**, retaining its Origami/Beta defaults,
and save. This authorized operation provisions `products/origami`; Firebase deploy
does not create it. Repeat configuration updates the same record, not another
product. Production catalog presence could not be verified by the hotfix's
read-only CLI-authenticated Firestore check (reported status 500); no production data was
written, and no production UI success is claimed.
