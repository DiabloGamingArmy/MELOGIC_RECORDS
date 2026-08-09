const objectId = (object = {}) => String(object.id || object.key || '')

export function sceneObjectIcon(object = {}) {
  const value = `${object.type || ''} ${object.category || ''}`.toLowerCase()
  if (value.includes('light')) return '◉'
  if (value.includes('audio') || value.includes('speaker') || value.includes('mic')) return '◖'
  if (value.includes('video') || value.includes('camera') || value.includes('led')) return '▻'
  if (value.includes('rig') || value.includes('truss')) return '⌁'
  if (value.includes('stage') || value.includes('deck')) return '□'
  return '◇'
}

// Project objects remain the source of truth. Nodes only reference them so a
// tree view can never drift from the data the viewport and properties edit.
export function buildSceneOutliner(objects = []) {
  const nodes = new Map()
  const roots = []
  ;(Array.isArray(objects) ? objects : []).forEach((object) => {
    const id = objectId(object)
    if (id) nodes.set(id, { id, object, children: [] })
  })
  nodes.forEach((node) => {
    const parentId = String(node.object.parentId || '')
    const parent = parentId ? nodes.get(parentId) : null
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  })
  return roots
}

export function filterSceneOutliner(nodes = [], query = '') {
  const needle = String(query || '').trim().toLowerCase()
  const walk = (node) => {
    const children = node.children.map(walk).filter(Boolean)
    if (!needle) return { ...node, children }
    const object = node.object || {}
    const matches = [node.id, object.label, object.name, object.type, object.category]
      .some((value) => String(value || '').toLowerCase().includes(needle))
    return matches || children.length ? { ...node, children } : null
  }
  return nodes.map(walk).filter(Boolean)
}
