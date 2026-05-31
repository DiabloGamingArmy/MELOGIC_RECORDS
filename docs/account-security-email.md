# Account Security Email

Melogic uses Firebase Authentication password reset emails for account recovery.

- The public auth page exposes a forgot-password flow that calls `sendPasswordResetEmail`.
- Signed-in users can request the same email from `/account/security`.
- The UI always shows a generic success message so account existence is not revealed.
- Security events are recorded under `users/{uid}/accountEvents` by trusted Cloud Functions.
- Users can read their own account events and mark them read; clients cannot create or delete account events.
- Authenticator-app 2FA is scaffolded in the Security page and will be enabled once the supported Firebase MFA enrollment flow is ready for this app.
