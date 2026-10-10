import { iconSvg } from '../utils/icons.js'
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function adminPageHeader({ eyebrow = 'Admin', title = '', description = '', refreshLabel = 'Refresh', actions = '' } = {}) {
  return `
    <header class="admin-page-header">
      <div>
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(title)}</h1>
        ${description ? `<p>${escapeHtml(description)}</p>` : ''}
      </div>
      ${actions || `<button type="button" class="admin-icon-button" data-refresh-admin-section title="${escapeHtml(refreshLabel)}">${iconSvg('barChart')}</button>`}
    </header>
  `
}


export function adminSimpleTable(label = 'Rows', headers = [], rows = [], options = {}) {
  return `
    <div class="admin-data-table ${escapeHtml(options.className || '')}" role="table" aria-label="${escapeHtml(label)}">
      <div class="admin-data-row is-header" role="row">
        ${headers.map((header) => `<span role="columnheader">${escapeHtml(header)}</span>`).join('')}
      </div>
      ${rows.length ? rows.map((row) => `
        <article class="admin-data-row" role="row">
          ${row.map((cell) => `<span role="cell">${cell?.html ? cell.html : escapeHtml(cell)}</span>`).join('')}
        </article>
      `).join('') : `
        <article class="admin-empty-state admin-table-empty">
          <strong>${escapeHtml(options.emptyTitle || `No ${label.toLowerCase()} found.`)}</strong>
          <span>${escapeHtml(options.emptyBody || 'Rows will appear here when data is available.')}</span>
        </article>
      `}
    </div>
  `
}

export function htmlCell(html = '') {
  return { html }
}


export function renderBadge(value, tone = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  return `<span class="review-badge ${tone ? `is-${escapeHtml(tone)}` : ''}">${escapeHtml(text)}</span>`
}

