# Security Hardening (Pass 1)

## Implemented now (in repo)
- Added Firebase App Check client scaffolding (`src/firebase/appCheck.js`) with safe no-op behavior in local/dev unless explicitly enabled via `VITE_ENABLE_APP_CHECK=true` and a site key is present.
- Initialized App Check from the Firebase bootstrap path before Firestore/Storage/Functions imports consume the app instance.
- Hardened `storage.rules` product media writes to owner-only paths with MIME and size validation.
- Hardened `firestore.rules` for `products/{productId}` with:
  - public read for published/public products only
  - owner read for private/draft products
  - allowed field list and validation constraints
  - immutable creator identity checks
  - protected server-owned fields blocked from client mutation
- Hardened product payload creation so creator identity is enforced from authenticated user/profile, not editable form values.
- Restricted production query fallback behavior for product listing failures so index issues are surfaced instead of silently over-reading.
- Added hosting security headers and cache policy headers to `firebase.json`.
- Replaced undefined OAuth support email placeholder with `support@melogicrecords.com`.

## Manual Firebase Console tasks (required)
1. Enable App Check for:
   - Firestore
   - Cloud Storage
   - Cloud Functions
2. Configure App Check with **reCAPTCHA Enterprise** for the web app.
3. Monitor App Check metrics/logs, then enable enforcement gradually.
4. Configure Firebase Auth password policy.
5. Enable and enforce email verification flow for relevant app actions.
6. Evaluate MFA requirements for creator/admin accounts.
7. Review/update Firebase Auth authorized domains and OAuth branding settings.
8. TODO: confirm `support@melogicrecords.com` mailbox ownership/routing before production launch.

## Deployment commands (manual only)
```bash
firebase deploy --only firestore:rules
firebase deploy --only storage
firebase deploy --only hosting
```

## Future server-side architecture work
- Move product publishing transitions to a callable Cloud Function.
- Add Stripe Checkout Session callable endpoint.
- Add Stripe webhook fulfillment pipeline.
- Add `entitlements` collection and access model.
- Add signed URL broker for paid/private downloads.
- Add moderation + malware/file scanning pipeline for uploads.

## Security notes
- Firebase client config values are not secrets by themselves.
- Firestore/Storage Rules + App Check + server-side validation are the security boundary.
- Do **not** treat localStorage cart data as purchase or entitlement source of truth.
