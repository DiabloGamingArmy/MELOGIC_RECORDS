import { doc, getDoc, getFirestore, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore'
import { app } from './firebaseConfig.js'

let hasWarnedProfileRead = false

export const db = getFirestore(app)

function defaultSocials() {
  return {
    instagram: '',
    soundcloud: '',
    spotify: '',
    youtube: '',
    discord: '',
    tiktok: ''
  }
}

function defaultSettings() {
  return {
    appearance: {
      theme: 'dark',
      compactMode: false,
      reducedMotion: false
    },
    notifications: {
      productUpdates: false,
      replies: false,
      creatorNews: false,
      releaseAlerts: false,
      marketing: false
    },
    privacy: {
      profileVisibility: 'public'
    }
  }
}

function defaultCreatorSettings() {
  return {
    creatorMode: false,
    publicCreatorProfile: false,
    storefrontVisible: false,
    submissionPreferences: ''
  }
}

function normalizeUsername(username) {
  return String(username || '')
    .trim()
    .toLowerCase()
}

function validateUsername(username) {
  if (!username) return { valid: false, message: 'Username is required.' }
  if (/\s/.test(username)) {
    return { valid: false, message: 'Username cannot contain spaces.' }
  }
  if (!/^[a-z0-9_-]+$/.test(username)) {
    return { valid: false, message: 'Username can only contain lowercase letters, numbers, underscores, and hyphens.' }
  }
  if (username.length < 3) {
    return { valid: false, message: 'Username must be at least 3 characters.' }
  }
  if (username.length > 30) {
    return { valid: false, message: 'Username must be 30 characters or less.' }
  }
  return { valid: true }
}

function validateDisplayName(displayName) {
  const value = String(displayName || '').trim()
  if (!value) {
    return { valid: false, message: 'Display name is required.' }
  }
  if (value.length > 80) {
    return { valid: false, message: 'Display name must be 80 characters or less.' }
  }
  return { valid: true, value }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}


function deriveRoleLabelFromValue(value) {
  const normalized = String(value || 'user').trim().toLowerCase()
  if (normalized === 'founder') return 'Founder'
  if (normalized === 'creator') return 'Creator'
  if (normalized === 'artist') return 'Artist'
  return 'User'
}

function sanitizeFirestorePayload(value) {
  if (value === undefined) return undefined
  if (typeof File !== 'undefined' && value instanceof File) return undefined
  if (typeof Blob !== 'undefined' && value instanceof Blob) return undefined

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeFirestorePayload(item))
      .filter((item) => item !== undefined)
  }

  if (value && typeof value === 'object') {
    if (value instanceof Date) return value
    if (!isPlainObject(value)) return value
    const clean = {}
    Object.entries(value).forEach(([key, nestedValue]) => {
      const sanitized = sanitizeFirestorePayload(nestedValue)
      if (sanitized !== undefined) clean[key] = sanitized
    })
    return clean
  }

  if (typeof value === 'number' && !Number.isFinite(value)) return undefined
  return value
}

function buildPublicProfile(uid, authUser, profileInput = {}) {
  const username = normalizeUsername(profileInput.username)
  return {
    uid,
    displayName: profileInput.displayName || authUser?.displayName || '',
    username,
    usernameLower: username,
    bio: profileInput.bio || '',
    avatarPath: profileInput.avatarPath || '',
    avatarURL: profileInput.avatarURL || profileInput.photoURL || authUser?.photoURL || '',
    bannerPath: profileInput.bannerPath || '',
    bannerURL: profileInput.bannerURL || '',
    location: profileInput.location || '',
    website: profileInput.website || '',
    roleLabel: profileInput.roleLabel || deriveRoleLabelFromValue(profileInput.role || profileInput.accountType),
    socials: profileInput.socials || {},
    stats: profileInput.stats || {
      products: 0,
      savedItems: 0,
      comments: 0,
      likes: 0,
      downloads: 0
    }
  }
}

