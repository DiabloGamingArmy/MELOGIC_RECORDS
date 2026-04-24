import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/firestore'
import {
  addParticipantsToThread,
  createGroupThread,
  createOrGetDm,
  getThread,
  listThreadsForUser,
  removeParticipantFromThread,
  subscribeToThreadsForUser
} from './threadService'
import { listMessages, markThreadRead, sendMessage, subscribeToMessages } from './messageService'

const profileCache = new Map()

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

  const profileDoc = await getDoc(doc(db, 'profiles', uid))
  const profile = profileDoc.exists() ? profileDoc.data() : null

  if (!profile) {
    const userDoc = await getDoc(doc(db, 'users', uid))
    const fallback = userDoc.exists() ? userDoc.data() : null
    profileCache.set(uid, fallback)
    return fallback
  }

  profileCache.set(uid, profile)
  return profile
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

export function subscribeToInboxThreads(uid, callback) {
  return subscribeToThreadsForUser(uid, async (threads) => {
    const decorated = await Promise.all(threads.map((thread) => decorateThread(thread, uid)))
    callback(decorated)
  })
}

export {
  getThread,
  listMessages,
  subscribeToMessages,
  createOrGetDm,
  createGroupThread,
  addParticipantsToThread,
  removeParticipantFromThread,
  sendMessage,
  markThreadRead
}
