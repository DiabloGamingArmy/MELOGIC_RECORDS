# Inbox Messaging Framework Baseline

The inbox messaging framework baseline is **complete** and considered stable.

## Baseline features included
- Direct messages
- Group chat foundation
- Conversation restore after per-user delete/hide
- Per-user pin/delete inbox controls
- Realtime messages
- Read/delivery receipts
- Typing indicators
- Attachments (256 MB max)
- Reactions
- Replies
- Message edit/delete/hide behavior
- DM blocking via thread-visible `dmBlockState`
- Blocked DM composer lockout for both users
- Profile/message sender hydration
- Basic chat settings/member controls

## Guidance for future work
- Treat this baseline as the stable foundation for future messaging work.
- Avoid rewriting core messaging flow unless explicitly requested.
- Extend through isolated, non-regressive improvements.

## Extension Rules

- Do not rewrite message send/read/delete/hide/block core flows for notification work.
- Add future account, security, system, or marketplace notices through isolated modules and filters.
- Keep `dmBlockState` as the cross-account DM lockout source of truth.
- Account events are read from `users/{uid}/accountEvents` and rendered under Inbox -> System -> Account without altering DM/group chat behavior.

## Implementation Status

- Core DM/group chat baseline remains stable.
- System notifications remain in `users/{uid}/systemNotifications`.
- Account/security events are a separate read path from `users/{uid}/accountEvents`.
- Users can mark account events read without creating/deleting event records.
