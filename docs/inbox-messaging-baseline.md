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
- Universal pinned inbox items live in `users/{uid}/inboxPins/{pinId}` and may reference message threads, system notifications, or account events. Pins are user-owned shortcuts only; they do not mutate the source notification/thread records.
- Message threads initially subscribe to the latest small window of messages and render at the bottom of the conversation. The "Load earlier messages" control prepends older pages while preserving scroll position.
- Image attachments open in an in-app preview modal with zoom controls. The source attachment remains available through the preview's Open action.

## Regression Checklist

1. Open `/inbox` and confirm direct/group conversation lists still render.
2. Open `/inbox?system=account` and confirm account events render without altering the core message thread state.
3. Confirm read markers update for the signed-in user only.
4. Pin and unpin a message thread plus a System/Account notification; confirm the Pinned block remains visible across Inbox sections.
5. Confirm permission failures are logged as recoverable UI states, not broken page renders.

## Known Production Risks

- Account event delivery depends on trusted backend callables writing `users/{uid}/accountEvents`.
- The messaging baseline should not be rewritten while adding marketplace or security notifications; add isolated system channels instead.