function buildPrivateProfile(uid, authUser, profileInput = {}) {
  return {
    uid,
    email: authUser?.email || profileInput.email || '',
    role: profileInput.role || 'user',
    roleLabel: profileInput.roleLabel || deriveRoleLabelFromValue(profileInput.role || profileInput.accountType),
    accountType: profileInput.accountType || 'user',
    settings: profileInput.settings || {},
    creatorSettings: profileInput.creatorSettings || {},
    // Backward-compat profile fields while migrating to profiles/{uid}
    displayName: profileInput.displayName || authUser?.displayName || '',
    username: normalizeUsername(profileInput.username),
    bio: profileInput.bio || '',
    photoURL: profileInput.photoURL || authUser?.photoURL || null,
    location: profileInput.location || '',
    website: profileInput.website || '',
    socials: profileInput.socials || {}
  }
}

function buildProvisionedUserDoc(uid, authUser, profileInput = {}) {
  const username = normalizeUsername(profileInput.username)
  return {
    uid,
    email: authUser?.email || profileInput.email || '',
    role: 'user',
    accountType: 'user',
    roleLabel: 'User',
    stats: { products: 0, savedItems: 0, comments: 0, likes: 0, downloads: 0 },
    displayName: String(profileInput.displayName || authUser?.displayName || '').trim(),
    username,
    bio: '',
    photoURL: profileInput.photoURL || authUser?.photoURL || '',
    location: '',
    website: '',
    socials: defaultSocials(),
    settings: defaultSettings(),
    creatorSettings: defaultCreatorSettings(),
    onboardingRequired: false
  }
}

function buildProvisionedProfileDoc(uid, authUser, profileInput = {}) {
  const username = normalizeUsername(profileInput.username)
  return {
    uid,
    displayName: String(profileInput.displayName || authUser?.displayName || '').trim(),
    username,
    usernameLower: username,
    bio: '',
    avatarPath: '',
    avatarURL: profileInput.photoURL || authUser?.photoURL || '',
    bannerPath: '',
    bannerURL: '',
    location: '',
    website: '',
    roleLabel: 'User',
    socials: defaultSocials(),
    stats: {
      products: 0,
      savedItems: 0,
      comments: 0,
      likes: 0,
      downloads: 0
    }
  }
}

function buildMinimalProvisionedUserDoc(uid, authUser, profileInput = {}) {
  return {
    uid,
    email: authUser?.email || profileInput.email || '',
    displayName: String(profileInput.displayName || authUser?.displayName || '').trim(),
    photoURL: profileInput.photoURL || authUser?.photoURL || '',
    role: 'user',
    onboardingRequired: true
  }
}

export async function upsertUserProfile(user, profileInput = {}) {
  if (!db || !user?.uid) return false
  const userRef = doc(db, 'users', user.uid)
  const payload = sanitizeFirestorePayload(buildPrivateProfile(user.uid, user, profileInput))
  payload.updatedAt = serverTimestamp()
  if (profileInput.isNewUser) payload.createdAt = serverTimestamp()
  await setDoc(userRef, payload, { merge: true })
  return true
}

