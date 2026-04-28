import './styles/base.css'
import './styles/newProduct.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState } from './firebase/auth'
import { buildProductPayload, getProductById, isPlaceholderProductId, requestProductReview, saveProductDraft } from './data/productService'
import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase/firestore'
import { ROUTES } from './utils/routes'

const PRODUCT_SECTIONS = [
  { key: 'basics', label: 'Product type' },
  { key: 'media', label: 'Listing media' },
  { key: 'distribution', label: 'Deliverables' },
  { key: 'preview', label: 'File browser preview' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'details', label: 'Details' },
  { key: 'contributors', label: 'Contributors' },
  { key: 'publish', label: 'Publish' }
]

const PRODUCT_TYPE_OPTIONS = [
  'Single Sample', 'Sample Pack', 'Drum Kit', 'Vocal Pack', 'Preset Bank', 'Wavetable Pack',
  'MIDI Pack', 'Project File', 'Plugin / VST', 'Course / Tutorial', 'Release', 'Other'
]

const PRODUCT_TYPE_GUIDANCE = {
  'Single Sample': 'Upload one main audio file and a public audio preview. Single samples can preview from product cards.',
  'Sample Pack': 'Upload a zip or folder files and one demo preview track. Product page shows file browser manifest.',
  'Drum Kit': 'Upload a zip or folder files and one demo preview track. Product page shows file browser manifest.',
  'Vocal Pack': 'Upload a zip or folder files and one demo preview track. Product page shows file browser manifest.',
  'Preset Bank': 'Upload preset package or folders. Optional demo audio. Viewer focuses on file browser layout.',
  'Wavetable Pack': 'Upload wavetable package or folders. Optional demo audio. Viewer focuses on file browser layout.',
  'MIDI Pack': 'Upload MIDI package or folders. Optional demo audio. Viewer focuses on file browser layout.',
  'Project File': 'Upload project/package plus DAW/version notes. Preview with rendered audio/video/screenshots.',
  'Plugin / VST': 'Upload installer variants or package zip. Add OS/DAW/architecture notes. Use demo audio/video previews.',
  'Course / Tutorial': 'Upload video previews, license/PDF, and course package. Viewer shows modules/files.',
  Release: 'Upload release package and media previews for shoppers.',
  Other: 'Choose flexible upload set. Preview files are public; deliverable files remain private.'
}

const app = document.querySelector('#app')
app.innerHTML = `
  ${navShell({ currentPage: 'products' })}
  <main>
    <section class="standard-hero utility-hero section">
      <div class="section-inner hero-inner hero-content-layer">
        <div class="hero-copy">
          <p class="eyebrow">Marketplace Creator Tools</p>
          <h1>New Product</h1>
          <p>Configure product metadata, media, pricing, and publish state for the Melogic marketplace.</p>
        </div>
      </div>
    </section>

    <section class="section product-editor-shell">
      <div class="section-inner" data-product-editor-root>
        <article class="product-editor-card">
          <p>Loading creator workspace...</p>
        </article>
      </div>
    </section>
  </main>
`

initShellChrome()

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
  mediaPreview: {
    cover: '',
    thumbnail: ''
  },
  status: {
    message: '',
    state: 'info'
  },
  creatorProfile: null,
  draft: null,
  requestedProductId: new URLSearchParams(window.location.search).get('id') || '',
  editPermissionError: ''
}

function getCreatorIdentity(user = null, profile = null, draft = {}) {
  const profileDisplayName = String(profile?.displayName || '').trim()
  const profileUsername = String(profile?.username || profile?.handle || '').trim()
  const authDisplayName = String(user?.displayName || '').trim()
  const draftDisplayName = String(draft?.artistName || '').trim()
  const draftUsername = String(draft?.artistUsername || '').trim()

  const artistId = user?.uid || String(draft?.artistId || '')
  const artistName = profileDisplayName || authDisplayName || draftDisplayName || 'Creator'
  const artistUsername = profileUsername || draftUsername
  const artistProfilePath = artistId ? String(draft?.artistProfilePath || `profiles/${artistId}`) : String(draft?.artistProfilePath || '')

  return {
    artistId,
    artistName,
    artistUsername,
    artistProfilePath
  }
}

function applyCreatorIdentity(draft = {}, user = null, profile = null) {
  return {
    ...(draft || {}),
    ...getCreatorIdentity(user, profile, draft)
  }
}

