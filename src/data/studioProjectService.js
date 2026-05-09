import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase/firestore'

const STUDIO_TYPES = ['song', 'beat', 'vocal', 'podcast', 'blank']
const toMillis = (value) => (value?.toMillis?.() || 0)
export function sortProjectsByActivity(a, b) {
  const aRank = toMillis(a.lastOpenedAt) || toMillis(a.updatedAt) || toMillis(a.createdAt)
  const bRank = toMillis(b.lastOpenedAt) || toMillis(b.updatedAt) || toMillis(b.createdAt)
  return bRank - aRank
}

const clampBpm = (value) => Math.max(40, Math.min(240, Number.isFinite(Number(value)) ? Math.round(Number(value)) : 140))
const sanitizeTitle = (value) => String(value || '').trim().slice(0, 120) || 'Untitled Project'
const sanitizeKey = (value) => String(value || '').trim().slice(0, 40) || 'C minor'
const sanitizeType = (value) => (STUDIO_TYPES.includes(value) ? value : 'song')

export function normalizeStudioProject(projectId, raw = {}) {
  return {
    id: String(projectId || '').trim(),
    title: sanitizeTitle(raw.title),
    ownerId: String(raw.ownerId || '').trim(),
    collaboratorIds: Array.isArray(raw.collaboratorIds) ? raw.collaboratorIds.filter(Boolean) : [],
    bpm: clampBpm(raw.bpm),
    key: sanitizeKey(raw.key),
    type: sanitizeType(raw.type),
    visibility: 'private',
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
    lastOpenedAt: raw.lastOpenedAt || null,
    version: 1,
    tracks: Array.isArray(raw.tracks) ? raw.tracks : [],
    timeline: raw.timeline && typeof raw.timeline === 'object' ? raw.timeline : { bars: 32, snap: 'bar' },
    mixer: raw.mixer && typeof raw.mixer === 'object' ? raw.mixer : { masterVolume: 0 },
    collaboration: raw.collaboration && typeof raw.collaboration === 'object' ? raw.collaboration : { activeUsers: [] }
  }
}

export async function listMyStudioProjects(uid) {
  const snapshot = await getDocs(query(collection(db, 'studioProjects'), where('ownerId', '==', uid)))
  return snapshot.docs.map((item) => normalizeStudioProject(item.id, item.data())).sort(sortProjectsByActivity)
}
export async function listSharedStudioProjects(uid) {
  const snapshot = await getDocs(query(collection(db, 'studioProjects'), where('collaboratorIds', 'array-contains', uid)))
  return snapshot.docs.map((item) => normalizeStudioProject(item.id, item.data())).sort(sortProjectsByActivity)
}
export async function listAccessibleStudioProjects(uid) {
  const [owned, shared] = await Promise.all([listMyStudioProjects(uid), listSharedStudioProjects(uid)])
  const map = new Map(); [...owned, ...shared].forEach((p) => p?.id && map.set(p.id, p))
  return [...map.values()].sort(sortProjectsByActivity)
}
export async function getStudioProject(projectId) {
  const id = String(projectId || '').trim(); if (!id) return null
  const snapshot = await getDoc(doc(db, 'studioProjects', id)); if (!snapshot.exists()) return null
  return normalizeStudioProject(snapshot.id, snapshot.data())
}
export async function createStudioProject(user, input = {}) {
  if (!user?.uid) throw new Error('A signed-in user is required.')
  const payload = { title: sanitizeTitle(input.title), ownerId: user.uid, collaboratorIds: [], bpm: 140, key: 'C minor', type: 'song', visibility: 'private', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastOpenedAt: serverTimestamp(), version: 1 }
  const ref = await addDoc(collection(db, 'studioProjects'), payload)
  return { id: ref.id, ...normalizeStudioProject(ref.id, payload) }
}
export async function touchStudioProject(projectId) {
  const id = String(projectId || '').trim(); if (!id) return
  await updateDoc(doc(db, 'studioProjects', id), { updatedAt: serverTimestamp(), lastOpenedAt: serverTimestamp() })
}
