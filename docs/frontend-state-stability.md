# Frontend State Stability

Interactive pages should avoid full reloads for small actions. Favor local state patches, background writes, and targeted DOM reconciliation so scroll position, media playback, composer drafts, and open modals stay stable.

## Default Pattern

1. Capture the current item state.
2. Optimistically patch the local item and update the smallest visible surface.
3. Run the backend write in the background.
4. Reconcile only the changed item from the callable result.
5. Roll back the captured item if the write fails.

Use a full reload only for route changes, filter/search changes, initial page hydration, permission boundary changes, or when the server response changes the shape of the whole result set.

## Inbox

- Sending a message should add an optimistic row, clear the composer, and let the message subscription reconcile the confirmed message.
- Do not refetch or rebuild the whole thread immediately after a successful send.
- Initial thread load can scroll to bottom. Older-message prepends should preserve the prior viewport anchor.
- Image and video attachments should reserve space before load events so bottom scroll does not jump.
- Thread pinning should patch the local thread row immediately and persist the preference in the background.

## Community

- Post like, dislike, save, and share actions should patch the specific post card and roll back on failure.
- Comment like and dislike actions should patch the specific comment action row, not rebuild the whole detail page.
- Comment create, reply, delete, edit, and report actions may re-render the detail comments area, but should not reload the whole feed.
- Search, sort, tab, topic, community, and tag changes can refetch because they intentionally change the result set.

## Stories

- Opening a story should render the viewer once.
- View-count writes should update local state quietly and must not re-render the viewer or restart media.
- Story media should use stable sizing and eager loading inside the active viewer.
- Story reactions and comments should follow the same optimistic-item pattern once their backend endpoints exist.

## UI Rails

- Right-rail widgets should derive from already-loaded state where possible.
- Avoid sidebar refetches that can reset the main feed or detail page.
- External content widgets should degrade to static copy until their integration is connected.