async function fetchPublicCreatorProfile(uid = '') {
  if (!db || !uid) return null
  try {
    const snapshot = await getDoc(doc(db, 'profiles', uid))
    if (!snapshot.exists()) return null
    return snapshot.data() || null
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
    currency: 'USD',
    isFree: true,
    featured: false,
    saleEnabled: false,
    licensePath: '',
    categories: '',
    genres: '',
    tags: '',
    formatNotes: '',
    compatibilityNotes: '',
    includedFiles: '',
    contributorNames: '',
    contributorIds: '',
    downloadPath: '',
    previewAudioPaths: '',
    previewVideoPaths: '',
    releasedAt: '',
    storefrontVisible: true,
    galleryPaths: '',
    coverPath: '',
    thumbnailPath: '',
    coverURL: '',
    thumbnailURL: ''
  }
}

function productTypeAccept(type = '', section = 'deliverable') {
  const isPlugin = type === 'Plugin / VST'
  if (section === 'previewAudio') return 'audio/*'
  if (section === 'previewVideo') return 'video/*'
  if (section === 'gallery') return 'image/*'
  if (isPlugin) return '.zip,.exe,.dmg,.pkg,.msi,.rar,.7z'
  if (type === 'Single Sample') return 'audio/*,.zip'
  return '.zip,.rar,.7z,audio/*,video/*,application/*,text/*'
}

