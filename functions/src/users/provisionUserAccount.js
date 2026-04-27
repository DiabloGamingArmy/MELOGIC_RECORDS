const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')

const db = getFirestore()

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeDisplayName(value) {
  return String(value || '').trim()
}

function assertValidDisplayName(displayName, required) {
  if (!required && !displayName) return
  if (!displayName) {
    throw new HttpsError('invalid-argument', 'Display name is required.')
  }
  if (displayName.length > 80) {
    throw new HttpsError('invalid-argument', 'Display name must be 80 characters or less.')
  }
}

function assertValidUsername(usernameLower, required) {
  if (!required && !usernameLower) return
  if (!usernameLower) {
    throw new HttpsError('invalid-argument', 'Username is required.')
  }
  if (!/^[a-z0-9_-]+$/.test(usernameLower)) {
    throw new HttpsError('invalid-argument', 'Username can only contain lowercase letters, numbers, underscores, and hyphens.')
  }
  if (usernameLower.length < 3 || usernameLower.length > 30) {
    throw new HttpsError('invalid-argument', 'Username must be between 3 and 30 characters.')
  }
}

exports.provisionUserAccount = onCall(async (request) => {
  const uid = request.auth?.uid
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Authentication is required.')
  }

  const requireUsername = request.data?.requireUsername !== false
  const displayName = normalizeDisplayName(request.data?.displayName)
  const usernameLower = normalizeUsername(request.data?.username)
  const email = String(request.data?.email || '').trim()
  const photoURL = String(request.data?.photoURL || '').trim()

  assertValidDisplayName(displayName, requireUsername)
  assertValidUsername(usernameLower, requireUsername)

  const userRef = db.collection('users').doc(uid)
  const profileRef = db.collection('profiles').doc(uid)
  const claimRef = usernameLower ? db.collection('usernameClaims').doc(usernameLower) : null

  let onboardingRequired = !requireUsername || !usernameLower
  let claimReserved = false

  await db.runTransaction(async (transaction) => {
    const [userSnap, profileSnap, claimSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(profileRef),
      claimRef ? transaction.get(claimRef) : Promise.resolve(null)
    ])

    if (claimSnap?.exists && claimSnap.data()?.uid !== uid) {
      throw new HttpsError('already-exists', 'Username already taken.')
    }

    const updatedAt = FieldValue.serverTimestamp()
    const createdAtPayload = userSnap.exists ? {} : { createdAt: updatedAt }

    if (requireUsername && usernameLower) {
      onboardingRequired = false
      claimReserved = true

      transaction.set(userRef, {
        uid,
        email,
        role: 'user',
        accountType: 'user',
        roleLabel: 'User',
        stats: { products: 0, savedItems: 0, comments: 0, likes: 0, downloads: 0 },
        displayName,
        username: usernameLower,
        bio: '',
        photoURL,
        onboardingRequired: false,
        updatedAt,
        ...createdAtPayload
      }, { merge: true })

      transaction.set(profileRef, {
        uid,
        displayName,
        username: usernameLower,
        usernameLower,
        bio: '',
        avatarPath: '',
        avatarURL: photoURL,
        bannerPath: '',
        bannerURL: '',
        roleLabel: 'User',
        stats: { products: 0, savedItems: 0, comments: 0, likes: 0, downloads: 0 },
        updatedAt,
        ...(profileSnap.exists ? {} : { createdAt: updatedAt })
      }, { merge: true })

      transaction.set(claimRef, {
        uid,
        username: usernameLower,
        usernameLower,
        updatedAt,
        ...(claimSnap?.exists ? {} : { createdAt: updatedAt })
      }, { merge: true })
      return
    }

    onboardingRequired = true
    transaction.set(userRef, {
      uid,
      email,
      role: 'user',
      accountType: 'user',
      roleLabel: 'User',
      stats: { products: 0, savedItems: 0, comments: 0, likes: 0, downloads: 0 },
      displayName,
      photoURL,
      onboardingRequired: true,
      updatedAt,
      ...createdAtPayload
    }, { merge: true })
  })

  return { ok: true, onboardingRequired, claimReserved, usernameLower }
})
