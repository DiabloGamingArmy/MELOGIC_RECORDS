# Firebase Storage CORS for Marketplace Seller Agreement

The Marketplace Seller Agreement Markdown is loaded in-browser from Firebase Storage using `fetch()`.

Because browser `fetch()` enforces CORS, the bucket serving:

`legal/agreements/marketplace-product-seller-agreement/v<number>.md`

must allow the app origins.

## Apply CORS settings

Use the repository config file:

`firebase-storage-cors.json`

### Option A (modern gcloud)

```bash
gcloud storage buckets update gs://melogic-records.firebasestorage.app --cors-file=firebase-storage-cors.json
```

### Option B (gsutil)

```bash
gsutil cors set firebase-storage-cors.json gs://melogic-records.firebasestorage.app
```

## Verify CORS

```bash
gsutil cors get gs://melogic-records.firebasestorage.app
```

## Important

This is a **bucket configuration** change.
It is **not** applied by a normal Firebase Hosting deploy unless one of the commands above is run separately.
