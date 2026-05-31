# Admin and Trust Route Matrix

## Admin Console

| Route | Required permission | Data source | Backend callable | Main actions | Changes state |
| --- | --- | --- | --- | --- | --- |
| `/admin` | `admin` | Presence, products, orders, reports, logs | `listActiveStaffPresence`, `listAdminProducts`, `listAdminOrders`, `listAdminReports`, `listAdminLogs` | View platform overview | No |
| `/admin/reviews` | `productReview` | Products in review queue | `listMarketplaceReviewQueue` | Inspect review queue | No |
| `/admin/reviews/{productId}` | `productReview` for decisions; `listingEdit` can inspect read-only details | Product detail and review metadata | `listMarketplaceReviewQueue`, `listAdminProducts`, `reviewProductDecision` | Approve, return, reject, keep pending only when pending review | Yes |
| `/admin/products` | `listingEdit` or `productReview` | Products | `listAdminProducts` | Browse product inventory | No |
| `/admin/users` | `userRead` or `roleManage` | Profiles/users/adminUsers | `listAdminUsers` | Browse users | No |
| `/admin/users/{uid}` | `userRead` or `roleManage` | Profile, user doc, products, account events | `getAdminUserProfile` | View Account Hub | No |
| `/admin/reports` | `admin`, `userModerate`, `productReview`, or `orderSupport` | Reports | `listAdminReports` | Browse reports | No |
| `/admin/reports/{reportId}` | `admin`, `userModerate`, `productReview`, or `orderSupport` | Report detail | `getAdminReport`, `updateReportDecision` | Assign, review, dismiss, resolve, action taken | Yes |
| `/admin/orders` | `orderSupport` | Orders | `listAdminOrders` | Browse orders | No |
| `/admin/orders/{orderId}` | `orderSupport` | Order detail and logs | `getAdminOrder` | View order audit | No |
| `/admin/team` | `roleManage` | Admin users | `listAdminTeam`, `setAdminUserRole` | Assign/remove roles | Yes |
| `/admin/team/{uid}` | `roleManage` | Admin user and profile context | `listAdminTeam`, `getAdminUserProfile` | View role audit | No |
| `/admin/logs` | `auditRead` | Admin logs | `listAdminLogs` | View audit logs | No |
| `/admin/logs/{logId}` | `auditRead` | Admin log detail | `getAdminLog` | View log detail, open target, copy JSON | No |
| `/admin/settings` | `admin`; edit requires `settingsManage` or `roleManage` | `platformConfig/current` | `getAdminSettings`, `updateAdminSettings` | Edit marketplace, agreements, AI moderation, upload limits, review policy | Yes |

## Account and Inbox Trust Routes

| Route | Required permission | Data source | Backend callable | Main actions | Changes state |
| --- | --- | --- | --- | --- | --- |
| `/account/security` | Signed-in user | Firebase Auth current user, `users/{uid}/accountEvents` | `recordAccountSecurityEvent` | Request password reset, view/mark events read | Yes, read markers and low-risk event |
| `/inbox?system=account` | Signed-in user | `users/{uid}/systemNotifications`, `users/{uid}/accountEvents` | None for reads | View Account/System events, mark read | Yes, read markers |

## Public and Creator Routes

| Route | Expected access | Notes |
| --- | --- | --- |
| `/products` | Public | Shows only published/public marketplace listings. |
| `/products/{slug}` | Public for published products; owner/admin paths remain protected by backend rules | Product detail should not expose private drafts to random visitors. |
| `/profile`, `/profile/public`, `/profiles/{uid-or-username}`, `/u/{username}` | Public profile view for the resolved user | `/profiles/{uid-or-username}` is rewritten to `profile-public.html`; username segments resolve through username claims before UID fallback. |
| `/products/new`, `/products/dashboard`, `/library`, `/orders` | Signed-in creator/customer | Marketplace shell, manifest, review, library, and order data stay behind Auth and backend callables where required. |

## Notes

- Non-admin users should receive intentional access-denied states for admin routes.
- Detail routes include Back links where the current admin UI has a detail panel.
- Admin-sensitive mutations go through callables and write `adminLogs`.
- Missing or denied report/order detail records should render a clear error or not-found state instead of an indefinite loading shell.
- Account Hub actions are explicit: Message opens Inbox DM flow, Add Note writes admin-only notes, and Suspend/Unsuspend writes account status plus audit/account events.
- Unsupported commerce actions, such as Stripe refunds and manual entitlement grant/revoke, must remain disabled with clear titles until backend callables exist.

## Production Smoke Checklist

1. Visit each public route and confirm no console errors beyond documented App Check or CSP report-only warnings.
2. Visit each admin list route with an admin account and confirm the table, empty state, or access-denied state is intentional.
3. Open detail routes for products, users, reports, orders, team members, and logs; Back links should return to their parent list.
4. Confirm non-admin accounts cannot enter `/admin` or execute admin callables.
5. Confirm settings changes, role changes, product decisions, and report decisions create `adminLogs`.

## Deploy Notes

- Frontend route, label, and empty-state changes require `firebase deploy --only hosting --project melogic-records`.
- Admin callable authorization changes require deploying the changed function names.
- Firestore/Storage security changes require separate rules deploys; bucket CORS is a separate `gsutil` or `gcloud storage` operation and is not applied by Hosting.
