import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/firestore'
import {
  addParticipantsToThread,
  createGroupThread,
  createOrGetDm,
  getThread,
  listThreadsForUser,
  repairMyInboxThreads,
  removeParticipantFromThread,
  updateThreadDetails,
  subscribeToThreadsForUser
} from './threadService'
import {
  listMessages,
  markThreadDelivered,
  markThreadRead,
  sendMessage,
  setTypingState,
  subscribeToMessages,
  subscribeToThreadParticipants,
  subscribeToTypingState
} from './messageService'

const profileCache = new Map()
let profileLookupWarningShown = false

function formatThreadTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date)
  } catch {
    return date.toLocaleString()
  }
}

async function getProfile(uid) {
  if (!db || !uid) return null
  if (profileCache.has(uid)) return profileCache.get(uid)

  try {
    const profileDoc = await getDoc(doc(db, 'profiles', uid))
    const profile = profileDoc.exists() ? profileDoc.data() : null
    profileCache.set(uid, profile)
    return profile
  } catch (error) {
    if (!profileLookupWarningShown) {
      profileLookupWarningShown = true
      console.warn('Inbox profile lookup failed for /profiles reads.', error)
    }
    profileCache.set(uid, null)
    return null
  }
}

export async function loadProfilesByUids(uids = []) {
  const unique = Array.from(new Set((uids || []).filter(Boolean)))
  if (!unique.length) return {}

  const profilePairs = await Promise.all(
    unique.map(async (uid) => [uid, await getProfile(uid)])
  )

  return profilePairs.reduce((acc, [uid, profile]) => {
    acc[uid] = profile
    return acc
  }, {})
}

function buildFallbackTitle(thread, currentUid) {
  if (thread.type === 'group') return thread.title || 'Untitled group'
  if (Array.isArray(thread.participantIds) && thread.participantIds.length > 1) {
    const count = thread.participantIds.filter((id) => id !== currentUid).length
    return count > 1 ? `Direct thread (${count} members)` : 'Direct message'
  }
  return 'Direct message'
}

async function decorateThread(thread, currentUid) {
  const participantIds = Array.isArray(thread.participantIds) ? thread.participantIds : []
  const isGroup = thread.type === 'group'
  const otherParticipantId = participantIds.find((id) => id && id !== currentUid)
  const otherProfile = !isGroup && otherParticipantId ? await getProfile(otherParticipantId) : null

  const title = isGroup
    ? thread.title || 'Untitled group'
    : String(otherProfile?.displayName || otherProfile?.username || buildFallbackTitle(thread, currentUid)).trim()

  return {
    ...thread,
    title,
    imageURL: thread.imageURL || otherProfile?.avatarURL || otherProfile?.photoURL || '',
    subtitle: thread.lastMessageText || 'No messages yet.',
    formattedTime: formatThreadTime(thread.lastMessageAt || thread.updatedAt || thread.createdAt),
    unreadCount: Number(thread.unreadCount || 0),
    isGroup
  }
}

export async function listInboxThreads(uid) {
  const threads = await listThreadsForUser(uid)
  return Promise.all(threads.map((thread) => decorateThread(thread, uid)))
}

export function subscribeToInboxThreads(uid, callback, onError) {
  return subscribeToThreadsForUser(uid, async (threads) => {
    const decorated = await Promise.all(threads.map((thread) => decorateThread(thread, uid)))
    callback(decorated)
  }, onError)
}

export {
  getThread,
  listMessages,
  subscribeToMessages,
  createOrGetDm,
  createGroupThread,
  repairMyInboxThreads,
  addParticipantsToThread,
  removeParticipantFromThread,
  updateThreadDetails,
  sendMessage,
  markThreadRead,
  markThreadDelivered,
  subscribeToThreadParticipants,
  subscribeToTypingState,
  setTypingState
}
