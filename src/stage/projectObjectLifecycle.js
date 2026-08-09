const LINKED_COLLECTIONS = Object.freeze(['audioInputs', 'fixtures', 'rigging', 'video', 'power'])

const clone = (value) => JSON.parse(JSON.stringify(value ?? null))
const objectId = (object) => String(object?.id || object?.key || '')
const uniqueIds = (ids = []) => [...new Set((Array.isArray(ids) ? ids : [ids]).map((id) => String(id || '')).filter(Boolean))]

function removeLinkedRows(project, ids) {
  const targetIds = new Set(ids)
  LINKED_COLLECTIONS.forEach((collection) => {
    project[collection] = (project[collection] || []).filter((row) => !targetIds.has(String(row?.linkedObjectId || '')))
  })
}

function restoreLinkedRows(project, linkedRows = {}) {
  LINKED_COLLECTIONS.forEach((collection) => {
    const rows = Array.isArray(linkedRows[collection]) ? linkedRows[collection] : []
    if (!rows.length) return
    const rowIds = new Set(rows.map((row) => String(row?.id || '')).filter(Boolean))
    const linkedIds = new Set(rows.map((row) => String(row?.linkedObjectId || '')).filter(Boolean))
    project[collection] = [
      ...(project[collection] || []).filter((row) => !rowIds.has(String(row?.id || '')) && !linkedIds.has(String(row?.linkedObjectId || ''))),
      ...rows.map(clone)
    ]
  })
}

function restoreObjects(project, removedObjects = []) {
  const restoringIds = new Set(removedObjects.map((entry) => objectId(entry.object)).filter(Boolean))
  const objects = (project.objects || []).filter((object) => !restoringIds.has(objectId(object)))
  removedObjects
    .slice()
    .sort((left, right) => left.index - right.index)
    .forEach(({ index, object }) => objects.splice(Math.max(0, Math.min(index, objects.length)), 0, clone(object)))
  project.objects = objects
}

function animationWithoutObjects(animation, ids) {
  const targetIds = new Set(ids)
  const next = clone(animation || {}) || {}
  next.tracks = (next.tracks || []).filter((track) => !targetIds.has(String(track?.targetObjectId || '')))
  return next
}

/**
 * Creates the sole project-level deletion transaction. It deliberately works
 * from project object UUIDs, not display labels, array positions, or assets.
 */
export function createProjectObjectDeletion(project, requestedIds, { selectedObjectIds = [], primaryObjectId = '' } = {}) {
  if (!project || typeof project !== 'object') return null
  const ids = new Set(uniqueIds(requestedIds))
  const removedObjects = (project.objects || [])
    .map((object, index) => ({ object, index }))
    .filter(({ object }) => ids.has(objectId(object)) && !object?.protected)
    .map(({ object, index }) => ({ index, object: clone(object) }))
  if (!removedObjects.length) return null

  const deletedIds = removedObjects.map(({ object }) => objectId(object))
  const deletedIdSet = new Set(deletedIds)
  const linkedRows = Object.fromEntries(LINKED_COLLECTIONS.map((collection) => [
    collection,
    (project[collection] || []).filter((row) => deletedIdSet.has(String(row?.linkedObjectId || ''))).map(clone)
  ]))
  const command = Object.freeze({
    kind: 'project-object-delete',
    objectIds: Object.freeze(deletedIds),
    removedObjects: Object.freeze(removedObjects.map(({ index, object }) => Object.freeze({ index, object }))),
    linkedRows: Object.freeze(linkedRows),
    animationBefore: clone(project.animation || {}),
    animationAfter: animationWithoutObjects(project.animation, deletedIds),
    selectionBefore: Object.freeze(uniqueIds(selectedObjectIds)),
    primaryBefore: String(primaryObjectId || ''),
    selectionAfter: Object.freeze([]),
    primaryAfter: ''
  })
  return { command, project: applyProjectObjectDeletion(project, command, 'after') }
}

/** Applies a deletion history transaction without touching runtime-only state. */
export function applyProjectObjectDeletion(project, command, direction = 'after') {
  const next = clone(project) || {}
  const restore = direction === 'before'
  if (!command || command.kind !== 'project-object-delete') return next
  if (restore) {
    restoreObjects(next, command.removedObjects || [])
    restoreLinkedRows(next, command.linkedRows)
    next.animation = clone(command.animationBefore || {})
  } else {
    const ids = command.objectIds || []
    const targetIds = new Set(ids)
    next.objects = (next.objects || []).filter((object) => !targetIds.has(objectId(object)))
    removeLinkedRows(next, ids)
    next.animation = clone(command.animationAfter || {})
  }
  return next
}

export function selectionForProjectObjectDeletion(project, command, direction = 'after') {
  const requested = direction === 'before' ? command?.selectionBefore : command?.selectionAfter
  const primary = direction === 'before' ? command?.primaryBefore : command?.primaryAfter
  const available = new Set((project?.objects || []).map(objectId).filter(Boolean))
  const selectedObjectIds = uniqueIds(requested).filter((id) => available.has(id))
  return {
    selectedObjectIds,
    primaryObjectId: selectedObjectIds.includes(primary) ? primary : selectedObjectIds[0] || ''
  }
}
