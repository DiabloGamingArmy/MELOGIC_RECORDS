import './styles/base.css'
import './styles/newProduct.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState } from './firebase/auth'
import { buildProductPayload, isPlaceholderProductId, saveProductDraft } from './data/productService'

const PRODUCT_SECTIONS = [
  { key: 'basics', label: 'Basics' },
  { key: 'media', label: 'Media' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'details', label: 'Details' },
  { key: 'contributors', label: 'Contributors' },
  { key: 'distribution', label: 'Distribution' },
  { key: 'preview', label: 'Preview' },
  { key: 'publish', label: 'Publish' }
]

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
    thumbnail: null
  },
  mediaPreview: {
    cover: '',
    thumbnail: ''
  },
  status: {
    message: '',
    state: 'info'
  },
  draft: null
}

function createEmptyProductDraft(user = null) {
  return {
    id: '',
    title: '',
    slug: '',
    shortDescription: '',
    description: '',
    productType: 'Sample Pack',
    artistId: user?.uid || '',
    artistName: user?.displayName || '',
    artistUsername: '',
    artistProfilePath: '',
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
  const empty = createEmptyProductDraft(user)
  if (!user) return empty

  try {
    const raw = sessionStorage.getItem(getDraftStorageKey(user))
    if (!raw) return empty
    const parsed = JSON.parse(raw)
    editorState.slugLocked = Boolean(parsed?.slugLocked)
    const hydratedDraft = {
      ...empty,
      ...(parsed?.draft || {}),
      artistId: parsed?.draft?.artistId || user.uid || ''
    }
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
  const safeDraft = { ...(draft || {}) }
  const numericPrice = Number(safeDraft.price || 0)

  return {
    ...safeDraft,
    priceCents: Math.max(0, Math.round((Number.isFinite(numericPrice) ? numericPrice : 0) * 100)),
    isFree: Boolean(safeDraft.isFree),
    featured: Boolean(safeDraft.featured),
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
      <a class="button button-accent" href="/auth.html">Go to Sign In / Sign Up</a>
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
        <a class="back-link" href="/products.html">← Back to Products</a>
        <nav aria-label="Product editor sections">
          ${PRODUCT_SECTIONS.map((item) => `<button type="button" class="section-btn ${item.key === section ? 'is-active' : ''}" data-section="${item.key}">${item.label}</button>`).join('')}
        </nav>
      </aside>

      <section class="product-editor-card product-content">
        <div class="product-status ${statusClass}" data-editor-status>${editorState.status.message || ''}</div>

        <form data-product-form>
          <article class="editor-panel ${section === 'basics' ? 'is-active' : ''}">
            <h2>Basics</h2>
            <p class="panel-copy">Core listing identity and publication status.</p>
            <div class="field-grid two-col">
              <label><span>Product Title</span><input name="title" required value="${escapeHtml(draft.title)}" /></label>
              <label><span>Slug</span><input name="slug" placeholder="auto-generated-from-title" value="${escapeHtml(draft.slug)}" /></label>
            </div>
            <div class="field-grid two-col">
              <label><span>Product Type</span>
                <select name="productType">
                  <option ${draft.productType === 'VST' ? 'selected' : ''}>VST</option><option ${draft.productType === 'Sample Pack' ? 'selected' : ''}>Sample Pack</option><option ${draft.productType === 'Preset Bank' ? 'selected' : ''}>Preset Bank</option><option ${draft.productType === 'Wavetables' ? 'selected' : ''}>Wavetables</option><option ${draft.productType === 'Drum Kit' ? 'selected' : ''}>Drum Kit</option><option ${draft.productType === 'Vocal Pack' ? 'selected' : ''}>Vocal Pack</option>
                </select>
              </label>
              <label><span>Artist / Primary Creator</span><input name="artistName" value="${escapeHtml(draft.artistName)}" /></label>
            </div>
            <label><span>Short Description</span><textarea name="shortDescription" rows="2">${escapeHtml(draft.shortDescription)}</textarea></label>
            <label><span>Full Description</span><textarea name="description" rows="5">${escapeHtml(draft.description)}</textarea></label>
            <div class="field-grid two-col">
              <label><span>Artist Username</span><input name="artistUsername" placeholder="artist-handle" value="${escapeHtml(draft.artistUsername)}" /></label>
              <label><span>Artist Profile Path</span><input name="artistProfilePath" placeholder="profiles/uid" value="${escapeHtml(draft.artistProfilePath)}" /></label>
            </div>
            <div class="field-grid two-col">
              <label><span>Status</span><select name="status"><option value="draft" ${draft.status === 'draft' ? 'selected' : ''}>Draft</option><option value="published" ${draft.status === 'published' ? 'selected' : ''}>Published</option><option value="archived" ${draft.status === 'archived' ? 'selected' : ''}>Archived</option></select></label>
              <label><span>Visibility</span><select name="visibility"><option value="public" ${draft.visibility === 'public' ? 'selected' : ''}>Public</option><option value="unlisted" ${draft.visibility === 'unlisted' ? 'selected' : ''}>Unlisted</option><option value="private" ${draft.visibility === 'private' ? 'selected' : ''}>Private</option></select></label>
            </div>
          </article>

          <article class="editor-panel ${section === 'media' ? 'is-active' : ''}">
            <h2>Media</h2>
            <p class="panel-copy">Upload listing visuals and preview assets. Cover/thumbnail upload is functional in this first pass.</p>
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
            <div class="media-grid placeholders">
              <div class="upload-card dashed"><h3>Gallery uploads</h3><p class="muted">Ready for products/{id}/gallery/{fileName}</p></div>
              <div class="upload-card dashed"><h3>Audio previews</h3><p class="muted">Ready for products/{id}/audio-previews/{fileName}</p></div>
              <div class="upload-card dashed"><h3>Video preview</h3><p class="muted">Ready for products/{id}/video-previews/{fileName}</p></div>
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
            <h2>Distribution</h2>
            <p class="panel-copy">Control release and storefront visibility settings.</p>
            <label><span>Download path</span><input name="downloadPath" placeholder="products/{id}/downloads/file.zip" value="${escapeHtml(draft.downloadPath)}" /></label>
            <label><span>Audio preview paths (comma separated)</span><input name="previewAudioPaths" placeholder="products/{id}/audio-previews/demo.mp3" value="${escapeHtml(draft.previewAudioPaths)}" /></label>
            <label><span>Video preview paths (comma separated)</span><input name="previewVideoPaths" placeholder="products/{id}/video-previews/demo.mp4" value="${escapeHtml(draft.previewVideoPaths)}" /></label>
            <label><span>Release date</span><input type="date" name="releasedAt" value="${escapeHtml(draft.releasedAt)}" /></label>
            <div class="toggle-grid">
              <label><input type="checkbox" name="storefrontVisible" ${draft.storefrontVisible ? 'checked' : ''} /> Storefront visibility enabled</label>
            </div>
          </article>

          <article class="editor-panel ${section === 'preview' ? 'is-active' : ''}" data-preview-panel>
            <h2>Preview</h2>
            <p class="panel-copy">Live listing card preview based on current form values.</p>
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

  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      window.location.hash = button.dataset.section
      renderEditor()
    })
  })

  editorRoot.querySelector('[data-pick-file="cover"]')?.addEventListener('click', () => coverInput?.click())
  editorRoot.querySelector('[data-pick-file="thumbnail"]')?.addEventListener('click', () => thumbnailInput?.click())

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

  function syncFieldFromEvent(event) {
    const target = event.target
    if (!target?.name) return

    if (!(target.name in editorState.draft)) return

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
        setStatus(publishValidationMessage, 'error')
        renderEditor()
        return
      }
    }

    setStatus(desiredStatus === 'published' ? 'Publishing product...' : 'Saving draft...', 'info')
    renderEditor()

    try {
      const wasNewDraft = !editorState.draft.id || isPlaceholderProductId(editorState.draft.id)
      const draftForSave = serializeDraftForFirestore({
        ...editorState.draft,
        status: desiredStatus
      })
      const payload = buildProductPayload(draftForSave, editorState.user)
      const result = await saveProductDraft(editorState.user, payload, {
        productId: wasNewDraft ? '' : editorState.draft.id,
        status: desiredStatus,
        isNew: wasNewDraft,
        mediaFiles: editorState.mediaFiles,
        onStatus: (message) => {
          setStatus(message, 'info')
          renderEditor()
        }
      })

      updateDraftField('id', result.productId)
      updateDraftField('slug', payload.slug)
      updateDraftField('coverPath', result.mediaUploads.coverPath || payload.coverPath || '')
      updateDraftField('thumbnailPath', result.mediaUploads.thumbnailPath || payload.thumbnailPath || '')
      updateDraftField('coverURL', result.mediaUploads.coverURL || payload.coverURL || editorState.draft.coverURL || '')
      updateDraftField('thumbnailURL', result.mediaUploads.thumbnailURL || payload.thumbnailURL || editorState.draft.thumbnailURL || '')
      syncPreviewFromDraft()
      editorState.mediaFiles.cover = null
      editorState.mediaFiles.thumbnail = null
      setStatus(
        desiredStatus === 'published'
          ? `Product ${result.productId} published successfully.`
          : 'Draft saved.',
        'success'
      )
      renderEditor()
    } catch (error) {
      console.warn('[new-product] Draft save flow failed.', error?.code || error?.message || error)
      const friendlyMessage = error?.code === 'permission-denied'
        ? desiredStatus === 'published'
          ? 'Could not publish product.'
          : 'Could not save draft.'
        : error?.code?.startsWith?.('storage/')
          ? 'Could not upload media.'
          : desiredStatus === 'published'
            ? 'Could not publish product.'
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
  editorState.draft = loadDraftState(user)
  syncPreviewFromDraft()
  renderEditor()
}

window.addEventListener('hashchange', () => {
  if (!editorState.user) return
  renderEditor()
})

initPage()
