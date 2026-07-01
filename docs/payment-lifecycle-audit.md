# Payment Lifecycle Audit

After a Stripe test purchase, verify these records before considering checkout healthy:

- `orders/{orderId}.paymentStatus` is `paid`.
- `orders/{orderId}.orderState` is `order_placed`.
- `users/{buyerUid}/libraryItems/{productId}` exists.
- `users/{buyerUid}/entitlements/{productId}` exists.
- `creatorLedger/{orderId}_{productId}` exists for seller-owned products.
- `users/{buyerUid}/commerceSummary/current.spendByCurrency` includes the paid amount.
- `users/{sellerUid}/earningsSummary/current.pendingByCurrency` includes creator net earnings while the hold is pending.
- `stripeWebhookEvents/{eventId}` exists with fulfillment result details.

If the webhook failed but Stripe shows the session as paid, return to:

`/account/library?purchase=success&session_id={CHECKOUT_SESSION_ID}`

The authenticated buyer reconciliation flow should repair the order, access records, creator ledger, and summaries without double-counting an already-processed checkout.
