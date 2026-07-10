import { collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/firestore'
import { DEFAULT_PROGRAM_SCENES, DEFAULT_PROGRAM_SOURCES } from './streaming/programMixer'

function cleanId(value = '') {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120)
}

function scenesCollection(uid = '') {
  return collection(db, 'users', uid, 'liveStudio', 'scenes', 'items')
}

function sourcesCollection(uid = '') {
  return collection(db, 'users', uid, 'liveStudio', 'sources', 'items')
}

export async function listProgramScenes(uid = '') {
  if (!db || !uid) return DEFAULT_PROGRAM_SCENES.map((scene) => ({ ...scene }))
  const snapshot = await getDocs(query(scenesCollection(uid), orderBy('updatedAt', 'desc'))).catch(() => null)
  const rows = snapshot?.docs?.map((docSnap) => ({ sceneId: docSnap.id, ...(docSnap.data() || {}) })) || []
  return rows.length ? rows : DEFAULT_PROGRAM_SCENES.map((scene) => ({ ...scene }))
}

export async function saveProgramScene(uid = '', scene = {}) {
  if (!db || !uid) return { ok: false }
  const sceneId = cleanId(scene.sceneId) || `scene_${Date.now().toString(36)}`
  await setDoc(doc(scenesCollection(uid), sceneId), {
    sceneId,
    name: String(scene.name || 'Untitled Scene').slice(0, 80),
    sources: Array.isArray(scene.sources) ? scene.sources.slice(0, 40) : [],
    canvasLayout: scene.canvasLayout || {},
    audioRoutingState: scene.audioRoutingState || {},
    transitionPreference: scene.transitionPreference || scene.transition || 'fade',
    createdAt: scene.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true })
  return { ok: true, sceneId }
}

export async function deleteProgramScene(uid = '', sceneId = '') {
  const cleanSceneId = cleanId(sceneId)
  if (!db || !uid || !cleanSceneId) return { ok: false }
  await deleteDoc(doc(scenesCollection(uid), cleanSceneId))
  return { ok: true, sceneId: cleanSceneId }
}

export async function listProgramSources(uid = '') {
  if (!db || !uid) return DEFAULT_PROGRAM_SOURCES.map((source) => ({ ...source }))
  const snapshot = await getDocs(query(sourcesCollection(uid), orderBy('updatedAt', 'desc'))).catch(() => null)
  const rows = snapshot?.docs?.map((docSnap) => ({ sourceId: docSnap.id, ...(docSnap.data() || {}) })) || []
  return rows.length ? rows : DEFAULT_PROGRAM_SOURCES.map((source) => ({ ...source }))
}

export async function saveProgramSource(uid = '', source = {}) {
  if (!db || !uid) return { ok: false }
  const sourceId = cleanId(source.sourceId) || `source_${Date.now().toString(36)}`
  await setDoc(doc(sourcesCollection(uid), sourceId), {
    sourceId,
    type: String(source.type || 'custom').slice(0, 80),
    label: String(source.label || 'Untitled Source').slice(0, 80),
    enabled: source.enabled !== false,
    muted: source.muted === true,
    visible: source.visible !== false,
    locked: source.locked === true,
    programEnabled: source.programEnabled !== false,
    monitorEnabled: source.monitorEnabled === true,
    zIndex: Number(source.zIndex || 0),
    opacity: Number(source.opacity ?? 1),
    objectFit: String(source.objectFit || 'cover'),
    transform: source.transform || {},
    audio: source.audio || {},
    video: source.video || {},
    updatedAt: serverTimestamp(),
    createdAt: source.createdAt || serverTimestamp()
  }, { merge: true })
  return { ok: true, sourceId }
}