export async function provisionNewUserAccount(user, options = {}) {
  if (!db || !user?.uid) throw new Error('Missing authenticated user for provisioning.')

  const uid = user.uid
  const userRef = doc(db, 'users', uid)
  const profileRef = doc(db, 'profiles', uid)
  const nextDisplayName = String(options.displayName || user.displayName || '').trim()
  const nextUsernameLower = normalizeUsername(options.username)
  const requireUsername = options.requireUsername !== false
  const nextPhotoURL = options.photoURL || user.photoURL || ''

  if (requireUsername) {
    const displayNameValidation = validateDisplayName(nextDisplayName)
    if (!displayNameValidation.valid) {
      const error = new Error(displayNameValidation.message)
      error.code = 'profile/invalid-display-name'
      throw error
    }

    const usernameValidation = validateUsername(nextUsernameLower)
    if (!usernameValidation.valid) {
      const error = new Error(usernameValidation.message)
      error.code = 'profile/invalid-username'
      throw error
    }
  }

  let onboardingRequired = !requireUsername
  let claimReserved = false

  await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef)
    const profileSnap = await transaction.get(profileRef)

    const hasValidUsername = validateUsername(nextUsernameLower).valid
    const claimRef = hasValidUsername ? doc(db, 'usernameClaims', nextUsernameLower) : null
    const claimSnap = claimRef ? await transaction.get(claimRef) : null

    if (claimSnap?.exists() && claimSnap.data()?.uid !== uid) {
      const usernameError = new Error('Username already taken.')
      usernameError.code = 'profile/username-taken'
      throw usernameError
    }

    const userPayload = hasValidUsername
      ? sanitizeFirestorePayload(
          buildProvisionedUserDoc(uid, user, {
            ...options,
            displayName: nextDisplayName,
            username: nextUsernameLower,
            photoURL: nextPhotoURL
          })
        )
      : sanitizeFirestorePayload(
          buildMinimalProvisionedUserDoc(uid, user, {
            ...options,
            displayName: nextDisplayName,
            photoURL: nextPhotoURL
          })
        )

    onboardingRequired = !hasValidUsername
    userPayload.updatedAt = serverTimestamp()
    if (!userSnap.exists()) userPayload.createdAt = serverTimestamp()
    transaction.set(userRef, userPayload, { merge: true })

    if (!hasValidUsername || !claimRef || !claimSnap) return

    const profilePayload = sanitizeFirestorePayload(
      buildProvisionedProfileDoc(uid, user, {
        ...options,
        displayName: nextDisplayName,
        username: nextUsernameLower,
        photoURL: nextPhotoURL
      })
    )

    profilePayload.updatedAt = serverTimestamp()
    if (!profileSnap.exists()) profilePayload.createdAt = serverTimestamp()
    transaction.set(profileRef, profilePayload, { merge: true })

    transaction.set(
      claimRef,
      {
        uid,
        username: nextUsernameLower,
        usernameLower: nextUsernameLower,
        createdAt: claimSnap.exists() ? claimSnap.data()?.createdAt || serverTimestamp() : serverTimestamp()
      },
      { merge: true }
    )

    claimReserved = true
  })

  return {
    onboardingRequired,
    claimReserved,
    usernameLower: nextUsernameLower || ''
  }
}

export async function ensureUserProvisioned(user, options = {}) {
  if (!db || !user?.uid) return { onboardingRequired: true, repaired: false }

  const uid = user.uid
  const userRef = doc(db, 'users', uid)
  const profileRef = doc(db, 'profiles', uid)
  const explicitUsername = normalizeUsername(options.username || '')
  const explicitDisplayName = String(options.displayName || user.displayName || '').trim()

  let onboardingRequired = false
  let repaired = false

  await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef)
    const profileSnap = await transaction.get(profileRef)
    const userData = userSnap.exists() ? userSnap.data() : {}
    const profileData = profileSnap.exists() ? profileSnap.data() : {}

    const fallbackUsername = normalizeUsername(
      explicitUsername || profileData.usernameLower || profileData.username || userData.username || ''
    )
    const hasValidUsername = validateUsername(fallbackUsername).valid

    const claimRef = hasValidUsername ? doc(db, 'usernameClaims', fallbackUsername) : null
    const claimSnap = claimRef ? await transaction.get(claimRef) : null
    const claimOwnedByOther = Boolean(claimSnap?.exists() && claimSnap.data()?.uid && claimSnap.data()?.uid !== uid)

    onboardingRequired = !hasValidUsername || claimOwnedByOther

    if (!userSnap.exists()) {
      const userPayload = onboardingRequired
        ? sanitizeFirestorePayload(
            buildMinimalProvisionedUserDoc(uid, user, {
              ...options,
              displayName: explicitDisplayName,
              photoURL: user.photoURL || ''
            })
          )
        : sanitizeFirestorePayload(
            buildProvisionedUserDoc(uid, user, {
              ...options,
              displayName: explicitDisplayName,
              username: fallbackUsername,
              photoURL: user.photoURL || ''
            })
          )
      userPayload.updatedAt = serverTimestamp()
      userPayload.createdAt = serverTimestamp()
      transaction.set(userRef, userPayload, { merge: true })
      repaired = true
    } else if (userData.onboardingRequired !== onboardingRequired) {
      transaction.set(userRef, { onboardingRequired, updatedAt: serverTimestamp() }, { merge: true })
      repaired = true
    }

    if (!onboardingRequired && !profileSnap.exists()) {
      const profilePayload = sanitizeFirestorePayload(
        buildProvisionedProfileDoc(uid, user, {
          ...options,
          displayName: explicitDisplayName || userData.displayName || profileData.displayName || '',
          username: fallbackUsername,
          photoURL: user.photoURL || userData.photoURL || ''
        })
      )
      profilePayload.updatedAt = serverTimestamp()
      profilePayload.createdAt = serverTimestamp()
      transaction.set(profileRef, profilePayload, { merge: true })
      repaired = true
    }

    if (!onboardingRequired && claimRef && claimSnap && !claimSnap.exists()) {
      transaction.set(
        claimRef,
        {
          uid,
          username: fallbackUsername,
          usernameLower: fallbackUsername,
          createdAt: serverTimestamp()
        },
        { merge: true }
      )
      repaired = true
    }
  })

  return { onboardingRequired, repaired }
}

