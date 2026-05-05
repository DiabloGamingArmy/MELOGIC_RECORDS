import './styles/base.css'
import './styles/productDashboard.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { addToCart } from './data/cartService'
import { getProductById, listProductFiles, listRecommendedProducts } from './data/productService'
import { userOwnsProduct } from './data/entitlementService'
import { getUserProductEngagementState, setProductReaction, setProductSaved } from './data/productEngagementService'
import { createProductReview, listProductReviews } from './data/productReviewService'
import { waitForInitialAuthState } from './firebase/auth'
import { ROUTES, productRoute, publicProfileRoute } from './utils/routes'
import { renderSafeRichDescription } from './utils/richDescription'
import { iconSvg } from './utils/icons'

const app = document.querySelector('#app')



const state = {
  mediaItems: [],
  selectedMediaIndex: 0,
  currentUser: null,
  isDraftPreview: false,
  interaction: { reaction: null, saved: false },
  engagementCounts: { likeCount: 0, dislikeCount: 0, saveCount: 0 },
  engagementProductId: '',
  reviews: [],
  fileBrowserProductId: '',
  fileBrowserPath: '',
  fileBrowserMessage: ''
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-')
}

function parseProductIdFromLocation() {
  const pathname = String(window.location.pathname || '')
  const params = new URLSearchParams(window.location.search)

  if (pathname.startsWith('/products/')) {
    const rawSegment = pathname.slice('/products/'.length).split('/')[0]
    const decodedSegment = decodeURIComponent(rawSegment || '').trim()
    if (decodedSegment) {
      const markerIndex = decodedSegment.lastIndexOf('--')
      if (markerIndex >= 0) {
        const extracted = decodedSegment.slice(markerIndex + 2).trim()
        if (extracted) return extracted
      }
      return decodedSegment
    }
  }

  return String(params.get('id') || '').trim()
}

function formatReleaseDate(value) {
  const stamp = new Date(value || 0)
  if (Number.isNaN(stamp.getTime())) return 'Unreleased'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(stamp)
}

