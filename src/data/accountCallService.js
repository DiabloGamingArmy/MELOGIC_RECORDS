import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore'
import { auth } from '../firebase/auth'
import { db } from '../firebase/firestore'

const CALLS_COLLECTION = 'accountCalls'
const ACTIVE_CALL_STATUSES = new Set(['ringing', 'accepted', 'connecting', 'active'])
const FINAL_CALL_STATUSES = new Set(['ended', 'declined', 'missed', 'failed', 'cancelled'])

function toIso(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeCall(id, raw = {}) {
  return {
    ...raw,
    id: String(raw.id || id || ''),
    participantUids: Array.isArray(raw.participantUids) ? raw.participantUids.filter(Boolean) : [],
    startedAt: toIso(raw.startedAt),
    acceptedAt: toIso(raw.acceptedAt),
    connectedAt: toIso(raw.connectedAt),
    endedAt: toIso(raw.endedAt),
    updatedAt: toIso(raw.updatedAt)
  }
}

function normalizeProfile(uid, profile = {}) {
  const photoURL = String(profile.avatarURL || profile.photoURL || '').trim()
  return {
    uid,
    displayName: String(profile.displayName || profile.username || 'Melogic member').trim(),
    photoURL
  }
}

async function loadProfile(uid) {
  if (!uid) return normalizeProfile('', {})
  const snapshot = await getDoc(doc(db, 'profiles', uid))
  return normalizeProfile(uid, snapshot.exists() ? snapshot.data() : {})
}

function requireCurrentUser() {
  const user = auth.currentUser
  if (!user?.uid) throw new Error('Sign in is required to use account calling.')
  return user
}

function callRef(callId) {
  const id = String(callId || '').trim()
  if (!id) throw new Error('Call ID is required.')
  return doc(db, CALLS_COLLECTION, id)
}

export async function createAccountAudioCall({
  calleeUid,
  threadId = '',
  callerProfile = null,
  calleeProfile = null
} = {}) {
  const caller = requireCurrentUser()
  const targetUid = String(calleeUid || '').trim()
  if (!targetUid || targetUid === caller.uid) throw new Error('A valid call recipient is required.')

  const [resolvedCaller, resolvedCallee] = await Promise.all([
    callerProfile ? normalizeProfile(caller.uid, callerProfile) : loadProfile(caller.uid),
    calleeProfile ? normalizeProfile(targetUid, calleeProfile) : loadProfile(targetUid)
  ])
  const reference = doc(collection(db, CALLS_COLLECTION))
  const payload = {
    id: reference.id,
    type: 'audio',
    mode: 'account-webrtc',
    callerUid: caller.uid,
    callerDisplayName: resolvedCaller.displayName || caller.displayName || 'Melogic member',
    callerPhotoURL: resolvedCaller.photoURL || caller.photoURL || '',
    calleeUid: targetUid,
    calleeDisplayName: resolvedCallee.displayName,
    calleePhotoURL: resolvedCallee.photoURL,
    participantUids: [caller.uid, targetUid],
    status: 'ringing',
    startedAt: serverTimestamp(),
    acceptedAt: null,
    connectedAt: null,
    endedAt: null,
    updatedAt: serverTimestamp(),
    endedBy: null,
    endReason: null,
    threadId: String(threadId || '').trim() || null,
    offer: null,
    answer: null,
    createdBy: caller.uid
  }
  await setDoc(reference, payload)
  return { ...normalizeCall(reference.id, payload), startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
}

export function watchAccountCall(callId, callback, onError) {
  return onSnapshot(callRef(callId), (snapshot) => {
    callback(snapshot.exists() ? normalizeCall(snapshot.id, snapshot.data({ serverTimestamps: 'estimate' })) : null)
  }, onError)
}

export async function getAccountCall(callId) {
  const snapshot = await getDoc(callRef(callId))
  return snapshot.exists() ? normalizeCall(snapshot.id, snapshot.data()) : null
}

export function watchIncomingAccountCalls(uid, callback, onError) {
  const targetUid = String(uid || '').trim()
  if (!targetUid) return () => {}
  return onSnapshot(
    query(
      collection(db, CALLS_COLLECTION),
      where('calleeUid', '==', targetUid),
      where('status', '==', 'ringing'),
      limit(10)
    ),
    (snapshot) => callback(snapshot.docs.map((row) => normalizeCall(row.id, row.data({ serverTimestamps: 'estimate' })))),
    onError
  )
}

export function watchRecentAccountCalls(uid, callback, onError) {
  const participantUid = String(uid || '').trim()
  if (!participantUid) return () => {}
  return onSnapshot(
    query(
      collection(db, CALLS_COLLECTION),
      where('participantUids', 'array-contains', participantUid),
      limit(20)
    ),
    (snapshot) => {
      const rows = snapshot.docs
        .map((row) => normalizeCall(row.id, row.data({ serverTimestamps: 'estimate' })))
        .sort((a, b) => new Date(b.startedAt || b.updatedAt || 0).getTime() - new Date(a.startedAt || a.updatedAt || 0).getTime())
      callback(rows)
    },
    onError
  )
}

export async function updateAccountCallStatus(callId, status, patch = {}) {
  const nextStatus = String(status || '').trim()
  if (![...ACTIVE_CALL_STATUSES, ...FINAL_CALL_STATUSES].includes(nextStatus)) {
    throw new Error('Unsupported call status.')
  }
  await updateDoc(callRef(callId), {
    ...patch,
    status: nextStatus,
    updatedAt: serverTimestamp()
  })
  return { ok: true, callId, status: nextStatus }
}

export function acceptAccountCall(callId) {
  return updateAccountCallStatus(callId, 'accepted', { acceptedAt: serverTimestamp() })
}

export function declineAccountCall(callId) {
  const uid = requireCurrentUser().uid
  return updateAccountCallStatus(callId, 'declined', {
    endedAt: serverTimestamp(),
    endedBy: uid,
    endReason: 'declined'
  })
}

export function cancelAccountCall(callId) {
  const uid = requireCurrentUser().uid
  return updateAccountCallStatus(callId, 'cancelled', {
    endedAt: serverTimestamp(),
    endedBy: uid,
    endReason: 'cancelled'
  })
}

export function endAccountCall(callId, reason = 'hangup') {
  const uid = requireCurrentUser().uid
  return updateAccountCallStatus(callId, 'ended', {
    endedAt: serverTimestamp(),
    endedBy: uid,
    endReason: String(reason || 'hangup').slice(0, 80)
  })
}

export function failAccountCall(callId, reason = 'connection-failed') {
  const uid = auth.currentUser?.uid || null
  return updateAccountCallStatus(callId, 'failed', {
    endedAt: serverTimestamp(),
    endedBy: uid,
    endReason: String(reason || 'connection-failed').slice(0, 80)
  })
}

export function markAccountCallMissed(callId) {
  const uid = auth.currentUser?.uid || null
  return updateAccountCallStatus(callId, 'missed', {
    endedAt: serverTimestamp(),
    endedBy: uid,
    endReason: 'no-answer'
  })
}

export async function saveCallOffer(callId, offer) {
  requireCurrentUser()
  await updateDoc(callRef(callId), {
    offer: { type: 'offer', sdp: String(offer?.sdp || '') },
    updatedAt: serverTimestamp()
  })
}

export async function saveCallAnswer(callId, answer) {
  requireCurrentUser()
  await updateDoc(callRef(callId), {
    answer: { type: 'answer', sdp: String(answer?.sdp || '') },
    updatedAt: serverTimestamp()
  })
}

function serializeCandidate(candidate) {
  const row = typeof candidate?.toJSON === 'function' ? candidate.toJSON() : candidate || {}
  return {
    candidate: String(row.candidate || ''),
    sdpMid: row.sdpMid == null ? null : String(row.sdpMid),
    sdpMLineIndex: row.sdpMLineIndex == null ? null : Number(row.sdpMLineIndex),
    usernameFragment: row.usernameFragment == null ? null : String(row.usernameFragment),
    createdAt: serverTimestamp(),
    createdBy: requireCurrentUser().uid
  }
}

function addIceCandidate(callId, side, candidate) {
  return addDoc(collection(db, CALLS_COLLECTION, callId, `${side}Candidates`), serializeCandidate(candidate))
}

export function addCallerIceCandidate(callId, candidate) {
  return addIceCandidate(callId, 'caller', candidate)
}

export function addCalleeIceCandidate(callId, candidate) {
  return addIceCandidate(callId, 'callee', candidate)
}

function watchIceCandidates(callId, side, callback, onError) {
  return onSnapshot(collection(db, CALLS_COLLECTION, callId, `${side}Candidates`), (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') callback({ id: change.doc.id, ...change.doc.data() })
    })
  }, onError)
}

export function watchCallerIceCandidates(callId, callback, onError) {
  return watchIceCandidates(callId, 'caller', callback, onError)
}

export function watchCalleeIceCandidates(callId, callback, onError) {
  return watchIceCandidates(callId, 'callee', callback, onError)
}

export { ACTIVE_CALL_STATUSES, FINAL_CALL_STATUSES }
