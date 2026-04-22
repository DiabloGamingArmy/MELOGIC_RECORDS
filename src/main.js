import './styles/base.css'
import { navShell } from './components/navShell'
import { floatingCard } from './components/floatingCard'
import navBrandLogo from './assets/brand/melogic-logo-mark-glow-black.png'

const heroCards = [
  floatingCard({
    className: 'wave-card',
    meta: 'Audio Preview',
    title: 'Waveform Deck',
    body: 'Transient-rich snapshots for fast auditioning.',
  }),
  floatingCard({
    className: 'creator-chip',
    meta: 'Creator Stat',
    title: 'Nyteform',
    body: '4.8k plays this week',
  }),
]

const app = document.querySelector('#app')

app.innerHTML = `
  ${navShell(navBrandLogo)}

  <main>
    <section class="hero" id="explore">
      <div class="section-inner hero-inner">
        <span class="pill">Label Pipeline</span>
        <h1>Audio tools, creator commerce, and label discovery in one ecosystem.</h1>
        <p>
          Melogic is building a producer-first platform for sample packs, presets, audio previews,
          creator profiles, and the next wave of independent electronic music.
        </p>
        <div class="hero-actions">
          <a class="button button-accent" href="#store">Explore the Store</a>
          <a class="button button-muted" href="#vision">Learn the Vision</a>
        </div>
        <div class="hero-floaters">
          ${heroCards.join('')}
        </div>
      </div>
    </section>

    <section class="section" id="vision">
      <div class="section-inner">
        <div class="section-head">
          <p class="eyebrow">Platform pillars</p>
          <h2>Built for creators, community, and discovery.</h2>
        </div>
        <div class="grid columns-3">
          <article class="panel">
            <h3>Digital Goods</h3>
            <p>Sample packs, presets, wavetables, and producer tools built for modern sound design.</p>
          </article>
          <article class="panel">
            <h3>Creator Marketplace</h3>
            <p>A future marketplace where producers can share, sell, and grow through community interaction.</p>
          </article>
          <article class="panel" id="label">
            <h3>Record Label Pipeline</h3>
            <p>A discovery layer for finding standout artists and turning community momentum into real releases.</p>
          </article>
        </div>
      </div>
    </section>

    <section class="section" id="store">
      <div class="section-inner">
        <div class="section-head">
          <p class="eyebrow">Featured previews</p>
          <h2>Mock packs designed for fast auditioning and workflow context.</h2>
        </div>
        <div class="grid columns-3">
          <article class="panel product-tile">
            <p class="product-type">Sample Pack</p>
            <h3>Melodic Dubstep Starter Pack</h3>
            <p class="tags">#MelodicDubstep · #FutureBass</p>
            <div class="tile-footer"><span>$29 — placeholder</span><button type="button">▶ Preview</button></div>
          </article>
          <article class="panel product-tile">
            <p class="product-type">Toolkit</p>
            <h3>Metalcore Impact Toolkit</h3>
            <p class="tags">#Metalcore · #Hybrid</p>
            <div class="tile-footer"><span>$35 — placeholder</span><button type="button">▶ Preview</button></div>
          </article>
          <article class="panel product-tile">
            <p class="product-type">Preset Bank</p>
            <h3>Serum Color Bass Presets</h3>
            <p class="tags">#ColorBass · #BassMusic</p>
            <div class="tile-footer"><span>$24 — placeholder</span><button type="button">▶ Preview</button></div>
          </article>
        </div>
      </div>
    </section>

    <section class="section" id="community">
      <div class="section-inner split">
        <div>
          <p class="eyebrow">Community layer</p>
          <h2>More than downloads: identity, feedback, and momentum.</h2>
          <p>
            Every product is meant to live socially with likes, comments, shares, audio previews,
            and creator identity so producers can build audience and credibility with each release.
          </p>
        </div>
        <article class="panel social-card" id="live">
          <p class="product-type">Live Comment Feed</p>
          <h3>"Snare texture at 0:42 is unreal."</h3>
          <p>@voidphase · 2h ago · 63 likes</p>
          <div class="social-actions">
            <span>♥ Like</span>
            <span>💬 Comment</span>
            <span>↗ Share</span>
          </div>
        </article>
      </div>
    </section>

    <section class="section closing">
      <div class="section-inner closing-inner">
        <h2>Built for the producers who want more than a download page.</h2>
        <a class="button button-accent" href="#app">Enter Melogic</a>
      </div>
    </section>
  </main>
`
