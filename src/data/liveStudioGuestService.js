import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from 'firebase/firestore'
import { db } from '../firebase/firestore'
import { searchProfilesByUsername } from './profileSearchService'

function cleanId(value = '') {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120)
}

function guestInviteCollection(sessionId = '') {
  return collection(db, 'liveStudioSessions', cleanId(sessionId), 'guestInvites')
}

export async function searchLiveStudioGuests(input = '', currentUid = '') {
  const rows = await searchProfilesByUsername(input)
  const normalized = String(input || '').trim().toLowerCase()
  return rows
    .filter((profile) => profile.uid !== currentUid)
    .filter((profile) => !normalized || profile.usernameLower?.includes(normalized) || profile.displayName?.toLowerCase().includes(normalized))
}

export async function listLiveStudioGuestInvites(sessionId = '') {
  if (!db || !sessionId) return []
  const snapshot = await getDocs(query(guestInviteCollection(sessionId), orderBy('updatedAt', 'desc'))).catch(() => null)
  return snapshot?.docs?.map((docSnap) => ({ inviteId: docSnap.id, ...(docSnap.data() || {}) })) || []
}

export function subscribeLiveStudioGuestInvites(sessionId = '', onNext = () => {}) {
  if (!db || !sessionId) return () => {}
  return onSnapshot(query(guestInviteCollection(sessionId), orderBy('updatedAt', 'desc')), (snapshot) => {
    onNext(snapshot.docs.map((docSnap) => ({ inviteId: docSnap.id, ...(docSnap.data() || {}) })))
  }, () => onNext([]))
}

export async function saveLiveStudioGuestInvite(sessionId = '', invite = {}) {
  if (!db || !sessionId) return { ok: false }
  const guestUid = cleanId(invite.guestUid)
  if (!guestUid) throw new Error('Choose a user to invite.')
  const inviteId = cleanId(invite.inviteId) || guestUid
  await setDoc(doc(guestInviteCollection(sessionId), inviteId), {
    inviteId,
    sessionId: cleanId(sessionId),
    hostUid: cleanId(invite.hostUid),
    guestUid,
    guestDisplayName: String(invite.guestDisplayName || invite.displayName || 'Invited guest').slice(0, 120),
    guestUsername: String(invite.guestUsername || invite.username || '').slice(0, 80),
    guestPhotoURL: String(invite.guestPhotoURL || invite.photoURL || invite.avatarURL || '').slice(0, 1000),
    status: String(invite.status || 'invited').slice(0, 40),
    role: String(invite.role || 'guest').slice(0, 40),
    setup: invite.setup || {},
    createdAt: invite.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true })
  return { ok: true, inviteId }
}

export async function updateLiveStudioGuestInviteStatus(sessionId = '', inviteId = '', status = 'ready', setup = {}) {
  if (!db || !sessionId || !inviteId) return { ok: false }
  await setDoc(doc(guestInviteCollection(sessionId), cleanId(inviteId)), {
    status: String(status || 'ready').slice(0, 40),
    setup: setup || {},
    updatedAt: serverTimestamp()
  }, { merge: true })
  return { ok: true }
}

export async function removeLiveStudioGuestInvite(sessionId = '', inviteId = '') {
  if (!db || !sessionId || !inviteId) return { ok: false }
  await deleteDoc(doc(guestInviteCollection(sessionId), cleanId(inviteId)))
  return { ok: true }
}

export function subscribeMyLiveStudioGuestInvite(sessionId = '', uid = '', onNext = () => {}) {
  if (!db || !sessionId || !uid) return () => {}
  return onSnapshot(query(guestInviteCollection(sessionId), where('guestUid', '==', uid), limit(1)), (snapshot) => {
    onNext(snapshot.docs[0] ? { inviteId: snapshot.docs[0].id, ...(snapshot.docs[0].data() || {}) } : null)
  }, () => onNext(null))
}
