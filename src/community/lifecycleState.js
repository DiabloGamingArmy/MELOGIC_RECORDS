export function normalizeCommunityUid(value = '') {
  return String(value || '').trim()
}

export function createCommunityAuthScope(initialUid = '') {
  let uid = normalizeCommunityUid(initialUid)
  let epoch = 0

  return {
    current() {
      return Object.freeze({ uid, epoch })
    },
    transition(nextUid = '') {
      const normalized = normalizeCommunityUid(nextUid)
      if (normalized === uid) return Object.freeze({ changed: false, previousUid: uid, uid, epoch })
      const previousUid = uid
      uid = normalized
      epoch += 1
      return Object.freeze({ changed: true, previousUid, uid, epoch })
    },
    invalidate() {
      epoch += 1
      return Object.freeze({ uid, epoch })
    },
    isCurrent(token) {
      return Boolean(token) && token.uid === uid && token.epoch === epoch
    }
  }
}

export function createMonotonicRequestOwner() {
  let generation = 0
  return {
    next() {
      generation += 1
      return generation
    },
    invalidate() {
      generation += 1
      return generation
    },
    current() {
      return generation
    },
    isCurrent(value) {
      return Number(value) === generation
    }
  }
}

// A preserved surface already owns the listeners attached to its nodes. This
// helper deliberately limits restoration to attachment plus targeted shared
// reconciliation; callers must not run the page-wide event binder afterward.
export function restorePreservedCommunitySurface({ root, fragment, reconcile } = {}) {
  if (!root || !fragment || typeof root.replaceChildren !== 'function') return false
  root.replaceChildren(fragment)
  if (typeof reconcile === 'function') reconcile(root)
  return true
}