function readSectionHash() {
  const hash = window.location.hash.replace('#', '')
  return PRODUCT_SECTIONS.some((item) => item.key === hash) ? hash : 'basics'
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function getDraftStorageKey(user) {
  return `melogic:new-product-draft:${user?.uid || 'anonymous'}:v1`
}

function saveDraftState() {
  if (!editorState.user || !editorState.draft) return
  try {
    const payload = {
      draft: editorState.draft,
      slugLocked: editorState.slugLocked,
      updatedAt: Date.now()
    }
    sessionStorage.setItem(getDraftStorageKey(editorState.user), JSON.stringify(payload))
  } catch {
    // ignore storage issues
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
    const hydratedDraft = applyCreatorIdentity({
      ...empty,
      ...(parsed?.draft || {})
    }, user, editorState.creatorProfile)
    if (isPlaceholderProductId(hydratedDraft.id)) {
      hydratedDraft.id = ''
    }
    return hydratedDraft
  } catch {
    return empty
  }
}

function updateDraftField(path, value) {
  if (!editorState.draft) return
  editorState.draft[path] = value
  saveDraftState()
}

function syncPreviewFromDraft() {
  if (!editorState.draft) return
  editorState.mediaPreview.cover = /^https?:\/\//i.test(editorState.draft.coverURL || '') ? editorState.draft.coverURL : ''
  editorState.mediaPreview.thumbnail = /^https?:\/\//i.test(editorState.draft.thumbnailURL || '') ? editorState.draft.thumbnailURL : ''
}

function hydrateSectionFields(sectionName) {
  if (!editorState.draft) return
  const panel = editorRoot.querySelector(`.editor-panel.${sectionName === readSectionHash() ? 'is-active' : ''}`)
  const target = panel || editorRoot
  const fields = target.querySelectorAll('[name]')

  fields.forEach((field) => {
    const key = field.name
    if (!(key in editorState.draft)) return

    if (field.type === 'checkbox') {
      field.checked = Boolean(editorState.draft[key])
      return
    }

    const nextValue = editorState.draft[key]
    field.value = nextValue == null ? '' : String(nextValue)
  })
}

function serializeDraftForFirestore(draft) {
  const safeDraft = applyCreatorIdentity({ ...(draft || {}) }, editorState.user, editorState.creatorProfile)
  const numericPrice = Number(safeDraft.price || 0)

  return {
    ...safeDraft,
    priceCents: Math.max(0, Math.round((Number.isFinite(numericPrice) ? numericPrice : 0) * 100)),
    isFree: Boolean(safeDraft.isFree),
    saleEnabled: Boolean(safeDraft.saleEnabled),
    storefrontVisible: Boolean(safeDraft.storefrontVisible)
  }
}

function setStatus(message, state = 'info') {
  editorState.status = { message, state }
}

function getPublishValidationMessage(draft = {}) {
  const missingTitle = !String(draft.title || '').trim()
  const missingProductType = !String(draft.productType || '').trim()

  if (missingTitle && missingProductType) {
    return 'Title and product type are required before publishing.'
  }
  if (missingTitle) {
    return 'Title is required before publishing.'
  }
  if (missingProductType) {
    return 'Product type is required before publishing.'
  }
  return ''
}

function renderSignedOut() {
  editorRoot.innerHTML = `
    <article class="product-editor-card signed-out">
      <h2>Sign in required</h2>
      <p>You need an authenticated account to create or publish marketplace products.</p>
      <a class="button button-accent" href="${ROUTES.auth}">Go to Sign In / Sign Up</a>
    </article>
  `
}

function renderEditPermissionDenied() {
  editorRoot.innerHTML = `
    <article class="product-editor-card signed-out">
      <h2>Listing access denied</h2>
      <p>You do not have permission to edit this listing.</p>
      <a class="button button-accent" href="${ROUTES.products}">Back to Products</a>
    </article>
  `
}

function previewCardMarkup(formData) {
  return `
    <article class="preview-card">
      <div class="preview-cover-wrap">
        ${editorState.mediaPreview.thumbnail || editorState.mediaPreview.cover
          ? `<img src="${editorState.mediaPreview.thumbnail || editorState.mediaPreview.cover}" alt="Product preview"/>`
          : '<div class="preview-cover-fallback">No media</div>'}
      </div>
      <div class="preview-content">
        <p class="preview-type">${escapeHtml(formData.productType || 'Sample Pack')}</p>
        <h3>${escapeHtml(formData.title || 'Untitled product')}</h3>
        <p class="preview-artist">by ${escapeHtml(formData.artistName || editorState.user?.displayName || 'Artist')}</p>
        <p class="preview-short">${escapeHtml(formData.shortDescription || 'Short description preview appears here.')}</p>
        <p class="preview-tags">${escapeHtml(formData.tags || '#tag1, #tag2')}</p>
        <div class="preview-meta">
          <span>${formData.isFree ? 'Free' : `${escapeHtml(formData.currency || 'USD')} ${(Number(formData.price || 0)).toFixed(2)}`}</span>
          <span>👍 0</span><span>💾 0</span><span>💬 0</span>
        </div>
      </div>
    </article>
  `
}

function renderEditor() {
  const section = readSectionHash()
  const statusClass = editorState.status.message ? `is-visible is-${editorState.status.state}` : ''
  const draft = editorState.draft || createEmptyProductDraft(editorState.user)

  editorRoot.innerHTML = `
    <div class="product-layout">
      <aside class="product-sidebar">
        <a class="back-link" href="${ROUTES.products}">← Back to Products</a>
        <nav aria-label="Product editor sections">
          ${PRODUCT_SECTIONS.map((item) => `<button type="button" class="section-btn ${item.key === section ? 'is-active' : ''}" data-section="${item.key}">${item.label}</button>`).join('')}
        </nav>
      </aside>

      <section class="product-editor-card product-content">
        <div class="product-status ${statusClass}" data-editor-status>${editorState.status.message || ''}</div>

        <form data-product-form>
          <article class="editor-panel ${section === 'basics' ? 'is-active' : ''}">
            <h2>Product type</h2>
            <p class="panel-copy">Choose product type first. It controls previews, deliverable mode, and viewer layout.</p>
            <div class="upload-card">
              <h3>Type selector</h3>
              <label><span>Product Type</span>
                <select name="productType">
                  ${PRODUCT_TYPE_OPTIONS.map((option) => `<option ${draft.productType === option ? 'selected' : ''}>${option}</option>`).join('')}
                </select>
              </label>
              <p class="muted">${escapeHtml(PRODUCT_TYPE_GUIDANCE[draft.productType] || PRODUCT_TYPE_GUIDANCE.Other)}</p>
            </div>
            <div class="field-grid two-col">
              <label><span>Product Title</span><input name="title" required value="${escapeHtml(draft.title)}" /></label>
              <label><span>Slug</span><input name="slug" placeholder="auto-generated-from-title" value="${escapeHtml(draft.slug)}" /></label>
            </div>
            <div class="field-grid two-col">
              <label><span>Artist / Primary Creator</span><input name="artistName" value="${escapeHtml(draft.artistName)}" readonly aria-readonly="true" class="locked-input" /><small class="field-lock-note">Creator is tied to your account.</small></label>
            </div>
            <label><span>Short Description</span><textarea name="shortDescription" rows="2">${escapeHtml(draft.shortDescription)}</textarea></label>
            <label><span>Full Description</span><textarea name="description" rows="5">${escapeHtml(draft.description)}</textarea></label>
            <div class="field-grid two-col">
              <label><span>Artist Username</span><input name="artistUsername" placeholder="artist-handle" value="${escapeHtml(draft.artistUsername)}" readonly aria-readonly="true" class="locked-input" /><small class="field-lock-note">Username comes from your public profile.</small></label>
              <label><span>Artist Profile Path</span><input name="artistProfilePath" placeholder="profiles/uid" value="${escapeHtml(draft.artistProfilePath)}" readonly aria-readonly="true" class="locked-input" /></label>
            </div>
            <div class="field-grid two-col">
              <label><span>Status</span><select name="status"><option value="draft" ${draft.status === 'draft' ? 'selected' : ''}>Draft</option><option value="review_pending" ${draft.status === 'review_pending' ? 'selected' : ''}>Review pending</option><option value="needs_changes" ${draft.status === 'needs_changes' ? 'selected' : ''}>Needs changes</option><option value="rejected" ${draft.status === 'rejected' ? 'selected' : ''}>Rejected</option><option value="archived" ${draft.status === 'archived' ? 'selected' : ''}>Archived</option></select></label>
              <label><span>Visibility</span><select name="visibility"><option value="public" ${draft.visibility === 'public' ? 'selected' : ''}>Public</option><option value="unlisted" ${draft.visibility === 'unlisted' ? 'selected' : ''}>Unlisted</option><option value="private" ${draft.visibility === 'private' ? 'selected' : ''}>Private</option></select></label>
            </div>
          </article>

          <article class="editor-panel ${section === 'media' ? 'is-active' : ''}">
            <h2>Listing media & preview media</h2>
            <p class="panel-copy">Preview files are public. Download files are private and require ownership.</p>
            <div class="media-grid">
              <div class="upload-card">
                <h3>Cover Image</h3>
                <button type="button" class="button button-accent" data-pick-file="cover">Upload Cover</button>
                <input class="hidden-file" type="file" accept="image/*" data-cover-input />
                <p class="muted">Storage target: products/{id}/cover/cover.webp</p>
              </div>
              <div class="upload-card">
                <h3>Thumbnail</h3>
                <button type="button" class="button button-accent" data-pick-file="thumbnail">Upload Thumbnail</button>
                <input class="hidden-file" type="file" accept="image/*" data-thumbnail-input />
                <p class="muted">Storage target: products/{id}/thumbnails/thumb.webp</p>
              </div>
            </div>
            <div class="media-grid">
              <div class="upload-card">
                <h3>Gallery uploads</h3>
                <button type="button" class="button button-muted" data-pick-file="gallery">Upload Gallery</button>
                <input class="hidden-file" type="file" accept="${productTypeAccept(draft.productType, 'gallery')}" multiple data-gallery-input />
                <p class="muted">${editorState.mediaFiles.gallery.length} selected · products/{id}/gallery/{fileName}</p>
              </div>
              <div class="upload-card">
                <h3>Public audio previews</h3>
                <button type="button" class="button button-muted" data-pick-file="preview-audio">Upload Audio Previews</button>
                <input class="hidden-file" type="file" accept="${productTypeAccept(draft.productType, 'previewAudio')}" multiple data-preview-audio-input />
                <p class="muted">${editorState.mediaFiles.previewAudio.length} selected · products/{id}/audio-previews/{fileName}</p>
              </div>
              <div class="upload-card">
                <h3>Public video previews</h3>
                <button type="button" class="button button-muted" data-pick-file="preview-video">Upload Video Previews</button>
                <input class="hidden-file" type="file" accept="${productTypeAccept(draft.productType, 'previewVideo')}" multiple data-preview-video-input />
                <p class="muted">${editorState.mediaFiles.previewVideo.length} selected · products/{id}/video-previews/{fileName}</p>
              </div>
            </div>
            <div class="preview-strip">
              ${editorState.mediaPreview.cover ? `<img src="${editorState.mediaPreview.cover}" alt="Cover preview" />` : '<div class="preview-box">Cover preview</div>'}
              ${editorState.mediaPreview.thumbnail ? `<img src="${editorState.mediaPreview.thumbnail}" alt="Thumbnail preview" />` : '<div class="preview-box">Thumbnail preview</div>'}
            </div>
          </article>

          <article class="editor-panel ${section === 'pricing' ? 'is-active' : ''}">
            <h2>Pricing</h2>
            <p class="panel-copy">Set sale settings and currency metadata.</p>
            <div class="field-grid two-col">
              <label><span>Price</span><input type="number" step="0.01" min="0" name="price" value="${escapeHtml(draft.price)}" /></label>
              <label><span>Currency</span><select name="currency"><option ${draft.currency === 'USD' ? 'selected' : ''}>USD</option><option ${draft.currency === 'EUR' ? 'selected' : ''}>EUR</option><option ${draft.currency === 'GBP' ? 'selected' : ''}>GBP</option></select></label>
            </div>
            <div class="toggle-grid">
              <label><input type="checkbox" name="isFree" ${draft.isFree ? 'checked' : ''} /> Free product</label>
              <label><input type="checkbox" name="featured" ${draft.featured ? 'checked' : ''} /> Featured listing</label>
              <label><input type="checkbox" name="saleEnabled" ${draft.saleEnabled ? 'checked' : ''} /> Sale enabled (placeholder)</label>
            </div>
            <label><span>License path / notes</span><input name="licensePath" placeholder="products/{id}/licenses/license.pdf" value="${escapeHtml(draft.licensePath)}" /></label>
          </article>

          <article class="editor-panel ${section === 'details' ? 'is-active' : ''}">
            <h2>Details</h2>
            <p class="panel-copy">Catalog metadata used for filtering and display.</p>
            <label><span>Categories (comma separated)</span><input name="categories" placeholder="Samples, Bass, Cinematic" value="${escapeHtml(draft.categories)}" /></label>
            <label><span>Genres (comma separated)</span><input name="genres" placeholder="Dubstep, Melodic Bass" value="${escapeHtml(draft.genres)}" /></label>
            <label><span>Tags (comma separated)</span><input name="tags" placeholder="Heavy, Hybrid, Dark" value="${escapeHtml(draft.tags)}" /></label>
            <label><span>Version / format notes</span><textarea name="formatNotes" rows="2">${escapeHtml(draft.formatNotes)}</textarea></label>
            <label><span>Compatibility notes</span><textarea name="compatibilityNotes" rows="2">${escapeHtml(draft.compatibilityNotes)}</textarea></label>
            <label><span>Included files</span><textarea name="includedFiles" rows="2">${escapeHtml(draft.includedFiles)}</textarea></label>
          </article>

          <article class="editor-panel ${section === 'contributors' ? 'is-active' : ''}">
            <h2>Contributors</h2>
            <p class="panel-copy">Add collaborator display names and optional profile IDs.</p>
            <label><span>Contributor names (comma separated)</span><input name="contributorNames" placeholder="Artist A, Artist B" value="${escapeHtml(draft.contributorNames)}" /></label>
            <label><span>Contributor profile IDs (comma separated)</span><input name="contributorIds" placeholder="uid1, uid2" value="${escapeHtml(draft.contributorIds)}" /></label>
          </article>

          <article class="editor-panel ${section === 'distribution' ? 'is-active' : ''}">
            <h2>Deliverables</h2>
            <p class="panel-copy">Download files are private and require ownership. Packs open a product viewer with file previews.</p>
            <div class="media-grid">
              <div class="upload-card">
                <h3>Deliverable files / package</h3>
                <button type="button" class="button button-accent" data-pick-file="deliverables">Upload Files</button>
                <input class="hidden-file" type="file" accept="${productTypeAccept(draft.productType, 'deliverable')}" multiple data-deliverables-input />
                <p class="muted">${editorState.mediaFiles.deliverables.length} selected · products/{id}/files/{fileId}/{fileName}</p>
              </div>
              <div class="upload-card">
                <h3>Folder upload (if supported)</h3>
                <button type="button" class="button button-muted" data-pick-file="deliverables-folder">Upload Folder</button>
                <input class="hidden-file" type="file" webkitdirectory multiple data-deliverables-folder-input />
                <p class="muted">${editorState.mediaFiles.folderDeliverables.length} folder files selected</p>
              </div>
            </div>
            <label><span>Download path (legacy)</span><input name="downloadPath" placeholder="products/{id}/downloads/file.zip" value="${escapeHtml(draft.downloadPath)}" /></label>
            <label><span>Release date</span><input type="date" name="releasedAt" value="${escapeHtml(draft.releasedAt)}" /></label>
            <div class="toggle-grid">
              <label><input type="checkbox" name="storefrontVisible" ${draft.storefrontVisible ? 'checked' : ''} /> Storefront visibility enabled</label>
            </div>
          </article>

          <article class="editor-panel ${section === 'preview' ? 'is-active' : ''}" data-preview-panel>
            <h2>File browser preview</h2>
            <p class="panel-copy">Manifest preview generated from selected deliverable files before save.</p>
            <div class="upload-card">
              <h3>Included files (${(editorState.mediaFiles.folderDeliverables.length || editorState.mediaFiles.deliverables.length)})</h3>
              <ul>
                ${[...editorState.mediaFiles.folderDeliverables, ...editorState.mediaFiles.deliverables].slice(0, 50).map((file) => `<li>${escapeHtml(file.webkitRelativePath || file.name)} · ${(Number(file.size || 0) / 1024).toFixed(1)} KB</li>`).join('') || '<li>No files selected yet.</li>'}
              </ul>
            </div>
            <div data-preview-card>
              ${previewCardMarkup(draft)}
            </div>
          </article>

          <article class="editor-panel ${section === 'publish' ? 'is-active' : ''}">
            <h2>Publish</h2>
            <p class="panel-copy">Save draft metadata or promote listing state for publishing.</p>
            <div class="actions-row">
              <button type="button" class="button button-muted" data-save-draft>Save Draft</button>
              <button type="button" class="button button-muted" data-preview-listing>Preview Listing</button>
              <button type="button" class="button button-accent" data-publish-product>Publish Product</button>
            </div>
          </article>
        </form>
      </section>
    </div>
  `

  hydrateSectionFields(section)

  const navButtons = editorRoot.querySelectorAll('[data-section]')
  const form = editorRoot.querySelector('[data-product-form]')
  const coverInput = editorRoot.querySelector('[data-cover-input]')
  const thumbnailInput = editorRoot.querySelector('[data-thumbnail-input]')
  const galleryInput = editorRoot.querySelector('[data-gallery-input]')
  const previewAudioInput = editorRoot.querySelector('[data-preview-audio-input]')
  const previewVideoInput = editorRoot.querySelector('[data-preview-video-input]')
  const deliverablesInput = editorRoot.querySelector('[data-deliverables-input]')
  const deliverablesFolderInput = editorRoot.querySelector('[data-deliverables-folder-input]')

  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      window.location.hash = button.dataset.section
      renderEditor()
    })
  })

  editorRoot.querySelector('[data-pick-file="cover"]')?.addEventListener('click', () => coverInput?.click())
  editorRoot.querySelector('[data-pick-file="thumbnail"]')?.addEventListener('click', () => thumbnailInput?.click())
  editorRoot.querySelector('[data-pick-file="gallery"]')?.addEventListener('click', () => galleryInput?.click())
  editorRoot.querySelector('[data-pick-file="preview-audio"]')?.addEventListener('click', () => previewAudioInput?.click())
  editorRoot.querySelector('[data-pick-file="preview-video"]')?.addEventListener('click', () => previewVideoInput?.click())
  editorRoot.querySelector('[data-pick-file="deliverables"]')?.addEventListener('click', () => deliverablesInput?.click())
  editorRoot.querySelector('[data-pick-file="deliverables-folder"]')?.addEventListener('click', () => deliverablesFolderInput?.click())

  coverInput?.addEventListener('change', () => {
    const file = coverInput.files?.[0]
    if (!file) return
    editorState.mediaFiles.cover = file
    editorState.mediaPreview.cover = URL.createObjectURL(file)
    setStatus('Cover image selected. Save draft to upload.', 'info')
    saveDraftState()
    renderEditor()
  })

  thumbnailInput?.addEventListener('change', () => {
    const file = thumbnailInput.files?.[0]
    if (!file) return
    editorState.mediaFiles.thumbnail = file
    editorState.mediaPreview.thumbnail = URL.createObjectURL(file)
    setStatus('Thumbnail selected. Save draft to upload.', 'info')
    saveDraftState()
    renderEditor()
  })
  galleryInput?.addEventListener('change', () => {
    editorState.mediaFiles.gallery = Array.from(galleryInput.files || [])
    setStatus('Gallery files selected. Save draft to upload.', 'info')
    renderEditor()
  })
  previewAudioInput?.addEventListener('change', () => {
    editorState.mediaFiles.previewAudio = Array.from(previewAudioInput.files || [])
    setStatus('Audio previews selected. Save draft to upload.', 'info')
    renderEditor()
  })
  previewVideoInput?.addEventListener('change', () => {
    editorState.mediaFiles.previewVideo = Array.from(previewVideoInput.files || [])
    setStatus('Video previews selected. Save draft to upload.', 'info')
    renderEditor()
  })
  deliverablesInput?.addEventListener('change', () => {
    editorState.mediaFiles.deliverables = Array.from(deliverablesInput.files || [])
    setStatus('Deliverable files selected. Save draft to upload.', 'info')
    renderEditor()
  })
  deliverablesFolderInput?.addEventListener('change', () => {
    editorState.mediaFiles.folderDeliverables = Array.from(deliverablesFolderInput.files || [])
    setStatus('Folder files selected. Save draft to upload.', 'info')
    renderEditor()
  })

  function syncFieldFromEvent(event) {
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
      const slugInput = form?.querySelector('input[name="slug"]')
      if (slugInput) slugInput.value = nextSlug
    }

    if (readSectionHash() === 'preview') {
      const previewEl = editorRoot.querySelector('[data-preview-card]')
      if (previewEl) previewEl.innerHTML = previewCardMarkup(editorState.draft)
    }
  }

  form?.addEventListener('input', syncFieldFromEvent)
  form?.addEventListener('change', syncFieldFromEvent)

  async function persistProduct(desiredStatus = 'draft') {
    if (!editorState.user || !editorState.draft) return

    if (desiredStatus === 'published') {
      const publishValidationMessage = getPublishValidationMessage(editorState.draft)
      if (publishValidationMessage) {
        console.warn('[new-product] Publish validation failed', publishValidationMessage)
        setStatus(publishValidationMessage, 'error')
        renderEditor()
        return
      }
    }

    setStatus(desiredStatus === 'published' ? 'Submitting for review...' : 'Saving draft...', 'info')
    renderEditor()

    try {
      const wasNewDraft = !editorState.draft.id || isPlaceholderProductId(editorState.draft.id)
      const draftForSave = serializeDraftForFirestore({
        ...editorState.draft,
        profile: editorState.creatorProfile || {},
        currentStatus: editorState.draft.status || 'draft',
        status: desiredStatus === 'published' ? 'review_pending' : desiredStatus
      })
      const payload = buildProductPayload(draftForSave, editorState.user)
      console.info('[new-product] Save flow debug.', {
        productId: wasNewDraft ? '(new draft id pending)' : editorState.draft.id,
        pendingCover: editorState.mediaFiles.cover instanceof File,
        pendingThumbnail: editorState.mediaFiles.thumbnail instanceof File,
        desiredStatus
      })
      const result = await saveProductDraft(editorState.user, payload, {
        productId: wasNewDraft ? '' : editorState.draft.id,
        status: desiredStatus === 'published' ? 'review_pending' : desiredStatus,
        isNew: wasNewDraft,
        mediaFiles: editorState.mediaFiles,
        galleryFiles: editorState.mediaFiles.gallery,
        previewAudioFiles: editorState.mediaFiles.previewAudio,
        previewVideoFiles: editorState.mediaFiles.previewVideo,
        deliverableFiles: [...editorState.mediaFiles.folderDeliverables, ...editorState.mediaFiles.deliverables],
        onStatus: (message) => {
          setStatus(message, 'info')
          renderEditor()
        }
      })

      updateDraftField('id', result.productId)
      updateDraftField('status', result.payload?.status || editorState.draft.status)
      updateDraftField('slug', payload.slug)
      updateDraftField('coverPath', result.mediaUploads.coverPath || payload.coverPath || '')
      updateDraftField('thumbnailPath', result.mediaUploads.thumbnailPath || payload.thumbnailPath || '')
      updateDraftField('coverURL', result.mediaUploads.coverURL || payload.coverURL || editorState.draft.coverURL || '')
      updateDraftField('thumbnailURL', result.mediaUploads.thumbnailURL || payload.thumbnailURL || editorState.draft.thumbnailURL || '')
      syncPreviewFromDraft()
      editorState.mediaFiles.cover = null
      editorState.mediaFiles.thumbnail = null
      editorState.mediaFiles.gallery = []
      editorState.mediaFiles.previewAudio = []
      editorState.mediaFiles.previewVideo = []
      editorState.mediaFiles.deliverables = []
      editorState.mediaFiles.folderDeliverables = []
      if (desiredStatus === 'published') {
        const reviewResult = await requestProductReview(result.productId)
        updateDraftField('status', reviewResult?.status || 'review_pending')
        setStatus(
          reviewResult?.status === 'published'
            ? 'Product published after review.'
            : reviewResult?.status === 'needs_changes'
              ? 'Changes require review.'
              : 'Submitted for review.',
          'success'
        )
      } else {
        setStatus('Draft saved.', 'success')
      }
      renderEditor()
    } catch (error) {
      const stage = error?.stage || 'unknown'
      if (stage === 'draft-initialization' || stage === 'draft-verification') {
        console.warn('[new-product] Draft initialization failed', error?.code || error?.message || error)
      } else if (stage === 'cover-upload') {
        console.warn('[new-product] Cover upload failed', error?.code || error?.message || error)
      } else if (stage === 'thumbnail-upload') {
        console.warn('[new-product] Thumbnail upload failed', error?.code || error?.message || error)
      } else if (stage === 'preview-upload') {
        console.warn('[new-product] Preview upload failed', error?.code || error?.message || error)
      } else if (stage === 'deliverable-upload') {
        console.warn('[new-product] Deliverable upload failed', error?.code || error?.message || error)
      } else if (stage === 'file-manifest-save') {
        console.warn('[new-product] File manifest save failed', error?.code || error?.message || error)
      } else if (stage === 'final-firestore-merge') {
        console.warn('[new-product] Final Firestore merge failed', error?.code || error?.message || error)
      } else if (stage === 'publish-transition') {
        console.warn('[new-product] Publish state update failed', error?.code || error?.message || error)
      } else {
        console.warn('[new-product] Draft save flow failed', error?.code || error?.message || error)
      }

      const friendlyMessage = stage === 'draft-initialization' || stage === 'draft-verification'
        ? 'Could not initialize draft.'
        : stage === 'cover-upload'
          ? 'Cover upload failed.'
            : stage === 'thumbnail-upload'
              ? 'Thumbnail upload failed.'
              : stage === 'preview-upload'
                ? 'Preview upload failed.'
                : stage === 'deliverable-upload'
                  ? 'Deliverable upload failed.'
                  : stage === 'file-manifest-save'
                    ? 'File manifest save failed.'
            : stage === 'final-firestore-merge'
              ? 'Final product metadata save failed.'
                : stage === 'publish-transition'
                  ? 'Review submission failed.'
                  : desiredStatus === 'published'
                  ? 'Could not submit for review.'
                  : 'Could not save draft.'
      setStatus(friendlyMessage, 'error')
      renderEditor()
    }
  }

  editorRoot.querySelector('[data-save-draft]')?.addEventListener('click', () => persistProduct('draft'))
  editorRoot.querySelector('[data-publish-product]')?.addEventListener('click', () => persistProduct('published'))
  editorRoot.querySelector('[data-preview-listing]')?.addEventListener('click', () => {
    window.location.hash = 'preview'
    setStatus('Preview panel updated from current draft state.', 'info')
    renderEditor()
  })
}

async function initPage() {
  const user = await waitForInitialAuthState()
  if (!user) {
    renderSignedOut()
    return
  }

  editorState.user = user
  editorState.creatorProfile = await fetchPublicCreatorProfile(user.uid)
  if (editorState.requestedProductId) {
    const existingProduct = await getProductById(editorState.requestedProductId)
    if (!existingProduct || existingProduct.artistId !== user.uid) {
      renderEditPermissionDenied()
      return
    }
    editorState.draft = applyCreatorIdentity({
      ...createEmptyProductDraft(user, editorState.creatorProfile),
      ...existingProduct,
      id: existingProduct.id
    }, user, editorState.creatorProfile)
  } else {
    editorState.draft = applyCreatorIdentity(loadDraftState(user), user, editorState.creatorProfile)
  }
  syncPreviewFromDraft()
  renderEditor()
}

window.addEventListener('hashchange', () => {
  if (!editorState.user) return
  renderEditor()
})

initPage()
