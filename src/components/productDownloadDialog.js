export function formatDownloadSize(bytes = 0) {
  const value = Math.max(0, Number(bytes || 0))
  if (!value) return 'size unavailable'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const amount = value / (1024 ** index)
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`
}

export function productDownloadDialogMarkup(dialog = {}) {
  if (!dialog.open) return ''
  return `
    <div class="product-download-modal-backdrop" data-close-product-download role="presentation">
      <section class="product-download-modal" role="dialog" aria-modal="true" aria-labelledby="product-download-title">
        <h2 id="product-download-title">Download Content</h2>
        <p>Are you sure you want to download <strong>${escapeHtml(dialog.title || 'this product')}</strong>? The file size is ${escapeHtml(formatDownloadSize(dialog.sizeBytes))}.</p>
        ${dialog.error ? `<p class="product-download-error">${escapeHtml(dialog.error)}</p>` : ''}
        <div class="product-download-modal-actions">
          <button type="button" class="button button-muted" data-close-product-download ${dialog.loading ? 'disabled' : ''}>Cancel</button>
          <button type="button" class="button button-accent" data-confirm-product-download ${dialog.loading ? 'disabled' : ''}>${dialog.loading ? 'Preparing...' : 'Download'}</button>
        </div>
      </section>
    </div>
  `
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function clickDownload(url = '', fileName = '') {
  if (!url) return
  const link = document.createElement('a')
  link.href = url
  if (fileName) link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function beginProductDownloads(result = {}) {
  const license = result.licenseFile || {}
  if (license.content) {
    const blob = new Blob([license.content], { type: license.contentType || 'text/markdown;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    clickDownload(objectUrl, license.fileName || 'MELOGIC_LICENSE_AND_OVERVIEW.md')
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000)
  }
  const files = Array.isArray(result.files) && result.files.length
    ? result.files
    : result.downloadUrl
      ? [{ downloadUrl: result.downloadUrl, fileName: result.fileName || '' }]
      : []
  files.forEach((file, index) => {
    window.setTimeout(() => clickDownload(file.downloadUrl, file.fileName), index * 180)
  })
}
