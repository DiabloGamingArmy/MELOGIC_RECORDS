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
  const packageSummary = dialog.fileCount
    ? `Packaging ${Number(dialog.fileCount)} ${Number(dialog.fileCount) === 1 ? 'file' : 'files'} · ${formatDownloadSize(dialog.sizeBytes)}`
    : `Package size: ${formatDownloadSize(dialog.sizeBytes)}`
  const contentsSummary = dialog.fileCount
    ? `${Number(dialog.fileCount)} ${Number(dialog.fileCount) === 1 ? 'file' : 'files'} · ${formatDownloadSize(dialog.sizeBytes)}`
    : formatDownloadSize(dialog.sizeBytes)
  const heading = dialog.loading
    ? 'Preparing secure ZIP...'
    : dialog.ready
      ? 'Download ready.'
      : 'Download Content'
  return `
    <div class="product-download-modal-backdrop" data-close-product-download role="presentation">
      <section class="product-download-modal" role="dialog" aria-modal="true" aria-labelledby="product-download-title">
        <h2 id="product-download-title">${heading}</h2>
        ${dialog.loading ? `
          <p>${escapeHtml(packageSummary)}</p>
          <div class="product-download-progress" role="progressbar" aria-label="Preparing secure ZIP"><span></span></div>
          <p class="product-download-note">This may take a moment for larger products.</p>
        ` : dialog.ready ? `
          <p><strong>${escapeHtml(dialog.title || 'Your product')}</strong> is downloading as one secure ZIP.</p>
        ` : `
          <p>Download <strong>${escapeHtml(dialog.title || 'this product')}</strong> as one secure ZIP containing ${escapeHtml(contentsSummary)} and the Melogic license overview.</p>
        `}
        ${dialog.error ? `<p class="product-download-error">${escapeHtml(dialog.error)}</p>` : ''}
        <div class="product-download-modal-actions">
          <button type="button" class="button button-muted" data-close-product-download ${dialog.loading ? 'disabled' : ''}>${dialog.ready ? 'Close' : 'Cancel'}</button>
          ${dialog.ready ? '' : `<button type="button" class="button button-accent" data-confirm-product-download ${dialog.loading ? 'disabled' : ''}>${dialog.loading ? 'Preparing ZIP...' : 'Download ZIP'}</button>`}
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
  const downloadUrl = String(result.downloadUrl || result.packageUrl || '')
  if (!downloadUrl) return false
  clickDownload(downloadUrl, result.fileName || 'melogic-product-download.zip')
  return true
}
