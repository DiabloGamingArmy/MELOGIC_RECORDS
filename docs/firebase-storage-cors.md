# Firebase Storage CORS for Marketplace Seller Agreement

The Marketplace Seller Agreement Markdown may be loaded in-browser from Firebase Storage. The product editor also has a same-origin fallback at:

`public/legal/agreements/marketplace-product-seller-agreement/v1.md`

It also supports a same-origin manifest:

`public/legal/agreements/marketplace-product-seller-agreement/manifest.json`

For production stability, keep `platformSettings/marketplaceSellerAgreement` or the manifest pointed at the latest agreement version. Browser-side Firebase Storage folder listing is intentionally not the default because it creates noisy CORS failures when the bucket CORS policy is missing or stale.

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

## Important

This is a **bucket configuration** change.
It is **not** applied by a normal Firebase Hosting deploy unless one of the commands above is run separately.

The actual bucket name should be verified in Firebase Console / Storage before applying the command.
Storage security rules and bucket CORS are separate settings: rules decide who may read the object, while CORS decides whether the browser origin is allowed to fetch it.

## Recommended latest-version flow

Use one of these as the authoritative latest-version pointer:

1. `platformSettings/marketplaceSellerAgreement` in Firestore with `activeVersion`, `storagePath`, and optional `publicPath`.
2. `public/legal/agreements/marketplace-product-seller-agreement/manifest.json`.

Only enable browser-side Storage version discovery if bucket CORS has been applied. In Firestore config, set `versionDiscoveryMode: "storage"` or `storageDiscoveryEnabled: true` when you intentionally want the browser to list Storage objects.
