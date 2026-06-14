export function escapeHtml(value) {
  return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'blockquote', 'hr', 'div', 'span'])
const ALLOWED_STYLES = new Set(['text-align', 'color', 'font-size', 'font-family'])
const STYLE_CAPABLE_TAGS = new Set(['p', 'strong', 'b', 'em', 'i', 'u', 'li', 'blockquote', 'div', 'span'])

function cleanStyle(value = '') {
  return value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [k, ...rest] = part.split(':')
      const key = String(k || '').trim().toLowerCase()
      const val = rest.join(':').trim()
      if (!ALLOWED_STYLES.has(key)) return ''
      if (key === 'text-align' && !['left', 'center', 'right'].includes(val)) return ''
      if (key === 'font-size' && !/^(12|14|16|18|20|24)px$/.test(val)) return ''
      if (key === 'font-family' && !/^(Arial|Georgia|Verdana|Tahoma|"Times New Roman")$/i.test(val)) return ''
      if (key === 'color') {
        const safeNamedColors = new Set(['black', 'white', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'cyan', 'magenta'])
        const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(val)
        const isRgb = /^rgba?\(\s*(25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(25[0-5]|2[0-4]\d|1?\d?\d)(\s*,\s*(0|1|0?\.\d+))?\s*\)$/i.test(val)
        if (!isHex && !isRgb && !safeNamedColors.has(val.toLowerCase())) return ''
      }
      return `${key}:${val}`
    })
    .filter(Boolean)
    .join(';')
}

function sanitizeNode(node, doc) {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent || '')
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const tag = node.tagName.toLowerCase()
  if (!ALLOWED_TAGS.has(tag)) {
    const frag = doc.createDocumentFragment()
    node.childNodes.forEach((child) => {
      const cleaned = sanitizeNode(child, doc)
      if (cleaned) frag.appendChild(cleaned)
    })
    return frag
  }
  const el = doc.createElement(tag)
  if (tag === 'a') {
    const href = String(node.getAttribute('href') || '').trim()
    if (/^(https?:|mailto:)/i.test(href)) {
      el.setAttribute('href', href)
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noopener noreferrer')
    }
  }
  const style = cleanStyle(String(node.getAttribute('style') || ''))
  if (style && STYLE_CAPABLE_TAGS.has(tag)) el.setAttribute('style', style)
  node.childNodes.forEach((child) => {
    const cleaned = sanitizeNode(child, doc)
    if (cleaned) el.appendChild(cleaned)
  })
  return el
}

export function sanitizeRichDescription(input = '') {
  const raw = String(input || '').trim()
  if (!raw) return ''
  const parser = new DOMParser()
  const src = parser.parseFromString(raw, 'text/html')
  const out = document.implementation.createHTMLDocument('safe')
  const container = out.createElement('div')
  src.body.childNodes.forEach((node) => {
    const cleaned = sanitizeNode(node, out)
    if (cleaned) container.appendChild(cleaned)
  })
  return container.innerHTML.trim()
}

export function renderSafeRichDescription(input = '') {
  const value = String(input || '')
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(value)
  if (!looksLikeHtml) {
    const plain = escapeHtml(value)
    return plain ? plain.replace(/\n/g, '<br>') : 'No full description has been provided yet.'
  }
  const safe = sanitizeRichDescription(value)
  return safe || 'No full description has been provided yet.'
}
