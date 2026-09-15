import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase/firestore'

const STUDIO_TYPES = ['song', 'beat', 'vocal', 'podcast', 'blank']
export const timestampToMillis = (value) => (value?.toMillis?.() || 0)
export function sortProjectsByActivity(a, b) {
  const aRank = timestampToMillis(a.lastOpenedAt) || timestampToMillis(a.updatedAt) || timestampToMillis(a.createdAt)
  const bRank = timestampToMillis(b.lastOpenedAt) || timestampToMillis(b.updatedAt) || timestampToMillis(b.createdAt)
  return bRank - aRank
}
const clampBpm = (value) => Math.max(40, Math.min(240, Number.isFinite(Number(value)) ? Math.round(Number(value)) : 140))
const sanitizeTitle = (value) => String(value || '').trim().slice(0, 120) || 'Untitled Project'
const sanitizeKey = (value) => String(value || '').trim().slice(0, 40) || 'C minor'
const sanitizeType = (value) => (STUDIO_TYPES.includes(value) ? value : 'song')
const isDev = () => typeof import.meta !== 'undefined' && Boolean(import.meta?.env?.DEV)
const RUNTIME_OBJECT_NAMES = new Set(['Blob', 'File', 'MediaRecorder', 'MediaStream', 'AudioBuffer', 'AudioNode', 'AudioContext', 'HTMLAudioElement', 'HTMLElement'])
const FIRESTORE_OBJECT_NAMES = new Set(['Timestamp', 'GeoPoint', 'Bytes', 'FieldValue', 'DeleteFieldValue', 'ServerTimestampFieldValue'])

function isRuntimeOnlyObject(value) {
  if (!value || typeof value !== 'object') return false
  const ctorName = value.constructor?.name || ''
  if (RUNTIME_OBJECT_NAMES.has(ctorName)) return true
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true
  if (typeof File !== 'undefined' && value instanceof File) return true
  if (typeof MediaStream !== 'undefined' && value instanceof MediaStream) return true
  if (typeof Element !== 'undefined' && value instanceof Element) return true
  return false
}

function isFirestoreSpecialValue(value) {
  if (!value || typeof value !== 'object') return false
  const ctorName = value.constructor?.name || ''
  return value instanceof Date || FIRESTORE_OBJECT_NAMES.has(ctorName) || typeof value.toMillis === 'function'
}

