# Mutual Users Platform Strategy

Mutual Users keeps contact intake separate from account matching.

## Desktop web

- Username search is available without contact access.
- Users may explicitly choose a CSV or vCard file.
- Selected identifiers remain in memory and are not stored by the browser app.

## Mobile web

- Use the Contact Picker API only when supported and only after a user presses **Choose contacts**.
- Fall back to username search or a user-selected CSV/vCard file.

## PWA or native wrapper

- A future wrapper can use native contact permissions.
- It should submit the same limited identifier payload to `matchContactsToUsers`.
- The suggestion result shape and follow/message/profile actions remain unchanged.

## Backend privacy boundary

Contact matching must use a private, verified identifier index readable only by Cloud Functions. Raw address books must not be persisted. The current callable deliberately returns `matchingEnabled: false` until that index and a server-side keyed hashing strategy are provisioned.
