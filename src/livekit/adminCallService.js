import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where
} from 'firebase/firestore'
import { db } from '../firebase/firestore'

const SUPPORT_CALLS_COLLECTION = 'supportCalls'

function timestampToIso(value) {
  if (!value) return ''
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return ''
}

export function normalizeSupportCall(id, data = {}) {
  return {
    id,
    direction: data.direction || 'inbound',
    status: data.status || 'active',
    roomName: data.roomName || '',
    callerNumberMasked: data.callerNumberMasked || data.callerNumber || 'Unknown caller',
    callerNumber: data.callerNumber || '',
    livekitParticipantIdentity: data.livekitParticipantIdentity || '',
    handledBy: data.handledBy || 'none',
    aiEnabled: data.aiEnabled === true,
    humanJoined: data.humanJoined === true,
    assignedAdminUid: data.assignedAdminUid || '',
    takeoverRequested: data.takeoverRequested === true,
    createdAt: timestampToIso(data.createdAt),
    startedAt: timestampToIso(data.startedAt || data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    endedAt: timestampToIso(data.endedAt),
    notes: data.notes || ''
  }
}

export function watchActiveSupportCalls(callback, onError) {
  const callsQuery = query(
    collection(db, SUPPORT_CALLS_COLLECTION),
    where('status', 'in', ['ringing', 'active']),
    orderBy('updatedAt', 'desc')
  )

  return onSnapshot(
    callsQuery,
    (snapshot) => {
      const calls = snapshot.docs.map((callDoc) => normalizeSupportCall(callDoc.id, callDoc.data()))
      callback(calls)
    },
    (error) => {
      console.warn('[admin calls] active call watch failed', error)
      if (typeof onError === 'function') onError(error)
    }
  )
}

export async function createManualSupportCall({
  roomName = 'melogic-phone-test',
  callerNumber = '',
  notes = ''
} = {}) {
  const cleanRoomName = String(roomName || 'melogic-phone-test').trim() || 'melogic-phone-test'
  const cleanCallerNumber = String(callerNumber || '').trim()

  const docRef = await addDoc(collection(db, SUPPORT_CALLS_COLLECTION), {
    direction: 'manual',
    status: 'active',
    roomName: cleanRoomName,
    callerNumber: cleanCallerNumber,
    callerNumberMasked: cleanCallerNumber || 'Manual test caller',
    livekitParticipantIdentity: '',
    handledBy: 'human',
    aiEnabled: false,
    humanJoined: false,
    assignedAdminUid: '',
    takeoverRequested: false,
    notes: String(notes || '').trim(),
    createdAt: serverTimestamp(),
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })

  return docRef.id
}

export async function markSupportCallHumanJoined(callId, adminUid = '') {
  if (!callId) return
  await updateDoc(doc(db, SUPPORT_CALLS_COLLECTION, callId), {
    handledBy: 'human',
    humanJoined: true,
    assignedAdminUid: adminUid || '',
    updatedAt: serverTimestamp()
  })
}

export async function requestSupportCallTakeover(callId, adminUid = '') {
  if (!callId) return
  await updateDoc(doc(db, SUPPORT_CALLS_COLLECTION, callId), {
    handledBy: 'human',
    aiEnabled: false,
    takeoverRequested: true,
    takeoverRequestedBy: adminUid || '',
    takeoverRequestedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })
}

export async function endSupportCall(callId) {
  if (!callId) return
  await updateDoc(doc(db, SUPPORT_CALLS_COLLECTION, callId), {
    status: 'ended',
    endedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })
}