export function findUndefinedPaths(value, basePath = 'payload') {
  const paths = []
  const visit = (current, path) => {
    if (current === undefined) {
      paths.push(path)
      return
    }
    if (!current || typeof current !== 'object' || isFirestoreSpecialValue(current) || isRuntimeOnlyObject(current)) return
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}.${index}`))
      return
    }
    Object.entries(current).forEach(([key, item]) => visit(item, `${path}.${key}`))
  }
  visit(value, basePath)
  return paths
}

export function sanitizeForFirestore(value, { inArray = false } = {}) {
  if (value === undefined || typeof value === 'function' || isRuntimeOnlyObject(value)) return inArray ? null : undefined
  if (value === null || typeof value !== 'object' || isFirestoreSpecialValue(value)) return value
  if (Array.isArray(value)) return value.map((item) => sanitizeForFirestore(item, { inArray: true }))
  const output = {}
  Object.entries(value).forEach(([key, item]) => {
    const sanitized = sanitizeForFirestore(item)
    if (sanitized !== undefined) output[key] = sanitized
  })
  return output
}

export function normalizeStudioProject(projectId, raw = {}) { return { id: String(projectId || '').trim(), title: sanitizeTitle(raw.title), ownerId: String(raw.ownerId || '').trim(), collaboratorIds: Array.isArray(raw.collaboratorIds) ? raw.collaboratorIds.filter(Boolean) : [], bpm: clampBpm(raw.bpm), key: sanitizeKey(raw.key), timeSignature: String(raw.timeSignature || '4/4').trim().slice(0, 20) || '4/4', type: sanitizeType(raw.type), visibility: 'private', createdAt: raw.createdAt || null, updatedAt: raw.updatedAt || null, lastOpenedAt: raw.lastOpenedAt || null, version: 1, tracks: Array.isArray(raw.tracks) ? raw.tracks : [], timeline: raw.timeline && typeof raw.timeline === 'object' ? raw.timeline : { bars: 32, snap: 'bar' }, mixer: raw.mixer && typeof raw.mixer === 'object' ? raw.mixer : { masterVolume: 0 }, collaboration: raw.collaboration && typeof raw.collaboration === 'object' ? raw.collaboration : { activeUsers: [] }, settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : {}, editorState: raw.editorState && typeof raw.editorState === 'object' ? raw.editorState : null } }

export async function listMyStudioProjects(uid) {
  const id = String(uid || '').trim(); if (!id) { console.warn('[studioProjectService] owned query skipped, missing uid'); return [] }
  try { const snapshot = await getDocs(query(collection(db, 'studioProjects'), where('ownerId', '==', id))); return snapshot.docs.map((d) => normalizeStudioProject(d.id, d.data())).sort(sortProjectsByActivity) }
  catch (error) { console.error('[studioProjectService] owned query failed', error?.code || '', error?.message || error); throw error }
}
export async function listSharedStudioProjects(uid) {
  const id = String(uid || '').trim(); if (!id) { console.warn('[studioProjectService] shared query skipped, missing uid'); return [] }
  try { const snapshot = await getDocs(query(collection(db, 'studioProjects'), where('collaboratorIds', 'array-contains', id))); return snapshot.docs.map((d) => normalizeStudioProject(d.id, d.data())).sort(sortProjectsByActivity) }
  catch (error) { console.error('[studioProjectService] shared query failed', error?.code || '', error?.message || error); throw error }
}
export async function listIndexedStudioProjects(uid) {
  const id = String(uid || '').trim(); if (!id) return []
  try { const snap = await getDocs(collection(db, 'users', id, 'studioProjectIndex')); return snap.docs.map((d) => normalizeStudioProject(d.id, d.data())).sort(sortProjectsByActivity) }
  catch (error) { console.error('[studioProjectService] index query failed', error?.code || '', error?.message || error); throw error }
}
export async function listAccessibleStudioProjects(uid) {
  const normalizedUid = String(uid || '').trim(); if (!normalizedUid) return []
  const [ownedResult, sharedResult] = await Promise.allSettled([listMyStudioProjects(normalizedUid), listSharedStudioProjects(normalizedUid)])
  const errors=[]; if(ownedResult.status==='rejected') errors.push({scope:'owned',error:ownedResult.reason}); if(sharedResult.status==='rejected') errors.push({scope:'shared',error:sharedResult.reason})
  if (errors.length===2) throw errors[0].error
  const map = new Map(); [...(ownedResult.status==='fulfilled'?ownedResult.value:[]), ...(sharedResult.status==='fulfilled'?sharedResult.value:[])].forEach((p)=>p?.id&&map.set(p.id,p))
  return [...map.values()].sort(sortProjectsByActivity)
}
export async function getStudioProject(projectId) { const id = String(projectId || '').trim(); if (!id) return null; const s=await getDoc(doc(db,'studioProjects',id)); return s.exists()?normalizeStudioProject(s.id,s.data()):null }
export async function createStudioProject(user, input = {}) {
  if (!user?.uid) throw new Error('A signed-in user is required.')
  const payload = { title: sanitizeTitle(input.title), ownerId: user.uid, collaboratorIds: [], bpm: 140, key: 'C minor', type: 'song', visibility: 'private', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastOpenedAt: serverTimestamp(), version: 1 }
  const ref = await addDoc(collection(db, 'studioProjects'), payload)
  setDoc(doc(db, 'users', user.uid, 'studioProjectIndex', ref.id), { projectId: ref.id, title: payload.title, ownerId: user.uid, role: 'owner', bpm: 140, key: 'C minor', type: 'song', updatedAt: serverTimestamp(), lastOpenedAt: serverTimestamp(), createdAt: serverTimestamp() }).catch((e)=>console.error('[studioProjectService] index write failed',e))
  return { id: ref.id, ...normalizeStudioProject(ref.id, payload) }
}
export async function touchStudioProject(projectId) { const id = String(projectId || '').trim(); if (!id) return; await updateDoc(doc(db, 'studioProjects', id), { updatedAt: serverTimestamp(), lastOpenedAt: serverTimestamp() }) }

export async function saveStudioProjectEditorState(projectId, editorState) {
  const id = String(projectId || '').trim()
  if (!id || !editorState || typeof editorState !== 'object') return
  const undefinedPaths = findUndefinedPaths(editorState, 'editorState')
  if (undefinedPaths.length && isDev()) console.warn('[studioProject] Firestore payload had undefined fields', undefinedPaths)
  const safeEditorState = sanitizeForFirestore(editorState)
  const metadata = editorState.projectMetadata && typeof editorState.projectMetadata === 'object' ? editorState.projectMetadata : null
  const payload = { editorState: safeEditorState, updatedAt: serverTimestamp(), lastOpenedAt: serverTimestamp() }
  if (metadata?.title) payload.title = sanitizeTitle(metadata.title)
  if (metadata?.bpm) payload.bpm = clampBpm(metadata.bpm)
  if (metadata?.key) payload.key = sanitizeKey(metadata.key)
  if (metadata?.timeSignature) payload.timeSignature = String(metadata.timeSignature || '').trim().slice(0, 20)
  await updateDoc(doc(db, 'studioProjects', id), payload)
}
