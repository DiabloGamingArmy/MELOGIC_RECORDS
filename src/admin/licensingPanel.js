import { adminPageHeader, adminSimpleTable, htmlCell, renderBadge, escapeHtml as esc } from './primitives.js'
import { iconSvg } from '../utils/icons.js'
const button = (name, label, extra = '', primary = false) => `<button type="button" class="${primary ? 'admin-primary-button' : 'admin-secondary-button'}" data-license-action="${name}" ${extra}>${label}</button>`
const field = (name, label, type = 'text', value = '', extra = '') => `<label class="${['campaign', 'reason', 'editions'].includes(name) ? 'is-wide' : ''}"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`
const date = value => value && Number.isFinite(new Date(value.length === 10 ? `${value}T12:00:00` : value).getTime()) ? esc(new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value))) : '—'
const badge = status => renderBadge(({ available: 'Available', partially_redeemed: 'Partially Redeemed', redeemed: 'Redeemed', expired: 'Expired', revoked: 'Revoked', active: 'Active', no_access: 'No access' })[status] || status, ({ available: 'published', active: 'published', partially_redeemed: 'review-pending', redeemed: 'draft', expired: 'needs-changes', revoked: 'rejected' })[status] || 'draft')
const emptyState = (title, body, action = '') => `<article class="admin-empty-state admin-table-empty admin-section-slab"><strong>${title}</strong><span>${body}</span>${action ? `<div class="admin-row-actions">${action}</div>` : ''}</article>`
const friendlyError = error => ['internal', 'functions/internal'].includes(error?.code) || error?.message === 'internal' ? 'Licensing data is temporarily unavailable. Try again or check the server logs if the problem continues.' : error?.message || 'The operation could not be completed. Please try again.'
export function mountLicensingPanel(root, { request, allowed, targetUid = '' }) {
  let disposed = false, products = [], keys = [], entitlements = [], cursor = '', busy = false, error = '', dialog = null
  let currentFilter = '', returnFocus = null, loading = true, loaded = false
  root.classList.add('admin-main')
  const doc = root.ownerDocument
  const FormData = doc.defaultView.FormData
  function closeDialog() {
    if (!dialog) return
    // Remove all plaintext values and DOM references on every close path.
    dialog.querySelectorAll('textarea,input').forEach(el => { el.value = '' })
    dialog.remove(); dialog = null
    returnFocus?.focus(); returnFocus = null
  }
  function modal(title, body) {
    const confirmLabel = title.startsWith('Generate') ? 'Generate' : title.startsWith('Grant') ? 'Grant Access' : title.startsWith('Revoke product') ? 'Revoke Access' : title.startsWith('Revoke license') ? 'Revoke Key' : 'Save'
    closeDialog()
    returnFocus = doc.activeElement
    dialog = doc.createElement('dialog')
    dialog.className = 'admin-decision-modal admin-product-grant-modal admin-licensing-dialog'
    dialog.setAttribute('aria-labelledby', 'license-dialog-title')
    dialog.innerHTML = `<header><h2 id="license-dialog-title">${esc(title)}</h2><button type="button" class="admin-icon-button" data-license-close aria-label="Close dialog">${iconSvg('x')}</button></header><form class="admin-email-form"><div class="admin-form-grid two">${body}</div><p role="alert" class="admin-status is-error" data-license-error hidden></p><footer class="admin-modal-actions">${button('cancel', 'Cancel')}<button class="${title.startsWith('Revoke') ? 'admin-danger-button' : 'admin-primary-button'}" type="submit">${confirmLabel}</button></footer></form>`
    doc.body.append(dialog)
    dialog.querySelector('[data-license-action="cancel"]').onclick = closeDialog
    dialog.querySelector('[data-license-close]').onclick = () => { if (!busy) closeDialog() }
    dialog.addEventListener('cancel', e => { e.preventDefault(); if (!busy) closeDialog() })
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '')
    return dialog.querySelector('form')
  }
  function productFields(selected = '') {
    return `<label><span>Product</span><select name="productId">${products.map(p => `<option value="${esc(p.productId)}" ${p.productId === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label><label><span>Edition</span><select name="edition"></select></label>`
  }
  function editions(form, selected = '') {
    const update = () => { const p = products.find(p => p.productId === form.elements.productId.value); form.elements.edition.innerHTML = (p?.editions || []).map(e => `<option ${e === selected ? 'selected' : ''}>${esc(e)}</option>`).join('') }
    form.elements.productId.onchange = update; update()
  }
  async function submit(form, name, data, success) {
    if (busy) return
    busy = true
    form.querySelectorAll('button').forEach(b => { b.disabled = true })
    try { const result = await request(name, data); if (!disposed) { closeDialog(); await success(result) } }
    catch (e) { if (dialog) { const alert = dialog.querySelector('[data-license-error]'); alert.hidden = false; alert.textContent = friendlyError(e) } }
    finally { busy = false; form.querySelectorAll('button').forEach(b => { b.disabled = false }) }
  }
  async function refresh(append = false) {
    if (loading && loaded) return
    loading = true
    if (!disposed) render()
    try {
      if (targetUid) { const result = await request('getAdminProductAccess', { targetUid }); products = result.products; entitlements = result.entitlements }
      else { const [catalog, page] = await Promise.all([request('listLicensingProducts'), request('listLicenseKeys', { cursor: append ? cursor : '' })]); products = catalog; keys = append ? [...keys, ...page.keys] : page.keys; cursor = page.cursor }
      error = ''; loaded = true
    } catch (e) { error = friendlyError(e) }
    loading = false
    if (!disposed) render()
  }
  function accessDialog(productId, revoke = false) {
    const previous = entitlements.find(e => e.productId === productId)
    const form = modal(revoke ? 'Revoke product access?' : 'Grant product access', revoke ? `<p class="is-wide admin-muted">${esc(targetUid)} will no longer be authorized after the authorization system observes this revocation (up to 15 minutes).</p>${field('reason', 'Reason', 'text', '', 'required maxlength="500"')}` : `${productFields(productId)}${field('expiresAt', 'Expiration (blank means never)', 'datetime-local')}${field('reason', 'Reason / Note', 'text', '', 'required maxlength="500"')}`)
    if (!revoke) editions(form, previous?.edition)
    form.onsubmit = e => { e.preventDefault(); const values = Object.fromEntries(new FormData(form)); submit(form, revoke ? 'revokeProductEntitlement' : 'grantProductEntitlement', { ...values, targetUid, productId: revoke ? productId : values.productId, expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null }, () => refresh()) }
  }
  function generate() {
    const form = modal('Generate license keys', `${productFields()}${field('quantity', 'Quantity', 'number', 1, 'required min="1" max="100"')}${field('maxRedemptions', 'Redemptions per key', 'number', 1, 'required min="1" max="1000"')}${field('expiresAt', 'Key expiration (blank means never)', 'datetime-local')}${field('campaign', 'Campaign / Note', 'text', '', 'maxlength="500"')}`)
    editions(form)
    form.onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(new FormData(form)); submit(form, 'generateLicenseKeys', { ...v, quantity: Number(v.quantity), maxRedemptions: Number(v.maxRedemptions), expiresAt: v.expiresAt ? new Date(v.expiresAt).toISOString() : null }, async result => {
      await refresh()
      if (disposed) { result.keys.length = 0; return }
      const resultForm = modal('Keys generated successfully', `<p class="admin-muted is-wide">These keys are shown only once. Copy them before closing this window.</p><textarea class="admin-code-value is-wide" readonly aria-label="Generated keys">${esc(result.keys.join('\n'))}</textarea><div class="is-wide">${button('copy', 'Copy All', '', true)}<span role="status" class="admin-muted"></span></div>`)
      result.keys.length = 0
      resultForm.querySelector('button[type="submit"]').remove()
      resultForm.querySelector('[data-license-action="cancel"]').textContent = 'Close'
      resultForm.onsubmit = e => { e.preventDefault(); closeDialog() }
      resultForm.querySelector('[data-license-action="copy"]').onclick = async () => {
        try { await doc.defaultView.navigator.clipboard.writeText(resultForm.querySelector('textarea').value); resultForm.querySelector('[role="status"]').textContent = 'Copied.' }
        catch { resultForm.querySelector('[role="status"]').textContent = 'Copy failed. Select the keys and copy manually.' }
      }
    }) }
  }
  function productDialog(p = {}) {
    const form = modal('Manage licensable product', `${field('productId', 'Product ID', 'text', p.productId || 'origami', `required ${p.productId ? 'readonly' : ''}`)}${field('name', 'Name', 'text', p.name || 'Origami', 'required')}<label><span>Status</span><select name="status">${['beta', 'active', 'disabled'].map(s => `<option ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>${field('editions', 'Allowed editions (comma separated)', 'text', (p.editions || ['beta']).join(', '), 'required')}${field('reason', 'Reason / Note')}`)
    form.onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(new FormData(form)); submit(form, 'saveLicensingProduct', { ...v, editions: v.editions.split(',').map(s => s.trim()) }, () => refresh()) }
  }
  function render() {
    if (!allowed) { root.innerHTML = '<p role="alert">Admin licensing permission required.</p>'; return }
    const canGenerate = loaded && products.length > 0 && !loading
    const actions = `<div class="admin-row-actions">${button('product', '+ Product')}${button('generate', '+ Generate Keys', canGenerate ? '' : 'disabled', true)}</div>`
    const header = adminPageHeader({ eyebrow: 'Product access', title: targetUid ? 'Product Access' : 'License Keys', description: targetUid ? `Manage access for ${targetUid}.` : 'Generate and manage product redemption credentials.', actions: targetUid ? button('refresh', 'Refresh', loading ? 'disabled' : '') : actions })
    const toolbar = targetUid ? '' : `<div class="admin-review-tools"><div class="admin-slab-heading"><h2>Redemption credentials</h2><span class="admin-muted">${keys.length} loaded</span></div><div class="admin-row-actions"><label class="admin-licensing-filter">Product<select data-license-filter ${!loaded || !products.length ? 'disabled' : ''}><option value="">All products</option>${products.map(p => `<option value="${esc(p.productId)}" ${p.productId === currentFilter ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>${button('refresh', loading ? 'Refreshing…' : 'Refresh', loading ? 'disabled' : '')}</div></div>`
    const visible = keys.filter(k => !currentFilter || k.productId === currentFilter)
    const rows = targetUid ? [...new Set([...products.map(p => p.productId), ...entitlements.map(e => e.productId)])].map(productId => {
      const p = products.find(p => p.productId === productId), e = entitlements.find(e => e.productId === productId)
      return [p?.name || productId, e?.edition || '—', htmlCell(badge(e?.status || 'no_access')), htmlCell(`<strong>${esc(e?.source || 'No grant')}</strong><small>Granted: ${date(e?.grantedAt)}</small><small>Expires: ${e?.expiresAt ? date(e.expiresAt) : 'Never'}</small>${e?.maskedKey ? `<code class="admin-code-value">${esc(e.maskedKey)}</code>` : ''}${e?.revokedAt ? `<small>Last revocation: ${date(e.revokedAt)} · ${esc(e.revocationReason)}</small>` : ''}`), htmlCell(`<div class="admin-row-actions">${p ? button('grant', 'Grant Access', `data-id="${esc(productId)}"`) : ''}${p && e?.status === 'active' ? button('revoke-access', 'Revoke Access', `data-id="${esc(productId)}"`) : ''}</div>`)]
    }) : visible.map(k => [htmlCell(`<code class="admin-code-value">${esc(k.maskedKey)}</code>`), products.find(p => p.productId === k.productId)?.name || k.productId, k.edition, htmlCell(`${badge(k.status)}<small>${k.redemptionCount} / ${k.maxRedemptions} redemptions</small>`), htmlCell(`<strong>${date(k.createdAt)}</strong>${k.campaign ? `<small>${esc(k.campaign)}</small>` : ''}`), htmlCell(k.status !== 'revoked' && k.managementId ? `<details class="admin-account-actions-menu"><summary class="admin-icon-button" aria-label="Actions for ${esc(k.maskedKey)}">${iconSvg('moreVertical')}</summary><div class="admin-account-actions-dropdown">${button('revoke-key', 'Revoke Key', `data-id="${esc(k.managementId)}"`)}</div></details>` : '<span class="admin-muted">—</span>')])
    let content
    if (error) content = `<article class="admin-empty-state admin-section-slab" role="alert"><strong>Licensing data could not be loaded</strong><p>${esc(error)}</p>${button('refresh', 'Try Again')}</article>`
    else if (loading && !loaded) content = '<article class="admin-empty-state" role="status">Loading licensing data…</article>'
    else if (!products.length) content = emptyState('No licensing products configured', 'Add Origami Beta or another product before generating license keys.', targetUid ? '' : button('product', '+ Add Product'))
    else if (!rows.length) content = targetUid ? emptyState('No product access yet', 'Grant access to a configured product.') : currentFilter ? emptyState('No keys for this product', 'No matching keys in the loaded pages. Load more or select another product.', button('generate', '+ Generate Keys', '', true)) : emptyState('No license keys yet', 'Generate a key to begin issuing product access.', button('generate', '+ Generate Keys', '', true))
    else content = adminSimpleTable(targetUid ? 'Product access' : 'License keys', targetUid ? ['Product', 'Edition', 'Status', 'Provenance', 'Actions'] : ['Key', 'Product', 'Edition', 'Status', 'Created / Campaign', 'Actions'], rows, { className: targetUid ? 'is-license-access' : 'is-license-keys' })
    root.innerHTML = `${header}<section class="admin-section-slab">${toolbar}${content}${!targetUid && cursor && !error ? `<div class="admin-load-more-row">${button('more', loading ? 'Loading…' : 'Load More', loading ? 'disabled' : '')}</div>` : ''}${!targetUid ? '<p class="admin-muted">Key revocation prevents future redemption. Manage existing user access under Users → Manage Products.</p>' : ''}</section>${!targetUid && products.length ? `<details class="admin-section-slab"><summary>Licensing products · ${products.length}</summary><div class="admin-row-actions">${products.map(p => button('edit-product', `${esc(p.name)} · Manage`, `data-id="${esc(p.productId)}"`)).join('')}</div></details>` : ''}`
    root.querySelector('[data-license-filter]')?.addEventListener('change', e => { currentFilter = e.target.value; render() })
    root.querySelectorAll('[data-license-action]').forEach(b => { b.onclick = () => {
      const action = b.dataset.licenseAction, id = b.dataset.id
      if (action === 'generate') generate()
      if (action === 'product') productDialog()
      if (action === 'edit-product') productDialog(products.find(p => p.productId === id))
      if (action === 'grant' || action === 'revoke-access') accessDialog(id, action === 'revoke-access')
      if (action === 'refresh' || action === 'more') refresh(action === 'more')
      if (action === 'revoke-key') {
        const form = modal('Revoke license key?', `<p class="is-wide admin-muted">Revoking this key prevents future redemption. Access already granted remains unchanged; manage it under Users → Manage Products.</p>${field('reason', 'Reason', 'text', '', 'required')}`)
        form.onsubmit = e => { e.preventDefault(); submit(form, 'revokeLicenseKey', { managementId: id, reason: form.elements.reason.value }, () => refresh()) }
      }
    } })
  }
  render()
  const ready = allowed ? refresh() : Promise.resolve()
  return { ready, dispose() { disposed = true; closeDialog(); root.innerHTML = '' } }
}
