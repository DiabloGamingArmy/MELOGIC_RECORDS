# Account Security Email

Melogic uses Firebase Authentication password reset emails for account recovery.

- The public auth page exposes a forgot-password flow that calls `sendPasswordResetEmail`.
- Signed-in users can request the same email from `/account/security`.
- The UI always shows a generic success message so account existence is not revealed.
- Security events are recorded under `users/{uid}/accountEvents` by trusted Cloud Functions.
- Users can read their own account events and mark them read; clients cannot create or delete account events.
- Authenticator-app 2FA is scaffolded in the Security page and will be enabled once the supported Firebase MFA enrollment flow is ready for this app.

## Implementation Status

### Implemented

- Public auth forgot-password flow calls Firebase Auth `sendPasswordResetEmail`.
- Signed-in `/account/security` page can send a password reset email to the current account email.
- Trusted functions write account events under `users/{uid}/accountEvents`.
- Product review decisions, reports, role changes, and signed-in password reset requests write account events.
- Inbox System -> Account reads account events separately from core message threads.
- Users can read their own account events and update only `readAt`.
- Firestore rules block client create/delete for account events.
- Admin Account Hub loads recent account events through `getAdminUserProfile`.
- Admin accounts see a missing-2FA warning on `/account/security` while MFA remains scaffolded.
- Admin suspension/unsuspension writes account events so the affected user can see critical account status changes.

### Scaffolded

- Authenticator-app 2FA and recovery codes are visible as disabled foundation controls.
- The Security page reads Firebase enrolled MFA factors if available.

### Pending

- Full TOTP enrollment, disable, and recovery-code callable flow.
- Full account-status enforcement beyond the current stored suspension flag and account event.
- Full enforcement of suspended-account restrictions across every product, report, checkout, and messaging edge.
- Login-success logging is intentionally not enabled to avoid noisy writes.

### Known Risks

- Password reset email delivery depends on Firebase Auth email templates and sender configuration.
- 2FA controls are intentionally not interactive until the supported Firebase MFA flow is implemented.

## Manual Test Checklist

1. Request forgot-password from the public auth page and confirm the UI shows a generic success message.
2. Open `/account/security` while signed in and confirm provider, email, MFA, and admin warning states match the account.
3. Confirm account events load under both `/account/security` and Inbox -> System -> Account.
4. Confirm Firestore rules allow users to read/update only their own `readAt` markers and block forged create/delete.
5. Confirm suspended users receive an `account_suspended` event and normal users cannot write suspension fields themselves.

## Deploy Notes

- UI copy or route fixes require Hosting deploy.
- Trusted event-writing changes require deploying the affected account/admin/product/report functions.
- No secret values are required for password reset; Firebase Auth email template configuration lives in Firebase Console.
