# Payment Lifecycle Audit

After a Stripe test purchase, verify these records before considering checkout healthy:

- `orders/{orderId}.paymentStatus` is `paid`.
- `orders/{orderId}.orderState` is `order_placed`.
- `users/{buyerUid}/libraryItems/{productId}` exists.
- `users/{buyerUid}/entitlements/{productId}` exists.
- `users/{buyerUid}/orders/{orderId}` exists and mirrors the paid order.
- `users/{sellerUid}/sales/{orderId}_{productId}` exists for each seller-owned product line.
- `creatorLedger/{orderId}_{productId}` exists for seller-owned products.
- `platformRevenueLedger/{orderId}_{productId}` exists with Melogic's cut.
- `users/{buyerUid}/commerceSummary/current.spendByCurrency` includes the paid amount.
- `users/{sellerUid}/earningsSummary/current.pendingByCurrency` includes creator net earnings while the hold is pending.
- `platformRevenueSummary/current.earnedByCurrency` includes platform revenue.
- `stripeWebhookEvents/{eventId}` exists with fulfillment result details.

Admins can also call `auditCheckoutSessionFulfillment` with an `orderId` or `sessionId` to check whether each expected order, access, sale, ledger, revenue, and summary document exists. The callable reports document presence only and does not expose Stripe secrets.

If the webhook failed but Stripe shows the session as paid, return to:

`/account/library?purchase=success&session_id={CHECKOUT_SESSION_ID}`

The authenticated buyer reconciliation flow should repair the order, buyer order mirror, access records, seller sale records, creator ledger, platform revenue records, and summaries without double-counting an already-processed checkout.
