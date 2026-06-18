import './styles/base.css'
import './styles/newProduct.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { waitForInitialAuthState } from './firebase/auth'
import {
  addProductContributorRequest,
  buildProductPayload,
  getProductById,
  isPlaceholderProductId,
  recalculateAcceptedContributors,
  removeProductContributorRequest,
  createOrUpdateProductShell,
  deleteProductStorageFile,
  saveProductManifest,
  submitProductForReview,
  uploadProductFile
} from './data/productService'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase/firestore'
import { ROUTES, productRoute } from './utils/routes'
import { iconSvg } from './utils/icons'
import { formatUsername } from './utils/format'
import { sanitizeRichDescription, escapeHtml as escapeRichHtml } from './utils/richDescription'
import { searchProfilesByUsername } from './data/profileSearchService'
import { getMarketplacePricingSettings } from './data/marketplaceSettingsService'
import { getAgreementMarkdown, getLatestMarketplaceSellerAgreement } from './data/legalAgreementService'
import { getCreatorAgeVerificationStatus, startCreatorAgeVerification } from './data/creatorComplianceService'

const PRODUCT_SECTIONS = [
  { key: 'product-info', label: 'Product Info' },
  { key: 'media-upload', label: 'Media & Upload' },
  { key: 'contributors', label: 'Contributors' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'agreements', label: 'Agreements' },
  { key: 'creator-eligibility', label: 'Creator Eligibility' },
  { key: 'publish', label: 'Publish' }
]

const PRODUCT_TYPE_OPTIONS = [
  'Single Sample', 'Sample Pack', 'Drum Kit', 'Vocal Pack', 'Preset Bank', 'Wavetable Pack',
  'MIDI Pack', 'Project File', 'Plugin / VST', 'Course / Tutorial', 'Release', 'Other'
]

const USAGE_LICENSE_OPTIONS = ['Standard License', 'Royalty Free', 'Custom License', 'Exclusive License']

const app = document.querySelector('#app')
app.innerHTML = `
  ${navShell({ currentPage: 'products' })}
  <main>
    <section class="section product-editor-shell">
      <div class="section-inner" data-product-editor-root>
        <article class="product-editor-card"><p>Loading creator workspace...</p></article>
      </div>
    </section>
  </main>
`

initShellChrome()

const isDevelopmentRuntime = import.meta.env.DEV
const editorRoot = document.querySelector('[data-product-editor-root]')
let editorState = {
  user: null,
  slugLocked: false,
  mediaFiles: {
    cover: null,
    thumbnail: null,
    gallery: [],
    previewAudio: [],
    previewVideo: [],
    deliverables: [],
    folderDeliverables: []
  },
  uploadQueue: [],
  mediaPreview: {
    cover: '',
    gallery: []
  },
  deliverableFolderPath: '',
  currentDeliverableFolderPath: '',
  deliverableFolders: [],
  deliverableAddMenuOpen: false,
  openDeliverableRowMenu: '',
  contributorUI: {
    search: '',
    role: '',
    filter: 'all',
    results: [],
    rows: []
  },
  marketplacePricingSettings: null,
  agreement: {
    config: null,
    latestVersion: '',
    markdown: '',
    loading: false,
    error: '',
    errorDetail: '',
    warning: '',
    source: '',
    loadedVersion: '',
    acceptanceBlockedReason: '',
    loadRequestId: 0,
    signedName: '',
    accepting: false
  },
  creatorEligibility: {
    loading: false,
    starting: false,
    error: '',
    status: null,
    attestationAccepted: false
  },
  publishConfirmOpen: false,
  status: { message: '', state: 'info' },
  isSubmittingReview: false,
  submitStep: '',
  submitError: '',
  submitSuccess: false,
  lastSubmitResult: null,
  reviewResult: null,
  creatorProfile: null,
  draft: null,
  restoreDraftPrompt: false,
  requestedProductId: (new URLSearchParams(window.location.search).get('id') || (window.location.pathname.startsWith('/products/edit/') ? window.location.pathname.split('/products/edit/')[1]?.split('/')[0] : '') || ''),
  requestedMode: new URLSearchParams(window.location.search).get('mode') || (window.location.pathname.startsWith('/products/edit') ? 'edit' : 'new')
}

function getCreatorIdentity(user = null, profile = null, draft = {}) {
  const profileDisplayName = String(profile?.displayName || '').trim()
  const profileUsername = String(profile?.username || profile?.handle || '').trim()
  const authDisplayName = String(user?.displayName || '').trim()
  const draftDisplayName = String(draft?.artistName || '').trim()
  const draftUsername = String(draft?.artistUsername || '').trim()
  const artistId = user?.uid || String(draft?.artistId || '')
  return {
    artistId,
    artistName: profileDisplayName || authDisplayName || draftDisplayName || 'Creator',
    artistUsername: profileUsername || draftUsername,
    artistProfilePath: artistId ? String(draft?.artistProfilePath || `profiles/${artistId}`) : String(draft?.artistProfilePath || '')
  }
}

function applyCreatorIdentity(draft = {}, user = null, profile = null) {
  return { ...(draft || {}), ...getCreatorIdentity(user, profile, draft) }
}

async function fetchPublicCreatorProfile(uid = '') {
  if (!db || !uid) return null
  try {
    const snapshot = await getDoc(doc(db, 'profiles', uid))
    return snapshot.exists() ? (snapshot.data() || null) : null
  } catch {
    return null
  }
}

function createEmptyProductDraft(user = null, profile = null) {
  const creator = getCreatorIdentity(user, profile)
  return {
    id: '',
    title: '',
    slug: '',
    shortDescription: '',
    description: '',
    productType: 'Single Sample',
    artistId: creator.artistId,
    artistName: creator.artistName,
    artistUsername: creator.artistUsername,
    artistProfilePath: creator.artistProfilePath,
    status: 'draft',
    visibility: 'private',
    price: '0',
    priceCents: 0,
    payoutTargetCents: 0,
    currency: 'USD',
    isFree: true,
    featured: false,
    saleEnabled: false,
    usageLicense: 'Standard License',
    version: '',
    licensePath: '',
    categories: '',
    genres: '',
    tags: '',
    formatNotes: '',
    compatibilityNotes: '',
    includedFiles: '',
    contributorNames: '',
    contributorIds: '',
    pendingContributorIds: [],
    contributorRequestCount: 0,
    sellerAgreement: null,
    sellerAgreementAccepted: false,
    sellerAgreementVersion: '',
    downloadPath: '',
    previewAudioPaths: '',
    previewVideoPaths: '',
    releasedAt: '',
    storefrontVisible: true,
    galleryPaths: '',
    coverPath: '',
    thumbnailPath: '',
    coverURL: '',
    thumbnailURL: '',
    updatedAt: ''
  }
}

function readSectionHash() {
  const hash = window.location.hash.replace('#', '')
  if (hash === 'preview') {
    window.location.hash = 'media-upload'
    return 'media-upload'
  }
  return PRODUCT_SECTIONS.some((item) => item.key === hash) ? hash : 'product-info'
}

function slugify(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
}

