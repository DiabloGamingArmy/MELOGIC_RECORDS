# Orders and Entitlements

## Current Lifecycle

1. Client starts paid checkout through the backend `createCheckoutSession` callable.
2. Stripe Checkout creates a sandbox/test session and the backend creates `orders/{orderId}` with Stripe-backed totals. Successful paid checkout redirects to `/account/library?purchase=success`.
3. `stripeWebhook` is the payment source of truth. On `checkout.session.completed` with `payment_status: paid`, it marks the order paid.
4. The webhook grants `users/{uid}/entitlements/{productId}` and mirrors access to `users/{uid}/libraryItems/{productId}`.
5. Free products use `claimFreeProduct`, which creates a zero-dollar `orders/{orderId}` record and writes the same entitlement/library access path without paid revenue.
6. Download access checks trusted entitlement/library records before signing product download URLs.

## User-Facing Routes

- `/account/library` shows purchased, free-claimed, active, pending, refunded/revoked, and saved product records.
- `/account/orders` shows Stripe-backed order history, totals, payment status, refund status, and View Order links.
- `/account/orders/{orderId}` shows order detail, line items, payment source, entitlement/library state, and support scaffolding.

Legacy `/library` and `/orders` paths redirect to the account routes.

## Admin Routes

- `/admin/orders` lists order summaries for staff with `orderSupport`.
- `/admin/orders/{orderId}` shows payment, entitlements, library access, mismatch warnings, support notes, and order logs.

Mismatch warnings include:

- Order paid but entitlement missing.
- Entitlement exists but library item missing.
- Order exists but payment is not complete.
- Refunded order still has active entitlement.

## Stripe Sandbox Behavior

The app may display `Stripe Test Mode` when `livemode` is false. This does not mean real money moved. Order totals, currency, payment status, session ID, and payment intent must come from Stripe/webhook-backed order data, not client cart guesses.

## Pending Support Actions

- Live Stripe refunds are not implemented from the admin UI.
- Manual entitlement grant/revoke callables are not implemented yet.
- User refund/problem buttons route to support scaffolding; they do not issue automatic refunds.
- The webhook currently processes `checkout.session.completed`; refunds, disputes, async payment failure, and subscription events need separate webhook branches before the UI can claim those states are automated.

## Security Notes

- Users can read only their own orders, entitlements, and library items.
- Users cannot create/update/delete entitlement or library records from the client.
- Admin inspection uses backend callables.
- Normal users cannot read `users/{uid}/adminNotes`.
- Product downloads are served through the `createProductDownloadUrl` callable after owner or active entitlement/library checks. Storage rules deny direct reads for marketplace download, file, and license paths.
- The active access schema is `orders/{orderId}` plus `users/{uid}/entitlements/{productId}` and `users/{uid}/libraryItems/{productId}`. A separate top-level entitlement collection is intentionally not used here.

## Manual Test Checklist

1. Complete Stripe sandbox checkout.
2. Confirm `orders/{orderId}` uses Stripe-backed amount/currency/status.
3. Confirm webhook grants entitlement and library item records.
4. Confirm `/account/orders` and `/account/library` show the purchase.
5. Confirm `/account/orders/{orderId}` opens only for the signed-in buyer.
6. Confirm `/admin/orders/{orderId}` shows entitlement/library state and warnings.
7. Confirm another user cannot read the order/library item.
8. Confirm no UI claims a real-money production charge while in sandbox mode.
