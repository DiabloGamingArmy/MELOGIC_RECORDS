import './marketplaceAdRails.css'
import { MARKETPLACE_AD_SLOTS } from './adConfig'
import { canShowMarketplaceRails } from './adPlacementRules'
import { createAdSenseDisplaySlot } from './AdSenseDisplaySlot'

const RAIL_WRAPPER_SELECTOR = '[data-marketplace-ad-rails]'

function createRail(position, slotId) {
  const rail = document.createElement('aside')
  rail.className = `marketplace-ad-rail marketplace-ad-rail--${position}`
  rail.setAttribute('aria-label', `${position} marketplace ad rail`)
  rail.dataset.marketplaceAdRail = position

  const slot = createAdSenseDisplaySlot({
    slotId,
    className: `adsense-display-slot--${position}`
  })

  if (slot) rail.append(slot)
  return rail
}

export function mountMarketplaceAdRails({ root = document.querySelector('[data-marketplace-root]') } = {}) {
  if (!canShowMarketplaceRails()) return null
  if (!root || root.closest(RAIL_WRAPPER_SELECTOR)) return null

  const parent = root.parentElement
  if (!parent) return null

  const wrapper = document.createElement('div')
  wrapper.className = 'marketplace-ad-rails-layout'
  wrapper.dataset.marketplaceAdRails = 'true'

  const leftRail = createRail('left', MARKETPLACE_AD_SLOTS.leftRail)
  const rightRail = createRail('right', MARKETPLACE_AD_SLOTS.rightRail)

  parent.insertBefore(wrapper, root)
  wrapper.append(leftRail, root, rightRail)

  return wrapper
}