function escapeHtml(value) {
  return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function getDraftStorageKey(user) {
  return `melogic:new-product-draft:${user?.uid || 'anonymous'}:v2`
}

function saveDraftState() {
  if (!editorState.user || !editorState.draft) return
  try {
    sessionStorage.setItem(getDraftStorageKey(editorState.user), JSON.stringify({ draft: editorState.draft, slugLocked: editorState.slugLocked, updatedAt: Date.now() }))
  } catch {
    // ignore
  }
}

function loadDraftState(user) {
  const empty = createEmptyProductDraft(user, editorState.creatorProfile)
  if (!user) return empty
  try {
    const raw = sessionStorage.getItem(getDraftStorageKey(user))
    if (!raw) return empty
    const parsed = JSON.parse(raw)
    editorState.slugLocked = Boolean(parsed?.slugLocked)
    const hydrated = applyCreatorIdentity({ ...empty, ...(parsed?.draft || {}) }, user, editorState.creatorProfile)
    if (isPlaceholderProductId(hydrated.id)) hydrated.id = ''
    return hydrated
  } catch {
    return empty
  }
}

function ensureLocalContributorRow() {
  if (!editorState.user) return
  const uid = editorState.user.uid
  const draft = editorState.draft || {}
  const displayName = draft.artistDisplayName || draft.artistName || editorState.user.displayName || 'Creator'
  const username = draft.artistUsername || ''
  const avatarURL = draft.artistAvatarURL || draft.artistPhotoURL || editorState.user.photoURL || ''
  const existingIndex = editorState.contributorUI.rows.findIndex((row) => row.uid === uid)
  const ownerRow = { uid, displayName, username, avatarURL, role: 'Creator/Owner', status: 'accepted', decision: 'accepted', lockedOwner: true, profilePath: draft.artistProfilePath || `profiles/${uid}` }
  if (existingIndex >= 0) editorState.contributorUI.rows[existingIndex] = { ...editorState.contributorUI.rows[existingIndex], ...ownerRow }
  else editorState.contributorUI.rows = [ownerRow, ...editorState.contributorUI.rows]
}

function setStatus(message, state = 'info') {
  editorState.status = { message, state }
}

function renderEditorStatusMarkup() {
  const message = String(editorState.status?.message || '').trim()
  if (!message) return ''
  const state = String(editorState.status?.state || 'info')
  return `<div class="product-status is-visible is-${escapeHtml(state)}" role="status" aria-live="polite">${escapeHtml(message)}</div>`
}

function isPreviouslyPublishedDraft(draft = {}) {
  return draft.status === 'published'
    || draft.currentStatus === 'published'
    || Boolean(draft.publishedAt || draft.releasedAt)
}

function getSubmitReviewLabel(draft = {}, isEditMode = false) {
  if (editorState.submitSuccess) return 'Submitted for Review'
  if (editorState.isSubmittingReview) {
    return String(editorState.submitStep || '').startsWith('upload') ? 'Uploading...' : 'Submitting...'
  }
  return isEditMode && isPreviouslyPublishedDraft(draft) ? 'Submit Edits for Review' : 'Submit for Review'
}

function setSubmitProgress(step, message, state = 'info') {
  editorState.submitStep = step
  setStatus(message, state)
}

function friendlySubmitError(error, step = '') {
  if (step === 'create-product-shell') {
    return 'Product draft could not be created. The backend rejected the product shell. Your form data is still saved locally.'
  }
  if (step === 'save-product-manifest') {
    return 'Product manifest could not be saved. Your product draft and uploaded files are still preserved. Try again.'
  }
  const code = String(error?.code || '').toLowerCase()
  const message = String(error?.message || '')
  const haystack = `${code} ${message}`.toLowerCase()
  if (String(error?.details?.code || '').includes('creator_age_verification_required') || haystack.includes('age verification')) {
    return 'Creator age verification is required before publishing marketplace products.'
  }
  if (haystack.includes('unauthenticated') || haystack.includes('auth')) {
    return 'You need to sign in again before submitting this product.'
  }
  if (haystack.includes('permission-denied') || haystack.includes('permission denied')) return 'You do not have permission to submit this product.'
  if (haystack.includes('failed-precondition')) {
    return message || 'Product details are incomplete. Check the publish checklist and try again.'
  }
  if (haystack.includes('unavailable') || haystack.includes('network')) {
    return 'Marketplace review is temporarily unavailable. Try again.'
  }
  if (haystack.includes('recaptcha') || haystack.includes('token') || haystack.includes('403')) {
    return 'Security verification failed. Refresh, sign in again, or contact support if this continues.'
  }
  if (step) return `Could not submit this product for review during ${step}. Try again.`
  return 'Could not submit this product for review. Try again.'
}

function submitStatusPanelMarkup() {
  if (!editorState.isSubmittingReview && !editorState.submitError && !editorState.submitSuccess) return ''
  const state = editorState.submitError ? 'error' : editorState.submitSuccess ? 'success' : 'info'
  const heading = editorState.submitError ? 'Submission failed' : editorState.submitSuccess ? 'Submitted for review' : 'Submitting product'
  const detail = editorState.submitError
    ? editorState.submitError
    : editorState.submitSuccess
      ? 'Your product is in marketplace review and will stay off public listings until approved.'
      : (editorState.status?.message || 'Preparing submission...')
  return `
    <div class="publish-submit-status is-${state}" role="status" aria-live="polite">
      <strong>${escapeHtml(heading)}</strong>
      <span>${escapeHtml(detail)}</span>
    </div>
  `
}

function updateDraftField(key, value) {
  if (!editorState.draft) return
  editorState.draft[key] = value
  saveDraftState()
}

function formatBytes(size = 0) {
  const kb = Number(size || 0) / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(2)} MB`
}

function toPathArray(value) {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean)
  return String(value || '').split(',').map((v) => v.trim()).filter(Boolean)
}

function toPathString(value) {
  return toPathArray(value).join(', ')
}

function normalizeDraftPaths(draft = {}) {
  return {
    ...draft,
    previewAudioPaths: toPathArray(draft.previewAudioPaths),
    previewVideoPaths: toPathArray(draft.previewVideoPaths),
    galleryPaths: toPathArray(draft.galleryPaths),
    coverPath: toPathString(draft.coverPath),
    thumbnailPath: toPathString(draft.thumbnailPath),
    downloadPath: toPathString(draft.downloadPath),
    primaryDownloadPath: toPathString(draft.primaryDownloadPath),
    deliverableFiles: Array.isArray(draft.deliverableFiles) ? draft.deliverableFiles : []
  }
}

function sanitizeDeliverableFolderPath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim().replace(/[^a-zA-Z0-9._ -]/g, '-'))
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
    .replace(/\/+/g, '/')
    .slice(0, 160)
}

function deliverableDisplayPath(file, folderPath = '') {
  const folder = sanitizeDeliverableFolderPath(folderPath || file.webkitRelativePath?.split('/').slice(0, -1).join('/') || '')
  return [folder, file.name].filter(Boolean).join('/')
}

function queueFile(role, file, extra = {}) {
  const displayPath = extra.displayPath || (role === 'deliverable' ? deliverableDisplayPath(file, editorState.deliverableFolderPath) : (file.webkitRelativePath || file.name))
  return {
    id: extra.id || crypto.randomUUID(),
    role,
    file,
    name: file.name,
    displayPath,
    folderPath: sanitizeDeliverableFolderPath(extra.folderPath || displayPath.split('/').slice(0, -1).join('/')),
    sizeBytes: Number(file.size || 0),
    contentType: file.type || 'application/octet-stream',
    status: extra.status || 'queued',
    progress: Number(extra.progress || 0),
    storagePath: extra.storagePath || '',
    description: String(extra.description || '').slice(0, 150),
    category: role === 'deliverable' ? 'Deliverables' : '',
    isDeliverable: role === 'deliverable',
    isDownloadable: role === 'deliverable',
    error: extra.error || ''
  }
}

function isSingleSampleProduct(draft = {}) {
  return String(draft?.productType || '').trim().toLowerCase() === 'single sample'
}

function isArchiveFile(file = null) {
  const name = String(file?.name || '').toLowerCase()
  return name.endsWith('.zip') || name.endsWith('.rar') || name.endsWith('.7z')
}

function validatePrimaryDeliverableSelection(files = [], draft = {}, hasExistingDeliverable = false) {
  const selected = Array.from(files || [])
  if (!selected.length) return { ok: false, message: 'No deliverable file selected.', level: 'error' }
  const file = selected[0]
  if (isSingleSampleProduct(draft)) {
    if (String(file.type || '').startsWith('audio/') || isArchiveFile(file)) return { ok: true, file, level: 'info', message: '' }
    return { ok: true, file, level: 'warning', message: 'Single Sample products usually use one audio file. ZIP is also supported.' }
  }
  if (!isArchiveFile(file)) {
    return { ok: true, file, level: 'warning', message: 'ZIP is recommended for multi-file products.' }
  }
  return { ok: true, file, level: 'info', message: '' }
}

function validateDraftFiles(draft = editorState.draft, mediaFiles = editorState.mediaFiles) {
  const errors = []
  const warnings = []
  const deliverables = Array.from(mediaFiles?.deliverables || [])
  const folderDeliverables = Array.from(mediaFiles?.folderDeliverables || [])
  const allDeliverables = [...deliverables, ...folderDeliverables]

  if (!allDeliverables.length && !toPathArray(draft?.downloadPath || draft?.primaryDownloadPath).length) {
    warnings.push('No deliverable has been added yet.')
  }

  const firstDeliverable = allDeliverables[0] || null
  if (firstDeliverable) {
    const isSingleSample = isSingleSampleProduct(draft)
    const isAudio = String(firstDeliverable.type || '').startsWith('audio/')
    const archive = isArchiveFile(firstDeliverable)
    if (isSingleSample) {
      if (!isAudio && !archive) warnings.push('Single Sample products usually use one audio file. ZIP is also supported.')
    } else if (!archive) {
      warnings.push('ZIP is recommended for multi-file products.')
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

function buildFileTreeRows(entries = []) {
  const currentPath = sanitizeDeliverableFolderPath(editorState.currentDeliverableFolderPath || '')
  const rows = []
  const folderMap = new Map()
  const addFolder = (path) => {
    const normalized = sanitizeDeliverableFolderPath(path)
    if (!normalized || folderMap.has(normalized)) return
    const parentPath = normalized.includes('/') ? normalized.split('/').slice(0, -1).join('/') : ''
    folderMap.set(normalized, { path: normalized, name: normalized.split('/').at(-1), parentPath, fileCount: 0, folderCount: 0 })
  }
  ;(editorState.deliverableFolders || []).forEach((path) => addFolder(path))
  entries.forEach((entry) => {
    if (!entry.isDeliverable) return
    const folderPath = sanitizeDeliverableFolderPath(entry.folderPath || String(entry.displayPath || entry.name || '').split('/').slice(0, -1).join('/'))
    if (folderPath) {
      const segments = folderPath.split('/')
      let acc = ''
      segments.forEach((segment) => {
        acc = acc ? `${acc}/${segment}` : segment
        addFolder(acc)
      })
    }
  })
  folderMap.forEach((folder) => {
    if (folder.parentPath && folderMap.has(folder.parentPath)) folderMap.get(folder.parentPath).folderCount += 1
  })
  entries.forEach((entry) => {
    if (!entry.isDeliverable) return
    const folderPath = sanitizeDeliverableFolderPath(entry.folderPath || String(entry.displayPath || entry.name || '').split('/').slice(0, -1).join('/'))
    if (folderMap.has(folderPath)) folderMap.get(folderPath).fileCount += 1
  })
  folderMap.forEach((folder) => {
    if (folder.parentPath !== currentPath) return
    rows.push({ type: 'folder', id: `folder-${folder.path}`, folder })
  })
  entries.filter((entry) => entry.isDeliverable).forEach((entry) => {
    const folderPath = sanitizeDeliverableFolderPath(entry.folderPath || String(entry.displayPath || entry.name || '').split('/').slice(0, -1).join('/'))
    if (folderPath !== currentPath) return
    rows.push({ type: 'file', entry, id: entry.id, name: entry.name })
  })
  return rows.sort((a, b) => String((a.folder?.name || a.name || a.entry?.name || '')).localeCompare(String((b.folder?.name || b.name || b.entry?.name || ''))))
}

function remapDeliverablePath(oldPath, nextPath) {
  const oldNorm = sanitizeDeliverableFolderPath(oldPath)
  const nextNorm = sanitizeDeliverableFolderPath(nextPath)
  if (!oldNorm) return sanitizeDeliverableFolderPath(nextNorm)
  if (oldNorm === nextNorm) return oldNorm
  const rewrite = (value) => {
    const clean = sanitizeDeliverableFolderPath(value)
    if (!clean || (clean !== oldNorm && !clean.startsWith(`${oldNorm}/`))) return clean
    return sanitizeDeliverableFolderPath(clean.replace(oldNorm, nextNorm).replace(/^\/+/, ''))
  }
  editorState.deliverableFolders = (editorState.deliverableFolders || []).map((path) => rewrite(path)).filter(Boolean)
  editorState.uploadQueue = editorState.uploadQueue.map((item) => {
    if (item.role !== 'deliverable') return item
    const folderPath = rewrite(item.folderPath || '')
    const name = String(item.name || '').split('/').pop()
    return { ...item, folderPath, displayPath: folderPath ? `${folderPath}/${name}` : name }
  })
  if (Array.isArray(editorState.draft?.deliverableFiles)) {
    updateDraftField('deliverableFiles', editorState.draft.deliverableFiles.map((item) => {
      const folderPath = rewrite(item.folderPath || '')
      const name = String(item.name || '').split('/').pop()
      return { ...item, folderPath, displayPath: folderPath ? `${folderPath}/${name}` : name, updatedAt: new Date().toISOString() }
    }))
  }
  editorState.currentDeliverableFolderPath = rewrite(editorState.currentDeliverableFolderPath || '')
  syncDeliverableDraftMetadata()
}

function removeFolderFromEditorState(folderPath = '') {
  const target = sanitizeDeliverableFolderPath(folderPath)
  if (!target) return []
  const isInside = (path = '') => {
    const normalized = sanitizeDeliverableFolderPath(path)
    return normalized === target || normalized.startsWith(`${target}/`)
  }
  const removedFiles = []
  editorState.deliverableFolders = (editorState.deliverableFolders || []).filter((path) => !isInside(path))
  editorState.uploadQueue = editorState.uploadQueue.filter((item) => {
    if (item.role !== 'deliverable') return true
    const fileFolder = sanitizeDeliverableFolderPath(item.folderPath || item.displayPath?.split('/').slice(0, -1).join('/'))
    if (isInside(fileFolder)) { removedFiles.push(item); return false }
    return true
  })
  if (Array.isArray(editorState.draft?.deliverableFiles)) {
    updateDraftField('deliverableFiles', editorState.draft.deliverableFiles.filter((item) => {
      const fileFolder = sanitizeDeliverableFolderPath(item.folderPath || item.displayPath?.split('/').slice(0, -1).join('/'))
      if (isInside(fileFolder)) { removedFiles.push(item); return false }
      return true
    }))
  }
  if (isInside(editorState.currentDeliverableFolderPath || '')) editorState.currentDeliverableFolderPath = target.split('/').slice(0, -1).join('/')
  editorState.deliverableFolderPath = editorState.currentDeliverableFolderPath || ''
  syncDeliverableDraftMetadata()
  return removedFiles
}

function gatherFileEntries() {
  const rows = []
  const pushRows = (files, category, isPublicPreview, isDeliverable) => {
    Array.from(files || []).forEach((file, index) => {
      rows.push({
        id: `${category}-${index}-${file.name}`,
        name: file.name,
        displayPath: file.webkitRelativePath || file.name,
        sizeBytes: file.size || 0,
        kind: file.type || 'file',
        category,
        isPublicPreview,
        isDeliverable,
        role: isDeliverable ? 'deliverable' : ''
      })
    })
  }
  pushRows(editorState.mediaFiles.gallery, 'Listing Media', true, false)
  pushRows(editorState.mediaFiles.previewAudio, 'Preview Media', true, false)
  pushRows(editorState.mediaFiles.previewVideo, 'Preview Media', true, false)
  const queuedIds = new Set()
  editorState.uploadQueue.forEach((item) => {
    queuedIds.add(item.id)
    rows.push({
      ...item,
      displayPath: item.displayPath || item.name,
      kind: item.contentType || item.kind || 'file',
      category: item.role === 'deliverable' ? 'Deliverables' : item.role === 'gallery' ? 'Listing Media' : 'Preview Media',
      isPublicPreview: item.role !== 'deliverable',
      isDeliverable: item.role === 'deliverable'
    })
  })
  ;(editorState.draft?.deliverableFiles || []).forEach((item) => {
    if (!queuedIds.has(item.id)) rows.push({ ...item, kind: item.contentType || item.kind || 'file', category: 'Deliverables', isDeliverable: true, role: 'deliverable', status: 'uploaded', progress: 100 })
  })
  return rows
}


function deliverableMetadataFromQueueItem(item = {}) {
  return {
    id: item.id,
    productId: editorState.draft?.id || '',
    name: item.name,
    displayPath: item.displayPath || item.name,
    storagePath: item.storagePath || '',
    sizeBytes: Number(item.sizeBytes || 0),
    contentType: item.contentType || 'application/octet-stream',
    extension: String(item.name || '').split('.').pop() || '',
    type: item.contentType || 'file',
    category: 'Deliverables',
    role: 'deliverable',
    isDeliverable: true,
    isDownloadable: true,
    canPreview: String(item.contentType || '').startsWith('audio/'),
    description: String(item.description || '').slice(0, 150),
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}

function syncDeliverableDraftMetadata() {
  if (!editorState.draft) return
  const queuedRows = editorState.uploadQueue.filter((item) => item.role === 'deliverable' && item.status === 'uploaded' && item.storagePath).map(deliverableMetadataFromQueueItem)
  const queuedIds = new Set(queuedRows.map((row) => row.id))
  const existingRows = Array.isArray(editorState.draft.deliverableFiles) ? editorState.draft.deliverableFiles.filter((row) => !queuedIds.has(row.id)) : []
  const rows = [...existingRows, ...queuedRows]
  updateDraftField('deliverableFiles', rows)
  updateDraftField('downloadPath', rows[0]?.storagePath || '')
  updateDraftField('primaryDownloadPath', rows[0]?.storagePath || '')
  updateDraftField('primaryDownloadBytes', Number(rows[0]?.sizeBytes || 0))
  updateDraftField('assetSummary', { ...(editorState.draft.assetSummary || {}), totalFiles: rows.length, totalBytes: rows.reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0), downloadableCount: rows.length, previewableCount: rows.filter((row) => row.canPreview).length })
}

async function ensureDraftProductShell() {
  if (editorState.draft?.id && !isPlaceholderProductId(editorState.draft.id)) {
    if (isDevelopmentRuntime) console.info('[new-product] using productId for upload', editorState.draft.id)
    return editorState.draft.id
  }
  const shell = await createOrUpdateProductShell(editorState.draft, editorState.user)
  if (isDevelopmentRuntime) console.info('[new-product] shell result', shell)
  updateDraftField('id', shell.productId)
  if (isDevelopmentRuntime) console.info('[new-product] using productId for upload', shell.productId)
  return shell.productId
}

async function uploadQueueItemsNow(items = []) {
  if (!editorState.user || !editorState.draft || !items.length) return
  let productId = ''
  try { productId = await ensureDraftProductShell() } catch { setStatus('Could not create draft before upload.', 'error'); renderEditor(); return }
  items.forEach(async (initialItem) => {
    const queueIndex = editorState.uploadQueue.findIndex((row) => row.id === initialItem.id)
    if (queueIndex < 0) return
    try {
      editorState.uploadQueue[queueIndex] = { ...editorState.uploadQueue[queueIndex], status: 'uploading', error: '' }
      renderEditor()
      const uploaded = await uploadProductFile({ productId, queueItem: editorState.uploadQueue[queueIndex], onProgress: (progress) => { const idx = editorState.uploadQueue.findIndex((row) => row.id === initialItem.id); if (idx >= 0) editorState.uploadQueue[idx] = { ...editorState.uploadQueue[idx], progress, status: 'uploading' }; renderEditor() } })
      const idx = editorState.uploadQueue.findIndex((row) => row.id === initialItem.id)
      if (idx >= 0) editorState.uploadQueue[idx] = { ...editorState.uploadQueue[idx], ...uploaded, status: 'uploaded', progress: 100 }
      syncDeliverableDraftMetadata()
      setStatus('Deliverable uploaded.', 'success')
      renderEditor()
    } catch (error) {
      const idx = editorState.uploadQueue.findIndex((row) => row.id === initialItem.id)
      if (idx >= 0) editorState.uploadQueue[idx] = { ...editorState.uploadQueue[idx], status: 'failed', error: error?.message || 'Upload failed' }
      setStatus('Deliverable upload failed. Remove it or try again.', 'error')
      renderEditor()
    }
  })
}

function tagValuesFor(field) {
  return String(editorState.draft?.[field] || '').split(',').map((item) => item.trim()).filter(Boolean)
}

function setTagValues(field, values = []) {
  updateDraftField(field, values.filter(Boolean).join(', '))
}

function tagEditorMarkup(field, label, placeholder) {
  const values = tagValuesFor(field)
  return `
    <div class="product-info-field">
      <label>${label}</label>
      <div class="tag-editor" data-tag-editor="${field}">
        <div class="tag-pill-row">
          ${values.map((tag) => `<span class="tag-pill">${escapeHtml(tag)}<button type="button" data-remove-tag="${escapeHtml(tag)}" data-tag-field="${field}">×</button></span>`).join('')}
        </div>
        <input type="text" data-tag-input="${field}" placeholder="${escapeHtml(placeholder)}" />
      </div>
    </div>
  `
}

function formattedEditDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10)
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10)
}

function normalizePriceToCents(value) {
  const raw = String(value ?? '').replace(/[^\d.]/g, '')
  if (!raw) return 0
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.max(0, Math.round(parsed * 100))
}

function centsToPriceInput(cents = 0) {
  const normalized = Math.max(0, Number(cents || 0))
  return (normalized / 100).toFixed(2)
}

function moneyFormatter(currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
  } catch {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
}

function getPricingSettings() {
  return editorState.marketplacePricingSettings || {
    defaultCurrency: 'USD',
    supportedCurrencies: ['USD'],
    platformFeeLabel: 'Melogic Records Fee',
    platformFeeBps: 1500,
    processorFeeLabel: 'Stripe Fee',
    processorPercentBps: 290,
    processorFixedFeeCents: 30,
    salesMilestones: [100, 1000, 100000],
    transactionNotice: {
      title: 'Transactions Notice:',
      commission: 'Commission: Our platform applies a standard 15% commission on all digital product sales.',
      processingFees: 'Processing Fees: Transactions are subject to standard third-party processing fees, which are deducted prior to payout.',
      supportedMethods: 'Supported Methods: Buyers can purchase via Credit Card, Apple Pay, and PayPal. Sellers can receive payouts via Direct Deposit or PayPal.'
    }
  }
}

function renderPricingPanel() {
  const draft = editorState.draft || createEmptyProductDraft(editorState.user)
  const settings = getPricingSettings()
  const currency = String(draft.currency || settings.defaultCurrency || 'USD').toUpperCase()
  const supportedCurrencies = Array.isArray(settings.supportedCurrencies) && settings.supportedCurrencies.length ? settings.supportedCurrencies : [currency]
  const formatter = moneyFormatter(currency)
  const metrics = pricingMetricsFromState()
  const payoutTargetCents = metrics.sellerNetTargetCents
  const salesMilestones = Array.isArray(settings.salesMilestones) && settings.salesMilestones.length ? settings.salesMilestones : [100, 1000, 100000]
  const currencyControlDisabled = supportedCurrencies.length <= 1 ? 'disabled' : ''

  // TODO: frontend pricing calculator is informational only; backend payout and checkout logic must remain the source of truth.
  return `
    <section class="pricing-workspace">
      <div class="pricing-main-grid">
        <article class="pricing-input-column">
          <div class="pricing-price-field">
            <div class="pricing-field-header">
              <label for="pricing-product-price">Seller Payout Target (${escapeHtml(currency)})</label>
              <select class="pricing-currency-action" data-pricing-currency ${currencyControlDisabled}>
                ${supportedCurrencies.map((code) => `<option value="${escapeHtml(code)}" ${code === currency ? 'selected' : ''}>Change Currency · ${escapeHtml(code)}</option>`).join('')}
              </select>
            </div>
            <input id="pricing-product-price" type="number" min="0" step="0.01" inputmode="decimal" name="price" value="${escapeHtml(centsToPriceInput(payoutTargetCents))}" data-pricing-price-input />
            <p class="pricing-help-copy">This is the amount you want to receive per sale before taxes.</p>
            <label class="pricing-free-toggle"><input type="checkbox" data-pricing-free-toggle ${payoutTargetCents === 0 || draft.isFree ? 'checked' : ''} /> Free product</label>
          </div>
          <div class="pricing-fee-row">
            <span>${escapeHtml(settings.platformFeeLabel)}: ${(Number(settings.platformFeeBps || 0) / 100).toFixed(2)}%</span>
            <strong data-pricing-platform-fee>${formatter.format(metrics.platformFeeCents / 100)}</strong>
          </div>
          <div class="pricing-fee-row">
            <span>${escapeHtml(settings.processorFeeLabel)}: ${(Number(settings.processorPercentBps || 0) / 100).toFixed(2)}% + ${formatter.format(Number(settings.processorFixedFeeCents || 0) / 100)}</span>
            <strong data-pricing-processor-fee>${formatter.format(metrics.processorFeeCents / 100)}</strong>
          </div>
          <div class="pricing-breakdown" data-pricing-breakdown>
            <p>Seller payout target: <strong>${formatter.format(metrics.sellerNetTargetCents / 100)}</strong></p>
            <p>${escapeHtml(settings.platformFeeLabel)}: <strong>${formatter.format(metrics.platformFeeCents / 100)}</strong></p>
            <p>Processing fee: <strong>${formatter.format(metrics.processorFeeCents / 100)}</strong></p>
            <p>Customer listing price: <strong>${formatter.format(metrics.customerListingCents / 100)}</strong></p>
          </div>
          <div class="pricing-price-field">
            <div class="pricing-field-header">
              <label>Final Customer Price (${escapeHtml(currency)})</label>
              <button type="button" class="pricing-currency-action" disabled>Change Currency</button>
            </div>
            <input type="text" readonly value="${escapeHtml(centsToPriceInput(metrics.customerListingCents))}" data-pricing-final-price />
            <p class="pricing-help-copy">This is the estimated price customers pay after marketplace and processing fees.</p>
          </div>
          <p class="pricing-warning ${metrics.invalidConfig ? '' : 'is-hidden'}" data-pricing-warning>Marketplace fee configuration is invalid.</p>
        </article>

        <article class="pricing-calculator-column">
          <div class="pricing-calculator">
            <h3>Estimated Seller Earnings:</h3>
            <div data-pricing-milestones>
            ${salesMilestones.map((milestone) => `
              <div class="pricing-calculator-row">
                <p>${Number(milestone).toLocaleString('en-US')} sales estimated payout:</p>
                <strong>${formatter.format((metrics.sellerNetTargetCents * Number(milestone || 0)) / 100)}</strong>
              </div>
            `).join('')}
            </div>
          </div>
        </article>

        <aside class="pricing-notice">
          <h4>${escapeHtml(settings.transactionNotice?.title || 'Transactions Notice:')}</h4>
          <p>${escapeHtml(settings.transactionNotice?.commission || '')}</p>
          <p>${escapeHtml(settings.transactionNotice?.processingFees || '')}</p>
          <p>${escapeHtml(settings.transactionNotice?.supportedMethods || '')}</p>
        </aside>
      </div>
    </section>
  `
}

function pricingMetricsFromState() {
  const draft = editorState.draft || {}
  const settings = getPricingSettings()
  const currency = String(draft.currency || settings.defaultCurrency || 'USD').toUpperCase()
  const formatter = moneyFormatter(currency)
  const sellerNetTargetCents = draft.isFree ? 0 : normalizePriceToCents(draft.price)
  const platformRate = Number(settings.platformFeeBps || 0) / 10000
  const processorRate = Number(settings.processorPercentBps || 0) / 10000
  const fixedFeeCents = Number(settings.processorFixedFeeCents || 0)
  const denominator = 1 - platformRate - processorRate
  const invalidConfig = denominator <= 0
  const calculatedGrossCents = sellerNetTargetCents <= 0 ? 0 : invalidConfig ? 0 : Math.ceil((sellerNetTargetCents + fixedFeeCents) / denominator)
  const customerListingCents = draft.isFree ? 0 : Math.max(0, calculatedGrossCents)
  const platformFeeCents = customerListingCents <= 0 ? 0 : Math.round(customerListingCents * platformRate)
  const processorFeeCents = customerListingCents <= 0 ? 0 : Math.round(customerListingCents * processorRate) + fixedFeeCents
  const estimatedSellerCents = customerListingCents - platformFeeCents - processorFeeCents
  const salesMilestones = Array.isArray(settings.salesMilestones) && settings.salesMilestones.length ? settings.salesMilestones : [100, 1000, 100000]
  return {
    settings,
    currency,
    formatter,
    sellerNetTargetCents,
    customerListingCents,
    platformFeeCents,
    processorFeeCents,
    estimatedSellerCents,
    invalidConfig,
    salesMilestones
  }
}

function refreshPricingDom() {
  const root = editorRoot.querySelector('.pricing-workspace')
  if (!root) return
  const metrics = pricingMetricsFromState()
  root.querySelector('[data-pricing-platform-fee]')?.replaceChildren(document.createTextNode(metrics.formatter.format(metrics.platformFeeCents / 100)))
  root.querySelector('[data-pricing-processor-fee]')?.replaceChildren(document.createTextNode(metrics.formatter.format(metrics.processorFeeCents / 100)))
  const finalInput = root.querySelector('[data-pricing-final-price]')
  if (finalInput) finalInput.value = centsToPriceInput(metrics.customerListingCents)
  const breakdown = root.querySelector('[data-pricing-breakdown]')
  if (breakdown) {
    breakdown.innerHTML = `
      <p>Seller payout target: <strong>${metrics.formatter.format(metrics.sellerNetTargetCents / 100)}</strong></p>
      <p>${escapeHtml(metrics.settings.platformFeeLabel)}: <strong>${metrics.formatter.format(metrics.platformFeeCents / 100)}</strong></p>
      <p>Processing fee: <strong>${metrics.formatter.format(metrics.processorFeeCents / 100)}</strong></p>
      <p>Customer listing price: <strong>${metrics.formatter.format(metrics.customerListingCents / 100)}</strong></p>
    `
  }
  const milestoneWrap = root.querySelector('[data-pricing-milestones]')
  if (milestoneWrap) {
    milestoneWrap.innerHTML = metrics.salesMilestones.map((milestone) => `
      <div class="pricing-calculator-row">
        <p>${Number(milestone).toLocaleString('en-US')} sales estimated payout:</p>
        <strong>${metrics.formatter.format((metrics.sellerNetTargetCents * Number(milestone || 0)) / 100)}</strong>
      </div>
    `).join('')
  }
  root.querySelector('[data-pricing-warning]')?.classList.toggle('is-hidden', !metrics.invalidConfig)
  syncPricingDraftFields(metrics)
}

function syncPricingDraftFields(metrics = null) {
  if (!editorState.draft) return null
  const next = metrics || pricingMetricsFromState()
  updateDraftField('payoutTargetCents', next.sellerNetTargetCents)
  updateDraftField('priceCents', next.customerListingCents)
  updateDraftField('price', centsToPriceInput(next.sellerNetTargetCents))
  updateDraftField('isFree', next.sellerNetTargetCents === 0)
  return next
}

function refreshAgreementAcceptButton() {
  const button = editorRoot.querySelector('[data-accept-agreement]')
  if (!button) return
  const agreementState = sellerAgreementState()
  const signatureDisabled = agreementState.accepted || editorState.agreement.loading || Boolean(editorState.agreement.error)
  const canAccept = !signatureDisabled && !editorState.agreement.accepting && String(editorState.agreement.signedName || '').trim().length >= 3
  button.disabled = !canAccept
}

function bindContributorAddButtons(scope = editorRoot) {
  scope.querySelectorAll('[data-add-contributor]').forEach((button) => {
    button.addEventListener('click', async () => {
      const uid = button.getAttribute('data-add-contributor') || ''
      const profile = editorState.contributorUI.results.find((row) => row.uid === uid)
      if (!profile || !editorState.user) return
      if (uid === editorState.user.uid) {
        setStatus('You cannot add yourself as a contributor.', 'error')
        renderEditor()
        return
      }
      if (editorState.contributorUI.rows.some((row) => row.uid === uid && row.status !== 'removed')) {
        setStatus('Contributor already added.', 'error')
        renderEditor()
        return
      }
      const row = {
        uid,
        displayName: profile.displayName || profile.username || 'Contributor',
        username: profile.username || '',
        avatarURL: profile.avatarURL || profile.photoURL || '',
        role: editorState.contributorUI.role || '',
        status: 'pending',
        decision: 'pending',
        requestedAt: new Date().toISOString(),
        decisionAt: '',
        legacy: false
      }
      editorState.contributorUI.rows = [row, ...editorState.contributorUI.rows]
      editorState.contributorUI.results = []
      editorState.contributorUI.search = ''
      recalcContributorSummaryFromRows()
      if (editorState.draft?.id && !isPlaceholderProductId(editorState.draft.id)) {
        await addProductContributorRequest({ productId: editorState.draft.id, ownerUid: editorState.user.uid, targetProfile: profile, role: row.role })
      }
      setStatus('Contributor request added (pending).', 'success')
      renderEditor()
    })
  })
}

function refreshContributorResultsDom() {
  const container = editorRoot.querySelector('[data-contributor-results]')
  if (!container) return
  container.classList.toggle('is-hidden', !editorState.contributorUI.results.length)
  container.innerHTML = editorState.contributorUI.results.map((profile) => `
    <button type="button" data-add-contributor="${escapeHtml(profile.uid)}">
      <img class="contributor-avatar" src="${escapeHtml(profile.avatarURL || profile.photoURL || '')}" alt="" />
      <span>${escapeHtml(profile.displayName || 'User')} ${escapeHtml(formatUsername(profile.username))}</span>
    </button>
  `).join('')
  bindContributorAddButtons(container)
}

function formatAgreementAcceptedDate(value = '') {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

function renderSafeInlineMarkdown(text = '') {
  const escaped = escapeHtml(text)
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

function renderAgreementMarkdown(markdown = '') {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n')
  const html = []
  let paragraph = []
  let listType = ''

  const flushParagraph = () => {
    if (!paragraph.length) return
    html.push(`<p>${renderSafeInlineMarkdown(paragraph.join(' '))}</p>`)
    paragraph = []
  }

  const closeList = () => {
    if (!listType) return
    html.push(listType === 'ol' ? '</ol>' : '</ul>')
    listType = ''
  }

  lines.forEach((line) => {
    const trimmed = line.trim()
    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/)
    const unorderedMatch = trimmed.match(/^[-*]\s+(.*)$/)
    if (!trimmed) {
      flushParagraph()
      closeList()
      return
    }
    if (/^---+$/.test(trimmed)) {
      flushParagraph()
      closeList()
      html.push('<hr />')
      return
    }
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/)
    if (headingMatch) {
      flushParagraph()
      closeList()
      const level = Math.min(4, headingMatch[1].length)
      html.push(`<h${level}>${renderSafeInlineMarkdown(headingMatch[2])}</h${level}>`)
      return
    }
    if (orderedMatch) {
      flushParagraph()
      if (listType !== 'ol') {
        closeList()
        html.push('<ol>')
        listType = 'ol'
      }
      html.push(`<li>${renderSafeInlineMarkdown(orderedMatch[1])}</li>`)
      return
    }
    if (unorderedMatch) {
      flushParagraph()
      if (listType !== 'ul') {
        closeList()
        html.push('<ul>')
        listType = 'ul'
      }
      html.push(`<li>${renderSafeInlineMarkdown(unorderedMatch[1])}</li>`)
      return
    }
    closeList()
    paragraph.push(trimmed)
  })

  flushParagraph()
  closeList()
  return html.join('')
}

function sellerAgreementState() {
  const config = editorState.agreement.config || {}
  const current = editorState.draft?.sellerAgreement || null
  const acceptedVersion = String(editorState.draft?.sellerAgreementVersion || current?.version || '')
  const activeVersion = String(editorState.agreement.latestVersion || config.activeVersion || '')
  const accepted = Boolean(editorState.draft?.sellerAgreementAccepted) && acceptedVersion === activeVersion
  const versionChanged = Boolean(editorState.draft?.sellerAgreementAccepted) && acceptedVersion && activeVersion && acceptedVersion !== activeVersion
  return { accepted, versionChanged, current }
}

function renderAgreementsPanel() {
  const agreementState = sellerAgreementState()
  const config = editorState.agreement.config || {}
  const acceptanceBlockedReason = String(editorState.agreement.acceptanceBlockedReason || '').trim()
  const signatureDisabled = agreementState.accepted || editorState.agreement.loading || Boolean(editorState.agreement.error) || Boolean(acceptanceBlockedReason)
  const canAccept = !signatureDisabled && !editorState.agreement.accepting && String(editorState.agreement.signedName || '').trim().length >= 3
  const agreementError = String(editorState.agreement.error || '').trim()
  const agreementWarning = String(editorState.agreement.warning || '').trim()
  const agreementErrorDetail = editorState.agreement.errorDetail && import.meta?.env?.DEV
    ? `<p class="agreement-error-detail">${escapeHtml(editorState.agreement.errorDetail)}</p>`
    : ''
  const agreementSourceDetail = editorState.agreement.source && import.meta?.env?.DEV
    ? `<p class="agreement-error-detail">Source: ${escapeHtml(editorState.agreement.source)}</p>`
    : ''
  const agreementBody = editorState.agreement.loading
    ? '<p class="agreement-loading">Loading agreement…</p>'
    : agreementError
      ? `<p class="agreement-error">${escapeHtml(agreementError)}</p>${config.activeVersion ? `<p class="agreement-error-detail">Version: ${escapeHtml(config.activeVersion)}</p>` : ''}${config.storagePath ? `<p class="agreement-error-detail">Path: ${escapeHtml(config.storagePath)}</p>` : ''}${agreementErrorDetail}<button type="button" class="button button-muted" data-retry-agreement-load>Retry Agreement Load</button>`
      : editorState.agreement.markdown
        ? `${agreementWarning ? `<p class="pricing-warning">${escapeHtml(agreementWarning)}</p>` : ''}${acceptanceBlockedReason ? `<p class="pricing-warning">${escapeHtml(acceptanceBlockedReason)}</p>` : ''}${agreementSourceDetail}${renderAgreementMarkdown(editorState.agreement.markdown)}`
        : '<p class="agreement-error">Seller agreement file is missing.</p>'
  return `
    <section class="agreements-workspace">
      <div class="agreements-main-grid">
        <article class="agreement-viewer-panel">
          <h3>Agreement Form</h3>
          <div class="agreement-document">
            ${agreementBody}
          </div>
          ${agreementState.versionChanged ? '<p class="pricing-warning">A newer seller agreement version is available and must be accepted before publishing.</p>' : ''}
          ${agreementState.accepted ? `<p class="agreement-accepted-status">Agreement accepted by ${escapeHtml(agreementState.current?.signedName || '')}${agreementState.current?.acceptedAt ? ` on ${escapeHtml(formatAgreementAcceptedDate(agreementState.current.acceptedAt))}` : ''}.</p>` : ''}
          <div class="agreement-signature-row">
            <div class="agreement-signature-field">
              <label>E-Signature (Your Full Legal Name):</label>
              <input type="text" value="${escapeHtml(editorState.agreement.signedName)}" data-agreement-signed-name ${signatureDisabled ? 'disabled' : ''} placeholder="Enter full legal name" />
            </div>
            <button type="button" class="agreement-accept-button" data-accept-agreement ${canAccept ? '' : 'disabled'}>
              ${agreementState.accepted ? 'Agreement Accepted' : editorState.agreement.accepting ? 'Saving…' : 'Accept Agreement'}
            </button>
          </div>
        </article>
        <aside class="agreement-notice">
          <h4>Modifications to Agreements:</h4>
          <p>We reserve the right to update or modify our agreements and policies at any time. If changes occur, you will be notified via email or an alert on your account dashboard. It is your responsibility to review and understand any updates, as all changes take effect immediately upon being posted.</p>
          ${config.title ? `<p>Current: ${escapeHtml(config.title)} ${escapeHtml(String(config.activeVersion || ''))}</p>` : ''}
        </aside>
      </div>
    </section>
  `
}

function buildPublishChecklist(draft = {}, state = {}, latestAgreement = {}) {
  const title = String(draft.title || '').trim()
  const slug = String(draft.slug || '').trim()
  const shortDescription = String(draft.shortDescription || '').trim()
  const description = String(draft.description || '').trim()
  const coverReady = Boolean(draft.coverPath || draft.coverURL || state.mediaPreview?.cover || state.mediaFiles?.cover)
  const thumbnailReady = Boolean(draft.thumbnailPath || draft.thumbnailURL || state.mediaFiles?.thumbnail || state.mediaPreview?.cover)
  const deliverablesCount = (state.mediaFiles?.deliverables?.length || 0) + (state.mediaFiles?.folderDeliverables?.length || 0)
  const hasDownload = Boolean(draft.downloadPath || deliverablesCount > 0)
  const hasPreviewMedia = Boolean(toPathArray(draft.previewAudioPaths).length || toPathArray(draft.previewVideoPaths).length || state.mediaFiles?.previewAudio?.length || state.mediaFiles?.previewVideo?.length)
  const previewDecision = hasPreviewMedia || Boolean(draft.previewMode === 'none')
  const pricingMetrics = pricingMetricsFromState()
  const pendingContributors = Number((draft.pendingContributorIds || []).length || 0)
  const acceptedContributors = Number(draft.contributorCount || 0)
  const latestVersion = String(latestAgreement?.activeVersion || state.agreement?.latestVersion || '').toLowerCase()
  const acceptedVersion = String(draft.sellerAgreementVersion || '').toLowerCase()
  const agreementAccepted = Boolean(draft.sellerAgreementAccepted)
  const agreementVersionMatch = agreementAccepted && acceptedVersion && latestVersion && acceptedVersion === latestVersion
  const eligibility = state.creatorEligibility?.status || { required: true, status: 'not_started' }
  const eligibilityReady = eligibility.required === false || eligibility.status === 'verified'
  return [
    { id: 'title', label: 'Product title exists', severity: title ? 'success' : 'error', blocking: !title, message: title ? 'Title added.' : 'Add a product title.', targetSection: 'product-info' },
    { id: 'type', label: 'Product type selected', severity: draft.productType ? 'success' : 'error', blocking: !draft.productType, message: draft.productType ? 'Product type selected.' : 'Select a product type.', targetSection: 'product-info' },
    { id: 'slug', label: 'Slug exists', severity: slug ? 'success' : 'error', blocking: !slug, message: slug ? 'Slug ready.' : 'Add a slug.', targetSection: 'product-info' },
    { id: 'short', label: 'Short description exists', severity: shortDescription ? 'success' : 'error', blocking: !shortDescription, message: shortDescription ? 'Short description ready.' : 'Add a short description.', targetSection: 'product-info' },
    { id: 'long', label: 'Long description exists', severity: description ? 'success' : 'error', blocking: !description, message: description ? 'Long description ready.' : 'Add a long description.', targetSection: 'product-info' },
    { id: 'cover', label: 'Cover image exists', severity: coverReady ? 'success' : 'error', blocking: !coverReady, message: coverReady ? 'Cover ready.' : 'Upload a cover image.', targetSection: 'media-upload' },
    { id: 'thumbnail', label: 'Thumbnail exists', severity: thumbnailReady ? 'success' : 'error', blocking: !thumbnailReady, message: thumbnailReady ? 'Thumbnail ready.' : 'Add a thumbnail image.', targetSection: 'media-upload' },
    { id: 'deliverables', label: 'Deliverable/download exists', severity: hasDownload ? 'success' : 'error', blocking: !hasDownload, message: hasDownload ? 'Download source detected.' : 'Add at least one deliverable.', targetSection: 'media-upload' },
    { id: 'preview', label: 'Preview media decision made', severity: previewDecision ? (hasPreviewMedia ? 'success' : 'warning') : 'error', blocking: !previewDecision, message: hasPreviewMedia ? 'Preview media assigned.' : (previewDecision ? 'No preview selected intentionally.' : 'Assign preview media or choose no preview.'), targetSection: 'media-upload' },
    { id: 'price', label: 'Price/currency valid', severity: (!pricingMetrics.invalidConfig && draft.currency && (draft.isFree || pricingMetrics.sellerNetTargetCents > 0)) ? 'success' : 'error', blocking: Boolean(pricingMetrics.invalidConfig || !draft.currency || (!draft.isFree && pricingMetrics.sellerNetTargetCents <= 0)), message: (!pricingMetrics.invalidConfig && draft.currency && (draft.isFree || pricingMetrics.sellerNetTargetCents > 0)) ? 'Pricing configured.' : (pricingMetrics.invalidConfig ? 'Marketplace fee configuration is invalid.' : 'Set pricing and currency.'), targetSection: 'pricing' },
    { id: 'contributors', label: 'Contributors resolved', severity: pendingContributors > 0 ? 'warning' : 'success', blocking: false, message: pendingContributors > 0 ? `${pendingContributors} pending contributor request(s).` : `${acceptedContributors} accepted contributor(s).`, targetSection: 'contributors' },
    { id: 'agreement', label: 'Seller agreement accepted', severity: agreementAccepted ? 'success' : 'error', blocking: !agreementAccepted, message: agreementAccepted ? `Accepted ${draft.sellerAgreementVersion || ''}.` : 'Accept seller agreement.', targetSection: 'agreements' },
    { id: 'agreement-version', label: 'Agreement version matches latest', severity: agreementVersionMatch ? 'success' : 'error', blocking: !agreementVersionMatch, message: agreementVersionMatch ? `Latest version ${latestVersion} accepted.` : `Latest seller agreement ${latestVersion || 'version'} must be accepted before publishing.`, targetSection: 'agreements' },
    { id: 'creator-eligibility', label: 'Creator eligibility verified', severity: eligibilityReady ? 'success' : (eligibility.status === 'pending' ? 'warning' : 'error'), blocking: !eligibilityReady, message: creatorEligibilityMessage(eligibility), targetSection: 'creator-eligibility' },
    { id: 'visibility', label: 'Visibility selected', severity: draft.visibility ? 'success' : 'error', blocking: !draft.visibility, message: draft.visibility ? `Visibility: ${draft.visibility}.` : 'Select visibility.', targetSection: 'product-info' },
    { id: 'quota', label: 'No quota errors', severity: 'success', blocking: false, message: 'No quota errors detected.', targetSection: 'media-upload' },
    { id: 'save-errors', label: 'No upload/save errors', severity: state.status?.state === 'error' ? 'warning' : 'success', blocking: false, message: state.status?.state === 'error' ? 'Recent action reported an error; verify before submit.' : 'No recent save/upload errors.', targetSection: 'publish' },
    {
      id: 'ai-review',
      label: 'AI review availability',
      severity: state.reviewResult
        ? (state.reviewResult?.aiConfigured === true && state.reviewResult?.aiSucceeded === true ? 'success' : 'warning')
        : 'info',
      blocking: false,
      message: state.reviewResult
        ? (state.reviewResult?.aiConfigured === true && state.reviewResult?.aiSucceeded === true
            ? 'AI review completed.'
            : state.reviewResult?.aiConfigured === true
              ? 'AI configured but failed; rule-based fallback used.'
              : 'AI not configured; rule-based fallback used.')
        : 'AI review availability will be checked during submission.',
      targetSection: 'publish'
    }
  ]
}

function getBlockingPublishIssues(items = []) {
  return items.filter((item) => item.blocking === true)
}

function calculateLaunchReadiness(checks = []) {
  const readyCount = checks.filter((item) => item.severity === 'success').length
  const warningCount = checks.filter((item) => item.severity === 'warning').length
  const blockedCount = checks.filter((item) => item.blocking).length
  const totalCount = checks.length || 1
  return {
    readyCount,
    warningCount,
    blockedCount,
    totalCount,
    percent: Math.round((readyCount / totalCount) * 100)
  }
}

function hasAiAuthReviewFailure(draft = {}) {
  return draft.reviewJobStatus === 'failed_ai_auth'
    || draft.moderationAIErrorCategory === 'auth'
    || ['gemini_auth_failed', 'gemini_secret_invalid'].includes(draft.moderationAIErrorCode)
}

function reviewFailureNoticeMarkup(draft = {}) {
  if (!hasAiAuthReviewFailure(draft)) return ''
  return `
    <div class="publish-review-alert" role="status">
      <strong>AI review failed: Gemini authentication error.</strong>
      <span>Your product remains pending review and is not publicly listed.</span>
      ${draft.moderationAIError ? `<small>${escapeHtml(draft.moderationAIError)}</small>` : ''}
    </div>
  `
}

function creatorEligibilityStatus() {
  return editorState.creatorEligibility?.status || { required: true, status: 'not_started' }
}

function isCreatorEligibilityVerified() {
  const status = creatorEligibilityStatus()
  return status.required === false || status.status === 'verified'
}

function creatorEligibilityMessage(status = creatorEligibilityStatus()) {
  if (status.required === false) return 'Creator age verification is not currently required.'
  if (status.status === 'verified') return 'Creator eligibility verified.'
  if (status.status === 'pending') return 'Age verification is pending. A verification provider flow is coming soon.'
  if (status.status === 'rejected') return 'Age verification was rejected. Contact support if you believe this is wrong.'
  if (status.status === 'expired') return 'Age verification expired and must be renewed.'
  return 'Age verification is required before publishing marketplace products.'
}

async function loadCreatorEligibility({ force = false } = {}) {
  if (!editorState.user) return creatorEligibilityStatus()
  if (!force && editorState.creatorEligibility.status) return editorState.creatorEligibility.status
  editorState.creatorEligibility.loading = true
  editorState.creatorEligibility.error = ''
  try {
    const status = await getCreatorAgeVerificationStatus()
    editorState.creatorEligibility.status = status
    return status
  } catch (error) {
    console.warn('[new-product] creator eligibility load failed', { code: error?.code, message: error?.message, details: error?.details })
    editorState.creatorEligibility.error = error?.message || 'Could not load creator eligibility.'
    return creatorEligibilityStatus()
  } finally {
    editorState.creatorEligibility.loading = false
  }
}

async function startCreatorEligibility() {
  if (!editorState.user || editorState.creatorEligibility.starting) return
  editorState.creatorEligibility.starting = true
  editorState.creatorEligibility.error = ''
  renderEditor()
  try {
    const status = await startCreatorAgeVerification({
      attestationAccepted: editorState.creatorEligibility.attestationAccepted === true
    })
    editorState.creatorEligibility.status = status
    setStatus('Age verification started. Provider verification is coming soon.', 'info')
  } catch (error) {
    console.warn('[new-product] creator eligibility start failed', { code: error?.code, message: error?.message, details: error?.details })
    editorState.creatorEligibility.error = error?.message || 'Could not start age verification.'
    setStatus(editorState.creatorEligibility.error, 'error')
  } finally {
    editorState.creatorEligibility.starting = false
    renderEditor()
  }
}

function renderCreatorEligibilityPanel() {
  const status = creatorEligibilityStatus()
  const verified = isCreatorEligibilityVerified()
  const loading = editorState.creatorEligibility.loading
  const starting = editorState.creatorEligibility.starting
  return `
    <section class="creator-eligibility-panel">
      <article class="publish-submit-panel creator-eligibility-card">
        <div class="creator-eligibility-header">
          <h3>Creator Eligibility</h3>
          <p>Marketplace publishing requires creator age verification when this platform setting is enabled.</p>
        </div>
        <div class="publish-checklist-row creator-eligibility-status is-${verified ? 'ready' : status.status === 'pending' ? 'warning' : 'error'}">
          <div>
            <p><strong>${escapeHtml(verified ? 'Ready' : status.status === 'pending' ? 'Pending' : 'Blocked')}</strong> · Age verification</p>
            <p>${escapeHtml(creatorEligibilityMessage(status))}</p>
          </div>
          <span>${escapeHtml(loading ? 'Loading...' : status.status || 'not_started')}</span>
        </div>
        <div class="product-info-grid creator-eligibility-details">
          <div class="product-info-field"><label>Status</label><div class="product-info-readonly">${escapeHtml(status.status || 'not_started')}</div></div>
          <div class="product-info-field"><label>Provider</label><div class="product-info-readonly">${escapeHtml(status.provider || 'manual_foundation')}</div></div>
          <div class="product-info-field"><label>Required</label><div class="product-info-readonly">${status.required === false ? 'No' : 'Yes'}</div></div>
          <div class="product-info-field"><label>Verified at</label><div class="product-info-readonly">${escapeHtml(status.verifiedAt || 'Not verified')}</div></div>
        </div>
        ${editorState.creatorEligibility.error ? `<p class="pricing-warning">${escapeHtml(editorState.creatorEligibility.error)}</p>` : ''}
        ${verified ? '<p class="agreement-accepted-status">Creator eligibility is complete for marketplace publishing.</p>' : `
          <label class="agreement-checkbox creator-eligibility-attestation">
            <input type="checkbox" data-creator-eligibility-attestation ${editorState.creatorEligibility.attestationAccepted ? 'checked' : ''} />
            <span>I confirm I am eligible to use creator marketplace tools and understand verification must be completed before publishing.</span>
          </label>
          <div class="publish-action-row creator-eligibility-actions">
            <button type="button" class="button button-accent" data-start-creator-eligibility ${starting ? 'disabled' : ''}>${starting ? 'Starting...' : status.status === 'pending' ? 'Resume age verification' : 'Start age verification'}</button>
          </div>
          <p class="dashboard-mini-note">Provider verification is not connected yet. Starting this flow marks the request pending; only an admin can mark the creator verified.</p>
        `}
      </article>
    </section>
  `
}

function renderPublishPanel() {
  const draft = editorState.draft || createEmptyProductDraft(editorState.user)
  const isEditMode = Boolean(editorState.requestedProductId || (draft.id && !isPlaceholderProductId(draft.id)))
  const checks = buildPublishChecklist(draft, editorState, editorState.agreement.config || {})
  const readiness = calculateLaunchReadiness(checks)
  const blockingIssues = getBlockingPublishIssues(checks)
  const agreementLatest = editorState.agreement.latestVersion || editorState.agreement.config?.activeVersion || 'v1'
  const agreementAccepted = draft.sellerAgreementVersion || '—'
  const fileEntries = gatherFileEntries()
  const deliverables = fileEntries.filter((item) => item.isDeliverable)
  const deliverableBytes = deliverables.reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0)
  const previewAssigned = Boolean(toPathArray(draft.previewAudioPaths).length || toPathArray(draft.previewVideoPaths).length || editorState.mediaFiles.previewAudio.length || editorState.mediaFiles.previewVideo.length)
  const canSubmit = !editorState.isSubmittingReview && blockingIssues.length === 0 && (isEditMode || (draft.status !== 'review_pending' && draft.status !== 'published'))
  const submitLabel = getSubmitReviewLabel(draft, isEditMode)

  return `
    <section class="publish-workspace">
      <div class="publish-grid">
        <article class="publish-summary-card">
          <h3>Product Summary</h3>
          <div class="publish-cover-preview">${editorState.mediaPreview.cover || draft.coverURL || draft.thumbnailURL ? `<img src="${escapeHtml(editorState.mediaPreview.cover || draft.coverURL || draft.thumbnailURL)}" alt="Product cover preview" />` : '<span>No cover</span>'}</div>
          <div class="publish-summary-meta">
            <p><strong>${escapeHtml(draft.title || 'Untitled product')}</strong></p>
            <p>${escapeHtml(draft.productType || '—')} · by ${escapeHtml(draft.artistName || 'Creator')}</p>
            <p>${draft.isFree ? 'Free' : `${escapeHtml(draft.currency || 'USD')} ${escapeHtml(centsToPriceInput(normalizePriceToCents(draft.price)))}`}</p>
            <p>Status: ${escapeHtml(draft.status || 'draft')} · Visibility: ${escapeHtml(draft.visibility || 'private')}</p>
            <p>${escapeHtml(draft.shortDescription || 'No short description yet.')}</p>
            <p>Preview: ${previewAssigned ? 'Assigned' : 'Not assigned'}</p>
            <p>Deliverables: ${deliverables.length} · ${formatBytes(deliverableBytes)}</p>
            <p>Contributors: ${Number(draft.contributorCount || 0)}</p>
            <p>Agreement: ${draft.sellerAgreementAccepted ? `Accepted (${escapeHtml(draft.sellerAgreementVersion || '')})` : 'Not accepted'}</p>
          </div>
        </article>

        <article class="publish-checklist-panel">
          <h3>Publish Checklist</h3>
          ${checks.map((check) => `
            <div class="publish-checklist-row is-${check.severity === 'success' ? 'ready' : check.severity}">
              <div>
                <p><strong>${check.severity === 'success' ? 'Ready' : check.severity === 'warning' ? 'Warning' : check.severity === 'info' ? 'Info' : 'Blocked'}</strong> · ${escapeHtml(check.label)}</p>
                <p>${escapeHtml(check.message || '')}</p>
              </div>
              <button type="button" data-publish-fix="${escapeHtml(check.targetSection || 'product-info')}">Fix</button>
            </div>
          `).join('')}
        </article>

        <aside class="publish-submit-panel">
          <h3>${isEditMode && isPreviouslyPublishedDraft(draft) ? 'Submit Edits for Review' : 'Submit for Review'}</h3>
          <p>Current status: <strong>${escapeHtml(draft.status || 'draft')}</strong></p>
          <p>Last updated: ${escapeHtml(formattedEditDate(draft.updatedAt || draft.createdAt))}</p>
          ${reviewFailureNoticeMarkup(draft)}
          <p>Latest agreement: <strong>${escapeHtml(agreementLatest)}</strong></p>
          <p>Accepted agreement: <strong>${escapeHtml(agreementAccepted)}</strong></p>
          ${agreementAccepted !== agreementLatest ? '<p class="pricing-warning">A newer seller agreement version is available and must be accepted before publishing.</p>' : ''}
          <div class="launch-readiness">
            <p>${readiness.readyCount}/${readiness.totalCount} checks complete · ${readiness.percent}%</p>
            <div class="launch-readiness-bar"><span style="width:${readiness.percent}%"></span></div>
            <p>Warnings: ${readiness.warningCount} · Blocking: ${blockingIssues.length}</p>
          </div>
          <div class="publish-next-steps">
            <h4>What happens next?</h4>
            <ol>
              <li>Your product enters review.</li>
              <li>Marketplace staff checks metadata, files, agreement, and preview behavior.</li>
              <li>If approved, visibility settings go live.</li>
              <li>If changes are needed, you’ll see a dashboard notice.</li>
            </ol>
          </div>
          <div class="publish-action-row">
            <button type="button" class="button button-muted" data-save-draft>Save Draft</button>
            <button type="button" class="button button-muted" data-open-marketplace-preview>Marketplace Preview</button>
            <button type="button" class="button button-muted" data-publish-fix="media-upload">Back to Media & Upload</button>
            <button type="button" class="button button-accent" data-open-submit-confirm ${canSubmit ? '' : 'disabled'}>${escapeHtml(submitLabel)}</button>
          </div>
          ${submitStatusPanelMarkup()}
          ${canSubmit || editorState.isSubmittingReview || editorState.submitSuccess ? '' : '<p class="pricing-warning">Resolve blocked items before submitting.</p>'}
          ${(draft.status === 'review_pending') ? '<p class="agreement-accepted-status">Product is awaiting review.</p>' : ''}
          ${(draft.status === 'published') ? '<p class="dashboard-mini-note">Product is already published.</p>' : ''}
        </aside>
      </div>
      ${editorState.publishConfirmOpen ? `
        <div class="publish-confirm-backdrop">
          <div class="publish-confirm-modal">
            <h4>Submit product for review?</h4>
            <p>Your product will be reviewed before becoming visible in the marketplace. You can continue editing drafts, but published changes may require approval.</p>
            <div class="publish-action-row">
              <button type="button" class="button button-muted" data-close-submit-confirm>Cancel</button>
              <button type="button" class="button button-accent" data-confirm-submit-review ${editorState.isSubmittingReview ? 'disabled' : ''}>${escapeHtml(submitLabel)}</button>
            </div>
          </div>
        </div>
      ` : ''}
    </section>
  `
}

function renderProductInfoPanel() {
  const draft = editorState.draft || createEmptyProductDraft(editorState.user)
  const isEditMode = Boolean(editorState.requestedProductId || (draft.id && !isPlaceholderProductId(draft.id)))
  const releaseDisplay = draft.releasedAt ? formattedEditDate(draft.releasedAt) : (isEditMode ? (draft.publishedAt ? formattedEditDate(draft.publishedAt) : 'Not set') : 'Set automatically on publish')
  return `
    <section class="product-info-grid">
      <div class="product-info-field"><label>Product Title</label><input name="title" value="${escapeHtml(draft.title)}" /></div>
      <div class="product-info-field"><label>Slug</label><input name="slug" value="${escapeHtml(draft.slug)}" /></div>
      <div class="product-info-field"><label>Product Type</label><select name="productType">${PRODUCT_TYPE_OPTIONS.map((option) => `<option ${draft.productType === option ? 'selected' : ''}>${option}</option>`).join('')}</select></div>

      <div class="product-info-field"><label>Artist / Primary Creator</label><input name="artistName" value="${escapeHtml(draft.artistName)}" readonly class="locked-input" /></div>
      <div class="product-info-field"><label>Version</label><input name="version" value="${escapeHtml(draft.version || '')}" placeholder="v1.0" /></div>
      ${tagEditorMarkup('compatibilityNotes', 'Compatibility', 'Ableton, FL Studio, Serum')}

      ${tagEditorMarkup('tags', 'Tags', 'Press Enter to add tags')}
      ${tagEditorMarkup('categories', 'Categories', 'Press Enter to add categories')}
      ${tagEditorMarkup('genres', 'Genres', 'Press Enter to add genres')}

      <div class="product-info-field"><label>Short Description</label><input name="shortDescription" value="${escapeHtml(draft.shortDescription)}" /></div>
      <div class="product-info-field"><label>Release Date</label><div class="product-info-readonly">${escapeHtml(releaseDisplay)}</div></div>
      <div class="product-info-field"><label>Usage License</label><select name="usageLicense">${USAGE_LICENSE_OPTIONS.map((option) => `<option ${draft.usageLicense === option ? 'selected' : ''}>${option}</option>`).join('')}</select></div>

      <div class="product-info-field is-wide"><label>Long Description</label><div class="rich-editor-toolbar" data-rich-toolbar><button type="button" data-rich-cmd="bold">B</button><button type="button" data-rich-cmd="italic">I</button><button type="button" data-rich-cmd="underline">U</button><button type="button" data-rich-cmd="insertUnorderedList">• List</button><button type="button" data-rich-cmd="insertOrderedList">1. List</button><button type="button" data-rich-align="justifyLeft">Left</button><button type="button" data-rich-align="justifyCenter">Center</button><button type="button" data-rich-align="justifyRight">Right</button><button type="button" data-rich-link>Link</button><button type="button" data-rich-cmd="insertHorizontalRule">HR</button><select data-rich-font><option value="">Font</option><option>Arial</option><option>Georgia</option><option>Verdana</option></select><select data-rich-size><option value="">Size</option><option value="12px">12</option><option value="14px">14</option><option value="16px">16</option><option value="18px">18</option></select><input type="color" value="#e8efff" data-rich-color aria-label="Text color" /></div><div class="rich-description-editor" contenteditable="true" data-description-editor>${sanitizeRichDescription(draft.description || '')}</div><input type="hidden" name="description" value="${escapeHtml(draft.description)}" data-description-hidden /></div>
      <div class="product-info-side-stack">
        <div class="product-info-field"><label>Visibility</label><div class="product-info-readonly">${escapeHtml(isEditMode ? (draft.visibility || 'private') : 'Private until approved/published')}</div></div>
        <div class="product-info-field"><label>Status</label><div class="product-info-readonly">${escapeHtml(isEditMode ? (draft.status || 'draft') : 'Draft')}</div></div>
        <div class="product-info-field"><label>Edit Date</label><input type="date" value="${escapeHtml(formattedEditDate(draft.updatedAt || draft.createdAt))}" readonly /></div>
      </div>
    </section>
  `
}

function renderPlaceholderPanel(section) {
  return `<section class="placeholder-panel"><h3>${escapeHtml(PRODUCT_SECTIONS.find((item) => item.key === section)?.label || 'Section')}</h3><p>This section will be redesigned in the next pass. Product Info is fully redesigned now.</p></section>`
}

function renderMediaUploadPanel() {
  const draft = editorState.draft || createEmptyProductDraft(editorState.user)
  const fileEntries = gatherFileEntries()
  const currentFolderPath = sanitizeDeliverableFolderPath(editorState.currentDeliverableFolderPath || '')
  editorState.currentDeliverableFolderPath = currentFolderPath
  editorState.deliverableFolderPath = currentFolderPath
  const treeRows = buildFileTreeRows(fileEntries)
  const folderSegments = currentFolderPath ? currentFolderPath.split('/').filter(Boolean) : []
  const parentFolderPath = folderSegments.slice(0, -1).join('/')
  const previewCount = fileEntries.filter((item) => item.isPublicPreview).length
  const deliverableCount = fileEntries.filter((item) => item.isDeliverable).length
  const totalBytes = fileEntries.reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0)
  return `
    <section class="media-upload-workspace">
      <div class="media-upload-main-grid">
        <article class="listing-preview-panel">
          <h3>Listing Preview</h3>
          <article class="listing-preview-card">
            <div class="listing-preview-card-cover">${editorState.mediaPreview.cover || draft.coverURL || draft.thumbnailURL ? `<img src="${escapeHtml(editorState.mediaPreview.cover || draft.coverURL || draft.thumbnailURL)}" alt="Listing preview cover" />` : '<div class="listing-preview-fallback">No cover yet</div>'}</div>
            <div class="listing-preview-content">
              <p class="listing-preview-type">${escapeHtml(draft.productType || 'Product')}</p>
              <h4>${escapeHtml(draft.title || 'Untitled product')}</h4>
              <p>by ${escapeHtml(draft.artistName || 'Creator')}</p>
              <p>${escapeHtml(draft.shortDescription || 'Short description preview appears here.')}</p>
              <p>${draft.isFree ? 'Free' : `${escapeHtml(draft.currency || 'USD')} ${centsToPriceInput(Number(draft.priceCents || 0))}`}</p>
              <p>${tagValuesFor('tags').slice(0, 3).join(' · ') || tagValuesFor('genres').slice(0, 2).join(' · ') || 'No tags yet'}</p>
              <p>${toPathArray(draft.previewAudioPaths).length || toPathArray(draft.previewVideoPaths).length || editorState.mediaFiles.previewAudio.length || editorState.mediaFiles.previewVideo.length ? 'Preview assigned' : 'No preview media assigned yet'}</p>
            </div>
          </article>
        </article>

        <article class="file-viewer-panel">
          <div class="file-viewer-toolbar editor-file-toolbar">
            <div>
              <h3>Deliverables</h3>
              <p class="editor-file-stats">${fileEntries.length} ${fileEntries.length === 1 ? 'file' : 'files'} · ${formatBytes(totalBytes)} · ${deliverableCount} deliverable${deliverableCount === 1 ? '' : 's'}</p>
            </div>
            <div class="editor-file-add-wrap">
              <button type="button" class="editor-file-add-button" data-deliverable-add-menu-toggle aria-label="Add file or folder" aria-haspopup="menu" aria-expanded="${editorState.deliverableAddMenuOpen ? 'true' : 'false'}">+</button>
              <div class="editor-file-add-menu ${editorState.deliverableAddMenuOpen ? 'is-open' : ''}" data-deliverable-menu role="menu">
                <button type="button" data-deliverable-add-file role="menuitem">Add File</button>
                <button type="button" data-deliverable-create-folder role="menuitem">Create Folder</button>
              </div>
            </div>
          </div>
          <div class="editor-file-browser"><div class="editor-file-browser-header"><p>Files</p></div><div class="editor-file-browser-divider"></div><div class="editor-file-breadcrumbs"><button type="button" data-deliverable-folder-path="">Root</button>${folderSegments.map((segment, idx) => `<span>/</span><button type="button" class="${idx === folderSegments.length - 1 ? 'is-current' : ''}" data-deliverable-folder-path="${escapeHtml(folderSegments.slice(0, idx + 1).join('/'))}">${escapeHtml(segment.charAt(0).toUpperCase() + segment.slice(1))}</button>`).join('')}</div><div class="editor-file-list-wrap editor-file-browser-scroll"><div class="editor-file-list">
            ${treeRows.length
              ? `${currentFolderPath ? `<button type="button" class="editor-file-row is-back-row" data-deliverable-folder-path="${escapeHtml(parentFolderPath)}"><span class="editor-file-back-icon">${iconSvg('arrowLeft')}</span><span class="editor-file-name">Back</span><span class="editor-file-current-folder">${escapeHtml(folderSegments.at(-1) || 'Root')} · Parent folder</span><span class="editor-file-description">..</span></button>` : ''}${treeRows.map((row) => row.type === 'folder'
                ? `<div class="editor-file-row is-folder"><button type="button" class="editor-file-row-main" data-deliverable-folder-path="${escapeHtml(row.folder.path)}"><span class="editor-file-icon">${iconSvg('folder')}</span><span class="editor-file-name">${escapeHtml(row.folder.name)}</span><span class="editor-file-description">Folder · ${row.folder.fileCount} files · ${row.folder.folderCount} folders</span></button><div class="editor-file-row-actions"><button type="button" class="editor-file-menu-button" data-row-menu-toggle="folder:${escapeHtml(row.folder.path)}" aria-label="Open folder actions" aria-haspopup="menu" aria-expanded="${editorState.openDeliverableRowMenu === `folder:${row.folder.path}` ? 'true' : 'false'}">${iconSvg('moreVertical')}</button><div class="editor-file-row-menu ${editorState.openDeliverableRowMenu === `folder:${row.folder.path}` ? 'is-open' : ''}" role="menu"><button type="button" data-folder-action="rename:${escapeHtml(row.folder.path)}">Rename</button><button type="button" data-folder-action="move:${escapeHtml(row.folder.path)}">Move</button><button type="button" data-folder-action="delete:${escapeHtml(row.folder.path)}">Delete</button></div></div></div>`
                : `
                  <div class="editor-file-row is-file">
                    <button type="button" class="editor-file-row-main"><span class="editor-file-icon">${iconSvg('file')}</span><span class="editor-file-name">${escapeHtml(row.entry.name)}</span><span class="editor-file-description">${escapeHtml(formatBytes(row.entry.sizeBytes))}</span><span class="editor-file-status-pill is-${escapeHtml(row.entry.status || 'queued')}">${escapeHtml((row.entry.status || 'queued').replace('_', ' '))}${row.entry.status === 'uploading' ? ` ${Math.round(Number(row.entry.progress || 0))}%` : ''}</span></button>
                    <div class="editor-file-row-actions"><button type="button" class="editor-file-menu-button" data-row-menu-toggle="file:${escapeHtml(row.entry.id)}" aria-label="Open file actions" aria-haspopup="menu" aria-expanded="${editorState.openDeliverableRowMenu === `file:${row.entry.id}` ? 'true' : 'false'}">${iconSvg('moreVertical')}</button><div class="editor-file-row-menu ${editorState.openDeliverableRowMenu === `file:${row.entry.id}` ? 'is-open' : ''}" role="menu"><button type="button" data-file-action="rename:${escapeHtml(row.entry.id)}">Rename</button><button type="button" data-file-action="move:${escapeHtml(row.entry.id)}">Move</button><button type="button" data-file-action="delete:${escapeHtml(row.entry.id)}">Delete</button></div></div>
                    ${row.entry.status === 'uploading' ? `<div class="editor-file-progress"><span style="width:${Math.max(0, Math.min(100, Number(row.entry.progress || 0)))}%"></span></div>` : ''}
                  </div>`).join('')}`
              : '<p class="file-viewer-empty">No product files added yet. Use + Add to attach your main deliverable.</p>'}
          </div></div></div>
        </article>

        <aside class="media-upload-actions">
          <button type="button" class="media-upload-action-btn" data-pick-file="cover">Upload Cover Image</button>
          <button type="button" class="media-upload-action-btn" data-pick-file="gallery">Upload Product Images</button>
          <button type="button" class="media-upload-action-btn" data-pick-file="preview-audio">Upload Audio Preview</button>
          <button type="button" class="media-upload-action-btn" data-pick-file="preview-video">Upload Video Preview</button>
          <button type="button" class="media-upload-action-btn marketplace-preview-btn" data-open-marketplace-preview>Marketplace Preview</button>
          <div class="cover-preview-block">${editorState.mediaPreview.cover || draft.coverURL || draft.thumbnailURL ? `<img src="${escapeHtml(editorState.mediaPreview.cover || draft.coverURL || draft.thumbnailURL)}" alt="Cover preview" /><button type="button" data-remove-cover>Remove cover</button>` : '<span>No cover selected</span>'}</div>
          <p class="cover-ratio-note">Use a 1:1 square cover. Non-square images will be cropped in product cards.</p>
          <div class="gallery-thumb-scroller">${(editorState.mediaPreview.gallery || []).map((url, index) => `<div class="gallery-thumb"><img src="${escapeHtml(url)}" alt="Gallery image ${index + 1}" /><button type="button" data-remove-gallery="${index}" aria-label="Remove gallery image">×</button></div>`).join('')}</div>
          <input class="hidden-file" type="file" accept="image/*" data-cover-input />
          <input class="hidden-file" type="file" accept="image/*" multiple data-gallery-input />
          <input class="hidden-file" type="file" accept="audio/*" multiple data-preview-audio-input />
          <input class="hidden-file" type="file" accept="video/*" multiple data-preview-video-input />
          <input class="hidden-file" type="file" multiple data-deliverables-input />
        </aside>
      </div>
    </section>
  `
}

function hydrateLegacyContributors() {
  if (!editorState.contributorUI.rows.length) {
    const names = String(editorState.draft?.contributorNames || '').split(',').map((item) => item.trim()).filter(Boolean)
    const ids = String(editorState.draft?.contributorIds || '').split(',').map((item) => item.trim()).filter(Boolean)
    editorState.contributorUI.rows = names.map((name, index) => ({
      uid: ids[index] || `legacy-${index}`,
      displayName: name,
      username: '',
      avatarURL: '',
      role: '',
      status: ids[index] ? 'accepted' : 'accepted',
      decision: 'accepted',
      requestedAt: new Date().toISOString(),
      decisionAt: new Date().toISOString(),
      legacy: !ids[index]
    }))
  }
  ensureLocalContributorRow()
}

function recalcContributorSummaryFromRows() {
  ensureLocalContributorRow()
  const accepted = editorState.contributorUI.rows.filter((row) => row.status === 'accepted')
  const pending = editorState.contributorUI.rows.filter((row) => row.status === 'pending')
  updateDraftField('contributorIds', accepted.filter((row) => row.uid && !row.legacy).map((row) => row.uid).join(', '))
  updateDraftField('contributorNames', accepted.map((row) => row.displayName).join(', '))
  updateDraftField('contributorCount', accepted.length)
  updateDraftField('contributors', accepted.map((row) => ({ uid: row.uid || '', displayName: row.displayName || '', username: row.username || '', role: row.role || '', avatarURL: row.avatarURL || '', profilePath: row.profilePath || '', status: row.status || 'accepted', lockedOwner: Boolean(row.lockedOwner) })))
  updateDraftField('pendingContributorIds', pending.map((row) => row.uid).filter(Boolean))
  updateDraftField('contributorRequestCount', editorState.contributorUI.rows.length)
}

function renderContributorsPanel() {
  hydrateLegacyContributors()
  const rows = editorState.contributorUI.rows
    .filter((row) => editorState.contributorUI.filter === 'all' ? true : row.status === editorState.contributorUI.filter)
  return `
    <section class=\"contributors-workspace\">
      <article class=\"contributors-main-panel\">
        <h3>Contributing Artists</h3>
        <div class=\"contributors-toolbar\">
          <input class=\"contributor-search\" type=\"search\" value=\"${escapeHtml(editorState.contributorUI.search)}\" placeholder=\"Search users by username or display name…\" data-contributor-search />
          <input type=\"text\" value=\"${escapeHtml(editorState.contributorUI.role)}\" placeholder=\"Contribution role (Producer, Vocalist...)\" data-contributor-role />
        </div>
        <div class=\"contributor-results ${editorState.contributorUI.results.length ? '' : 'is-hidden'}\" data-contributor-results>
          ${editorState.contributorUI.results.map((profile) => `
            <button type=\"button\" data-add-contributor=\"${escapeHtml(profile.uid)}\">
              <img class=\"contributor-avatar\" src=\"${escapeHtml(profile.avatarURL || profile.photoURL || '')}\" alt=\"\" />
              <span>${escapeHtml(profile.displayName || 'User')} ${escapeHtml(formatUsername(profile.username))}</span>
            </button>
          `).join('')}
        </div>
        <div class=\"contributor-filter-row\">
          ${['all', 'pending', 'accepted', 'denied'].map((filter) => `<button type=\"button\" class=\"${editorState.contributorUI.filter === filter ? 'is-active' : ''}\" data-contributor-filter=\"${filter}\">${filter[0].toUpperCase()}${filter.slice(1)}</button>`).join('')}
        </div>
        <div class=\"contributor-table\">
          ${rows.length ? rows.map((row) => {
            const isOwner = Boolean(row.lockedOwner)
            const roleValue = isOwner ? 'Creator/Owner' : (row.role || '')
            return `
            <article class=\"contributor-row ${isOwner ? 'is-owner' : ''}\">
              <img class=\"contributor-avatar\" src=\"${escapeHtml(row.avatarURL || '')}\" alt=\"\" />
              <div class=\"contributor-identity\">
                <strong>${escapeHtml(row.displayName || 'Unknown')}</strong>
                <p>${escapeHtml(formatUsername(row.username) || 'manual')}</p>
                <p class=\"contributor-uid\">${escapeHtml(row.uid || '')}</p>
              </div>
              <div><input type=\"text\" value=\"${escapeHtml(roleValue)}\" data-contributor-role-edit=\"${escapeHtml(row.uid)}\" placeholder=\"Role\" ${isOwner ? 'disabled' : ''}/></div>
              <div>${escapeHtml((row.requestedAt || '').slice(0, 10) || '—')}</div>
              <div>${escapeHtml((row.decisionAt || '').slice(0, 10) || '—')}</div>
              <div><span class=\"contributor-status-badge is-${escapeHtml(row.status || 'pending')}\">${escapeHtml(row.status || 'pending')}</span></div>
              <div class=\"contributor-actions\">
                ${isOwner
                  ? '<span class=\"contributor-owner-label\">Creator</span>'
                  : `<button type=\"button\" data-contributor-status=\"${escapeHtml(row.uid)}:accepted\">Accept</button>
                    <button type=\"button\" data-contributor-status=\"${escapeHtml(row.uid)}:denied\">Deny</button>
                    <button type=\"button\" data-contributor-remove=\"${escapeHtml(row.uid)}\">Remove</button>`}
              </div>
            </article>
          `}).join('') : '<p class=\"contributor-empty-state\">No contributing artists added yet.</p>'}
        </div>
      </article>
      <aside class=\"contributors-notice\">
        <h4>Collaboration Notice:</h4>
        <p>To ensure accurate attribution, contributing artists are required to accept their collaboration request before being listed as credited additions to your product. Pending their acceptance, their names will not be visible on the product page.</p>
      </aside>
    </section>
  `
}

function renderEditor() {
  const section = readSectionHash()

  editorRoot.innerHTML = `
    <div class="marketplace-editor-page">
      ${editorState.restoreDraftPrompt ? '<div class="draft-restore-toast" data-draft-restore-toast><span>Restore your previous draft?</span><div><button type="button" data-restore-draft>Restore Draft</button><button type="button" data-dismiss-restore-draft>Dismiss</button></div></div>' : ''}
      <header class="marketplace-editor-header">
        <p class="marketplace-editor-header-kicker">NEW MARKETPLACE ITEM</p>
        <p class="marketplace-editor-header-copy">Configure product metadata, media, pricing, and publish state for the Melogic marketplace.</p>
      </header>
      ${renderEditorStatusMarkup()}

      <section class="marketplace-editor-tabs-wrap">
        <p class="marketplace-editor-pages-label"><span></span>PAGES<span></span></p>
        <div class="marketplace-editor-tabs">
          ${PRODUCT_SECTIONS.map((item) => `<button type="button" class="marketplace-editor-tab ${item.key === section ? 'is-active' : ''}" data-section="${item.key}">${item.label}</button>`).join('')}
        </div>
      </section>

      <section class="marketplace-editor-workspace">
        <form data-product-form>
          ${section === 'product-info'
            ? renderProductInfoPanel()
            : section === 'media-upload'
              ? renderMediaUploadPanel()
              : section === 'contributors'
                ? renderContributorsPanel()
                : section === 'pricing'
                  ? renderPricingPanel()
                  : section === 'agreements'
                    ? renderAgreementsPanel()
                    : section === 'creator-eligibility'
                      ? renderCreatorEligibilityPanel()
                    : section === 'publish'
                      ? renderPublishPanel()
                : renderPlaceholderPanel(section)}
          ${section === 'publish' ? '' : `
          <div class="editor-actions">
            <button type="button" class="button button-muted" data-save-draft>Save Draft</button>
            <button type="button" class="button button-accent" data-next-section>Next</button>
          </div>`}
        </form>
      </section>
    </div>
  `

  editorRoot.querySelectorAll('[data-section]').forEach((button) => {
    button.addEventListener('click', () => {
      window.location.hash = button.getAttribute('data-section')
      renderEditor()
    })
  })

  editorRoot.querySelectorAll('[data-publish-fix]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.getAttribute('data-publish-fix') || 'product-info'
      window.location.hash = target
      editorState.publishConfirmOpen = false
      renderEditor()
    })
  })

  editorRoot.querySelector('[data-open-submit-confirm]')?.addEventListener('click', () => {
    editorState.publishConfirmOpen = true
    renderEditor()
  })
  editorRoot.querySelector('[data-close-submit-confirm]')?.addEventListener('click', () => {
    editorState.publishConfirmOpen = false
    renderEditor()
  })
  editorRoot.querySelector('[data-creator-eligibility-attestation]')?.addEventListener('change', (event) => {
    editorState.creatorEligibility.attestationAccepted = event.target.checked === true
  })
  editorRoot.querySelector('[data-start-creator-eligibility]')?.addEventListener('click', () => {
    startCreatorEligibility()
  })
  editorRoot.querySelector('[data-next-section]')?.addEventListener('click', () => {
    const idx = PRODUCT_SECTIONS.findIndex((item) => item.key === section)
    const next = PRODUCT_SECTIONS[idx + 1]
    if (!next) return
    window.location.hash = next.key
    renderEditor()
  })
  editorRoot.querySelector('[data-next-section]')?.addEventListener('click', () => {
    const idx = PRODUCT_SECTIONS.findIndex((item) => item.key === section)
    const next = PRODUCT_SECTIONS[idx + 1]
    if (!next) return
    window.location.hash = next.key
    renderEditor()
  })

  const form = editorRoot.querySelector('[data-product-form]')
  editorRoot.querySelector('[data-restore-draft]')?.addEventListener('click', () => {
    if (!editorState.user) return
    editorState.draft = normalizeDraftPaths(applyCreatorIdentity(loadDraftState(editorState.user), editorState.user, editorState.creatorProfile))
    editorState.restoreDraftPrompt = false
    renderEditor()
  })
  editorRoot.querySelector('[data-dismiss-restore-draft]')?.addEventListener('click', () => {
    editorState.restoreDraftPrompt = false
    renderEditor()
  })
  if (editorState.restoreDraftPrompt) window.setTimeout(() => { editorState.restoreDraftPrompt = false; renderEditor() }, 10000)

  const descriptionEditor = form?.querySelector('[data-description-editor]')
  const descriptionHidden = form?.querySelector('[data-description-hidden]')
  let savedDescriptionRange = null

  const captureDescriptionRange = () => {
    const selection = window.getSelection()
    if (!descriptionEditor || !selection?.rangeCount) return
    const range = selection.getRangeAt(0)
    if (!descriptionEditor.contains(range.commonAncestorContainer)) return
    savedDescriptionRange = range.cloneRange()
  }

  const restoreDescriptionRange = () => {
    if (!descriptionEditor || !savedDescriptionRange) return
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(savedDescriptionRange)
  }

  const runRichCommand = (command, value = null) => {
    restoreDescriptionRange()
    descriptionEditor?.focus()
    document.execCommand(command, false, value)
    captureDescriptionRange()
    descriptionEditor?.dispatchEvent(new Event('input'))
  }

  descriptionEditor?.addEventListener('input', () => {
    const safe = sanitizeRichDescription(descriptionEditor.innerHTML || '')
    if (descriptionHidden) descriptionHidden.value = safe
    updateDraftField('description', safe)
    captureDescriptionRange()
  })
  ;['keyup', 'mouseup', 'focus'].forEach((eventName) => descriptionEditor?.addEventListener(eventName, captureDescriptionRange))
  form?.querySelector('[data-rich-toolbar]')?.addEventListener('pointerdown', captureDescriptionRange)

  form?.querySelectorAll('[data-rich-cmd]').forEach((button) => button.addEventListener('click', () => {
    const cmd = button.getAttribute('data-rich-cmd')
    if (!cmd) return
    runRichCommand(cmd)
  }))
  form?.querySelectorAll('[data-rich-align]').forEach((button) => button.addEventListener('click', () => {
    const cmd = button.getAttribute('data-rich-align')
    if (!cmd) return
    runRichCommand(cmd)
  }))
  form?.querySelector('[data-rich-link]')?.addEventListener('click', () => {
    const href = window.prompt('Enter link URL (http, https, or mailto):', 'https://') || ''
    if (!/^(https?:|mailto:)/i.test(href.trim())) return
    runRichCommand('createLink', href.trim())
  })
  form?.querySelector('[data-rich-font]')?.addEventListener('change', (event) => {
    const value = String(event.target.value || '').trim()
    if (!value) return
    runRichCommand('fontName', value)
  })
  form?.querySelector('[data-rich-size]')?.addEventListener('change', (event) => {
    const value = String(event.target.value || '').trim()
    if (!value) return
    document.execCommand('styleWithCSS', false, true)
    restoreDescriptionRange()
    descriptionEditor?.focus()
    document.execCommand('fontSize', false, '4')
    descriptionEditor?.querySelectorAll('font[size="4"]').forEach((node) => { node.removeAttribute('size'); node.style.fontSize = value })
    captureDescriptionRange()
    descriptionEditor?.dispatchEvent(new Event('input'))
  })
  form?.querySelector('[data-rich-color]')?.addEventListener('input', (event) => {
    document.execCommand('styleWithCSS', false, true)
    runRichCommand('foreColor', String(event.target.value || '#dbe9ff'))
  })

  form?.addEventListener('input', (event) => {
    const target = event.target
    if (!target?.name) return
    if (!(target.name in editorState.draft)) return
    if (['artistName', 'artistUsername', 'artistProfilePath', 'artistId'].includes(target.name)) return
    const value = target.type === 'checkbox' ? target.checked : target.value
    updateDraftField(target.name, value)
    if (target.name === 'slug') {
      editorState.slugLocked = Boolean(String(value || '').trim())
      saveDraftState()
      return
    }
    if (target.name === 'title' && !editorState.slugLocked) {
      const nextSlug = slugify(value)
      updateDraftField('slug', nextSlug)
      const slugInput = form.querySelector('input[name="slug"]')
      if (slugInput) slugInput.value = nextSlug
    }
  })

  form?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (editorState.deliverableAddMenuOpen || editorState.openDeliverableRowMenu)) {
      editorState.deliverableAddMenuOpen = false
      editorState.openDeliverableRowMenu = ''
      renderEditor()
      return
    }
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    const field = input.getAttribute('data-tag-input')
    if (!field) return
    if (event.key === 'Enter') {
      event.preventDefault()
      const value = input.value.trim()
      if (!value) return
      const values = [...tagValuesFor(field), value]
      setTagValues(field, Array.from(new Set(values)))
      input.value = ''
      renderEditor()
      return
    }
    if (event.key === 'Backspace' && !input.value.trim()) {
      const values = tagValuesFor(field)
      values.pop()
      setTagValues(field, values)
      renderEditor()
    }
  })

  editorRoot.querySelectorAll('[data-remove-tag]').forEach((button) => {
    button.addEventListener('click', () => {
      const field = button.getAttribute('data-tag-field') || ''
      const value = button.getAttribute('data-remove-tag') || ''
      setTagValues(field, tagValuesFor(field).filter((tag) => tag !== value))
      renderEditor()
    })
  })

  const pricingPriceInput = editorRoot.querySelector('[data-pricing-price-input]')
  pricingPriceInput?.addEventListener('input', () => {
    const targetCents = normalizePriceToCents(pricingPriceInput.value)
    updateDraftField('price', centsToPriceInput(targetCents))
    updateDraftField('isFree', targetCents === 0)
    const freeToggle = editorRoot.querySelector('[data-pricing-free-toggle]')
    if (freeToggle) freeToggle.checked = targetCents === 0
    syncPricingDraftFields()
    refreshPricingDom()
  })

  editorRoot.querySelector('[data-pricing-currency]')?.addEventListener('change', (event) => {
    const selectedCurrency = String(event.target.value || '').trim().toUpperCase()
    if (!selectedCurrency) return
    updateDraftField('currency', selectedCurrency)
    renderEditor()
  })

  editorRoot.querySelector('[data-pricing-free-toggle]')?.addEventListener('change', (event) => {
    const checked = Boolean(event.target.checked)
    updateDraftField('isFree', checked)
    if (checked) updateDraftField('price', '0.00')
    if (!checked && normalizePriceToCents(editorState.draft?.price || '') === 0) updateDraftField('price', '1.00')
    if (pricingPriceInput) pricingPriceInput.value = editorState.draft.price
    syncPricingDraftFields()
    refreshPricingDom()
  })

  editorRoot.querySelector('[data-agreement-signed-name]')?.addEventListener('input', (event) => {
    editorState.agreement.signedName = event.target.value
    refreshAgreementAcceptButton()
  })

  editorRoot.querySelector('[data-accept-agreement]')?.addEventListener('click', async () => {
    if (!editorState.user || !editorState.draft) return
    if (!editorState.agreement.config || editorState.agreement.loading || editorState.agreement.error || editorState.agreement.acceptanceBlockedReason) return
    const signedName = String(editorState.agreement.signedName || '').trim()
    if (signedName.length < 3) {
      setStatus('Please enter your full legal name before accepting the agreement.', 'error')
      renderEditor()
      return
    }
    if (!signedName.includes(' ') && signedName.length < 6) {
      setStatus('Please enter a full legal name (first and last preferred).', 'error')
      renderEditor()
      return
    }

    editorState.agreement.accepting = true
    renderEditor()
    let stage = 'signed-form-write'
    let latestVersion = String(editorState.agreement.config?.activeVersion || '')
    const agreementId = String(editorState.agreement.config?.agreementId || '')
    const uid = String(editorState.user.uid || '')
    const formKey = `${agreementId}_${latestVersion}`
    const currentUid = String(editorState.user.uid || '')
    try {
      const config = editorState.agreement.config
      latestVersion = String(config.activeVersion || 'v1')
      const agreementPayload = {
        agreementId,
        version: latestVersion,
        title: config.title,
        storagePath: config.storagePath,
        format: config.format || 'markdown',
        signedName,
        acceptedBy: uid,
        accepted: true,
        signedFormPath: `users/${uid}/signedForms/${formKey}`,
        acceptedAt: new Date().toISOString()
      }
      const signedFormRef = doc(db, 'users', uid, 'signedForms', formKey)
      await setDoc(signedFormRef, {
        formKey,
        agreementId,
        version: latestVersion,
        title: config.title,
        storagePath: config.storagePath,
        format: config.format || 'markdown',
        signedName,
        signedBy: uid,
        signedAt: serverTimestamp(),
        accepted: true,
        source: 'new-product-editor',
        updatedAt: serverTimestamp()
      }, { merge: true })
      updateDraftField('sellerAgreement', agreementPayload)
      updateDraftField('sellerAgreementAccepted', true)
      updateDraftField('sellerAgreementVersion', latestVersion)
      saveDraftState()
      setStatus('Agreement accepted.', 'success')
    } catch (error) {
      console.warn('[new-product] signed form acceptance failed', {
        code: error?.code,
        message: error?.message,
        uid: editorState.user?.uid || '',
        formKey,
        agreementId,
        latestVersion
      })
      setStatus('Could not save agreement acceptance. Please try again.', 'error')
    } finally {
      editorState.agreement.accepting = false
      renderEditor()
    }
  })

  editorRoot.querySelector('[data-retry-agreement-load]')?.addEventListener('click', () => {
    if (!editorState.user) return
    editorState.agreement.loading = true
    editorState.agreement.error = ''
    editorState.agreement.errorDetail = ''
    editorState.agreement.warning = ''
    editorState.agreement.source = ''
    editorState.agreement.loadedVersion = ''
    editorState.agreement.acceptanceBlockedReason = ''
    renderEditor()
    loadAgreementForEditor(editorState.user).catch((error) => {
      console.warn('[new-product] agreement retry failed unexpectedly', error?.code || error?.message || error)
    })
  })

  const coverInput = editorRoot.querySelector('[data-cover-input]')
  const galleryInput = editorRoot.querySelector('[data-gallery-input]')
  const previewAudioInput = editorRoot.querySelector('[data-preview-audio-input]')
  const previewVideoInput = editorRoot.querySelector('[data-preview-video-input]')
  const deliverablesInput = editorRoot.querySelector('[data-deliverables-input]')
  editorRoot.querySelector('[data-pick-file="cover"]')?.addEventListener('click', () => coverInput?.click())
  editorRoot.querySelector('[data-pick-file="gallery"]')?.addEventListener('click', () => galleryInput?.click())
  editorRoot.querySelector('[data-pick-file="preview-audio"]')?.addEventListener('click', () => previewAudioInput?.click())
  editorRoot.querySelector('[data-pick-file="preview-video"]')?.addEventListener('click', () => previewVideoInput?.click())
  editorRoot.querySelector('[data-pick-file="deliverables"]')?.addEventListener('click', () => deliverablesInput?.click())
  editorRoot.querySelector('[data-deliverable-add-menu-toggle]')?.addEventListener('click', (event) => {
    event.preventDefault()
    editorState.deliverableAddMenuOpen = !editorState.deliverableAddMenuOpen
    renderEditor()
  })
  editorRoot.querySelector('[data-deliverable-add-file]')?.addEventListener('click', () => {
    editorState.deliverableAddMenuOpen = false
    deliverablesInput?.click()
  })
  editorRoot.querySelector('[data-deliverable-create-folder]')?.addEventListener('click', () => {
    editorState.deliverableAddMenuOpen = false
    const base = sanitizeDeliverableFolderPath(editorState.currentDeliverableFolderPath || '')
    const raw = window.prompt('New folder name or path:', '') || ''
    const folderName = sanitizeDeliverableFolderPath(raw)
    const folder = sanitizeDeliverableFolderPath(base ? `${base}/${folderName}` : folderName)
    if (!folder) return
    editorState.deliverableFolders = Array.from(new Set([...(editorState.deliverableFolders || []), folder]))
    editorState.currentDeliverableFolderPath = folder
    editorState.deliverableFolderPath = folder
    setStatus(`Created folder ${folder}.`, 'info')
    renderEditor()
  })
  coverInput?.addEventListener('change', () => {
    const file = coverInput.files?.[0]
    if (!file) return
    editorState.mediaFiles.cover = file
    editorState.mediaPreview.cover = URL.createObjectURL(file)
    editorState.uploadQueue = [...editorState.uploadQueue.filter((item) => item.role !== 'cover'), queueFile('cover', file)]
    setStatus('Cover image selected and queued.', 'info')
    renderEditor()
  })
  galleryInput?.addEventListener('change', () => {
    const added = Array.from(galleryInput.files || [])
    editorState.mediaFiles.gallery = [...editorState.mediaFiles.gallery, ...added]
    editorState.mediaPreview.gallery = [...(editorState.mediaPreview.gallery || []), ...added.map((file) => URL.createObjectURL(file))]
    editorState.uploadQueue = [...editorState.uploadQueue, ...added.map((file) => queueFile('gallery', file))]
    setStatus('Product images selected and queued.', 'info')
    renderEditor()
  })
  previewAudioInput?.addEventListener('change', () => {
    editorState.mediaFiles.previewAudio = Array.from(previewAudioInput.files || [])
    editorState.uploadQueue = [
      ...editorState.uploadQueue.filter((item) => item.role !== 'previewAudio'),
      ...editorState.mediaFiles.previewAudio.map((file) => queueFile('previewAudio', file))
    ]
    setStatus('Audio previews selected and queued.', 'info')
    renderEditor()
  })
  previewVideoInput?.addEventListener('change', () => {
    editorState.mediaFiles.previewVideo = Array.from(previewVideoInput.files || [])
    editorState.uploadQueue = [
      ...editorState.uploadQueue.filter((item) => item.role !== 'previewVideo'),
      ...editorState.mediaFiles.previewVideo.map((file) => queueFile('previewVideo', file))
    ]
    setStatus('Video previews selected and queued.', 'info')
    renderEditor()
  })
  deliverablesInput?.addEventListener('change', () => {
    const selected = Array.from(deliverablesInput.files || [])
    if (!selected.length) return
    const existingPaths = new Set(editorState.uploadQueue.filter((item) => item.role === 'deliverable').map((item) => item.displayPath))
    const queued = []
    selected.forEach((file) => {
      const item = queueFile('deliverable', file)
      if (existingPaths.has(item.displayPath)) return
      existingPaths.add(item.displayPath)
      queued.push(item)
    })
    if (!queued.length) {
      setStatus('Deliverable already exists at that folder path.', 'error')
      renderEditor()
      return
    }
    editorState.mediaFiles.deliverables = [...editorState.mediaFiles.deliverables, ...selected]
    editorState.uploadQueue = [...editorState.uploadQueue, ...queued]
    setStatus('Deliverables added. Upload started.', 'info')
    renderEditor()
    uploadQueueItemsNow(queued)
  })
  editorRoot.querySelectorAll('[data-remove-file]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.getAttribute('data-remove-file'))
      const files = gatherFileEntries()
      const target = files[index]
      if (!target) return
      const map = {
        'Listing Media': 'gallery',
        'Preview Media': target.kind.startsWith('video/') ? 'previewVideo' : 'previewAudio',
        Deliverables: 'deliverables'
      }
      const key = map[target.category]
      if (!key) return
      editorState.mediaFiles[key] = (editorState.mediaFiles[key] || []).filter((row) => (row.webkitRelativePath || row.name) !== target.displayPath)
      editorState.uploadQueue = editorState.uploadQueue.filter((row) => row.id !== target.id)
      if (target.isDeliverable) syncDeliverableDraftMetadata()
      setStatus('File removed from draft.', 'info')
      renderEditor()
    })
  })
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-deliverable-menu]') && !event.target.closest('[data-deliverable-add-menu-toggle]') && editorState.deliverableAddMenuOpen) {
      editorState.deliverableAddMenuOpen = false
      renderEditor()
    }
    if (!event.target.closest('[data-row-menu-toggle]') && !event.target.closest('.editor-file-row-menu') && editorState.openDeliverableRowMenu) {
      editorState.openDeliverableRowMenu = ''
      renderEditor()
    }
  }, { once: true })
  editorRoot.querySelectorAll('[data-row-menu-toggle]').forEach((button) => button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const key = button.getAttribute('data-row-menu-toggle') || ''
    editorState.openDeliverableRowMenu = editorState.openDeliverableRowMenu === key ? '' : key
    renderEditor()
  }))
  editorRoot.querySelectorAll('[data-folder-action]').forEach((button) => button.addEventListener('click', async (event) => {
    event.preventDefault()
    event.stopPropagation()
    const [action, pathRaw] = String(button.getAttribute('data-folder-action') || '').split(':')
    const path = sanitizeDeliverableFolderPath(pathRaw || '')
    if (!path) return
    if (action === 'rename' || action === 'move') {
      const next = sanitizeDeliverableFolderPath(window.prompt(`${action === 'rename' ? 'Rename folder to' : 'Move folder to path'}`, path.split('/').at(-1) || path) || '')
      if (!next) return
      const parent = action === 'rename' ? path.split('/').slice(0, -1).join('/') : ''
      remapDeliverablePath(path, action === 'rename' ? sanitizeDeliverableFolderPath(parent ? `${parent}/${next}` : next) : next)
    }
    if (action === 'delete') {
      if (!window.confirm(`Delete folder ${path} and remove all nested files from this listing?`)) return
      const removedFiles = removeFolderFromEditorState(path)
      const uploaded = removedFiles.filter((item) => item.storagePath)
      for (const file of uploaded) {
        const result = await deleteProductStorageFile(file.storagePath)
        if (!result.ok && !result.objectNotFound) {
          setStatus(`Could not delete some storage files in ${path}.`, 'error')
          renderEditor()
          return
        }
      }
      setStatus(`Deleted folder ${path}.`, 'info')
    }
    editorState.openDeliverableRowMenu = ''
    renderEditor()
  }))
  editorRoot.querySelectorAll('[data-file-action]').forEach((button) => button.addEventListener('click', async (event) => {
    event.preventDefault()
    event.stopPropagation()
    const [action, id] = String(button.getAttribute('data-file-action') || '').split(':')
    const updateFile = (mapper) => {
      editorState.uploadQueue = editorState.uploadQueue.map((item) => item.id === id ? mapper(item) : item)
      if (Array.isArray(editorState.draft?.deliverableFiles)) updateDraftField('deliverableFiles', editorState.draft.deliverableFiles.map((item) => item.id === id ? mapper(item) : item))
      syncDeliverableDraftMetadata()
    }
    if (action === 'rename') {
      const target = gatherFileEntries().find((row) => row.id === id)
      if (!target) return
      const nextName = String(window.prompt('Rename file', target.name || '') || '').trim()
      if (!nextName) return
      updateFile((item) => ({ ...item, name: nextName, displayPath: item.folderPath ? `${item.folderPath}/${nextName}` : nextName }))
    }
    if (action === 'move') {
      const target = gatherFileEntries().find((row) => row.id === id)
      if (!target) return
      const nextFolder = sanitizeDeliverableFolderPath(window.prompt('Move file to folder path (empty for Root)', target.folderPath || '') || '')
      updateFile((item) => ({ ...item, folderPath: nextFolder, displayPath: nextFolder ? `${nextFolder}/${item.name}` : item.name }))
      if (nextFolder) editorState.deliverableFolders = Array.from(new Set([...(editorState.deliverableFolders || []), nextFolder]))
    }
    if (action === 'delete') {
      if (!window.confirm('Remove this file from the listing manifest?')) return
      const target = gatherFileEntries().find((row) => row.id === id)
      if (target?.status === 'uploading') {
        setStatus('Wait for upload to finish before deleting this file.', 'error')
        return
      }
      if (target?.storagePath) {
        const result = await deleteProductStorageFile(target.storagePath)
        if (!result.ok && !result.objectNotFound) {
          setStatus('Failed to delete the uploaded storage file. Try again.', 'error')
          return
        }
      }
      editorState.uploadQueue = editorState.uploadQueue.filter((item) => item.id !== id)
      if (Array.isArray(editorState.draft?.deliverableFiles)) updateDraftField('deliverableFiles', editorState.draft.deliverableFiles.filter((item) => item.id !== id))
      syncDeliverableDraftMetadata()
    }
    editorState.openDeliverableRowMenu = ''
    renderEditor()
  }))
  editorRoot.querySelectorAll('[data-deliverable-folder-path]').forEach((button) => {
    button.addEventListener('click', () => {
      const path = sanitizeDeliverableFolderPath(button.getAttribute('data-deliverable-folder-path') || '')
      editorState.currentDeliverableFolderPath = path
      editorState.deliverableFolderPath = path
      renderEditor()
    })
  })
  editorRoot.querySelectorAll('.editor-file-row.is-folder[data-deliverable-folder-path]').forEach((row) => row.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    const path = sanitizeDeliverableFolderPath(row.getAttribute('data-deliverable-folder-path') || '')
    editorState.currentDeliverableFolderPath = path
    editorState.deliverableFolderPath = path
    renderEditor()
  }))
  editorRoot.querySelector('[data-remove-cover]')?.addEventListener('click', () => {
    editorState.mediaFiles.cover = null
    editorState.mediaPreview.cover = ''
    editorState.uploadQueue = editorState.uploadQueue.filter((item) => item.role !== 'cover' && item.role !== 'thumbnail')
    updateDraftField('coverPath', '')
    updateDraftField('thumbnailPath', '')
    renderEditor()
  })
  editorRoot.querySelectorAll('[data-remove-gallery]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.getAttribute('data-remove-gallery'))
      editorState.mediaFiles.gallery = editorState.mediaFiles.gallery.filter((_, i) => i !== index)
      editorState.mediaPreview.gallery = (editorState.mediaPreview.gallery || []).filter((_, i) => i !== index)
      const galleryQueue = editorState.uploadQueue.filter((item) => item.role === 'gallery')
      const removeId = galleryQueue[index]?.id
      if (removeId) editorState.uploadQueue = editorState.uploadQueue.filter((item) => item.id !== removeId)
      renderEditor()
    })
  })
  editorRoot.querySelectorAll('[data-file-description-input]').forEach((input) => {
    input.addEventListener('input', () => {
      const id = input.getAttribute('data-file-description-input') || ''
      const value = String(input.value || '').slice(0, 150)
      editorState.uploadQueue = editorState.uploadQueue.map((item) => item.id === id ? { ...item, description: value } : item)
      if (editorState.draft?.deliverableFiles) {
        updateDraftField('deliverableFiles', editorState.draft.deliverableFiles.map((item) => item.id === id ? { ...item, description: value, updatedAt: new Date().toISOString() } : item))
      }
      syncDeliverableDraftMetadata()
    })
  })

  editorRoot.querySelectorAll('[data-assign-role]').forEach((button) => {
    button.addEventListener('click', () => {
      const [indexRaw, role] = String(button.getAttribute('data-assign-role') || '').split(':')
      const file = gatherFileEntries()[Number(indexRaw)]
      if (!file) return
      if (role === 'hover-audio') updateDraftField('previewAudioPaths', `products/${editorState.draft.id || '{id}'}/audio-previews/${file.name}`)
      if (role === 'hover-video') updateDraftField('previewVideoPaths', `products/${editorState.draft.id || '{id}'}/video-previews/${file.name}`)
      setStatus('Preview role assigned. Save draft to persist uploads.', 'info')
      renderEditor()
    })
  })
  editorRoot.querySelectorAll('[data-open-marketplace-preview]').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      const productId = await saveCurrentDraftAndReturnId({ reason: 'marketplace-preview', desiredStatus: 'draft' })
      if (!productId) throw new Error('missing-product-id-after-save')
      window.open(`${productRoute(productId)}?preview=draft`, '_blank', 'noopener,noreferrer')
    } catch (error) {
      console.warn('[new-product] marketplace preview failed', { code: error?.code, message: error?.message })
      setStatus('Could not save draft for preview. Check required fields and try again.', 'error')
      renderEditor()
    }
  }))

  const contributorSearchInput = editorRoot.querySelector('[data-contributor-search]')
  const contributorRoleInput = editorRoot.querySelector('[data-contributor-role]')
  let contributorSearchTimer = null
  contributorSearchInput?.addEventListener('input', async () => {
    editorState.contributorUI.search = contributorSearchInput.value
    if (editorState.contributorUI.search.trim().length < 2) {
      editorState.contributorUI.results = []
      refreshContributorResultsDom()
      return
    }
    window.clearTimeout(contributorSearchTimer)
    contributorSearchTimer = window.setTimeout(async () => {
      try {
        editorState.contributorUI.results = await searchProfilesByUsername(editorState.contributorUI.search.trim())
      } catch {
        editorState.contributorUI.results = []
      }
      refreshContributorResultsDom()
    }, 180)
  })
  contributorRoleInput?.addEventListener('input', () => {
    editorState.contributorUI.role = contributorRoleInput.value
  })
  bindContributorAddButtons(editorRoot)
  editorRoot.querySelectorAll('[data-contributor-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      editorState.contributorUI.filter = button.getAttribute('data-contributor-filter') || 'all'
      renderEditor()
    })
  })
  editorRoot.querySelectorAll('[data-contributor-status]').forEach((button) => {
    button.addEventListener('click', async () => {
      const [uid, status] = String(button.getAttribute('data-contributor-status') || '').split(':')
      const targetRow = editorState.contributorUI.rows.find((row) => row.uid === uid)
      if (targetRow?.lockedOwner) return
      editorState.contributorUI.rows = editorState.contributorUI.rows.map((row) => row.uid === uid ? { ...row, status, decision: status, decisionAt: new Date().toISOString() } : row)
      recalcContributorSummaryFromRows()
      if (editorState.draft?.id && !isPlaceholderProductId(editorState.draft.id)) await recalculateAcceptedContributors(editorState.draft.id)
      renderEditor()
    })
  })
  editorRoot.querySelectorAll('[data-contributor-remove]').forEach((button) => {
    button.addEventListener('click', async () => {
      const uid = button.getAttribute('data-contributor-remove') || ''
      editorState.contributorUI.rows = editorState.contributorUI.rows.filter((row) => row.uid !== uid)
      recalcContributorSummaryFromRows()
      if (editorState.draft?.id && !isPlaceholderProductId(editorState.draft.id) && editorState.user) {
        await removeProductContributorRequest({ productId: editorState.draft.id, ownerUid: editorState.user.uid, targetUid: uid })
      }
      renderEditor()
    })
  })
  editorRoot.querySelectorAll('[data-contributor-role-edit]').forEach((input) => {
    input.addEventListener('input', (event) => {
      const uid = input.getAttribute('data-contributor-role-edit') || ''
      const value = event.target.value
      const targetRow = editorState.contributorUI.rows.find((row) => row.uid === uid)
      if (targetRow?.lockedOwner) return
      editorState.contributorUI.rows = editorState.contributorUI.rows.map((row) => row.uid === uid ? { ...row, role: value } : row)
    })
  })

  async function persistProduct(desiredStatus = 'draft') {
    if (!editorState.user || !editorState.draft) return
    const submittingForReview = desiredStatus === 'published'
    if (submittingForReview && editorState.isSubmittingReview) return
    const pricingMetrics = syncPricingDraftFields()
    if (pricingMetrics?.invalidConfig) {
      setStatus('Marketplace fee configuration is invalid.', 'error')
      renderEditor()
      return
    }
    if (desiredStatus === 'published') {
      const eligibility = await loadCreatorEligibility({ force: true })
      if (eligibility.required !== false && eligibility.status !== 'verified') {
        editorState.submitError = creatorEligibilityMessage(eligibility)
        setStatus(editorState.submitError, 'error')
        window.location.hash = 'creator-eligibility'
        renderEditor()
        return
      }
      const requiredVersion = String(editorState.agreement.latestVersion || editorState.agreement.config?.activeVersion || '')
      const agreementId = String(editorState.agreement.config?.agreementId || '')
      const formKey = `${agreementId}_${requiredVersion}`
      const signedFormSnap = await getDoc(doc(db, 'users', editorState.user.uid, 'signedForms', formKey))
      const signedFormAccepted = signedFormSnap.exists() && signedFormSnap.data()?.accepted === true
      const acceptedVersion = String(editorState.draft.sellerAgreementVersion || '')
      const accepted = signedFormAccepted || (Boolean(editorState.draft.sellerAgreementAccepted) && acceptedVersion && acceptedVersion === requiredVersion)
      if (!accepted) {
        setStatus(`Latest seller agreement ${requiredVersion || 'version'} must be accepted before publishing.`, 'error')
        renderEditor()
        return
      }
    }
    if (submittingForReview) {
      editorState.isSubmittingReview = true
      editorState.submitError = ''
      editorState.submitSuccess = false
      editorState.lastSubmitResult = null
      setSubmitProgress('saving-product-draft', 'Saving product draft...')
    } else {
      setStatus('Saving draft...', 'info')
    }
    renderEditor()
    let submitStep = 'starting'
    try {
      const pendingContributors = (editorState.contributorUI.rows || []).filter((row) => row.status === 'pending').length
      if (desiredStatus === 'published' && pendingContributors > 0) {
        editorState.isSubmittingReview = false
        editorState.submitError = 'Pending contributor approvals must be resolved before publishing.'
        setStatus('Pending contributor approvals must be resolved before publishing.', 'error')
        renderEditor()
        return
      }
      const deliverableValidation = validateDraftFiles(editorState.draft, editorState.mediaFiles)
      if (!deliverableValidation.ok) {
        editorState.isSubmittingReview = false
        editorState.submitError = deliverableValidation.errors[0]
        setStatus(deliverableValidation.errors[0], 'error')
        renderEditor()
        return
      }
      if (desiredStatus === 'published' && deliverableValidation.warnings.includes('No deliverable has been added yet.')) {
        editorState.isSubmittingReview = false
        editorState.submitError = 'Add a deliverable before submitting for review.'
        setStatus('Add a deliverable before submitting for review.', 'error')
        renderEditor()
        return
      }
      submitStep = 'create-product-shell'
      if (submittingForReview) setSubmitProgress('saving-product-draft', 'Saving product draft...')
      const existingDraftId = editorState.draft?.id && !isPlaceholderProductId(editorState.draft.id)
        ? editorState.draft.id
        : ''
      if (isDevelopmentRuntime) {
        console.info('[new-product] using productId for submit', existingDraftId || '(server-generated)')
      }
      const shell = await createOrUpdateProductShell(editorState.draft, editorState.user)
      if (isDevelopmentRuntime) console.info('[new-product] shell result', shell)
      const productId = shell.productId
      editorState.draft.id = productId
      updateDraftField('id', productId)
      submitStep = 'upload-files'
      if (editorState.uploadQueue.some((item) => item.status === 'uploading')) {
        editorState.isSubmittingReview = false
        editorState.submitError = 'Wait for uploads to finish before publishing.'
        setStatus('Wait for uploads to finish before publishing.', 'error')
        renderEditor()
        return
      }
      const uploadedFiles = []
      const hasPendingUploads = editorState.uploadQueue.some((item) => item.status !== 'uploaded' || !item.storagePath)
      if (submittingForReview && hasPendingUploads) setSubmitProgress('uploading-files', 'Uploading files...')
      for (let index = 0; index < editorState.uploadQueue.length; index += 1) {
        const item = editorState.uploadQueue[index]
        if (item.status === 'uploaded' && item.storagePath) {
          uploadedFiles.push(item)
          continue
        }
        submitStep = `upload-${item.role}`
        editorState.uploadQueue[index] = { ...item, status: 'uploading', error: '' }
        renderEditor()
        const uploaded = await uploadProductFile({ productId, queueItem: item, onProgress: (progress) => { editorState.uploadQueue[index] = { ...editorState.uploadQueue[index], progress, status: 'uploading' }; renderEditor() } })
        editorState.uploadQueue[index] = { ...uploaded, status: 'uploaded', progress: 100 }
        uploadedFiles.push(uploaded)
      }
      syncDeliverableDraftMetadata()
      submitStep = 'save-product-manifest'
      if (submittingForReview) setSubmitProgress('saving-product-manifest', 'Saving product manifest...')
      const manifestResult = await saveProductManifest({ productId, draft: editorState.draft, uploadedFiles, user: editorState.user })
      if (manifestResult?.manifest) {
        editorState.draft = { ...editorState.draft, ...manifestResult.manifest, id: productId }
        saveDraftState()
      }
      if (desiredStatus === 'published') {
        submitStep = 'submit-for-review'
        setSubmitProgress('requesting-marketplace-review', 'Requesting marketplace review...')
        const reviewResult = await submitProductForReview({ productId })
        editorState.reviewResult = reviewResult || null
        editorState.lastSubmitResult = reviewResult || null
        const latest = await getProductById(productId).catch(() => null)
        if (latest) editorState.draft = { ...editorState.draft, ...latest, id: productId }
        const resolvedStatus = latest?.status || reviewResult?.status || 'review_pending'
        updateDraftField('status', resolvedStatus)
        updateDraftField('visibility', latest?.visibility || editorState.draft.visibility || 'private')
        editorState.isSubmittingReview = false
        editorState.submitSuccess = resolvedStatus !== 'needs_changes'
        if (resolvedStatus === 'published') setSubmitProgress('submitted-for-review', 'Product published. It is now public.', 'success')
        else if (resolvedStatus === 'needs_changes') {
          editorState.submitError = 'Product needs changes before publishing.'
          setSubmitProgress('submitted-for-review', 'Product needs changes before publishing.', 'error')
        } else setSubmitProgress('submitted-for-review', 'Product submitted for review. It will not appear publicly until approved.', 'success')
        console.info('[new-product] review final state', {
          status: latest?.status || reviewResult?.status || '',
          visibility: latest?.visibility || '',
          moderationStatus: latest?.moderationStatus || reviewResult?.moderationStatus || '',
          moderationSummary: latest?.moderationSummary || reviewResult?.summary || '',
          moderationAIConfigured: latest?.moderationAIConfigured ?? reviewResult?.aiConfigured ?? null,
          moderationAIAttempted: latest?.moderationAIAttempted ?? reviewResult?.aiAttempted ?? null,
          moderationAISucceeded: latest?.moderationAISucceeded ?? reviewResult?.aiSucceeded ?? null,
          moderationAIError: latest?.moderationAIError || reviewResult?.error || '',
          moderationAIErrorCode: latest?.moderationAIErrorCode || reviewResult?.errorCode || '',
          moderationAIErrorCategory: latest?.moderationAIErrorCategory || reviewResult?.errorCategory || '',
          reviewJobStatus: latest?.reviewJobStatus || reviewResult?.reviewJobStatus || ''
        })
      }
      if (desiredStatus !== 'published') setStatus('Draft saved.', 'success')
      renderEditor()
    } catch (error) {
      console.error('[new-product] submit failed', {
        submitStep,
        code: error?.code,
        message: error?.message,
        details: error?.details || null,
        productId: editorState.draft?.id || '',
        uid: editorState.user?.uid || '',
        productShellDiagnostics: error?.productShellDiagnostics || null,
        error
      })
      if (submittingForReview) {
        editorState.isSubmittingReview = false
        editorState.submitSuccess = false
        editorState.submitError = friendlySubmitError(error, submitStep)
      }
      setStatus(submittingForReview ? editorState.submitError : `Save failed during ${submitStep}: ${error?.message || 'Unknown error'}`, 'error')
      renderEditor()
    }
  }

  editorRoot.querySelector('[data-save-draft]')?.addEventListener('click', () => persistProduct('draft'))
  editorRoot.querySelector('[data-confirm-submit-review]')?.addEventListener('click', async () => {
    editorState.publishConfirmOpen = false
    try {
      await persistProduct('published')
    } catch (error) {
      console.warn('[new-product] submit review failed', {
        code: error?.code,
        message: error?.message,
        stage: error?.stage || 'submit-review'
      })
      setStatus('Could not submit for review.', 'error')
      renderEditor()
    }
  })
}

