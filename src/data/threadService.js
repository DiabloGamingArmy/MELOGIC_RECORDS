import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'

function toIsoDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function makeDmKey(a, b) {
  return [a, b].filter(Boolean).sort().join('_')
}

function normalizeThread(threadId, raw = {}) {
  return {
    id: threadId,
    type: raw.type === 'group' ? 'group' : 'dm',
    createdBy: raw.createdBy || '',
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt),
    title: raw.title || '',
    imagePath: raw.imagePath || '',
    imageURL: raw.imageURL || '',
    participantIds: Array.isArray(raw.participantIds) ? raw.participantIds : [],
    participantCount: Number(raw.participantCount || 0),
    lastMessageText: raw.lastMessageText || '',
    lastMessageAt: toIsoDate(raw.lastMessageAt),
    lastMessageSenderId: raw.lastMessageSenderId || '',
    lastMessageType: raw.lastMessageType || 'text',
    status: raw.status || 'active',
    dmKey: raw.dmKey || ''
  }
}

async function writeInboxSummary(threadId, threadData, participantIds = [], extra = {}) {
  if (!db) return
  const writes = participantIds.map((uid) => setDoc(
    doc(db, 'users', uid, 'inboxThreads', threadId),
    {
      threadId,
      type: threadData.type,
      title: threadData.title || '',
      imageURL: threadData.imageURL || '',
      otherParticipantId: threadData.type === 'dm' ? participantIds.find((id) => id !== uid) || '' : '',
      lastMessageText: threadData.lastMessageText || '',
      lastMessageAt: threadData.lastMessageAt || null,
      lastMessageSenderId: threadData.lastMessageSenderId || '',
      unreadCount: Number(extra.unreadCount || 0),
      archived: false,
      muted: false,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  ))

  await Promise.all(writes)
}

function getThreadQuery(uid) {
  return query(collection(db, 'threads'), where('participantIds', 'array-contains', uid), orderBy('lastMessageAt', 'desc'), limit(100))
}

export async function listThreadsForUser(uid) {
  if (!db || !uid) return []

  let snapshot
  try {
    snapshot = await getDocs(getThreadQuery(uid))
  } catch {
    snapshot = await getDocs(query(collection(db, 'threads'), where('participantIds', 'array-contains', uid), limit(100)))
  }

  const threads = snapshot.docs.map((threadDoc) => normalizeThread(threadDoc.id, threadDoc.data()))
  return threads.sort((a, b) => {
    const aDate = a.lastMessageAt || a.updatedAt || a.createdAt || ''
    const bDate = b.lastMessageAt || b.updatedAt || b.createdAt || ''
    return aDate < bDate ? 1 : -1
  })
}

export function subscribeToThreadsForUser(uid, callback) {
  if (!db || !uid || typeof callback !== 'function') return () => {}

  let unsubscribe = () => {}

  try {
    unsubscribe = onSnapshot(getThreadQuery(uid), (snapshot) => {
      const threads = snapshot.docs.map((threadDoc) => normalizeThread(threadDoc.id, threadDoc.data()))
      callback(threads)
    })
  } catch {
    unsubscribe = onSnapshot(
      query(collection(db, 'threads'), where('participantIds', 'array-contains', uid), limit(100)),
      (snapshot) => {
        const threads = snapshot.docs.map((threadDoc) => normalizeThread(threadDoc.id, threadDoc.data()))
        callback(threads)
      }
    )
  }

  return unsubscribe
}

export async function getThread(threadId) {
  if (!db || !threadId) return null
  const threadDoc = await getDoc(doc(db, 'threads', threadId))
  if (!threadDoc.exists()) return null
  return normalizeThread(threadDoc.id, threadDoc.data())
}

async function upsertParticipants(threadId, participantIds = [], ownerId = '') {
  const writes = participantIds.map((uid) => {
    const role = uid === ownerId ? 'owner' : 'member'
    return setDoc(
      doc(db, 'threads', threadId, 'participants', uid),
      {
        uid,
        role,
        joinedAt: serverTimestamp(),
        lastDeliveredAt: null,
        lastReadAt: null,
        muted: false,
        archived: false
      },
      { merge: true }
    )
  })

  await Promise.all(writes)
}

async function createDmClientSide({ creatorId, participantId }) {
  if (!db || !creatorId || !participantId || creatorId === participantId) {
    throw new Error('createDmThread requires unique creatorId and participantId.')
  }

  const participantIds = [creatorId, participantId]
  const dmKey = makeDmKey(creatorId, participantId)

  const existingByKey = await getDocs(query(collection(db, 'threads'), where('dmKey', '==', dmKey), limit(1)))
  if (!existingByKey.empty) {
    return normalizeThread(existingByKey.docs[0].id, existingByKey.docs[0].data())
  }

  const threadDoc = await addDoc(collection(db, 'threads'), {
    type: 'dm',
    dmKey,
    createdBy: creatorId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    title: '',
    imagePath: '',
    imageURL: '',
    participantIds,
    participantCount: 2,
    lastMessageText: '',
    lastMessageAt: null,
    lastMessageSenderId: '',
    lastMessageType: 'text',
    status: 'active'
  })

  await upsertParticipants(threadDoc.id, participantIds, creatorId)
  await writeInboxSummary(threadDoc.id, { type: 'dm' }, participantIds)
  return getThread(threadDoc.id)
}

export async function createOrGetDm({ creatorId, targetUid }) {
  if (!creatorId || !targetUid) throw new Error('createOrGetDm requires creatorId and targetUid.')

  try {
    const callable = httpsCallable(functions, 'createOrGetDm')
    const result = await callable({ targetUid })
    if (result?.data?.threadId) return getThread(result.data.threadId)
  } catch {
    // fallback for local/dev until function is deployed
  }

  return createDmClientSide({ creatorId, participantId: targetUid })
}

async function createGroupClientSide({ creatorId, participantIds = [], title = '', imagePath = '', imageURL = '' }) {
  if (!db || !creatorId) {
    throw new Error('createGroupThread requires creatorId.')
  }

  const members = Array.from(new Set([creatorId, ...participantIds].filter(Boolean)))
  const threadDoc = await addDoc(collection(db, 'threads'), {
    type: 'group',
    createdBy: creatorId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    title: String(title || '').trim(),
    imagePath: imagePath || '',
    imageURL: imageURL || '',
    participantIds: members,
    participantCount: members.length,
    lastMessageText: '',
    lastMessageAt: null,
    lastMessageSenderId: '',
    lastMessageType: 'text',
    status: 'active'
  })

  await upsertParticipants(threadDoc.id, members, creatorId)
  await writeInboxSummary(threadDoc.id, { type: 'group', title: String(title || '').trim(), imageURL }, members)
  return getThread(threadDoc.id)
}

export async function createGroupThread({ creatorId, participantIds = [], title = '', imagePath = '', imageURL = '' }) {
  try {
    const callable = httpsCallable(functions, 'createGroupThread')
    const result = await callable({ participantIds, title, imagePath, imageURL })
    if (result?.data?.threadId) return getThread(result.data.threadId)
  } catch {
    // fallback for local/dev until function is deployed
  }

  return createGroupClientSide({ creatorId, participantIds, title, imagePath, imageURL })
}

export async function addParticipantsToThread({ threadId, actorUid, participantIds = [] }) {
  if (!db || !threadId || !actorUid || !participantIds.length) return false

  try {
    const callable = httpsCallable(functions, 'updateThreadParticipants')
    await callable({ threadId, mode: 'add', participantIds })
    return true
  } catch {
    // fallback only for local scaffolding
  }

  const threadRef = doc(db, 'threads', threadId)
  await runTransaction(db, async (transaction) => {
    const threadSnap = await transaction.get(threadRef)
    if (!threadSnap.exists()) throw new Error('Thread not found.')
    const thread = threadSnap.data()
    if (!Array.isArray(thread.participantIds) || !thread.participantIds.includes(actorUid)) {
      throw new Error('Only participants can add members.')
    }
    if (thread.createdBy && thread.createdBy !== actorUid) {
      throw new Error('Only owner can add members.')
    }
  })

  const uniqueNewParticipants = Array.from(new Set(participantIds.filter(Boolean)))
  if (!uniqueNewParticipants.length) return false

  await updateDoc(threadRef, {
    participantIds: arrayUnion(...uniqueNewParticipants),
    updatedAt: serverTimestamp()
  })

  const thread = await getThread(threadId)
  const allIds = thread?.participantIds || []
  await upsertParticipants(threadId, uniqueNewParticipants, actorUid)
  await updateDoc(threadRef, { participantCount: allIds.length })
  await writeInboxSummary(threadId, thread || {}, allIds)
  return true
}

export async function removeParticipantFromThread({ threadId, actorUid, participantId }) {
  if (!db || !threadId || !actorUid || !participantId) return false

  try {
    const callable = httpsCallable(functions, 'updateThreadParticipants')
    await callable({ threadId, mode: 'remove', participantIds: [participantId] })
    return true
  } catch {
    // fallback only for local scaffolding
  }

  const threadRef = doc(db, 'threads', threadId)
  await runTransaction(db, async (transaction) => {
    const participantRef = doc(db, 'threads', threadId, 'participants', actorUid)
    const participantSnap = await transaction.get(participantRef)
    if (!participantSnap.exists()) throw new Error('Not a participant.')
    const role = participantSnap.data()?.role || 'member'
    if (role !== 'owner' && actorUid !== participantId) {
      throw new Error('Only owner can remove others.')
    }

    transaction.update(threadRef, {
      participantIds: arrayRemove(participantId),
      updatedAt: serverTimestamp()
    })
  })

  const batch = writeBatch(db)
  batch.set(doc(db, 'threads', threadId, 'participants', participantId), { archived: true }, { merge: true })
  batch.delete(doc(db, 'users', participantId, 'inboxThreads', threadId))
  await batch.commit()

  const thread = await getThread(threadId)
  await updateDoc(threadRef, { participantCount: (thread?.participantIds || []).length })
  return true
}

export async function updateThreadDetails({ threadId, actorUid, title = '', imageURL = '', imagePath = '' }) {
  if (!db || !threadId || !actorUid) return false
  const thread = await getThread(threadId)
  if (!thread) throw new Error('Thread not found.')
  if (thread.type !== 'group') throw new Error('Only group chats can be renamed.')
  if (thread.createdBy && thread.createdBy !== actorUid) throw new Error('Only the group owner can edit chat details.')

  await updateDoc(doc(db, 'threads', threadId), {
    title: String(title || '').trim(),
    imageURL: String(imageURL || '').trim(),
    imagePath: String(imagePath || '').trim(),
    updatedAt: serverTimestamp()
  })

  return true
}
