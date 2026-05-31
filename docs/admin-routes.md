# Admin and Trust Route Matrix

## Admin Console

| Route | Required permission | Data source | Backend callable | Main actions | Changes state |
| --- | --- | --- | --- | --- | --- |
| `/admin` | `admin` | Presence, products, orders, reports, logs | `listActiveStaffPresence`, `listAdminProducts`, `listAdminOrders`, `listAdminReports`, `listAdminLogs` | View platform overview | No |
| `/admin/reviews` | `productReview` | Products in review queue | `listMarketplaceReviewQueue` | Inspect review queue | No |
| `/admin/reviews/{productId}` | `productReview` | Product detail and review metadata | `listMarketplaceReviewQueue`, `reviewProductDecision` | Approve, return, reject, keep pending | Yes |
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
| `/admin/settings` | `admin`; edit requires `settingsManage` or `roleManage` | `platformConfig/current` | `getAdminSettings`, `updateAdminSettings` | Edit marketplace, agreements, AI moderation, upload limits, review policy | Yes |

## Account and Inbox Trust Routes

| Route | Required permission | Data source | Backend callable | Main actions | Changes state |
| --- | --- | --- | --- | --- | --- |
| `/account/security` | Signed-in user | Firebase Auth current user, `users/{uid}/accountEvents` | `recordAccountSecurityEvent` | Request password reset, view/mark events read | Yes, read markers and low-risk event |
| `/inbox?system=account` | Signed-in user | `users/{uid}/systemNotifications`, `users/{uid}/accountEvents` | None for reads | View Account/System events, mark read | Yes, read markers |

## Notes

- Non-admin users should receive intentional access-denied states for admin routes.
- Detail routes include Back links where the current admin UI has a detail panel.
- Admin-sensitive mutations go through callables and write `adminLogs`.
