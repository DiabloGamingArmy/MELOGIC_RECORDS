# Marketplace AI Review Pipeline

1. Seller submits from New Product editor.
2. Client calls `requestProductReview`.
3. Backend creates `productReviewJobs/{jobId}` and keeps the product `review_pending` / private.
4. `processProductReviewJob` loads product metadata, file manifest, previews, and seller agreement data.
5. The function runs deterministic checks and Gemini review with the safe moderation model fallback order.
6. AI success records `moderationAISucceeded: true`, `moderationAIModel`, `moderationStatus`, `moderationInstructionsUsed`, `moderationPolicyVersion`, and `reviewJobStatus`.
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

## AI Moderation Settings

- Authoritative settings live in `platformConfig/current.aiModeration`.
- Default model order is `gemini-2.5-flash-lite`, `gemini-2.5-flash`, `gemini-flash-latest`.
- `gemini-1.5-flash`, Pro, Deep Research, Imagen, Veo, Lyria, Embedding, TTS, Robotics, and image-generation models are not allowed for product review.
- Admin `productModerationInstructions` are additive to the base policy and cannot remove hard safety requirements.
- AI failure keeps the product pending/private and records error fields such as `moderationAIErrorCode`, `moderationAIErrorCategory`, and `reviewJobStatus`.

## Operational Test Checklist

1. Submit a product from the creator editor.
2. Confirm `requestProductReview` creates a review job and keeps the product `review_pending` / private.
3. Confirm `processProductReviewJob` runs server-side deterministic and Gemini review.
4. Confirm AI pass leaves the product pending manual review by default.
5. Approve from `/admin/reviews/{productId}` and confirm the product becomes `published` / `public`.
6. Return for changes and confirm the product becomes `needs_changes` / private.
7. Confirm the creator receives an account event and, for returns, a system notification.

## Implementation Status

- Client cannot approve or publish directly.
- AI calls are server-side only.
- `requestProductReview` and `processProductReviewJob` are deployed Functions.
- `reviewProductDecision` handles approve, return for changes, reject, and keep pending through Admin SDK.
- `AUTO_APPROVE_PRODUCTS` defaults false.
- Settings-driven AI moderation instructions are used by the backend and marked with `moderationInstructionsUsed`.
