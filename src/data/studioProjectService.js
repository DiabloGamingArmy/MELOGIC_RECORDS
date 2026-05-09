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

export function normalizeStudioProject(projectId, raw = {}) { return { id: String(projectId || '').trim(), title: sanitizeTitle(raw.title), ownerId: String(raw.ownerId || '').trim(), collaboratorIds: Array.isArray(raw.collaboratorIds) ? raw.collaboratorIds.filter(Boolean) : [], bpm: clampBpm(raw.bpm), key: sanitizeKey(raw.key), type: sanitizeType(raw.type), visibility: 'private', createdAt: raw.createdAt || null, updatedAt: raw.updatedAt || null, lastOpenedAt: raw.lastOpenedAt || null, version: 1, tracks: Array.isArray(raw.tracks) ? raw.tracks : [], timeline: raw.timeline && typeof raw.timeline === 'object' ? raw.timeline : { bars: 32, snap: 'bar' }, mixer: raw.mixer && typeof raw.mixer === 'object' ? raw.mixer : { masterVolume: 0 }, collaboration: raw.collaboration && typeof raw.collaboration === 'object' ? raw.collaboration : { activeUsers: [] } } }

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
