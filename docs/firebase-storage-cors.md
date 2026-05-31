# Firebase Storage CORS for Marketplace Seller Agreement

The Marketplace Seller Agreement Markdown may be loaded in-browser from Firebase Storage. The product editor also has a same-origin fallback at:

`public/legal/agreements/marketplace-product-seller-agreement/v1.md`

It also supports a same-origin manifest:

`public/legal/agreements/marketplace-product-seller-agreement/manifest.json`

For production stability, keep `platformConfig/current.agreements` as the authoritative admin settings document and mirror the active seller agreement to `platformSettings/marketplaceSellerAgreement` for the product editor. Browser-side Firebase Storage folder listing is intentionally not the default because it creates noisy CORS failures when the bucket CORS policy is missing or stale.

Because browser `fetch()` and Firebase Storage browser reads enforce CORS, the bucket serving:

`legal/agreements/marketplace-product-seller-agreement/v<number>.md`

must allow the app origins.

## Apply CORS settings

Use the repository config file:

`firebase-storage-cors.json`

Current expected contents:

```json
[
  {
    "origin": [
      "https://melogicrecords.studio",
      "https://melogic-records.web.app",
      "https://melogic-records.firebaseapp.com",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3000"
    ],
    "method": ["GET", "HEAD"],
    "responseHeader": ["Content-Type", "Access-Control-Allow-Origin", "x-goog-meta-*"],
    "maxAgeSeconds": 3600
  }
]
```

### Option A (gsutil)

```bash
gsutil cors set firebase-storage-cors.json gs://melogic-records.firebasestorage.app
```

### Option B (modern gcloud)

```bash
gcloud storage buckets update gs://melogic-records.firebasestorage.app --cors-file=firebase-storage-cors.json
```

## Verify CORS

```bash
gsutil cors get gs://melogic-records.firebasestorage.app
```

The repo also exposes a read-only helper:

```bash
npm run storage:cors:get
```

## Important

This is a **bucket configuration** change.
It is **not** applied by a normal Firebase Hosting deploy unless one of the commands above is run separately.

The actual bucket name should be verified in Firebase Console / Storage before applying the command.
Storage security rules and bucket CORS are separate settings: rules decide who may read the object, while CORS decides whether the browser origin is allowed to fetch it.

## Recommended latest-version flow

Use this as the authoritative latest-version pointer:

1. `platformConfig/current.agreements` for admin-owned platform settings.
2. Mirrored `platformSettings/marketplaceSellerAgreement` with `activeVersion`, `storagePath`, and optional `publicPath` for creator editor reads.
3. `public/legal/agreements/marketplace-product-seller-agreement/manifest.json` as same-origin fallback.

Only enable browser-side Storage version discovery if bucket CORS has been applied. In Firestore config, set `versionDiscoveryMode: "storage"` or `storageDiscoveryEnabled: true` when you intentionally want the browser to list Storage objects. Direct fetch of the exact configured agreement object is controlled separately by `allowStorageFetch`.

## Operator Runbook

1. Verify the bucket name in Firebase Console / Storage.
2. Review `firebase-storage-cors.json`; it should include `https://melogicrecords.studio`, `https://melogic-records.web.app`, `https://melogic-records.firebaseapp.com`, and localhost development origins.
3. Apply with `gsutil cors set firebase-storage-cors.json gs://melogic-records.firebasestorage.app` or `gcloud storage buckets update gs://melogic-records.firebasestorage.app --cors-file=firebase-storage-cors.json`.
4. Verify with `gsutil cors get gs://melogic-records.firebasestorage.app` or `npm run storage:cors:get`.
5. Remember that `firebase deploy` does not apply bucket CORS.

## Implementation Status

- `firebase-storage-cors.json` exists with production and localhost origins.
- Admin agreement upload accepts `.md` files only and validates `v<number>` versions.
- New uploads use `legal/agreements/marketplace-product-seller-agreement/v<number>.md`.
- `updateAdminSettings` writes `platformConfig/current` and mirrors the active agreement to `platformSettings/marketplaceSellerAgreement`.
- The mirror enables direct fetch of the configured Storage object with `allowStorageFetch: true`.
- Browser-side Storage folder listing remains opt-in and is not the default.

## Production Readiness Caveat

- Do not report bucket CORS as applied unless `gsutil cors set ...` or `gcloud storage buckets update ... --cors-file=...` has actually been run and verified.
- If CORS is not applied, the product editor should continue using the Firestore settings mirror and same-origin public fallback rather than browser-side bucket listing.
- Storage rules and CORS must both be correct: rules authorize the object read, while CORS authorizes the browser origin.
