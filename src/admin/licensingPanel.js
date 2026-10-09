const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const button = (name, label, extra = '') => `<button type="button" class="admin-secondary-button" data-license-action="${name}" ${extra}>${label}</button>`
const field = (name, label, type = 'text', value = '', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`
export function mountLicensingPanel(root, { request, allowed, targetUid = '' }) {
  let disposed = false, products = [], keys = [], entitlements = [], cursor = '', busy = false, error = '', dialog = null
  let currentFilter = '', returnFocus = null
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
    dialog.className = 'admin-licensing-dialog'
    dialog.innerHTML = `<h2>${esc(title)}</h2><form>${body}<p role="alert" data-license-error></p><div class="admin-row-actions">${button('cancel', 'Cancel')}<button class="admin-primary-button" type="submit">${confirmLabel}</button></div></form>`
    doc.body.append(dialog)
    dialog.querySelector('[data-license-action="cancel"]').onclick = closeDialog
    dialog.addEventListener('cancel', e => { e.preventDefault(); if (!busy) closeDialog() })
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '')
    return dialog.querySelector('form')
  }
  function productFields(selected = '') {
    return `<label>Product<select name="productId">${products.map(p => `<option value="${esc(p.productId)}" ${p.productId === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label><label>Edition<select name="edition"></select></label>`
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
    catch (e) { if (dialog) dialog.querySelector('[data-license-error]').textContent = e.message || 'Operation failed.' }
    finally { busy = false; form.querySelectorAll('button').forEach(b => { b.disabled = false }) }
  }
  async function refresh(append = false) {
    try {
      if (targetUid) { const result = await request('getAdminProductAccess', { targetUid }); products = result.products; entitlements = result.entitlements }
      else { const [catalog, page] = await Promise.all([request('listLicensingProducts'), request('listLicenseKeys', { cursor: append ? cursor : '' })]); products = catalog; keys = append ? [...keys, ...page.keys] : page.keys; cursor = page.cursor }
      error = ''
    } catch (e) { error = e.message || 'Licensing could not be loaded.' }
    if (!disposed) render()
  }
  function accessDialog(productId, revoke = false) {
    const previous = entitlements.find(e => e.productId === productId)
    const form = modal(revoke ? 'Revoke product access?' : 'Grant product access', revoke ? `<p>${esc(targetUid)} will no longer be authorized after the authorization system observes this revocation (up to 15 minutes).</p>${field('reason', 'Reason', 'text', '', 'required maxlength="500"')}` : `${productFields(productId)}${field('expiresAt', 'Expiration (blank means never)', 'datetime-local')}${field('reason', 'Reason / Note', 'text', '', 'required maxlength="500"')}`)
    if (!revoke) editions(form, previous?.edition)
    form.onsubmit = e => { e.preventDefault(); const values = Object.fromEntries(new FormData(form)); submit(form, revoke ? 'revokeProductEntitlement' : 'grantProductEntitlement', { ...values, targetUid, productId: revoke ? productId : values.productId, expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null }, () => refresh()) }
  }
  function generate() {
    const form = modal('Generate license keys', `${productFields()}${field('quantity', 'Quantity', 'number', 1, 'required min="1" max="100"')}${field('maxRedemptions', 'Redemptions per key', 'number', 1, 'required min="1" max="1000"')}${field('expiresAt', 'Key expiration (blank means never)', 'datetime-local')}${field('campaign', 'Campaign / Note', 'text', '', 'maxlength="500"')}`)
    editions(form)
    form.onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(new FormData(form)); submit(form, 'generateLicenseKeys', { ...v, quantity: Number(v.quantity), maxRedemptions: Number(v.maxRedemptions), expiresAt: v.expiresAt ? new Date(v.expiresAt).toISOString() : null }, async result => {
      await refresh()
      if (disposed) { result.keys.length = 0; return }
      const resultForm = modal('Copy your keys now', `<p>These keys will only be shown once. Copy them before closing this window.</p><textarea readonly aria-label="Generated keys">${esc(result.keys.join('\n'))}</textarea>${button('copy', 'Copy All')}<span role="status"></span>`)
      result.keys.length = 0
      resultForm.querySelector('button[type="submit"]').textContent = 'Close'
      resultForm.querySelector('[data-license-action="cancel"]').textContent = 'Close'
      resultForm.onsubmit = e => { e.preventDefault(); closeDialog() }
      resultForm.querySelector('[data-license-action="copy"]').onclick = async () => {
        try { await doc.defaultView.navigator.clipboard.writeText(resultForm.querySelector('textarea').value); resultForm.querySelector('[role="status"]').textContent = 'Copied.' }
        catch { resultForm.querySelector('[role="status"]').textContent = 'Copy failed. Select the keys and copy manually.' }
      }
    }) }
  }
  function productDialog(p = {}) {
    const form = modal('Manage licensable product', `${field('productId', 'Product ID', 'text', p.productId || 'origami', `required ${p.productId ? 'readonly' : ''}`)}${field('name', 'Name', 'text', p.name || 'Origami', 'required')}<label>Status<select name="status">${['beta', 'active', 'disabled'].map(s => `<option ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>${field('editions', 'Allowed editions (comma separated)', 'text', (p.editions || ['beta']).join(', '), 'required')}${field('reason', 'Reason / Note')}`)
    form.onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(new FormData(form)); submit(form, 'saveLicensingProduct', { ...v, editions: v.editions.split(',').map(s => s.trim()) }, () => refresh()) }
  }
  function render() {
    if (!allowed) { root.innerHTML = '<p role="alert">Admin licensing permission required.</p>'; return }
    const rows = targetUid ? [...new Set([...products.map(p => p.productId), ...entitlements.map(e => e.productId)])].map(productId => {
      const p = products.find(p => p.productId === productId), e = entitlements.find(e => e.productId === productId)
      return `<tr><td>${esc(p?.name || productId)}</td><td>${esc(e?.edition)}</td><td>${esc(e?.status || 'NO ACCESS')}</td><td>Source: ${esc(e?.source)}<br>Granted: ${esc(e?.grantedAt)}<br>Expires: ${esc(e?.expiresAt || 'Never')}<br>${esc(e?.maskedKey)}<br>Last revocation: ${esc(e?.revokedAt)} ${esc(e?.revocationReason)}</td><td>${p ? button('grant', 'Grant Access', `data-id="${esc(productId)}"`) : ''}${p && e?.status === 'active' ? button('revoke-access', 'Revoke Access', `data-id="${esc(productId)}"`) : ''}</td></tr>`
    }).join('') : keys.filter(k => !currentFilter || k.productId === currentFilter).map(k => `<tr><td>${esc(k.maskedKey)}</td><td>${esc(k.productId)}</td><td>${esc(k.edition)}</td><td>${esc(k.status)} (${k.redemptionCount}/${k.maxRedemptions})</td><td>${esc(k.createdAt)}<br>${esc(k.campaign)}</td><td>${k.status !== 'revoked' && k.managementId ? button('revoke-key', 'Revoke Key', `data-id="${esc(k.managementId)}"`) : ''}</td></tr>`).join('')
    root.innerHTML = `<section class="admin-section-slab"><h1>${targetUid ? 'Product Access' : 'License Keys'}</h1>${targetUid ? `<p>User: ${esc(targetUid)}</p>` : `<div class="admin-row-actions">${button('generate', '+ Generate Keys', products.length ? '' : 'disabled')}${button('product', '+ Product')}</div><label class="admin-licensing-filter">Filter loaded keys<select data-license-filter><option value="">All products</option>${products.map(p => `<option value="${esc(p.productId)}" ${p.productId === currentFilter ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label><p>${products.length ? '' : 'Create the Origami product with its beta edition using + Product before generating keys. '}Revoking a key prevents future redemption. Existing ownership is revoked separately in Users → Manage Products.</p><div>${products.map(p => button('edit-product', `${esc(p.name)} · ${esc(p.status)} · Manage`, `data-id="${esc(p.productId)}"`)).join('')}</div>`}<p role="alert">${esc(error)}</p><div class="admin-licensing-table"><table class="admin-table"><thead><tr>${(targetUid ? ['Product', 'Edition', 'Status', 'Provenance', 'Actions'] : ['Key', 'Product', 'Edition', 'Status', 'Created / Campaign', 'Actions']).map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows || '<tr><td>No records yet.</td></tr>'}</tbody></table></div>${!targetUid && cursor ? button('more', 'Load More') : ''}${button('refresh', 'Refresh')}</section>`
    root.querySelector('[data-license-filter]')?.addEventListener('change', e => { currentFilter = e.target.value; render() })
    root.querySelectorAll('[data-license-action]').forEach(b => { b.onclick = () => {
      const action = b.dataset.licenseAction, id = b.dataset.id
      if (action === 'generate') generate()
      if (action === 'product') productDialog()
      if (action === 'edit-product') productDialog(products.find(p => p.productId === id))
      if (action === 'grant' || action === 'revoke-access') accessDialog(id, action === 'revoke-access')
      if (action === 'refresh' || action === 'more') refresh(action === 'more')
      if (action === 'revoke-key') {
        const form = modal('Revoke license key?', `<p>Future redemptions will be blocked. Existing entitlements remain unchanged.</p>${field('reason', 'Reason', 'text', '', 'required')}`)
        form.onsubmit = e => { e.preventDefault(); submit(form, 'revokeLicenseKey', { managementId: id, reason: form.elements.reason.value }, () => refresh()) }
      }
    } })
  }
  render()
  const ready = allowed ? refresh() : Promise.resolve()
  return { ready, dispose() { disposed = true; closeDialog(); root.innerHTML = '' } }
}
