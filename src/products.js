import './styles/base.css'
import './styles/products.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'

const app = document.querySelector('#app')

const productCatalog = [
  { title: 'Aether Pulse Vol. 1', creator: 'NOVA//CTRL', type: 'Sample Pack', genres: ['Melodic Bass', 'Future'], price: '$19' },
  { title: 'Fracture Grid', creator: 'Iron Arc', type: 'Serum Presets', genres: ['Color Bass', 'Heavy'], price: '$24' },
  { title: 'Glass Impact', creator: 'SYNTHRUNE', type: 'Vital Bank', genres: ['Dubstep', 'Cinematic'], price: '$17' },
  { title: 'Voltage Bloom', creator: 'MIRA WAVE', type: 'Wavetables', genres: ['Hybrid Trap', 'EDM'], price: '$12' },
  { title: 'Black Alloy Drums', creator: 'KROVAK', type: 'Drum Kit', genres: ['Metalcore', 'Hybrid'], price: '$21' },
  { title: 'Skyline Lift FX', creator: 'Arcline Studio', type: 'FX Toolkit', genres: ['Festival', 'Transitions'], price: '$15' },
  { title: 'Nightframe Leads', creator: 'VEXA', type: 'Preset Bank', genres: ['Electro', 'Synthwave'], price: '$18' },
  { title: 'Ghostform Vocals', creator: 'Helix North', type: 'Vocal Chop Kit', genres: ['Future Bass', 'Vocal'], price: '$16' },
  { title: 'Riftweight Textures', creator: 'Null Harbor', type: 'One-Shot Pack', genres: ['Bass Music', 'Industrial'], price: '$14' },
  { title: 'Hyperline Motion', creator: 'Prismforge', type: 'Creator Release', genres: ['Electronic', 'Melodic'], price: '$27' }
]

const cardMarkup = productCatalog
  .map(
    (product) => `
      <article class="product-card" role="listitem">
        <div class="product-cover" aria-hidden="true"></div>
        <div class="product-content">
          <div class="product-meta-row">
            <p class="product-type">${product.type}</p>
            <p class="product-price">${product.price}</p>
          </div>
          <h3>${product.title}</h3>
          <p class="product-creator">by ${product.creator}</p>
          <p class="product-tags">${product.genres.map((genre) => `#${genre.replace(/\s+/g, '')}`).join(' · ')}</p>
          <div class="product-actions">
            <button type="button" class="preview-btn" aria-label="Preview ${product.title}">▶ Preview</button>
            <button type="button" class="add-btn" aria-label="Add ${product.title} to cart">Add to cart</button>
          </div>
        </div>
      </article>
    `
  )
  .join('')

app.innerHTML = `
  ${navShell({ currentPage: 'products' })}

  <main>
    <section class="products-hero section" id="products-top">
      <div class="hero-media" aria-hidden="true">
        <video
          id="products-hero-video"
          class="hero-bg-video"
          muted
          loop
          autoplay
          playsinline
          preload="metadata"
        ></video>
        <div class="hero-media-overlay"></div>
      </div>
      <div class="section-inner">
        <p class="eyebrow">Marketplace</p>
        <h1>Products</h1>
        <p class="products-intro">
          Browse sample packs, presets, wavetables, tools, and creator-made releases across the Melogic catalog.
        </p>
      </div>
    </section>

    <section class="section products-catalog">
      <div class="section-inner">
        <div class="products-filter-row" aria-label="Catalog controls">
          <label class="filter-control">
            <span>Search</span>
            <input type="search" placeholder="Search products or creators" />
          </label>
          <label class="filter-control">
            <span>Category</span>
            <select>
              <option>All categories</option>
              <option>Sample Packs</option>
              <option>Presets</option>
              <option>Wavetables</option>
              <option>Tools</option>
            </select>
          </label>
          <label class="filter-control">
            <span>Genre</span>
            <select>
              <option>All genres</option>
              <option>Melodic Bass</option>
              <option>Dubstep</option>
              <option>Metalcore</option>
              <option>Hybrid Trap</option>
            </select>
          </label>
          <label class="filter-control">
            <span>Sort</span>
            <select>
              <option>Featured</option>
              <option>Newest</option>
              <option>Price: Low to High</option>
              <option>Price: High to Low</option>
            </select>
          </label>
        </div>

        <div class="products-grid" role="list" aria-label="Product catalog">
          ${cardMarkup}
        </div>
      </div>
    </section>

    <footer class="section products-footer">
      <div class="section-inner">
        <p class="eyebrow">Melogic Records</p>
        <p>Catalog-ready tools and creator releases built for the next wave of heavy electronic music.</p>
      </div>
    </footer>
  </main>
`

function initProductsHeroVideo() {
  const heroVideo = document.querySelector('#products-hero-video')
  const heroPaths = getPageHeroVideoPaths('products')
  if (!heroPaths) return false
  return attachHeroVideo(heroVideo, {
    webmPath: heroPaths.webm,
    mp4Path: heroPaths.mp4,
    warningKey: 'products'
  })
}

initShellChrome()
initProductsHeroVideo()