async function initPage() {
  const user = await waitForInitialAuthState()
  if (!user) {
    editorRoot.innerHTML = `<article class="product-editor-card signed-out"><h2>Sign in required</h2><a class="button button-accent" href="${ROUTES.auth}">Go to Sign In / Sign Up</a></article>`
    return
  }

  editorState.user = user
  editorState.creatorProfile = await fetchPublicCreatorProfile(user.uid)
  editorState.marketplacePricingSettings = await getMarketplacePricingSettings()
  await loadCreatorEligibility({ force: true })
  editorState.agreement.loading = true
  editorState.agreement.error = ''

  if (editorState.requestedProductId) {
    try {
      console.info('[new-product] loading edit listing', { productId: editorState.requestedProductId, mode: editorState.requestedMode, pathname: window.location.pathname })
      const existingProduct = await getProductById(editorState.requestedProductId)
      if (!existingProduct || existingProduct.artistId !== user.uid) {
        editorRoot.innerHTML = `<article class="product-editor-card signed-out"><h2>Listing access denied</h2><a class="button button-accent" href="${ROUTES.products}">Back to Products</a></article>`
        return
      }
      editorState.draft = normalizeDraftPaths(applyCreatorIdentity({ ...createEmptyProductDraft(user, editorState.creatorProfile), ...existingProduct, id: existingProduct.id }, user, editorState.creatorProfile))
    } catch (error) {
      console.warn('[newProduct] failed to load editable product', { productId: editorState.requestedProductId, message: error?.message })
      editorRoot.innerHTML = `<article class="product-editor-card signed-out"><h2>Couldn’t load listing</h2><p>${escapeHtml(error?.message || 'Unknown error')}</p><a class="button button-accent" href="${ROUTES.products}">Back to Products</a></article>`
      return
    }
  } else {
    editorState.draft = normalizeDraftPaths(applyCreatorIdentity(createEmptyProductDraft(user, editorState.creatorProfile), user, editorState.creatorProfile))
  }
  if (!editorState.requestedProductId) {
    try {
      const raw = sessionStorage.getItem(getDraftStorageKey(user))
      editorState.restoreDraftPrompt = Boolean(raw)
    } catch {}
  }

  if (!editorState.draft.currency) {
    updateDraftField('currency', editorState.marketplacePricingSettings?.defaultCurrency || 'USD')
  }
  if (!normalizePriceToCents(editorState.draft.price) && Number.isFinite(editorState.draft.payoutTargetCents) && editorState.draft.payoutTargetCents > 0) {
    updateDraftField('price', centsToPriceInput(editorState.draft.payoutTargetCents))
  } else if (!normalizePriceToCents(editorState.draft.price) && Number.isFinite(editorState.draft.priceCents) && editorState.draft.priceCents > 0) {
    updateDraftField('price', centsToPriceInput(editorState.draft.priceCents))
  }
  syncPricingDraftFields()

  editorState.agreement.signedName = String(editorState.draft.sellerAgreement?.signedName || '')
  editorState.agreement.loading = true
  editorState.agreement.error = ''
  editorState.agreement.errorDetail = ''
  editorState.agreement.warning = ''
  editorState.agreement.source = ''
  editorState.agreement.loadedVersion = ''
  editorState.agreement.acceptanceBlockedReason = ''
  renderEditor()

  loadAgreementForEditor(user).catch((error) => {
    console.warn('[new-product] agreement background load failed unexpectedly', error?.code || error?.message || error)
  })
}

