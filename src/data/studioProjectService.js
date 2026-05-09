import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where
} from 'firebase/firestore'
import { db } from '../firebase/firestore'

const STUDIO_TYPES = ['song', 'beat', 'vocal', 'podcast', 'blank']

function clampBpm(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 140
  return Math.max(40, Math.min(240, Math.round(n)))
}

function sanitizeTitle(value) {
  const trimmed = String(value || '').trim().slice(0, 120)
  return trimmed || 'Untitled Project'
}

function sanitizeKey(value) {
  const trimmed = String(value || '').trim().slice(0, 40)
  return trimmed || 'C minor'
}

function sanitizeType(value) {
  return STUDIO_TYPES.includes(value) ? value : 'song'
}

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
    version: 1
  }
}

export async function listMyStudioProjects(uid) {
  const snapshot = await getDocs(query(collection(db, 'studioProjects'), where('ownerId', '==', uid)))
  return snapshot.docs
    .map((item) => normalizeStudioProject(item.id, item.data()))
    .sort((a, b) => (b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0))
}

export async function listSharedStudioProjects(uid) {
  const snapshot = await getDocs(query(collection(db, 'studioProjects'), where('collaboratorIds', 'array-contains', uid)))
  return snapshot.docs
    .map((item) => normalizeStudioProject(item.id, item.data()))
    .sort((a, b) => (b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0))
}

export async function getStudioProject(projectId) {
  const id = String(projectId || '').trim()
  if (!id) return null
  const projectRef = doc(db, 'studioProjects', id)
  const snapshot = await getDoc(projectRef)
  if (!snapshot.exists()) return null
  return normalizeStudioProject(snapshot.id, snapshot.data())
}

export async function createStudioProject(user, input = {}) {
  if (!user?.uid) throw new Error('A signed-in user is required.')
  const payload = {
    title: sanitizeTitle(input.title),
    ownerId: user.uid,
    collaboratorIds: [],
    bpm: clampBpm(input.bpm),
    key: sanitizeKey(input.key),
    type: sanitizeType(input.type),
    visibility: 'private',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastOpenedAt: serverTimestamp(),
    version: 1
  }
  const ref = await addDoc(collection(db, 'studioProjects'), payload)
  return { id: ref.id, ...normalizeStudioProject(ref.id, payload) }
}

export async function touchStudioProject(projectId) {
  const id = String(projectId || '').trim()
  if (!id) return
  await updateDoc(doc(db, 'studioProjects', id), {
    updatedAt: serverTimestamp(),
    lastOpenedAt: serverTimestamp()
  })
}
