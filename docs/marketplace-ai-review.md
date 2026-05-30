# Marketplace AI Review Pipeline

1. Seller submits from New Product editor.
2. Client calls `requestProductReview`.
3. Backend creates `productReviewJobs/{jobId}` and keeps the product `review_pending` / private.
4. `processProductReviewJob` loads product metadata, file manifest, previews, and seller agreement data.
5. The function runs deterministic checks and Gemini review with the safe moderation model fallback order.
6. AI success records `moderationAISucceeded: true`, `moderationAIModel`, `moderationStatus`, and `reviewJobStatus`.
7. By default, products that pass AI remain `review_pending` with `reviewJobStatus: "pending_manual_review"`.
8. Staff review pending products in the Admin Console at `/admin/reviews`.
9. Staff decisions call `reviewProductDecision`, which publishes or returns the listing to a private non-public state through Admin SDK.

## Security boundaries
- Client can submit/cancel review requests only.
- Client cannot approve or publish directly.
- AI provider keys must be server-side secrets.
- No AI calls from browser/client JavaScript.
- Admin approval is server-only. The Admin Console uses callables and does not require broad Firestore writes.
- Reviewer authorization is based on Firebase Auth custom claims only. `adminUsers/{uid}` is display metadata, not an authorization source.
- Bootstrap the first owner with `node scripts/setAdminClaims.js <uid> owner`; the user must sign out/sign in or refresh their ID token afterward.

## Manual Review

`reviewProductDecision` accepts:

- `approve`: publishes the product as `published` / `public`.
- `request_changes`: keeps the product private with `needs_changes`.
- `reject`: keeps the product private with `rejected`.
- `keep_pending`: returns the product to `review_pending` / private.

Every decision writes an audit event under `productModeration/{productId}/events/{eventId}` and an admin audit log under `adminLogs/{logId}`.

## AI Auto-Approval

`AUTO_APPROVE_PRODUCTS` defaults to false. If enabled, automatic publish only happens when Gemini succeeds, rule checks pass, the AI risk level is low or unknown with no reasons, required listing fields are present, the seller agreement is accepted, product deliverables exist, and pricing is valid. AI failures never publish through rule-based fallback.
