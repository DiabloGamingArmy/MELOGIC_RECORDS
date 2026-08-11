/*
  Vertix legacy branding guard
  ----------------------------
  This is intentionally presentation-only.

  It does NOT rename:
    - Firestore collections
    - storage paths
    - stage engine symbols
    - data attributes / IDs
    - Resona context IDs such as `stagemaker`

  Those identifiers can be migrated separately after compatibility tests.

  The guard only replaces known legacy StageMaker display phrases that can
  still be emitted by older deeply nested UI modules.
*/

const EXACT_TEXT_REPLACEMENTS = new Map([
  ['STAGEMAKER', 'VERTIX'],
  ['StageMaker', 'Vertix'],
  ['Stagemaker', 'Vertix'],
  ['StageMaker Projects', 'Vertix Projects'],
  ['My StageMaker Projects', 'My Vertix Projects'],
  ['StageMaker 3D viewport', 'Vertix 3D viewport'],
  ['StageMaker inspector', 'Vertix inspector'],
  ['StageMaker Resona tab', 'Vertix Resona tab'],
  ['StageMaker viewport tools', 'Vertix viewport tools'],
  ['StageMaker object data panel', 'Vertix object data panel'],
  ['Open StageMaker Resona dock', 'Open Vertix Resona dock'],
  ['Enable StageMaker guidance', 'Enable Vertix guidance']
])

const HUMAN_FACING_ATTRIBUTES = [
  'aria-label',
  'title',
  'placeholder'
]

function normalize(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function replaceKnownTextNode(node) {
  if (!(node instanceof Text)) return

  const original = node.nodeValue || ''
  const clean = normalize(original)
  const replacement = EXACT_TEXT_REPLACEMENTS.get(clean)

  if (!replacement) return

  const leading = original.match(/^\s*/)?.[0] || ''
  const trailing = original.match(/\s*$/)?.[0] || ''

  node.nodeValue = `${leading}${replacement}${trailing}`
}

function replaceKnownAttributes(element) {
  if (!(element instanceof Element)) return

  HUMAN_FACING_ATTRIBUTES.forEach((attribute) => {
    const current = element.getAttribute(attribute)

    if (!current || !/stagemaker/i.test(current)) return

    element.setAttribute(
      attribute,
      current.replace(/stagemaker/gi, 'Vertix')
    )
  })
}

function processNode(node) {
  if (!node) return

  if (node instanceof Text) {
    replaceKnownTextNode(node)
    return
  }

  if (!(node instanceof Element) && node !== document) return

  if (node instanceof Element) replaceKnownAttributes(node)

  const walker = document.createTreeWalker(
    node,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
  )

  let current = walker.currentNode

  while (current) {
    if (current instanceof Text) replaceKnownTextNode(current)
    else if (current instanceof Element) replaceKnownAttributes(current)

    current = walker.nextNode()
  }
}

function normalizeDocumentTitle() {
  if (/stagemaker/i.test(document.title || '')) {
    document.title = document.title.replace(/stagemaker/gi, 'Vertix')
  }

  if (/melogic\s*\|\s*stage$/i.test(document.title || '')) {
    document.title = 'Melogic | Vertix'
  }
}

function installGuard() {
  normalizeDocumentTitle()
  processNode(document)

  const observer = new MutationObserver((mutations) => {
    normalizeDocumentTitle()

    mutations.forEach((mutation) => {
      if (mutation.type === 'characterData') {
        replaceKnownTextNode(mutation.target)
        return
      }

      mutation.addedNodes.forEach(processNode)

      if (
        mutation.type === 'attributes'
        && mutation.target instanceof Element
      ) {
        replaceKnownAttributes(mutation.target)
      }
    })
  })

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: HUMAN_FACING_ATTRIBUTES
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installGuard, { once: true })
} else {
  installGuard()
}
