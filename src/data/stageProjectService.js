import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase/firestore'
import { FIRESTORE_COLLECTIONS } from '../config/firestoreCollections'
import { createDefaultStagePlan, normalizeStagePlan } from '../stage/stagePlanModel'

const STAGE_PROJECTS_COLLECTION = FIRESTORE_COLLECTIONS.stageProjects || 'stageProjects'

export const timestampToMillis = (value) => (value?.toMillis?.() || 0)

export function sortStageProjectsByActivity(a, b) {
  const aRank = timestampToMillis(a.lastOpenedAt) || timestampToMillis(a.updatedAt) || timestampToMillis(a.createdAt)
  const bRank = timestampToMillis(b.lastOpenedAt) || timestampToMillis(b.updatedAt) || timestampToMillis(b.createdAt)
  return bRank - aRank
}

export function normalizeStageProject(projectId, raw = {}) {
  const legacyStageDimensions = raw.stage && typeof raw.stage === 'object'
    ? { width: raw.stage.width, depth: raw.stage.depth, deckHeight: raw.stage.deckHeight ?? raw.stage.height, unit: raw.stage.unit }
    : {}
  const plan = normalizeStagePlan({
    ...(raw.plan && typeof raw.plan === 'object' ? raw.plan : {}),
    id: projectId,
    title: raw.title,
    name: raw.title || raw.name,
    stageType: raw.stageType,
    stageDimensions: raw.stageDimensions || legacyStageDimensions,
    objects: Array.isArray(raw.objects) && !(raw.plan?.objects) ? raw.objects : raw.plan?.objects,
    fixtures: raw.fixtures || raw.plan?.fixtures,
    audioInputs: raw.audioInputs || raw.plan?.audioInputs,
    rigging: raw.rigging || raw.plan?.rigging,
    video: raw.video || raw.plan?.video,
    power: raw.power || raw.plan?.power,
    layers: raw.layers || raw.plan?.layers,
    measurements: raw.measurements || raw.plan?.measurements,
    annotations: raw.annotations || raw.plan?.annotations,
    venue: raw.venue || raw.plan?.venue,
    notes: raw.notes ?? raw.plan?.notes,
    exportSettings: raw.exportSettings || raw.plan?.exportSettings,
    version: raw.version || raw.plan?.version || 1
  })
  return {
    id: String(projectId || '').trim(),
    title: String(raw.title || '').trim().slice(0, 120) || 'Untitled Stage Plan',
    ownerId: String(raw.ownerId || '').trim(),
    collaboratorIds: Array.isArray(raw.collaboratorIds) ? raw.collaboratorIds.filter(Boolean) : [],
    visibility: raw.visibility || 'private',
    type: raw.type || 'stage-plan',
    stageType: String(raw.stageType || '').trim() || 'Blank Stage',
    stage: raw.stage && typeof raw.stage === 'object' ? raw.stage : { width: 32, depth: 20, height: 4, unit: 'ft' },
    stageDimensions: plan.stageDimensions,
    coordinateSystem: plan.coordinateSystem,
    objects: plan.objects,
    fixtures: plan.fixtures,
    audioInputs: plan.audioInputs,
    rigging: plan.rigging,
    video: plan.video,
    power: plan.power,
    layers: plan.layers,
    measurements: plan.measurements,
    annotations: plan.annotations,
    venue: plan.venue,
    exportSettings: plan.exportSettings,
    plan,
    notes: String(raw.notes ?? plan.notes ?? ''),
    version: Number(raw.version || 1),
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
    lastOpenedAt: raw.lastOpenedAt || null,
    editorState: raw.editorState && typeof raw.editorState === 'object' ? raw.editorState : null
  }
}

export async function listMyStageProjects(uid) {
  const id = String(uid || '').trim(); if (!id) { console.warn('[stageProjectService] owned query skipped, missing uid'); return [] }
  try {
    const snapshot = await getDocs(query(collection(db, STAGE_PROJECTS_COLLECTION), where('ownerId', '==', id)))
    return snapshot.docs.map((d) => normalizeStageProject(d.id, d.data())).sort(sortStageProjectsByActivity)
  } catch (error) { console.error('[stageProjectService] owned query failed', error?.code || '', error?.message || error); throw error }
}

export async function listSharedStageProjects(uid) {
  const id = String(uid || '').trim(); if (!id) { console.warn('[stageProjectService] shared query skipped, missing uid'); return [] }
  try {
    const snapshot = await getDocs(query(collection(db, STAGE_PROJECTS_COLLECTION), where('collaboratorIds', 'array-contains', id)))
    return snapshot.docs.map((d) => normalizeStageProject(d.id, d.data())).sort(sortStageProjectsByActivity)
  } catch (error) { console.error('[stageProjectService] shared query failed', error?.code || '', error?.message || error); throw error }
}

export async function listIndexedStageProjects(uid) {
  const id = String(uid || '').trim(); if (!id) return []
  try {
    const snap = await getDocs(collection(db, 'users', id, 'stageProjectIndex'))
    return snap.docs.map((d) => normalizeStageProject(d.id, d.data())).sort(sortStageProjectsByActivity)
  } catch (error) { console.error('[stageProjectService] index query failed', error?.code || '', error?.message || error); throw error }
}

