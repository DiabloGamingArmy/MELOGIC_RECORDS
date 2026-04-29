# Marketplace AI Review Pipeline (Phase 1)

1. Seller submits from New Product editor.
2. Client writes `pendingReview/marketplace/items/{productId}`.
3. Backend Cloud Function triggers on create/update.
4. Function loads product metadata, file manifest, previews, and signed form references.
5. Function runs deterministic checks + optional AI checks.
6. Function writes results into `checks` fields on pendingReview doc.
7. Backend (Admin SDK only) may publish low-risk items.
8. Backend routes uncertain items to human review.
9. Backend rejects/needs-changes with actionable reasons.

## Security boundaries
- Client can submit/cancel review requests only.
- Client cannot approve or publish directly.
- AI provider keys must be server-side secrets.
- No AI calls from browser/client JavaScript.

## Suggested function
`reviewMarketplaceProductSubmission` on `pendingReview/marketplace/items/{productId}`

Initial stub should:
- read review + product docs
- compute `checks.rules`
- set `checks.ai.status = "not_configured"` unless server AI is enabled
- avoid auto-publishing in phase 1