async function loadAgreementForEditor(user) {
  const requestId = Number(editorState.agreement.loadRequestId || 0) + 1
  editorState.agreement.loadRequestId = requestId
  const isCurrentLoad = () => editorState.agreement.loadRequestId === requestId
  const timeoutId = setTimeout(() => {
    if (!isCurrentLoad() || !editorState.agreement.loading) return
    editorState.agreement.loading = false
    editorState.agreement.markdown = ''
    editorState.agreement.error = 'Seller agreement could not be loaded.'
    editorState.agreement.errorDetail = 'Reason: agreement-timeout · The request timed out. Firebase Storage CORS or permissions may need configuration.'
    renderEditor()
  }, 12000)
  let agreementId = ''
  let latestVersion = ''
  let agreementConfig = null
  try {
    let stage = 'latest-agreement-config'
    agreementConfig = await getLatestMarketplaceSellerAgreement()
    if (!isCurrentLoad()) return
    editorState.agreement.config = agreementConfig
    editorState.agreement.latestVersion = agreementConfig.activeVersion
    editorState.agreement.error = ''
    editorState.agreement.errorDetail = ''
    editorState.agreement.warning = agreementConfig.versionDiscoveryWarning || ''
    editorState.agreement.source = ''
    editorState.agreement.loadedVersion = ''
    editorState.agreement.acceptanceBlockedReason = ''
    agreementId = String(agreementConfig.agreementId || '')
    latestVersion = String(agreementConfig.activeVersion || '')

    stage = 'agreement-markdown'
    try {
      const agreementResult = await getAgreementMarkdown(agreementConfig.storagePath, {
        returnMetadata: true
      })
      if (!isCurrentLoad()) return
      editorState.agreement.markdown = agreementResult.markdown || ''
      editorState.agreement.source = agreementResult.source || ''
      editorState.agreement.loadedVersion = agreementResult.version || ''
      editorState.agreement.warning = agreementResult.warning || editorState.agreement.warning || ''
      if (editorState.agreement.loadedVersion && latestVersion && editorState.agreement.loadedVersion !== latestVersion) {
        editorState.agreement.acceptanceBlockedReason = `Showing ${editorState.agreement.loadedVersion}; load latest seller agreement ${latestVersion} before accepting.`
      }
      editorState.agreement.error = ''
      editorState.agreement.errorDetail = ''
    } catch (markdownError) {
      if (!isCurrentLoad()) return
      editorState.agreement.markdown = ''
      editorState.agreement.loadedVersion = ''
      editorState.agreement.acceptanceBlockedReason = ''
      editorState.agreement.error = 'Seller agreement could not be loaded.'
      editorState.agreement.errorDetail = [
        markdownError?.code ? `Reason: ${markdownError.code}` : '',
        markdownError?.message || '',
        markdownError?.details?.storagePath ? `Storage path: ${markdownError.details.storagePath}` : ''
      ].filter(Boolean).join(' · ')
      console.warn('[new-product] agreement markdown load failed', {
        stage,
        code: markdownError?.code,
        message: markdownError?.message,
        storagePath: agreementConfig.storagePath
      })
    }
    clearTimeout(timeoutId)
    if (isCurrentLoad()) {
      editorState.agreement.loading = false
      renderEditor()
    }

    try {
      stage = 'signed-form-read'
      const formKey = `${agreementId}_${latestVersion}`
      const signedFormSnap = await getDoc(doc(db, 'users', user.uid, 'signedForms', formKey))
      if (!isCurrentLoad()) return
      if (signedFormSnap.exists() && signedFormSnap.data()?.accepted === true) {
        const signedForm = signedFormSnap.data() || {}
        updateDraftField('sellerAgreement', {
          agreementId,
          version: latestVersion,
          title: signedForm.title || agreementConfig.title,
          storagePath: signedForm.storagePath || agreementConfig.storagePath,
          format: signedForm.format || agreementConfig.format || 'markdown',
          signedName: signedForm.signedName || editorState.agreement.signedName || '',
          acceptedBy: user.uid,
          accepted: true,
          signedFormPath: `users/${user.uid}/signedForms/${formKey}`,
          acceptedAt: (typeof signedForm.signedAt?.toDate === 'function' ? signedForm.signedAt.toDate().toISOString() : new Date().toISOString())
        })
        updateDraftField('sellerAgreementAccepted', true)
        updateDraftField('sellerAgreementVersion', latestVersion)
        editorState.agreement.signedName = String(signedForm.signedName || editorState.agreement.signedName || '')
      }
    } catch (error) {
      console.warn('[new-product] agreement load failed', {
        stage: 'signed-form-read',
        code: error?.code,
        message: error?.message,
        uid: editorState.user?.uid || '',
        agreementId,
        latestVersion
      })
    }
    if (editorState.draft.sellerAgreementVersion && editorState.draft.sellerAgreementVersion !== agreementConfig.activeVersion) {
      updateDraftField('sellerAgreementAccepted', false)
    }
  } catch (error) {
    if (!isCurrentLoad()) return
    console.warn('[new-product] agreement load failed', {
      stage: editorState.agreement.config ? 'agreement-markdown' : 'latest-agreement-config',
      code: error?.code,
      message: error?.message,
      uid: editorState.user?.uid || '',
      agreementId,
      latestVersion
    })
    editorState.agreement.latestVersion = ''
    editorState.agreement.error = 'Seller agreement could not be loaded.'
    editorState.agreement.errorDetail = [
      error?.code ? `Reason: ${error.code}` : '',
      error?.message || '',
      agreementConfig?.storagePath ? `Storage path: ${agreementConfig.storagePath}` : ''
    ].filter(Boolean).join(' · ')
  } finally {
    clearTimeout(timeoutId)
    if (isCurrentLoad()) {
      editorState.agreement.loading = false
      renderEditor()
    }
  }
}

