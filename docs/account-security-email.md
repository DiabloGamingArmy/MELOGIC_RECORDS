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

### Scaffolded

- Authenticator-app 2FA and recovery codes are visible as disabled foundation controls.
- The Security page reads Firebase enrolled MFA factors if available.

### Pending

- Full TOTP enrollment, disable, and recovery-code callable flow.
- Account suspension/unsuspension event logging, once those admin actions are implemented.
- Login-success logging is intentionally not enabled to avoid noisy writes.

### Known Risks

- Password reset email delivery depends on Firebase Auth email templates and sender configuration.
- 2FA controls are intentionally not interactive until the supported Firebase MFA flow is implemented.
