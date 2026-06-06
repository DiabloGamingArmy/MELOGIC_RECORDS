# Inbox System Events

Inbox System reads two trusted notification sources:

- `users/{uid}/systemNotifications`
- `users/{uid}/accountEvents`

Account events appear in Inbox -> System. Security-sensitive event types such as password reset requests, email changes, 2FA enable/disable, admin role changes, and account suspension appear under the Security filter. Non-sensitive account events remain under Account.

Security event Open actions route to `/account/security`.

Clients can mark their own events read. They cannot create, edit, or delete trusted account events.