export async function listAccessibleStageProjects(uid) {
  const normalizedUid = String(uid || '').trim(); if (!normalizedUid) return []
  const [ownedResult, sharedResult, indexedResult] = await Promise.allSettled([
    listMyStageProjects(normalizedUid),
    listSharedStageProjects(normalizedUid),
    listIndexedStageProjects(normalizedUid)
  ])

  const errors = []
  if (ownedResult.status === 'rejected') errors.push(ownedResult.reason)
  if (sharedResult.status === 'rejected') errors.push(sharedResult.reason)
  if (indexedResult.status === 'rejected') errors.push(indexedResult.reason)
  if (errors.length === 3) throw errors[0]

  const merged = new Map()
  ;[
    ...(ownedResult.status === 'fulfilled' ? ownedResult.value : []),
    ...(sharedResult.status === 'fulfilled' ? sharedResult.value : []),
    ...(indexedResult.status === 'fulfilled' ? indexedResult.value : [])
  ].forEach((project) => project?.id && merged.set(project.id, project))
  return [...merged.values()].sort(sortStageProjectsByActivity)
}

export async function getStageProject(projectId) {
  const id = String(projectId || '').trim(); if (!id) return null
  const snapshot = await getDoc(doc(db, STAGE_PROJECTS_COLLECTION, id))
  return snapshot.exists() ? normalizeStageProject(snapshot.id, snapshot.data()) : null
}

export async function createStageProject(user, input = {}) {
  if (!user?.uid) throw new Error('A signed-in user is required.')
  const title = String(input.title || '').trim().slice(0, 120) || 'Untitled Stage Plan'
  const stageType = String(input.stageType || '').trim() || 'Blank Stage'
  const plan = createDefaultStagePlan({ name: title, version: 1 })
  plan.title = title
  plan.stageType = stageType
  const payload = {
    title,
    ownerId: user.uid,
    collaboratorIds: [],
    visibility: 'private',
    type: 'stage-plan',
    stageType,
    stage: { width: plan.stageDimensions.width, depth: plan.stageDimensions.depth, height: plan.stageDimensions.deckHeight, unit: plan.stageDimensions.unit },
    stageDimensions: plan.stageDimensions,
    coordinateSystem: plan.coordinateSystem,
    objects: plan.objects,
    fixtures: plan.fixtures,
    audioInputs: plan.audioInputs,
    rigging: plan.rigging,
    video: plan.video,
    power: plan.power,
    layers: plan.layers,
    measurements: plan.measurements,
    annotations: plan.annotations,
    venue: plan.venue,
    exportSettings: plan.exportSettings,
    plan,
    notes: plan.notes || '',
    version: 1,
    editorState: {
      viewportMode: 'perspective3d',
      paneSizes: { library: 236, right: 286, bottom: 190, bottomSplit: 58 },
      selectedObjectId: 'stage-deck',
      showGrid: true,
      snapEnabled: true,
      snapInterval: 1,
      showLabels: true,
      showBeams: true,
      activeStageSection: 'home',
      activeEditorMode: 'entities',
      activeInspectorTab: 'properties',
      activeDataTab: 'schema',
      renderMode: 'technical',
      stageTabs: [{ id: 'stage-1', title: 'Untitled Stage' }],
      activeStageTabId: 'stage-1'
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastOpenedAt: serverTimestamp()
  }
  const ref = await addDoc(collection(db, STAGE_PROJECTS_COLLECTION), payload)
  setDoc(doc(db, 'users', user.uid, 'stageProjectIndex', ref.id), {
    projectId: ref.id,
    title,
    ownerId: user.uid,
    visibility: 'private',
    type: 'stage-plan',
    stageType,
    updatedAt: serverTimestamp(),
    lastOpenedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  }).catch((e) => console.error('[stageProjectService] index write failed', e))
  return { id: ref.id, ...normalizeStageProject(ref.id, payload) }
}

export async function touchStageProject(projectId) {
  const id = String(projectId || '').trim(); if (!id) return
  await updateDoc(doc(db, STAGE_PROJECTS_COLLECTION, id), { updatedAt: serverTimestamp(), lastOpenedAt: serverTimestamp() })
}

export async function saveStageProjectEditorState(projectId, editorState) {
  const id = String(projectId || '').trim(); if (!id || !editorState || typeof editorState !== 'object') return
  await updateDoc(doc(db, STAGE_PROJECTS_COLLECTION, id), { editorState, updatedAt: serverTimestamp(), lastOpenedAt: serverTimestamp() })
}

export async function saveStageProjectPlan(projectId, plan, editorState = null) {
  const id = String(projectId || '').trim(); if (!id || !plan || typeof plan !== 'object') return
  const normalizedPlan = normalizeStagePlan({ ...plan, id })
  const payload = {
    plan: normalizedPlan,
    stageDimensions: normalizedPlan.stageDimensions,
    coordinateSystem: normalizedPlan.coordinateSystem,
    objects: normalizedPlan.objects,
    fixtures: normalizedPlan.fixtures,
    audioInputs: normalizedPlan.audioInputs,
    rigging: normalizedPlan.rigging,
    video: normalizedPlan.video,
    power: normalizedPlan.power,
    layers: normalizedPlan.layers,
    measurements: normalizedPlan.measurements,
    annotations: normalizedPlan.annotations,
    venue: normalizedPlan.venue,
    exportSettings: normalizedPlan.exportSettings,
    notes: normalizedPlan.notes || '',
    updatedAt: serverTimestamp(),
    lastOpenedAt: serverTimestamp()
  }
  if (editorState && typeof editorState === 'object') payload.editorState = editorState
  await updateDoc(doc(db, STAGE_PROJECTS_COLLECTION, id), payload)
}
