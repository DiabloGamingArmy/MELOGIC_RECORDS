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
