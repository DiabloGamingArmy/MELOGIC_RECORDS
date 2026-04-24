import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/firestore'
import { createDmThread, createGroupThread, getThread, listThreadsForUser } from './threadService'
import { listMessages, sendMessage } from './messageService'

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
    imageURL: thread.imageURL || otherProfile?.avatarURL || '',
    subtitle: thread.lastMessageText || 'No messages yet.',
    formattedTime: formatThreadTime(thread.lastMessageAt || thread.updatedAt || thread.createdAt),
    unreadCount: 0,
    isGroup
  }
}

export async function listInboxThreads(uid) {
  const threads = await listThreadsForUser(uid)
  const decorated = await Promise.all(threads.map((thread) => decorateThread(thread, uid)))
  return decorated
}

export { getThread, listMessages, createDmThread, createGroupThread, sendMessage }
