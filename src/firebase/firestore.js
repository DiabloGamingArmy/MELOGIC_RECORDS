import { doc, getDoc, getFirestore, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore'
import { app } from './firebaseConfig.js'

let hasWarnedProfileRead = false

export const db = getFirestore(app)

function normalizeUsername(username) {
  return String(username || '')
    .trim()
    .toLowerCase()
}

function buildPublicProfile(uid, authUser, profileInput = {}) {
  const username = (profileInput.username || '').trim()
  return {
    uid,
    displayName: profileInput.displayName || authUser?.displayName || '',
    username,
    usernameLower: normalizeUsername(username),
    bio: profileInput.bio || '',
    avatarPath: profileInput.avatarPath || '',
    avatarURL: profileInput.avatarURL || profileInput.photoURL || authUser?.photoURL || '',
    bannerPath: profileInput.bannerPath || '',
    bannerURL: profileInput.bannerURL || '',
    location: profileInput.location || '',
    website: profileInput.website || '',
    roleLabel: profileInput.roleLabel || profileInput.role || 'User',
    socials: profileInput.socials || {},
    stats: profileInput.stats || {
      products: 0,
      savedItems: 0,
      comments: 0,
      likes: 0,
      downloads: 0
    },
    updatedAt: serverTimestamp()
  }
}

function buildPrivateProfile(uid, authUser, profileInput = {}) {
  return {
    uid,
    email: authUser?.email || profileInput.email || '',
    role: profileInput.role || 'user',
    updatedAt: serverTimestamp(),
    settings: profileInput.settings || {},
    creatorSettings: profileInput.creatorSettings || {},
    // Backward-compat profile fields while migrating to profiles/{uid}
    displayName: profileInput.displayName || authUser?.displayName || '',
    username: profileInput.username || '',
    bio: profileInput.bio || '',
    photoURL: profileInput.photoURL || authUser?.photoURL || null,
    location: profileInput.location || '',
    website: profileInput.website || '',
    socials: profileInput.socials || {}
  }
}

export async function upsertUserProfile(user, profileInput = {}) {
  if (!db || !user?.uid) return false
  const userRef = doc(db, 'users', user.uid)
  const payload = buildPrivateProfile(user.uid, user, profileInput)

  if (profileInput.isNewUser) {
    payload.createdAt = serverTimestamp()
  }

  await setDoc(userRef, payload, { merge: true })
  return true
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

export async function saveProfileChanges(user, payload = {}) {
  if (!db || !user?.uid) throw new Error('Missing authenticated user for save.')

  const uid = user.uid
  const profileRef = doc(db, 'profiles', uid)
  const userRef = doc(db, 'users', uid)

  await runTransaction(db, async (transaction) => {
    const [profileSnap, userSnap] = await Promise.all([transaction.get(profileRef), transaction.get(userRef)])
    const existingProfile = profileSnap.exists() ? profileSnap.data() : {}
    const existingUser = userSnap.exists() ? userSnap.data() : {}

    const previousUsernameLower =
      existingProfile.usernameLower || normalizeUsername(existingProfile.username || existingUser.username)
    const nextUsernameLower = normalizeUsername(payload.username)

    if (nextUsernameLower) {
      const claimRef = doc(db, 'usernameClaims', nextUsernameLower)
      const claimSnap = await transaction.get(claimRef)
      if (claimSnap.exists() && claimSnap.data()?.uid !== uid) {
        const usernameError = new Error('Username already taken.')
        usernameError.code = 'profile/username-taken'
        throw usernameError
      }

      transaction.set(
        claimRef,
        {
          uid,
          username: payload.username,
          usernameLower: nextUsernameLower,
          createdAt: claimSnap.exists() ? claimSnap.data()?.createdAt || serverTimestamp() : serverTimestamp()
        },
        { merge: true }
      )

      if (previousUsernameLower && previousUsernameLower !== nextUsernameLower) {
        const previousClaimRef = doc(db, 'usernameClaims', previousUsernameLower)
        const previousClaimSnap = await transaction.get(previousClaimRef)
        if (previousClaimSnap.exists() && previousClaimSnap.data()?.uid === uid) {
          transaction.delete(previousClaimRef)
        }
      }
    }

    const publicPayload = buildPublicProfile(uid, user, payload)
    const privatePayload = buildPrivateProfile(uid, user, payload)

    if (!profileSnap.exists()) {
      publicPayload.createdAt = serverTimestamp()
    }
    if (!userSnap.exists()) {
      privatePayload.createdAt = serverTimestamp()
    }

    transaction.set(profileRef, publicPayload, { merge: true })
    transaction.set(userRef, privatePayload, { merge: true })
  })
}
