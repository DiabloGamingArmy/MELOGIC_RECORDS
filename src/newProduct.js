import './styles/base.css'
import './styles/newProduct.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState } from './firebase/auth'
import { buildProductPayload, saveProductDraft } from './data/productService'

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

function setStatus(message, state = 'info') {
  editorState.status = { message, state }
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
        <p class="preview-type">${formData.productType || 'Sample Pack'}</p>
        <h3>${formData.title || 'Untitled product'}</h3>
        <p class="preview-artist">by ${formData.artistName || editorState.user?.displayName || 'Artist'}</p>
        <p class="preview-short">${formData.shortDescription || 'Short description preview appears here.'}</p>
        <p class="preview-tags">${formData.tags || '#tag1, #tag2'}</p>
        <div class="preview-meta">
          <span>${formData.isFree ? 'Free' : `${formData.currency || 'USD'} ${(Number(formData.price || 0)).toFixed(2)}`}</span>
          <span>👍 0</span><span>💾 0</span><span>💬 0</span>
        </div>
      </div>
    </article>
  `
}

function renderEditor() {
  const section = readSectionHash()
  const statusClass = editorState.status.message ? `is-visible is-${editorState.status.state}` : ''

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
              <label><span>Product Title</span><input name="title" required /></label>
              <label><span>Slug</span><input name="slug" placeholder="auto-generated-from-title" /></label>
            </div>
            <div class="field-grid two-col">
              <label><span>Product Type</span>
                <select name="productType">
                  <option>VST</option><option>Sample Pack</option><option>Preset Bank</option><option>Wavetables</option><option>Drum Kit</option><option>Vocal Pack</option>
                </select>
              </label>
              <label><span>Artist / Primary Creator</span><input name="artistName" value="${editorState.user?.displayName || ''}" /></label>
            </div>
            <label><span>Short Description</span><textarea name="shortDescription" rows="2"></textarea></label>
            <label><span>Full Description</span><textarea name="description" rows="5"></textarea></label>
            <div class="field-grid two-col">
              <label><span>Artist Username</span><input name="artistUsername" placeholder="artist-handle" /></label>
              <label><span>Artist Profile Path</span><input name="artistProfilePath" placeholder="profiles/uid" /></label>
            </div>
            <div class="field-grid two-col">
              <label><span>Status</span><select name="status"><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
              <label><span>Visibility</span><select name="visibility"><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select></label>
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
              <label><span>Price</span><input type="number" step="0.01" min="0" name="price" value="0" /></label>
              <label><span>Currency</span><select name="currency"><option>USD</option><option>EUR</option><option>GBP</option></select></label>
            </div>
            <div class="toggle-grid">
              <label><input type="checkbox" name="isFree" checked /> Free product</label>
              <label><input type="checkbox" name="featured" /> Featured listing</label>
              <label><input type="checkbox" name="saleEnabled" /> Sale enabled (placeholder)</label>
            </div>
            <label><span>License path / notes</span><input name="licensePath" placeholder="products/{id}/licenses/license.pdf" /></label>
          </article>

          <article class="editor-panel ${section === 'details' ? 'is-active' : ''}">
            <h2>Details</h2>
            <p class="panel-copy">Catalog metadata used for filtering and display.</p>
            <label><span>Categories (comma separated)</span><input name="categories" placeholder="Samples, Bass, Cinematic" /></label>
            <label><span>Genres (comma separated)</span><input name="genres" placeholder="Dubstep, Melodic Bass" /></label>
            <label><span>Tags (comma separated)</span><input name="tags" placeholder="Heavy, Hybrid, Dark" /></label>
            <label><span>Version / format notes</span><textarea name="formatNotes" rows="2"></textarea></label>
            <label><span>Compatibility notes</span><textarea name="compatibilityNotes" rows="2"></textarea></label>
            <label><span>Included files</span><textarea name="includedFiles" rows="2"></textarea></label>
          </article>

          <article class="editor-panel ${section === 'contributors' ? 'is-active' : ''}">
            <h2>Contributors</h2>
            <p class="panel-copy">Add collaborator display names and optional profile IDs.</p>
            <label><span>Contributor names (comma separated)</span><input name="contributorNames" placeholder="Artist A, Artist B" /></label>
            <label><span>Contributor profile IDs (comma separated)</span><input name="contributorIds" placeholder="uid1, uid2" /></label>
          </article>

          <article class="editor-panel ${section === 'distribution' ? 'is-active' : ''}">
            <h2>Distribution</h2>
            <p class="panel-copy">Control release and storefront visibility settings.</p>
            <label><span>Download path</span><input name="downloadPath" placeholder="products/{id}/downloads/file.zip" /></label>
            <label><span>Audio preview paths (comma separated)</span><input name="previewAudioPaths" placeholder="products/{id}/audio-previews/demo.mp3" /></label>
            <label><span>Video preview paths (comma separated)</span><input name="previewVideoPaths" placeholder="products/{id}/video-previews/demo.mp4" /></label>
            <label><span>Release date</span><input type="date" name="releasedAt" /></label>
            <div class="toggle-grid">
              <label><input type="checkbox" name="storefrontVisible" checked /> Storefront visibility enabled</label>
            </div>
          </article>

          <article class="editor-panel ${section === 'preview' ? 'is-active' : ''}" data-preview-panel>
            <h2>Preview</h2>
            <p class="panel-copy">Live listing card preview based on current form values.</p>
            <div data-preview-card>
              ${previewCardMarkup({})}
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
    renderEditor()
  })

  thumbnailInput?.addEventListener('change', () => {
    const file = thumbnailInput.files?.[0]
    if (!file) return
    editorState.mediaFiles.thumbnail = file
    editorState.mediaPreview.thumbnail = URL.createObjectURL(file)
    setStatus('Thumbnail selected. Save draft to upload.', 'info')
    renderEditor()
  })

  form?.addEventListener('input', (event) => {
    const titleInput = form.querySelector('input[name="title"]')
    const slugInput = form.querySelector('input[name="slug"]')
    if (event.target === slugInput) {
      editorState.slugLocked = Boolean(slugInput.value.trim())
      return
    }
    if (event.target === titleInput && !editorState.slugLocked) {
      slugInput.value = slugify(titleInput.value)
    }

    if (readSectionHash() === 'preview') {
      const data = Object.fromEntries(new FormData(form).entries())
      const previewEl = editorRoot.querySelector('[data-preview-card]')
      if (previewEl) previewEl.innerHTML = previewCardMarkup(data)
    }
  })

  async function persistProduct(desiredStatus = 'draft') {
    if (!form || !editorState.user) return
    const data = Object.fromEntries(new FormData(form).entries())
    const numericPrice = Number(data.price || 0)

    const payload = buildProductPayload({
      ...data,
      status: desiredStatus,
      isFree: data.isFree === 'on',
      featured: data.featured === 'on',
      priceCents: Math.max(0, Math.round(numericPrice * 100))
    }, editorState.user)

    try {
      const result = await saveProductDraft(editorState.user, payload, {
        productId: payload.id,
        status: desiredStatus,
        isNew: true,
        mediaFiles: editorState.mediaFiles
      })

      setStatus(
        desiredStatus === 'published'
          ? `Product ${result.productId} published successfully.`
          : `Draft ${result.productId} saved successfully.`,
        'success'
      )
      renderEditor()
    } catch (error) {
      console.warn('[new-product] Save failed.', error?.message || error)
      setStatus('Could not save product right now. Please try again.', 'error')
      renderEditor()
    }
  }

  editorRoot.querySelector('[data-save-draft]')?.addEventListener('click', () => persistProduct('draft'))
  editorRoot.querySelector('[data-publish-product]')?.addEventListener('click', () => persistProduct('published'))
  editorRoot.querySelector('[data-preview-listing]')?.addEventListener('click', () => {
    window.location.hash = 'preview'
    setStatus('Preview panel updated with current form values.', 'info')
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
  renderEditor()
}

window.addEventListener('hashchange', () => {
  if (!editorState.user) return
  renderEditor()
})

initPage()