export async function getEffectiveProfile(uid, authUser = null) {
  if (!db || !uid) return null

  try {
    const profileRef = doc(db, 'profiles', uid)
    const userRef = doc(db, 'users', uid)
    const [profileSnap, userSnap] = await Promise.all([getDoc(profileRef), getDoc(userRef)])

    const profileData = profileSnap.exists() ? profileSnap.data() : null
    const userData = userSnap.exists() ? userSnap.data() : null

    const merged = {
      ...(userData || {}),
      ...(profileData || {}),
      uid,
      displayName: profileData?.displayName || userData?.displayName || authUser?.displayName || '',
      username: profileData?.username || userData?.username || '',
      bio: profileData?.bio || userData?.bio || '',
      photoURL: profileData?.avatarURL || profileData?.photoURL || userData?.photoURL || authUser?.photoURL || '',
      email: userData?.email || authUser?.email || ''
    }

    return {
      publicProfile: profileData,
      privateProfile: userData,
      effectiveProfile: merged
    }
  } catch (error) {
    if (!hasWarnedProfileRead) {
      hasWarnedProfileRead = true
      console.warn('[firebase/firestore] Profile read failed; falling back to Auth user.', error?.message || error)
    }
    return {
      publicProfile: null,
      privateProfile: null,
      effectiveProfile: {
        uid,
        displayName: authUser?.displayName || '',
        username: '',
        bio: '',
        photoURL: authUser?.photoURL || '',
        email: authUser?.email || ''
      }
    }
  }
}

export async function getUserProfile(uid, authUser = null) {
  const result = await getEffectiveProfile(uid, authUser)
  return result?.effectiveProfile || null
}

export async function getPublicProfile(uid) {
  if (!db || !uid) return null
  const profileRef = doc(db, 'profiles', uid)
  const profileSnap = await getDoc(profileRef)
  if (!profileSnap.exists()) return null
  return { uid, ...profileSnap.data() }
}

export async function getUidForUsername(username) {
  if (!db) return null
  const usernameLower = normalizeUsername(username)
  if (!usernameLower) return null
  const claimRef = doc(db, 'usernameClaims', usernameLower)
  const claimSnap = await getDoc(claimRef)
  if (!claimSnap.exists()) return null
  return claimSnap.data()?.uid || null
}

