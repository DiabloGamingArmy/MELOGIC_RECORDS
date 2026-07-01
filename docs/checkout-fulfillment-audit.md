# Checkout Fulfillment Audit

Use this checklist after a paid Stripe Checkout purchase or when repairing a paid checkout session.

## Buyer Access

- Stripe Checkout Session has `payment_status == paid`.
- `orders/{orderId}.paymentStatus == paid`.
- `orders/{orderId}.orderState == order_placed`.
- `users/{buyerUid}/libraryItems/{productId}` exists for each paid digital or downloadable product.
- `users/{buyerUid}/entitlements/{productId}` exists for each paid digital or downloadable product.
- `users/{buyerUid}/orders/{orderId}` exists and mirrors the paid order.

## Seller Accounting

- `users/{sellerUid}/sales/{orderId_productId}` exists when the product has a valid seller.
- `creatorLedger/{orderId_productId}` exists when the product has a valid seller.
- `users/{sellerUid}/earningsSummary/current` includes the pending amount.
- `platformRevenueLedger/{orderId_productId}` exists for each seller ledger line.
- `platformRevenueSummary/current` includes earned platform fees.

## Operational Signals

- `stripeWebhookEvents/{eventId}` has the fulfillment result.
- The fulfillment result includes `libraryWriteCount`, `entitlementWriteCount`, `grantedProductIds`, `repairedProductIds`, `duplicateProductIds`, `ledgerEntryIds`, and `missingCreatorProductIds`.
- Missing seller or creator data is logged, but it does not block buyer library access.
- If the webhook failed, `/account/library?purchase=success&session_id=...` calls `reconcileCheckoutSession`.
- If buyer access still needs repair, call `repairPaidCheckoutAccess` with a paid `sessionId` or `orderId`.

## Guardrails

- Physical-only products do not receive digital library access unless they are hybrid or have downloadable assets.
- Unknown marketplace products default to library-access eligible.
- Checkout fulfillment does not create Stripe transfers or payouts.
- Stripe secret keys are never logged.