function buildMediaItems(product) {
  const leadImage = [product.coverURL, product.thumbnailURL].find(Boolean) || ''
  const media = [
    ...(leadImage ? [{ type: 'image', url: leadImage, label: `${product.title} cover` }] : []),
    ...(product.galleryURLs || []).map((url, index) => ({ type: 'image', url, label: `${product.title} gallery ${index + 1}` })),
    ...(product.previewVideoURLs || []).map((url, index) => ({ type: 'video', url, label: `${product.title} video ${index + 1}` }))
  ]

  const seen = new Set()
  return media.filter((item) => {
    const key = `${item.type}:${item.url}`
    if (!item.url || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function renderMainMedia() {
  const mainMediaRoot = app.querySelector('[data-dashboard-main-media]')
  if (!mainMediaRoot) return

  const selected = state.mediaItems[state.selectedMediaIndex]
  if (!selected) {
    mainMediaRoot.innerHTML = `
      <div class="dashboard-media-fallback">
        <p class="eyebrow">Melogic Visual</p>
        <h3>No media uploaded yet</h3>
        <p>Creators can add cover art, gallery images, and preview videos.</p>
      </div>
    `
    return
  }

  mainMediaRoot.innerHTML = selected.type === 'video'
    ? `<video src="${escapeHtml(selected.url)}" controls preload="metadata" aria-label="${escapeHtml(selected.label)}"></video>`
    : `<img src="${escapeHtml(selected.url)}" alt="${escapeHtml(selected.label)}" loading="eager" />`



  const ratingSlider = app.querySelector('[data-rating-slider]')
  const ratingFill = app.querySelector('[data-rating-fill]')
  const ratingValue = app.querySelector('[data-rating-value]')
  ratingSlider?.addEventListener('input', () => {
    const val = Number(ratingSlider.value || 0)
    if (ratingFill) ratingFill.style.width = `${Math.max(0, Math.min(100, (val / 5) * 100))}%`
    if (ratingValue) ratingValue.textContent = `${val % 1 ? val.toFixed(1) : val.toFixed(0)} / 5`
  })
  app.querySelectorAll('[data-media-index]').forEach((button) => {
    const index = Number(button.getAttribute('data-media-index'))
    button.classList.toggle('is-active', index === state.selectedMediaIndex)
    button.setAttribute('aria-pressed', String(index === state.selectedMediaIndex))
  })
}

function renderState(title, body) {
  document.title = 'Melogic | Product'
  app.innerHTML = `
    ${navShell({ currentPage: 'products' })}
    <main>
      <section class="section product-dashboard-shell">
        <div class="section-inner product-dashboard-empty">
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(body)}</p>
          <a class="button button-muted" href="${ROUTES.products}">Back to Products</a>
        </div>
      </section>
    </main>
  `
  initShellChrome()
}

function renderSkeleton() {
  app.innerHTML = `
    ${navShell({ currentPage: 'products' })}
    <main>
      <section class="section product-dashboard-shell">
        <div class="section-inner product-dashboard-layout">
          <div class="dashboard-skeleton dashboard-skeleton-media"></div>
          <div class="dashboard-skeleton dashboard-skeleton-overview"></div>
          <div class="dashboard-skeleton dashboard-skeleton-content"></div>
          <div class="dashboard-skeleton dashboard-skeleton-sidebar"></div>
        </div>
      </section>
    </main>
  `
  initShellChrome()
}

function recommendationCardMarkup(product) {
  const art = product.thumbnailURL || product.coverURL
  const badge = product.genres?.[0] || product.productType || 'Product'
  return `
    <a class="dashboard-recommend-card" href="${productRoute(product)}" aria-label="Open ${escapeHtml(product.title)}">
      <div class="dashboard-recommend-thumb">
        ${art
          ? `<img src="${escapeHtml(art)}" alt="${escapeHtml(product.title)} cover" loading="lazy" />`
          : '<div class="dashboard-recommend-fallback" aria-hidden="true"></div>'}
      </div>
      <div class="dashboard-recommend-body">
        <h4>${escapeHtml(product.title)}</h4>
        <p class="dashboard-recommend-creator">${escapeHtml(product.artistName)}</p>
        <div class="dashboard-recommend-meta">
          <span>${escapeHtml(product.priceLabel || (product.isFree ? 'Free' : '—'))}</span>
          <span>${escapeHtml(badge)}</span>
        </div>
      </div>
    </a>
  `
}


function formatReviewTime(value) {
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value || 0)
  if (Number.isNaN(date.getTime())) return 'Just now'
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function reviewInitials(name) {
  return creatorInitials(name || 'User')
}


function getLikeRatio(likes = 0, dislikes = 0) {
  const safeLikes = Math.max(0, Number(likes || 0))
  const safeDislikes = Math.max(0, Number(dislikes || 0))
  const total = safeLikes + safeDislikes
  if (!total) return { likePercent: 50, dislikePercent: 50, total: 0 }
  return { likePercent: Math.round((safeLikes / total) * 100), dislikePercent: Math.round((safeDislikes / total) * 100), total }
}

function formatAudioTime(seconds) {
  const total = Math.max(0, Number(seconds || 0))
  const mins = Math.floor(total / 60)
  const secs = Math.floor(total % 60)
  return `${mins}:${String(secs).padStart(2, '0')}`
}

function renderRatingStars(value = 0) {
  const width = Math.max(0, Math.min(100, (Number(value || 0) / 5) * 100))
  return `<span class="dashboard-rating-stars" aria-hidden="true"><span class="dashboard-rating-stars-empty">★★★★★</span><span class="dashboard-rating-stars-fill" style="width:${width}%">★★★★★</span></span>`
}
function creatorInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'CR'
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('')
}



function formatBytes(size = 0) {
  const bytes = Math.max(0, Number(size || 0))
  if (!bytes) return '0 KB'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / (1024 ** index)
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

function normalizePackagePath(value = '') {
  const raw = String(value || '').trim()
  if (!raw || /^https?:\/\//i.test(raw)) return ''
  const cleaned = raw.split('?')[0].replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
  const marker = cleaned.match(/(?:deliverables|downloads|packages|package)\/(.+)$/i)
  return (marker?.[1] || cleaned).split('/').filter(Boolean).join('/')
}

function getFilePathCandidates(file = {}) {
  return [file.displayPath, file.path, file.storagePath, file.fullPath, file.name].map(normalizePackagePath).filter(Boolean)
}

function pathMatchesAny(candidate, knownPaths) {
  return knownPaths.some((known) => candidate === known || candidate.endsWith(`/${known}`) || known.endsWith(`/${candidate}`))
}

function getKnownListingMediaPaths(product = {}) {
  return [product.coverPath, product.thumbnailPath, product.primaryPreviewPath, product.previewAssignment?.hoverAudioPath, product.previewAssignment?.hoverVideoPath, ...(product.galleryPaths || []), ...(product.previewAudioPaths || []), ...(product.previewVideoPaths || [])].map(normalizePackagePath).filter(Boolean)
}

function getProductViewerDeliverableFiles(product = {}, productFiles = []) {
  const mergedFiles = [...(Array.isArray(productFiles) ? productFiles : []), ...(Array.isArray(product?.deliverableFiles) ? product.deliverableFiles : [])]
  const seen = new Set()
  const knownListingPaths = getKnownListingMediaPaths(product)
  const downloadPaths = [product.downloadPath, product.primaryDownloadPath].map(normalizePackagePath).filter(Boolean)
  return Array.from(mergedFiles || []).filter((file) => {
    const key = String(file.id || file.storagePath || file.displayPath || file.path || file.name || '')
    if (key && seen.has(key)) return false
    if (key) seen.add(key)
    const candidates = getFilePathCandidates(file)
    const roleText = [file.role, file.category, file.type, file.kind, file.contentType, file.purpose].join(' ').toLowerCase()
    const explicitDeliverable = file.isDeliverable === true || /\b(deliverable|deliverables|package|download)\b/.test(roleText)
    const explicitListingMedia = file.isPublicPreview === true || /preview|cover|thumbnail|gallery|listing media|public preview|hover/.test(roleText)
    if (candidates.some((candidate) => pathMatchesAny(candidate, knownListingPaths)) && !explicitDeliverable) return false
    if (explicitListingMedia && !explicitDeliverable) return false
    if (file.isDownloadable === false && !explicitDeliverable) return false
    if (explicitDeliverable && file.isDownloadable !== false) return true
    if (candidates.some((candidate) => pathMatchesAny(candidate, downloadPaths))) return true
    return explicitDeliverable && candidates.length > 0
  })
}

function getViewerFilePath(file = {}) {
  return getFilePathCandidates(file)[0] || normalizePackagePath(file.name) || 'Unnamed file'
}

function getFileExtension(path = '') {
  const name = String(path || '').split('/').pop() || ''
  const dotIndex = name.lastIndexOf('.')
  return dotIndex > -1 ? name.slice(dotIndex + 1).toLowerCase() : ''
}

function inferFileDescription(file = {}, name = '') {
  const explicit = file.description || file.note || file.summary || file.kind || file.contentType
  if (explicit) return String(explicit)
  const ext = getFileExtension(name)
  if (['wav', 'aiff', 'aif', 'mp3', 'flac', 'ogg'].includes(ext)) return 'Audio file'
  if (['mid', 'midi'].includes(ext)) return 'MIDI file'
  if (['fxp', 'fxb', 'vital', 'serum', 'nmsv', 'adg'].includes(ext)) return 'Preset file'
  if (['zip', 'rar', '7z'].includes(ext)) return 'Product archive'
  if (['txt', 'md', 'pdf', 'rtf'].includes(ext)) return 'Documentation'
  return 'Product file'
}

function iconForFile(name = '') {
  const ext = getFileExtension(name)
  if (['wav', 'aiff', 'aif', 'mp3', 'flac', 'ogg', 'mid', 'midi'].includes(ext)) return 'music'
  if (['zip', 'rar', '7z'].includes(ext)) return 'package'
  if (['txt', 'md', 'pdf', 'rtf'].includes(ext)) return 'fileText'
  return 'file'
}

function createFileTree(files = []) {
  const root = { name: '', path: '', folders: new Map(), files: [] }
  files.forEach((file) => {
    const path = getViewerFilePath(file)
    const segments = path.split('/').filter(Boolean)
    if (!segments.length) return
    let current = root
    segments.slice(0, -1).forEach((segment) => {
      const nextPath = [current.path, segment].filter(Boolean).join('/')
      if (!current.folders.has(segment)) current.folders.set(segment, { name: segment, path: nextPath, folders: new Map(), files: [] })
      current = current.folders.get(segment)
    })
    current.files.push({ ...file, viewerName: segments.at(-1), viewerPath: path })
  })
  return root
}

function summarizeTreeNode(node) {
  let fileCount = node.files.length
  let folderCount = node.folders.size
  let sizeBytes = node.files.reduce((sum, file) => sum + Number(file.sizeBytes || file.size || 0), 0)
  node.folders.forEach((folder) => {
    const summary = summarizeTreeNode(folder)
    fileCount += summary.fileCount
    folderCount += summary.folderCount
    sizeBytes += summary.sizeBytes
  })
  return { fileCount, folderCount, sizeBytes }
}

function getTreeNode(root, path = '') {
  return normalizePackagePath(path).split('/').filter(Boolean).reduce((node, segment) => node?.folders.get(segment), root) || null
}

function renderProductFileBrowser(product, productFiles, ownsProduct) {
  const deliverableFiles = getProductViewerDeliverableFiles(product, productFiles)
  const root = createFileTree(deliverableFiles)
  let currentPath = normalizePackagePath(state.fileBrowserPath)
  let currentNode = getTreeNode(root, currentPath)
  if (!currentNode) {
    currentPath = ''
    state.fileBrowserPath = ''
    currentNode = root
  }
  const rootSummary = summarizeTreeNode(root)
  const currentSummary = summarizeTreeNode(currentNode)
  const segments = currentPath.split('/').filter(Boolean)
  const crumbs = [`<button type="button" data-file-browser-path="" aria-label="Open package root"><span class="product-file-crumb-icon">${iconSvg('home')}</span>Root</button>`, ...segments.map((segment, index) => {
    const path = segments.slice(0, index + 1).join('/')
    return `<span class="product-file-crumb-separator">${iconSvg('chevronRight')}</span><button type="button" data-file-browser-path="${escapeHtml(path)}">${escapeHtml(segment)}</button>`
  })].join('')
  const parentPath = segments.slice(0, -1).join('/')
  const currentFolderName = segments.at(-1) || 'Root'
  const backRow = currentPath ? `<button type="button" class="product-file-row is-folder is-back-row" role="treeitem" data-file-browser-path="${escapeHtml(parentPath)}"><span class="product-file-icon">${iconSvg('arrowLeft')}</span><span class="product-file-name">Back</span><span class="product-file-current-folder">${escapeHtml(currentFolderName)}</span><span class="product-file-meta">..</span></button>` : ''
  const folderRows = Array.from(currentNode.folders.values()).sort((a, b) => a.name.localeCompare(b.name)).map((folder) => {
    const summary = summarizeTreeNode(folder)
    return `<button type="button" class="product-file-row is-folder" role="treeitem" data-file-browser-path="${escapeHtml(folder.path)}"><span class="product-file-icon">${iconSvg('folder')}</span><span class="product-file-name">${escapeHtml(folder.name)}</span><span class="product-file-description">Folder · ${summary.fileCount} files · ${summary.folderCount} folders</span><span class="product-file-meta">${formatBytes(summary.sizeBytes)}</span></button>`
  }).join('')
  const fileRows = currentNode.files.slice().sort((a, b) => a.viewerName.localeCompare(b.viewerName)).map((file) => {
    const description = inferFileDescription(file, file.viewerName)
    const status = ownsProduct ? 'Included in download' : 'Locked manifest'
    return `<button type="button" class="product-file-row is-file" role="treeitem" data-file-browser-file="${escapeHtml(file.viewerPath)}"><span class="product-file-icon">${iconSvg(iconForFile(file.viewerName))}</span><span class="product-file-name">${escapeHtml(file.viewerName)}</span><span class="product-file-description">${escapeHtml(description)}</span><span class="product-file-meta"><span class="product-file-status">${iconSvg(ownsProduct ? 'package' : 'lock')} ${escapeHtml(status)}</span><span>${formatBytes(file.sizeBytes || file.size || 0)}</span></span></button>`
  }).join('')
  const rows = `${backRow}${folderRows}${fileRows}` || '<div class="product-file-empty">No included files listed yet.</div>'
  return `<div class="product-file-browser" data-file-browser-root><div class="product-file-browser-header"><div><h2>File Viewer</h2><p>Product package manifest. File contents stay locked.</p></div><div class="product-file-browser-summary">${rootSummary.fileCount} files · ${rootSummary.folderCount} folders · ${formatBytes(rootSummary.sizeBytes)}</div></div><div class="product-file-browser-divider"></div><div class="product-file-browser-body"><div class="product-file-breadcrumbs" aria-label="File browser breadcrumbs">${crumbs}</div><div class="product-file-list-wrap"><div class="product-file-message ${state.fileBrowserMessage ? 'is-visible' : ''}" data-file-browser-message>${escapeHtml(state.fileBrowserMessage)}</div><div class="product-file-list" role="tree" aria-label="Product package files">${rows}</div></div></div><p class="product-file-footer">Viewing ${escapeHtml(currentPath || 'Root')} · ${currentSummary.fileCount} files · ${currentSummary.folderCount} folders</p></div>`
}

function bindProductFileBrowser(product, productFiles, ownsProduct) {
  const root = app.querySelector('[data-file-browser-root]')
  if (!root) return
  const renderIntoRoot = () => {
    const next = document.createElement('div')
    next.innerHTML = renderProductFileBrowser(product, productFiles, ownsProduct).trim()
    root.replaceWith(next.firstElementChild)
    bindProductFileBrowser(product, productFiles, ownsProduct)
  }
  root.addEventListener('click', (event) => {
    const pathButton = event.target.closest('[data-file-browser-path]')
    if (pathButton) {
      event.preventDefault()
      state.fileBrowserPath = pathButton.getAttribute('data-file-browser-path') || ''
      state.fileBrowserMessage = ''
      renderIntoRoot()
      return
    }
    const fileButton = event.target.closest('[data-file-browser-file]')
    if (fileButton) {
      event.preventDefault()
      state.fileBrowserMessage = 'File contents are available after checkout/download. This viewer only shows the package manifest.'
      renderIntoRoot()
    }
  })
}

function renderAudioPlayIcon(isPlaying) { return isPlaying ? iconSvg('pause') : iconSvg('play') }
function syncAudioUi(audio, index) {
  const range = app.querySelector(`[data-audio-range][data-audio-index="${index}"]`)
  const time = app.querySelector(`[data-audio-time][data-audio-index="${index}"]`)
  const btn = app.querySelector(`[data-audio-play][data-audio-index="${index}"]`)
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0
  if (range) range.value = String(duration ? Math.round((audio.currentTime / duration) * 1000) : 0)
  if (time) time.textContent = `${formatAudioTime(audio.currentTime)} / ${formatAudioTime(duration)}`
  if (btn) { btn.classList.toggle('is-playing', !audio.paused); btn.setAttribute('aria-pressed', String(!audio.paused)); btn.setAttribute('aria-label', `${audio.paused ? 'Play' : 'Pause'} audio preview ${index + 1}`); const icon = btn.querySelector('[data-audio-icon]'); if (icon) icon.innerHTML = renderAudioPlayIcon(!audio.paused) }
}
function bindAudioPreviewControls() {
  const audios = Array.from(app.querySelectorAll('audio[data-dashboard-audio]'))
  audios.forEach((audio) => { const index = Number(audio.getAttribute('data-dashboard-audio') || -1); if (!String(audio.getAttribute('src') || '').trim()) console.warn('[product] audio preview URL missing', { index }); audio.addEventListener('loadedmetadata', () => syncAudioUi(audio, index)); audio.addEventListener('timeupdate', () => syncAudioUi(audio, index)); audio.addEventListener('ended', () => syncAudioUi(audio, index)) })
  app.querySelectorAll('[data-audio-play]').forEach((button) => button.addEventListener('click', async (event) => { event.preventDefault(); event.stopPropagation(); const index = Number(button.getAttribute('data-audio-index') || -1); const audio = app.querySelector(`audio[data-dashboard-audio="${index}"]`); if (!(audio instanceof HTMLAudioElement)) { console.warn('[product] audio element not found for preview', { index }); return } audios.forEach((other) => { if (other !== audio) { other.pause(); syncAudioUi(other, Number(other.getAttribute('data-dashboard-audio') || -1)) } }); if (audio.paused) { try { await audio.play() } catch (error) { console.warn('[product] audio preview playback failed', { index, src: audio.currentSrc || audio.src || '', message: error?.message }); return } } else audio.pause(); syncAudioUi(audio, index) }))
  app.querySelectorAll('[data-audio-range]').forEach((range) => range.addEventListener('input', () => { const index = Number(range.getAttribute('data-audio-index') || -1); const audio = app.querySelector(`audio[data-dashboard-audio="${index}"]`); if (!(audio instanceof HTMLAudioElement) || !Number.isFinite(audio.duration) || !audio.duration) return; audio.currentTime = (Number(range.value || 0) / 1000) * audio.duration; syncAudioUi(audio, index) }))
}

function renderProduct(product, recommendations = [], ownerPreview = false, productFiles = [], ownsProduct = false) {
  const mediaItems = buildMediaItems(product)
  state.mediaItems = mediaItems
  state.selectedMediaIndex = 0

  const listingThumbnailURL = product.thumbnailURL || product.coverURL || ''
  const typeLabel = product.productType || 'Product'
  const creatorHref = product.artistId ? publicProfileRoute({ uid: product.artistId }) : ROUTES.profilePublic
  if (state.engagementProductId !== product.id) {
    state.engagementCounts = {
      likeCount: Number(product.likeCount ?? product.counts?.likes ?? 0),
      dislikeCount: Number(product.dislikeCount ?? product.counts?.dislikes ?? 0),
      saveCount: Number(product.saveCount ?? product.counts?.saves ?? 0)
    }
    state.engagementProductId = product.id
  }
  if (state.fileBrowserProductId !== product.id) {
    state.fileBrowserProductId = product.id
    state.fileBrowserPath = ''
    state.fileBrowserMessage = ''
  }
  const likeCount = state.engagementCounts.likeCount
  const dislikeCount = state.engagementCounts.dislikeCount
  const artistDisplayName = product.artistDisplayName || product.artistName || 'Creator'
  const handleRaw = product.artistUsername || product.creatorUsername || product.username || product.artistHandle || product.creator?.username || product.artist?.username || ''
  const artistHandle = String(handleRaw || '').trim() ? `@${String(handleRaw).replace(/^@+/, '')}` : ''
  const creatorAvatar = product.artistAvatarURL || product.artistPhotoURL || ''
  const isOwner = Boolean(state.currentUser?.uid && product.artistId === state.currentUser.uid)

  const thumbMarkup = mediaItems.map((item, index) => `
    <button type="button" class="dashboard-thumb" data-media-index="${index}" aria-label="Show media ${index + 1}" aria-pressed="${index === 0 ? 'true' : 'false'}">
      ${item.type === 'video'
        ? '<span class="dashboard-thumb-video">Video preview</span>'
        : `<img src="${escapeHtml(item.url)}" alt="" loading="lazy" />`}
    </button>
  `).join('')

  const tags = (product.tags || []).slice(0, 12)
  app.innerHTML = `
    ${navShell({ currentPage: 'products' })}
    <main>
      ${state.isDraftPreview ? '<section class=\"section\"><div class=\"section-inner\"><article class=\"panel-surface draft-preview-banner\">Marketplace Preview — actions are disabled.</article></div></section>' : ''}
      <section class="section product-dashboard-shell">
        <div class="section-inner product-dashboard-layout">
          <section class="dashboard-media-area panel-surface" aria-label="Product media gallery">
            ${isOwner ? `
              <article class="dashboard-owner-header-card">
                <p class="eyebrow">Your listing</p>
                <h3>${ownerPreview ? 'Private owner preview' : 'Manage this product'}</h3>
                <p>Status: ${escapeHtml(product.status || 'draft')} · Visibility: ${escapeHtml(product.visibility || 'private')}</p>
                <p>Created: ${escapeHtml(formatReleaseDate(product.createdAt))} · Updated: ${escapeHtml(formatReleaseDate(product.updatedAt || product.createdAt))}</p>
                <p>Moderation: ${escapeHtml(product.moderationStatus || 'pending')}</p>
                <a class="button button-muted" href="${ROUTES.newProduct}?id=${encodeURIComponent(product.id)}">Edit listing</a>
              </article>
            ` : ''}
            <div class="dashboard-main-media" data-dashboard-main-media></div>
            ${thumbMarkup ? `
              <div class="dashboard-thumb-toolbar">
                <button type="button" class="dashboard-nav-btn" data-media-prev aria-label="Previous media">◀</button>
                <div class="dashboard-thumb-row">${thumbMarkup}</div>
                <button type="button" class="dashboard-nav-btn" data-media-next aria-label="Next media">${iconSvg('play')}</button>
              </div>
            ` : ''}
            ${(product.previewAudioURLs || []).length ? `
              <section class="dashboard-audio-panel">
                <h3>Audio previews</h3>
                <div class="dashboard-audio-row" data-dashboard-audio-row>
                  ${product.previewAudioURLs.map((url, index) => `<div class="dashboard-audio-card" data-audio-card><button type="button" class="dashboard-audio-play" data-audio-play data-audio-index="${index}" aria-label="Play audio preview ${index + 1}" aria-pressed="false"><span data-audio-icon aria-hidden="true">${renderAudioPlayIcon(false)}</span></button><div class="dashboard-audio-meta"><p>Audio preview ${index + 1}</p><span data-audio-time data-audio-index="${index}">0:00 / 0:00</span><input class="dashboard-audio-range" type="range" min="0" max="1000" value="0" data-audio-range data-audio-index="${index}" aria-label="Audio preview ${index + 1} progress"></div><audio src="${escapeHtml(url)}" preload="metadata" data-dashboard-audio="${index}"></audio></div>`).join('')}
                </div>
              </section>
            ` : ''}
          </section>

          <section class="dashboard-main-sections panel-surface">
            <div class="dashboard-content-parent">
              <article class="dashboard-section-card dashboard-about-section">
                <h2>About this product</h2>
                <div class="dashboard-rich-description">${renderSafeRichDescription(product.description || product.shortDescription || '')}</div>
              </article>

              <div class="dashboard-details-split">
                <article class="dashboard-section-card dashboard-file-tree-viewer">
                  ${renderProductFileBrowser(product, productFiles, ownsProduct)}
                </article>

                <aside class="dashboard-metadata-panel">
                  <div class="dashboard-metadata-stack">
                    <article class="dashboard-section-card dashboard-metadata-card">
                      <h2>Compatibility</h2>
                      <p>${escapeHtml((product.dawCompatibility || []).join(', ') || (product.formatKeys || []).join(', ') || 'Compatibility details are based on creator-provided metadata.')}</p>
                    </article>
                    <article class="dashboard-section-card dashboard-metadata-card"><h2>License / Usage</h2><p>${product.licensePath ? 'License included.' : 'License details were not uploaded yet.'}</p></article>
                    <article class="dashboard-section-card dashboard-metadata-card"><h2>Creator Notes</h2><p>${escapeHtml(product.shortDescription || 'Creator notes will appear here when provided.')}</p></article>
                    <article class="dashboard-section-card dashboard-metadata-card"><h2>Tags</h2><div class="dashboard-tag-row">${tags.length ? tags.map((tag) => `<span class="dashboard-pill">${escapeHtml(tag)}</span>`).join('') : '<span class="dashboard-pill">No tags yet</span>'}</div></article>
                    <article class="dashboard-section-card dashboard-metadata-card"><h2>Stats</h2><p>${likeCount} likes · ${dislikeCount} dislikes · Saves ${state.engagementCounts.saveCount} · Downloads ${product.downloadCount ?? product.counts?.downloads ?? 0}</p></article>
                  </div>
                </aside>
              </div>

              <article class="dashboard-section-card dashboard-reviews-section">
                <h2>Reviews (${product.reviewCount ?? product.commentCount ?? state.reviews.length})</h2>
                <p class="dashboard-review-rating">${product.averageRating ? `Average rating ${Number(product.averageRating).toFixed(1)} / 5` : 'No ratings yet.'}</p>
                ${state.currentUser?.uid ? `<form class="dashboard-review-composer" data-review-form><label for="review-body">Write a review</label><div class="dashboard-rating-control" data-rating-control><div>${renderRatingStars(0).replace('style="width:0%"','data-rating-fill style="width:0%"')}</div><input type="range" name="rating" min="0" max="5" step="0.5" value="0" class="dashboard-rating-slider" data-rating-slider aria-label="Rating out of 5 stars" /><span class="dashboard-rating-value" data-rating-value>0 / 5</span></div><textarea id="review-body" name="body" maxlength="5000" placeholder="Share your thoughts about this product..."></textarea><button class="button button-accent" type="submit">Submit review</button></form>` : '<p class="dashboard-mini-note">Sign in to review this product.</p>'}
                <div class="dashboard-review-list">${state.reviews.length ? state.reviews.map((review) => `<article class="dashboard-review-card"><div class="dashboard-creator-block">${review.avatarURL ? `<img class="dashboard-creator-avatar" src="${escapeHtml(review.avatarURL)}" alt="${escapeHtml(review.displayName || 'User')} avatar" loading="lazy" />` : `<span class="dashboard-creator-avatar-fallback">${escapeHtml(reviewInitials(review.displayName || 'User'))}</span>`}<div><p class="dashboard-creator-name">${escapeHtml(review.displayName || 'User')}</p><p class="dashboard-mini-note">${escapeHtml(formatReviewTime(review.createdAt))}</p></div></div><p class="dashboard-review-rating">${review.rating ? `${renderRatingStars(review.rating)} <span>${Number(review.rating).toFixed(review.rating % 1 ? 1 : 0)} / 5</span>` : 'No star rating'}</p><p>${escapeHtml(review.body || '')}</p></article>`).join('') : '<p class="dashboard-review-empty">No reviews yet. Be the first to review this product.</p>'}</div>
              </article>

              <article class="dashboard-section-card dashboard-recommendations-section">
                <div class="dashboard-section-heading-row"><h2>Recommended products</h2><a href="${ROUTES.products}">Browse all</a></div>
                ${recommendations.length ? `<div class="dashboard-recommend-carousel" aria-label="Recommended products">${recommendations.map((item) => recommendationCardMarkup(item)).join('')}</div>` : '<p>No recommendations yet.</p>'}
              </article>
            </div>
          </section>

          <aside class="dashboard-lower-sidebar">
            <article class="panel-surface dashboard-overview">
              <p class="dashboard-breadcrumbs"><a href="${ROUTES.products}">Products</a> <span>&gt;</span> <span>${escapeHtml((product.categories || [])[0] || 'Catalog')}</span> <span>&gt;</span> <span>${escapeHtml(typeLabel)}</span></p>
              ${listingThumbnailURL ? `<img class="dashboard-cover-banner" src="${escapeHtml(listingThumbnailURL)}" alt="${escapeHtml(product.title)} cover" loading="lazy" />` : ''}
              <h2>${escapeHtml(product.title)}</h2>
              <p class="dashboard-short-description">${escapeHtml(product.shortDescription || product.description || 'No description has been shared yet.')}</p>
              <div class="dashboard-top-badges">
                <span class="dashboard-pill">${escapeHtml(typeLabel)}</span>
                ${(product.genres || []).slice(0, 3).map((genre) => `<span class="dashboard-pill">${escapeHtml(genre)}</span>`).join('')}
              </div>
              <dl class="dashboard-overview-grid">
                <div><dt>Type</dt><dd>${escapeHtml(typeLabel)}</dd></div>
                <div><dt>Release date</dt><dd>${escapeHtml(formatReleaseDate(product.releasedAt || product.createdAt))}</dd></div>
                <div><dt>Creator</dt><dd>${escapeHtml(product.artistName)}</dd></div>
                <div><dt>Categories</dt><dd>${escapeHtml((product.categories || []).join(', ') || 'Unspecified')}</dd></div>
                <div><dt>Genres</dt><dd>${escapeHtml((product.genres || []).join(', ') || 'Unspecified')}</dd></div>
                <div><dt>DAW compatibility</dt><dd>${escapeHtml((product.dawCompatibility || []).join(', ') || 'Creator has not listed DAWs')}</dd></div>
                <div><dt>Formats</dt><dd>${escapeHtml((product.formatKeys || []).join(', ') || 'Creator has not listed formats')}</dd></div>
              </dl>
              <div class="dashboard-tag-row">
                ${tags.length ? tags.map((tag) => `<span class="dashboard-pill">${escapeHtml(tag)}</span>`).join('') : '<span class="dashboard-pill">No tags yet</span>'}
              </div>
              <p class="dashboard-engagement">${likeCount} likes · ${dislikeCount} dislikes</p>
              ${(() => { const ratio = getLikeRatio(likeCount, dislikeCount); return `<div class="dashboard-sentiment-meter ${ratio.total ? "" : "is-empty"}" aria-label="Like dislike ratio"><div class="dashboard-sentiment-meter-track"><span class="dashboard-sentiment-like" style="width:${ratio.likePercent}%"></span><span class="dashboard-sentiment-dislike" style="width:${ratio.dislikePercent}%"></span></div><div class="dashboard-sentiment-labels"><span>${likeCount} likes</span><span>${dislikeCount} dislikes</span></div></div>` })()}

              <div class="dashboard-creator-block">
                ${creatorAvatar
                  ? `<img src="${escapeHtml(creatorAvatar)}" alt="${escapeHtml(artistDisplayName)} avatar" class="dashboard-creator-avatar" loading="lazy" />`
                  : `<span class="dashboard-creator-avatar-fallback">${escapeHtml(creatorInitials(artistDisplayName))}</span>`}
                <div>
                  <p class="dashboard-creator-name">${escapeHtml(artistDisplayName)}</p>
                  ${artistHandle ? `<p class="dashboard-creator-handle">${escapeHtml(artistHandle)}</p>` : `<p class="dashboard-creator-handle dashboard-mini-note">Creator profile</p>`}
                </div>
                <a class="button button-muted" href="${creatorHref}">View Creator</a>
              </div>
            </article>

            <article class="panel-surface dashboard-side-card">
              <h3>Get ${escapeHtml(product.title)}</h3>
              <p class="dashboard-price">${escapeHtml(product.priceLabel || (product.isFree ? 'Free' : '—'))}</p>
              <div class="dashboard-action-stack">
                <button type="button" class="button button-accent ${state.isDraftPreview ? 'preview-mode-disabled' : ''}" data-add-dashboard-cart ${state.isDraftPreview ? 'disabled title="Disabled in marketplace preview."' : ''}>Add to Cart</button>
                <a class="button button-muted" href="${ROUTES.products}">Back to Products</a>
                <div class="dashboard-action-icons-row">
                  <button type="button" class="dashboard-icon-action ${state.interaction.reaction === 'like' ? 'is-active' : ''}" data-product-like aria-label="Like this product" title="Like" aria-pressed="${state.interaction.reaction === 'like'}" ${state.isDraftPreview ? 'disabled title="Disabled in marketplace preview."' : ''}><span class="icon">${iconSvg('thumbsUp')}</span><em>${likeCount}</em></button>
                  <button type="button" class="dashboard-icon-action ${state.interaction.reaction === 'dislike' ? 'is-active' : ''}" data-product-dislike aria-label="Dislike this product" title="Dislike" aria-pressed="${state.interaction.reaction === 'dislike'}" ${state.isDraftPreview ? 'disabled title="Disabled in marketplace preview."' : ''}><span class="icon">${iconSvg('thumbsDown')}</span><em>${dislikeCount}</em></button>
                  <button type="button" class="dashboard-icon-action" data-product-share aria-label="Share this product" title="Share"><span class="icon">${iconSvg('share2')}</span></button>
                  <button type="button" class="dashboard-icon-action ${state.interaction.saved ? 'is-active' : ''}" data-product-save aria-label="Save this product" title="Save" aria-pressed="${state.interaction.saved}" ${state.isDraftPreview ? 'disabled title="Disabled in marketplace preview."' : ''}><span class="icon">${iconSvg('bookmark')}</span><em>${state.engagementCounts.saveCount}</em></button>
                </div>
                
              </div>
              <p class="dashboard-mini-note">Instant digital download</p>
              <p class="dashboard-mini-note">${product.licensePath ? 'License included' : 'License details available from creator on request'}</p>
              <p class="dashboard-mini-note">Created by ${escapeHtml(product.artistName)}</p>
            </article>

            <article class="panel-surface dashboard-side-card">
              <h3>Compatibility</h3>
              <p>DAW: ${escapeHtml((product.dawCompatibility || []).join(', ') || 'Not listed')}</p>
              <p>Formats: ${escapeHtml((product.formatKeys || []).join(', ') || 'Not listed')}</p>
              <p class="dashboard-mini-note">Compatibility details are based on creator-provided metadata.</p>
            </article>

            <article class="panel-surface dashboard-side-card">
              <h3>Community activity</h3>
              <p>${likeCount} likes · ${dislikeCount} dislikes</p>
              <p>Saves: ${state.engagementCounts.saveCount}</p>
              <p>Downloads: ${product.downloadCount ?? product.counts?.downloads ?? 0}</p>
              <p>Comments: ${product.commentCount ?? product.counts?.comments ?? 0}</p>
            </article>
          </aside>
        </div>
      </section>
    </main>
  `

  document.title = `Melogic | ${product.title}`
  renderMainMedia()
  bindAudioPreviewControls()
  bindProductFileBrowser(product, productFiles, ownsProduct)
  initShellChrome()

  app.querySelector('[data-add-dashboard-cart]')?.addEventListener('click', (event) => {
    if (state.isDraftPreview) return
    event.preventDefault()
    addToCart(product)
    const button = event.currentTarget
    if (button instanceof HTMLButtonElement) {
      button.textContent = 'Added to cart'
      setTimeout(() => {
        button.textContent = 'Add to Cart'
      }, 1200)
    }
    document.querySelector('[data-cart-trigger]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

  const showActionMessage = (message) => {
    const note = app.querySelector('.dashboard-mini-note')
    if (note) note.textContent = message
  }

  const requireAuth = () => {
    if (state.currentUser?.uid) return true
    showActionMessage('Sign in to interact with products.')
    return false
  }

  app.querySelector('[data-product-like]')?.addEventListener('click', async () => {
    if (state.isDraftPreview || !requireAuth()) return
    const prev = state.interaction.reaction
    const previousCounts = { ...state.engagementCounts }
    const next = prev === 'like' ? null : 'like'
    if (prev === 'like') state.engagementCounts.likeCount = Math.max(0, state.engagementCounts.likeCount - 1)
    if (prev === 'dislike') state.engagementCounts.dislikeCount = Math.max(0, state.engagementCounts.dislikeCount - 1)
    if (next === 'like') state.engagementCounts.likeCount += 1
    if (next === 'dislike') state.engagementCounts.dislikeCount += 1
    state.interaction.reaction = next
    renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    try { await setProductReaction(product.id, next) } catch (error) {
      state.interaction.reaction = prev
      state.engagementCounts = previousCounts
      console.warn('[product] engagement update failed', {
        code: error?.code,
        message: error?.message,
        details: error?.details
      })
      showActionMessage('Could not update reaction')
      renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    }
  })

  app.querySelector('[data-product-dislike]')?.addEventListener('click', async () => {
    if (state.isDraftPreview || !requireAuth()) return
    const prev = state.interaction.reaction
    const previousCounts = { ...state.engagementCounts }
    const next = prev === 'dislike' ? null : 'dislike'
    if (prev === 'like') state.engagementCounts.likeCount = Math.max(0, state.engagementCounts.likeCount - 1)
    if (prev === 'dislike') state.engagementCounts.dislikeCount = Math.max(0, state.engagementCounts.dislikeCount - 1)
    if (next === 'like') state.engagementCounts.likeCount += 1
    if (next === 'dislike') state.engagementCounts.dislikeCount += 1
    state.interaction.reaction = next
    renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    try { await setProductReaction(product.id, next) } catch (error) {
      state.interaction.reaction = prev
      state.engagementCounts = previousCounts
      console.warn('[product] engagement update failed', {
        code: error?.code,
        message: error?.message,
        details: error?.details
      })
      showActionMessage('Could not update reaction')
      renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    }
  })

  app.querySelector('[data-product-save]')?.addEventListener('click', async () => {
    if (state.isDraftPreview || !requireAuth()) return
    const previousSaved = state.interaction.saved
    const previousCounts = { ...state.engagementCounts }
    const next = !previousSaved
    state.interaction.saved = next
    state.engagementCounts.saveCount = Math.max(0, state.engagementCounts.saveCount + (next ? 1 : -1))
    renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    showActionMessage(next ? 'Saved' : 'Removed from saved')
    try { await setProductSaved(product.id, next) } catch (error) {
      state.interaction.saved = previousSaved
      state.engagementCounts = previousCounts
      console.warn('[product] engagement update failed', {
        code: error?.code,
        message: error?.message,
        details: error?.details
      })
      showActionMessage('Could not update save state')
      renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    }
  })

  app.querySelector('[data-product-share]')?.addEventListener('click', async () => {
    const shareData = { title: product.title, text: product.shortDescription || 'Check this product', url: window.location.href }
    try {
      if (navigator.share) await navigator.share(shareData)
      else if (navigator.clipboard) await navigator.clipboard.writeText(window.location.href)
      showActionMessage('Copied link')
    } catch {}
  })

  app.querySelector('[data-review-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!state.currentUser?.uid) return
    const form = event.currentTarget
    const data = new FormData(form)
    const body = String(data.get('body') || '').trim()
    const rawRating = Number(data.get('rating') || 0)
    const rating = rawRating > 0 ? rawRating : null
    if (!body) return
    await createProductReview(product.id, state.currentUser, {}, { body, rating })
    state.reviews = await listProductReviews(product.id, { limitCount: 20 })
    renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
  })



  const ratingSlider = app.querySelector('[data-rating-slider]')
  const ratingFill = app.querySelector('[data-rating-fill]')
  const ratingValue = app.querySelector('[data-rating-value]')
  ratingSlider?.addEventListener('input', () => {
    const val = Number(ratingSlider.value || 0)
    if (ratingFill) ratingFill.style.width = `${Math.max(0, Math.min(100, (val / 5) * 100))}%`
    if (ratingValue) ratingValue.textContent = `${val % 1 ? val.toFixed(1) : val.toFixed(0)} / 5`
  })
  app.querySelectorAll('[data-media-index]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedMediaIndex = Number(button.getAttribute('data-media-index')) || 0
      renderMainMedia()
    })
  })

  app.querySelectorAll('[data-media-prev], [data-media-next]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!state.mediaItems.length) return
      const delta = button.hasAttribute('data-media-prev') ? -1 : 1
      state.selectedMediaIndex = (state.selectedMediaIndex + delta + state.mediaItems.length) % state.mediaItems.length
      renderMainMedia()
    })
  })
}

async function init() {
  renderSkeleton()
  state.currentUser = await waitForInitialAuthState()
  state.isDraftPreview = new URLSearchParams(window.location.search).get('preview') === 'draft'

  const id = parseProductIdFromLocation()
  if (!id) {
    renderState('Product not found.', 'Please choose a product from the marketplace.')
    return
  }

  try {
    const product = await getProductById(id)
    if (!product) {
      renderState('This product could not be found.', 'It may have been removed or is not public yet.')
      return
    }

    const isOwner = Boolean(state.currentUser?.uid && product.artistId === state.currentUser.uid)
    const isPublic = product.status === 'published' && product.visibility === 'public'
    if (!isPublic && !isOwner && !state.isDraftPreview) {
      renderState('Product not available.', 'This product is not currently available to the public.')
      return
    }
    if (state.isDraftPreview && !isOwner) {
      renderState('Preview unavailable.', 'Only the product owner can open draft marketplace preview mode.')
      return
    }

    const safe = async (label, fallback, task) => {
      try {
        return await task()
      } catch (error) {
        console.warn(`[product] optional ${label} load failed`, error?.message || error)
        return fallback
      }
    }

    const recommendations = await safe('recommendations', [], () => listRecommendedProducts({ product, pageSize: 8 }))
    const productFiles = await safe('files', [], () => listProductFiles(product.id))
    const ownsProduct = await safe('ownership', false, () => userOwnsProduct(state.currentUser?.uid || '', product.id))
    const reviews = await safe('reviews', [], () => listProductReviews(product.id, { limitCount: 20 }))
    const engagement = await safe('engagement', { reaction: null, saved: false }, () => state.currentUser?.uid
      ? getUserProductEngagementState(product.id, state.currentUser.uid)
      : Promise.resolve({ reaction: null, saved: false }))
    state.reviews = reviews
    state.interaction = engagement
    renderProduct(product, recommendations.filter((item) => normalizeKey(item.id) !== normalizeKey(product.id)), !isPublic && isOwner, productFiles, ownsProduct || Boolean(isOwner))
  } catch (error) {
    console.error('[product] failed to load product page', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack
    })
    renderState('Product could not be loaded right now.', 'Please try again in a moment.')
  }
}

init()