export async function saveProfileChanges(user, payload = {}) {
  if (!db || !user?.uid) throw new Error('Missing authenticated user for save.')

  const uid = user.uid
  const profileRef = doc(db, 'profiles', uid)
  const userRef = doc(db, 'users', uid)
  const displayNameValidation = validateDisplayName(payload.displayName)
  if (!displayNameValidation.valid) {
    const displayNameError = new Error(displayNameValidation.message)
    displayNameError.code = 'profile/invalid-display-name'
    throw displayNameError
  }

  let saveStage = 'init'

  try {
    await runTransaction(db, async (transaction) => {
      saveStage = 'read-current-profile'
      const profileSnap = await transaction.get(profileRef)
      const userSnap = await transaction.get(userRef)
      const existingProfile = profileSnap.exists() ? profileSnap.data() : {}
      const existingUser = userSnap.exists() ? userSnap.data() : {}

      const previousUsernameLower =
        existingProfile.usernameLower || normalizeUsername(existingProfile.username || existingUser.username)
      const nextUsernameLower = normalizeUsername(payload.username)
      const usernameValidation = validateUsername(nextUsernameLower)

      if (!usernameValidation.valid) {
        const usernameError = new Error(usernameValidation.message)
        usernameError.code = 'profile/invalid-username'
        throw usernameError
      }

      const usernameChanged = previousUsernameLower !== nextUsernameLower

      let nextClaimRef = null
      let nextClaimSnap = null
      let previousClaimRef = null
      let previousClaimSnap = null

      try {
        if (nextUsernameLower && usernameChanged) {
          saveStage = 'username-claim-read-next'
          nextClaimRef = doc(db, 'usernameClaims', nextUsernameLower)
          nextClaimSnap = await transaction.get(nextClaimRef)
          if (nextClaimSnap.exists() && nextClaimSnap.data()?.uid !== uid) {
            const usernameError = new Error('Username already taken.')
            usernameError.code = 'profile/username-taken'
            throw usernameError
          }
        }

        if (previousUsernameLower && previousUsernameLower !== nextUsernameLower) {
          saveStage = 'username-claim-read-previous'
          previousClaimRef = doc(db, 'usernameClaims', previousUsernameLower)
          previousClaimSnap = await transaction.get(previousClaimRef)
        }
      } catch (error) {
        if (!error?.code) error.code = 'profile/username-claim-write-failed'
        throw error
      }

      const normalizedPayload = {
        ...payload,
        displayName: displayNameValidation.value,
        username: nextUsernameLower,
        roleLabel: existingProfile.roleLabel || deriveRoleLabelFromValue(existingUser.role || existingUser.accountType),
        accountType: existingUser.accountType || 'user'
      }

      const publicPayload = sanitizeFirestorePayload(buildPublicProfile(uid, user, normalizedPayload))
      const privatePayload = sanitizeFirestorePayload(buildPrivateProfile(uid, user, normalizedPayload))
      publicPayload.updatedAt = serverTimestamp()
      privatePayload.updatedAt = serverTimestamp()

      if (!profileSnap.exists()) publicPayload.createdAt = serverTimestamp()
      if (!userSnap.exists()) privatePayload.createdAt = serverTimestamp()

      if (nextClaimRef && nextClaimSnap) {
        saveStage = 'username-claim-write-next'
        transaction.set(
          nextClaimRef,
          {
            uid,
            username: nextUsernameLower,
            usernameLower: nextUsernameLower,
            createdAt: nextClaimSnap.exists() ? nextClaimSnap.data()?.createdAt || serverTimestamp() : serverTimestamp()
          },
          { merge: true }
        )
      }

      if (previousClaimRef && previousClaimSnap?.exists() && previousClaimSnap.data()?.uid === uid) {
        saveStage = 'username-claim-write-previous-delete'
        transaction.delete(previousClaimRef)
      }

      saveStage = 'public-profile-write'
      transaction.set(profileRef, publicPayload, { merge: true })

      saveStage = 'private-profile-write'
      transaction.set(userRef, privatePayload, { merge: true })
      saveStage = 'transaction-commit'
    })
  } catch (error) {
    if (!error?.code) {
      if (
        saveStage === 'username-claim-read-next' ||
        saveStage === 'username-claim-read-previous' ||
        saveStage === 'username-claim-write-next' ||
        saveStage === 'username-claim-write-previous-delete'
      ) {
        error.code = 'profile/username-claim-write-failed'
      } else if (saveStage === 'public-profile-write') {
        error.code = 'profile/public-profile-write-failed'
      } else if (saveStage === 'private-profile-write' || saveStage === 'transaction-commit') {
        error.code = 'profile/private-profile-write-failed'
      }
    }

    if (error?.code === 'profile/username-claim-write-failed') {
      console.warn('[firebase/firestore] Username claim write failed.', error?.message || error)
    } else if (error?.code === 'profile/public-profile-write-failed') {
      console.warn('[firebase/firestore] Public profile write failed.', error?.message || error)
    } else if (error?.code === 'profile/private-profile-write-failed') {
      console.warn('[firebase/firestore] Private profile write failed.', error?.message || error)
    }
    throw error
  }
}
