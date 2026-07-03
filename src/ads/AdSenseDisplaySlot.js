import { ADS_ENABLED, ADSENSE_CLIENT_ID, ADS_VISIBLE_DURING_REVIEW } from './adConfig'

const pushedSlots = new WeakSet()

function pushAdSlot(insElement) {
  if (!insElement || pushedSlots.has(insElement)) return
  pushedSlots.add(insElement)

  if (typeof window === 'undefined' || !window.adsbygoogle) return

  try {
    window.adsbygoogle.push({})
  } catch (error) {
    if (import.meta.env.DEV) console.warn('[ads] AdSense slot push failed', error?.message || error)
  }
}

export function createAdSenseDisplaySlot({ slotId, className = '' } = {}) {
  if (!ADS_ENABLED || !ADS_VISIBLE_DURING_REVIEW || !slotId) return null

  const slot = document.createElement('aside')
  slot.className = ['adsense-display-slot', className].filter(Boolean).join(' ')
  slot.setAttribute('aria-label', 'Advertisement')

  const label = document.createElement('span')
  label.className = 'adsense-display-slot__label'
  label.textContent = 'Advertisement'

  const ins = document.createElement('ins')
  ins.className = 'adsbygoogle'
  ins.style.display = 'block'
  ins.dataset.adClient = ADSENSE_CLIENT_ID
  ins.dataset.adSlot = slotId
  ins.dataset.adFormat = 'auto'
  ins.dataset.fullWidthResponsive = 'true'

  slot.append(label, ins)
  requestAnimationFrame(() => pushAdSlot(ins))

  return slot
}
