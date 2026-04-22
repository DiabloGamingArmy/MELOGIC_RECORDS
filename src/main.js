import './styles/base.css'
import { navShell } from './components/navShell'
import navBrandLogo from './assets/brand/melogic-logo-mark-glow-black.png'

const app = document.querySelector('#app')

app.innerHTML = `
  ${navShell(navBrandLogo)}

  <main>
    <section class="hero" id="explore">
      <div class="section-inner hero-inner">
        <div class="hero-copy">
          <p class="eyebrow">Melogic Records</p>
          <h1>Where heavy sound design becomes a release pipeline.</h1>
          <p>
            Melogic Records builds tools, sample libraries, and artist infrastructure for producers
            pushing electronic music, melodic bass, and metalcore into the same future.
          </p>
          <div class="hero-actions">
            <a class="button button-accent" href="#store">Explore the Catalog</a>
            <a class="button button-muted" href="#community">Submit / Connect</a>
          </div>
        </div>
        <aside class="hero-accent" aria-hidden="true">
          <div class="accent-line"></div>
          <p>Signal route // Create → Share → Release</p>
        </aside>
      </div>
    </section>

    <section class="section" id="mission">
      <div class="section-inner mission-grid">
        <div>
          <p class="eyebrow">Company perspective</p>
          <h2>Built as a label. Engineered like a platform.</h2>
          <p>
            Melogic is designed around a simple idea: the best producer communities should not stop at
            downloads. They should create tools, develop artists, move releases, and give momentum to
            sounds that deserve a bigger stage.
          </p>
        </div>
        <article class="side-note">
          <p class="eyebrow">Current focus</p>
          <p>Catalog-ready tools, creator identity, and discovery systems that translate community response into real release opportunities.</p>
        </article>
      </div>
    </section>

    <section class="section" id="vision">
      <div class="section-inner">
        <div class="section-head">
          <p class="eyebrow">Core pillars</p>
          <h2>Three systems powering the Melogic ecosystem.</h2>
        </div>
        <div class="pillars">
          <article>
            <h3>Sound Tools</h3>
            <p>Sample packs, presets, and production assets built for modern heavy and melodic workflows.</p>
          </article>
          <article>
            <h3>Producer Network</h3>
            <p>A social layer where feedback, previews, and identity help producers grow with intent.</p>
          </article>
          <article id="label">
            <h3>Label Pipeline</h3>
            <p>Discovery infrastructure that helps standout creators move toward real release support.</p>
          </article>
        </div>
      </div>
    </section>

    <section class="section" id="store">
      <div class="section-inner">
        <div class="section-head">
          <p class="eyebrow">Featured drops</p>
          <h2>Curated tools for aggressive, melodic production.</h2>
        </div>
        <div class="catalog-list">
          <article class="catalog-item">
            <div>
              <p class="product-type">Sample Pack</p>
              <h3>Melodic Dubstep Starter Pack</h3>
              <p class="tags">#MelodicDubstep · #FutureBass</p>
            </div>
            <button type="button">Preview</button>
          </article>
          <article class="catalog-item">
            <div>
              <p class="product-type">Toolkit</p>
              <h3>Metalcore Impact Toolkit</h3>
              <p class="tags">#Metalcore · #Hybrid</p>
            </div>
            <button type="button">Preview</button>
          </article>
          <article class="catalog-item">
            <div>
              <p class="product-type">Preset Bank</p>
              <h3>Serum Color Bass Presets</h3>
              <p class="tags">#ColorBass · #BassMusic</p>
            </div>
            <button type="button">Preview</button>
          </article>
        </div>
      </div>
    </section>

    <section class="section" id="community">
      <div class="section-inner community-grid">
        <div>
          <p class="eyebrow">Artist development</p>
          <h2>Community feedback that can become label momentum.</h2>
          <p>
            Likes, comments, previews, and creator profiles are not decorations. They become signals:
            what producers are building, what listeners respond to, and what releases may deserve real support.
          </p>
        </div>
        <blockquote class="quote-card" id="live">
          "This drop sounds release-ready. The arrangement finally matches the emotion."
          <cite>— Community note from an early Melogic preview thread</cite>
        </blockquote>
      </div>
    </section>

    <section class="section" id="pipeline">
      <div class="section-inner">
        <div class="section-head">
          <p class="eyebrow">Pathway</p>
          <h2>From sound pack to signed release.</h2>
        </div>
        <div class="flow-steps">
          <article>
            <h3>Create</h3>
            <p>Producers build with Melogic tools and original libraries.</p>
          </article>
          <article>
            <h3>Share</h3>
            <p>Work gains feedback through previews, comments, and creator identity.</p>
          </article>
          <article>
            <h3>Release</h3>
            <p>Standout artists can move into label support, marketing, and distribution.</p>
          </article>
        </div>
      </div>
    </section>

    <section class="section closing">
      <div class="section-inner closing-inner">
        <h2>Build the sound. Find the artists. Move the culture.</h2>
        <div class="hero-actions">
          <a class="button button-accent" href="#app">Enter Melogic</a>
          <a class="button button-muted" href="#store">View Catalog</a>
        </div>
      </div>
    </section>
  </main>
`
