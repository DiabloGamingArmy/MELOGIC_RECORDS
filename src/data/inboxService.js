import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/firestore'
import {
  addParticipantsToThread,
  createGroupThread,
  createOrGetDm,
  blockUser,
  getBlockedUsers,
  getThread,
  hydrateThreadFromSourceIfNeeded,
  listThreadsForUser,
  restoreThreadForUser,
  setThreadPinnedForUser,
  deleteThreadForUser,
  repairMyInboxThreads,
  removeParticipantFromThread,
  subscribeToBlockedUsers,
  subscribeToThread,
  unblockUser,
  updateThreadDetails,
  subscribeToThreadsForUser
} from './threadService'
import {
  addMessageReaction,
  deleteMessageForEveryone,
  editMessage,
  hideMessageForMe,
  listMessages,
  markThreadDelivered,
  markThreadRead,
  removeMessageReaction,
  sendMessage,
  setTypingState,
  subscribeToHiddenThreadMessages,
  subscribeToMessageReactions,
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
  const otherByMirror = Array.isArray(thread.otherParticipantIds) ? thread.otherParticipantIds.find((id) => id && id !== currentUid) : ''
  const otherParticipantId = otherByMirror || participantIds.find((id) => id && id !== currentUid) || ''
  const otherProfile = !isGroup && otherParticipantId ? await getProfile(otherParticipantId) : null

  const title = isGroup
    ? thread.title || 'Untitled group'
    : String(otherProfile?.displayName || otherProfile?.username || buildFallbackTitle(thread, currentUid)).trim()

  const attachmentCount = Number(thread.lastMessageAttachmentCount || 0)
  const fallbackSubtitle = (() => {
    if (thread.lastMessageText) return thread.lastMessageText
    if (thread.lastMessageType === 'deleted') return 'Message removed'
    if (attachmentCount > 0) return attachmentCount === 1 ? '1 attachment' : `${attachmentCount} attachments`
    if (thread.lastMessageType === 'image') return '1 image'
    if (thread.lastMessageType === 'video') return '1 video'
    if (thread.lastMessageType === 'audio') return '1 audio'
    if (thread.lastMessageType === 'file') return '1 file'
    if (thread.lastMessageType && thread.lastMessageType !== 'text') return '1 attachment'
    return 'No messages yet.'
  })()

  return {
    ...thread,
    otherParticipantId,
    otherProfile,
    title,
    imageURL: otherProfile?.avatarURL || otherProfile?.photoURL || thread.imageURL || '',
    subtitle: fallbackSubtitle,
    formattedTime: formatThreadTime(thread.lastMessageAt || thread.updatedAt || thread.createdAt),
    unreadCount: Number(thread.unreadCount || 0),
    isGroup
  }
}

export async function listInboxThreads(uid) {
  const threads = await listThreadsForUser(uid)
  const hydratedThreads = await Promise.all(threads.map((thread) => hydrateThreadFromSourceIfNeeded(thread)))
  return Promise.all(hydratedThreads.map((thread) => decorateThread(thread, uid)))
}

export function subscribeToInboxThreads(uid, callback, onError) {
  return subscribeToThreadsForUser(uid, async (threads) => {
    const hydratedThreads = await Promise.all(threads.map((thread) => hydrateThreadFromSourceIfNeeded(thread)))
    const decorated = await Promise.all(hydratedThreads.map((thread) => decorateThread(thread, uid)))
    callback(decorated)
  }, onError)
}

export {
  getThread,
  hydrateThreadFromSourceIfNeeded,
  listMessages,
  subscribeToMessages,
  createOrGetDm,
  createGroupThread,
  repairMyInboxThreads,
  restoreThreadForUser,
  addParticipantsToThread,
  removeParticipantFromThread,
  updateThreadDetails,
  setThreadPinnedForUser,
  deleteThreadForUser,
  blockUser,
  unblockUser,
  getBlockedUsers,
  subscribeToBlockedUsers,
  sendMessage,
  editMessage,
  addMessageReaction,
  removeMessageReaction,
  subscribeToMessageReactions,
  hideMessageForMe,
  subscribeToHiddenThreadMessages,
  deleteMessageForEveryone,
  markThreadRead,
  markThreadDelivered,
  subscribeToThreadParticipants,
  subscribeToThread,
  subscribeToTypingState,
  setTypingState
}