window.addEventListener('hashchange', () => {
  if (!editorState.user) return
  renderEditor()
})

initPage()
async function saveCurrentDraftAndReturnId({ reason = 'save', desiredStatus = 'draft' } = {}) {
  if (!editorState.user || !editorState.draft) throw new Error('missing-user-or-draft')
  if (!String(editorState.draft.title || '').trim()) throw new Error('Add a product title before saving this draft.')
  if (!String(editorState.draft.artistId || editorState.user.uid || '').trim()) throw new Error('missing-artist-id')
  const fileValidation = validateDraftFiles(editorState.draft, editorState.mediaFiles)
  if (!fileValidation.ok) throw new Error(fileValidation.errors[0] || 'draft-file-validation-failed')
  if (reason === 'submit-review' && fileValidation.warnings.includes('No deliverable has been added yet.')) {
    throw new Error('Add a deliverable before submitting for review.')
  }
  const wasNewDraft = !editorState.draft.id || isPlaceholderProductId(editorState.draft.id)
  const payload = buildProductPayload({
    ...editorState.draft,
    artistId: editorState.user.uid,
    visibility: editorState.draft.visibility || 'private',
    status: desiredStatus === 'published' ? 'review_pending' : 'draft'
  }, editorState.user)
  const result = await saveProductDraft(editorState.user, payload, {
    productId: wasNewDraft ? '' : editorState.draft.id,
    status: desiredStatus === 'published' ? 'review_pending' : 'draft',
    isNew: wasNewDraft,
    mediaFiles: editorState.mediaFiles,
    galleryFiles: editorState.mediaFiles.gallery,
    previewAudioFiles: editorState.mediaFiles.previewAudio,
    previewVideoFiles: editorState.mediaFiles.previewVideo
  })
  const savedId = result?.id || result?.productId || ''
  if (savedId) {
    editorState.draft.id = savedId
    updateDraftField('id', savedId)
  }
  editorState.draft = {
    ...editorState.draft,
    ...(result?.payload || {}),
    ...(savedId ? { id: savedId } : {})
  }
  updateDraftField('status', result.payload?.status || editorState.draft.status)
  updateDraftField('slug', result.payload?.slug || payload.slug)
  return savedId
}
