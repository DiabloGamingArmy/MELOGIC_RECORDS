import './styles/base.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'

const app = document.querySelector('#app')

const releaseProducts = [
  {
    title: 'Aether Pulse Vol. 1',
    creator: 'NOVA//CTRL',
    type: 'Sample Pack',
    tags: ['#MelodicBass', '#Future'],
    price: '$19'
  },
  {
    title: 'Fracture Grid',
    creator: 'Iron Arc',
    type: 'Serum Presets',
    tags: ['#ColorBass', '#Heavy'],
    price: '$24'
  },
  {
    title: 'Glass Impact',
    creator: 'SYNTHRUNE',
    type: 'Vital Bank',
    tags: ['#Dubstep', '#Cinematic'],
    price: '$17'
  },
  {
    title: 'Voltage Bloom',
    creator: 'MIRA WAVE',
    type: 'Wavetables',
    tags: ['#HybridTrap', '#EDM'],
    price: '$12'
  },
  {
    title: 'Black Alloy Drums',
    creator: 'KROVAK',
    type: 'Drum Kit',
    tags: ['#Metalcore', '#Hybrid'],
    price: '$21'
  },
  {
    title: 'Skyline Lift FX',
    creator: 'Arcline Studio',
    type: 'FX Toolkit',
    tags: ['#Transitions', '#Festival'],
    price: '$15'
  },
  {
    title: 'Nightframe Leads',
    creator: 'VEXA',
    type: 'Preset Bank',
    tags: ['#Electro', '#Synthwave'],
    price: '$18'
  },
  {
    title: 'Ghostform Vocals',
    creator: 'Helix North',
    type: 'Vocal Chop Kit',
    tags: ['#Vocal', '#FutureBass'],
    price: '$16'
  }
]

const cardsMarkup = releaseProducts
  .map(
    (product) => `
      <article class="release-card" role="listitem">
        <div class="release-topline">
          <p class="product-type">${product.type}</p>
          <p class="release-price">${product.price}</p>
        </div>
        <h3>${product.title}</h3>
        <p class="release-creator">by ${product.creator}</p>
        <p class="tags">${product.tags.join(' · ')}</p>
        <div class="release-actions">
          <button type="button" class="preview-btn" aria-label="Preview ${product.title}">▶ Preview</button>
          <button type="button" class="add-btn" aria-label="Add ${product.title} to cart">Add to cart</button>
        </div>
      </article>
    `
  )
  .join('')

app.innerHTML = `
  <div class="page-preloader" id="page-preloader" role="status" aria-live="polite" aria-label="Loading page">
    <div class="preloader-core">
      <span class="preloader-ring" aria-hidden="true"></span>
      <p>Loading</p>
    </div>
  </div>

  ${navShell({ currentPage: 'home' })}

  <main>
    <section class="hero" id="explore">
      <div class="hero-media" aria-hidden="true">
        <video
          id="hero-bg-video"
          class="hero-bg-video"
          muted
          loop
          autoplay
          playsinline
          preload="metadata"
        ></video>
        <div class="hero-media-overlay"></div>
      </div>

      <div class="section-inner hero-inner">
        <div class="hero-copy">
          <h1>Where heavy sound design becomes a release pipeline.</h1>
          <p>
            Melogic Records builds tools, sample libraries, and artist infrastructure for producers
            pushing electronic music, melodic bass, and metalcore into the same future.
          </p>
          <div class="hero-actions">
            <a class="button button-accent" href="#products">Explore the Catalog</a>
            <a class="button button-muted" href="#community">Submit / Connect</a>
          </div>
        </div>
      </div>
    </section>

    <div class="lower-page-layer" id="products-layer">
      <canvas class="lower-network-canvas" id="lower-network-canvas" aria-hidden="true"></canvas>

      <div class="lower-page-content">
        <section class="section releases" id="products">
          <div class="section-inner">
            <div class="section-head">
              <p class="eyebrow">Community releases</p>
              <h2>Tools from the Melogic Network.</h2>
              <p class="section-description">Explore sample packs, presets, wavetables, and production tools from creators building inside the Melogic ecosystem.</p>
            </div>

            <div class="releases-carousel" data-carousel>
              <button class="carousel-control" type="button" data-dir="left" aria-label="Scroll products left">←</button>
              <div class="releases-track" role="list" aria-label="Community release products">
                ${cardsMarkup}
              </div>
              <button class="carousel-control" type="button" data-dir="right" aria-label="Scroll products right">→</button>
            </div>
          </div>
        </section>

        <section class="section" id="mission">
          <div class="section-inner mission-grid">
            <div>
              <p class="eyebrow">Our perspective</p>
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
              <article>
                <h3>Label Pipeline</h3>
                <p>Discovery infrastructure that helps standout creators move toward real release support.</p>
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

        <section class="section utility-links" id="forms">
          <div class="section-inner utility-grid">
            <article>
              <p class="eyebrow">Forms</p>
              <h3>Submission + contact routes</h3>
              <p>Drop demos, creator details, and tool proposals through Melogic intake forms.</p>
            </article>
            <article id="faq">
              <p class="eyebrow">FAQ</p>
              <h3>Quick answers for creators</h3>
              <p>Find policy details for usage rights, release opportunities, and platform rollouts.</p>
            </article>
            <article id="support">
              <p class="eyebrow">Support</p>
              <h3>Help for account + catalog access</h3>
              <p>Need a hand with downloads or profiles? Reach support and get routed fast.</p>
            </article>
          </div>
        </section>

        <section class="section closing">
          <div class="section-inner closing-inner">
            <h2>Build the sound. Find the artists. Move the culture.</h2>
            <div class="hero-actions">
              <a class="button button-accent" href="#explore">Enter Melogic</a>
              <a class="button button-muted" href="#products">View Catalog</a>
            </div>
          </div>
        </section>
      </div>
    </div>
  </main>
`


async function initHeroBackgroundVideo() {
  const heroVideo = document.querySelector('#hero-bg-video')
  return attachHeroVideo(heroVideo, {
    webmPath: 'assets/site/backgrounds/hero-loop.webm',
    mp4Path: 'assets/site/backgrounds/hero-loop.mp4',
    warningKey: 'home'
  })
}

function initCarousel() {
  const carousel = document.querySelector('[data-carousel]')
  if (!carousel) return

  const track = carousel.querySelector('.releases-track')
  const controls = carousel.querySelectorAll('.carousel-control')
  if (!track || !controls.length) return

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const baseSpeed = reducedMotion ? 0 : 0.093
  const manualStep = () => Math.max(track.clientWidth * 0.72, 320)

  let animationFrame = null
  let resumeTimer = null
  let isAutoRunning = false
  let lastTimestamp = 0

  const stopAuto = () => {
    isAutoRunning = false
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = null
    }
    lastTimestamp = 0
  }

  const tick = (timestamp) => {
    if (!isAutoRunning) return

    if (!lastTimestamp) {
      lastTimestamp = timestamp
    }

    const delta = timestamp - lastTimestamp
    lastTimestamp = timestamp

    track.scrollLeft += baseSpeed * delta

    const endThreshold = track.scrollWidth - track.clientWidth - 2
    if (track.scrollLeft >= endThreshold) {
      track.scrollLeft = 0
    }

    animationFrame = window.requestAnimationFrame(tick)
  }

  const startAuto = () => {
    if (isAutoRunning || reducedMotion) return
    isAutoRunning = true
    animationFrame = window.requestAnimationFrame(tick)
  }

  const pauseAndResume = () => {
    stopAuto()
    window.clearTimeout(resumeTimer)
    resumeTimer = window.setTimeout(startAuto, 20000)
  }

  controls.forEach((control) => {
    control.addEventListener('click', () => {
      const direction = control.dataset.dir === 'left' ? -1 : 1
      pauseAndResume()
      track.scrollBy({ left: direction * manualStep(), behavior: 'smooth' })
    })
  })

  track.addEventListener('pointerdown', pauseAndResume)
  track.addEventListener('wheel', pauseAndResume, { passive: true })

  startAuto()
}

function initPagePreloader(logoReadyPromise, heroReadyPromise) {
  const preloader = document.querySelector('#page-preloader')
  if (!preloader) return

  const fallbackMs = 3800
  const fadeDurationMs = 500
  let hidden = false

  const hidePreloader = () => {
    if (hidden) return
    hidden = true
    preloader.classList.add('is-hidden')
    window.setTimeout(() => {
      preloader.remove()
    }, fadeDurationMs + 40)
  }

  Promise.allSettled([logoReadyPromise, heroReadyPromise]).then(hidePreloader)
  window.setTimeout(hidePreloader, fallbackMs)
}

function initLowerBackground() {
  const canvas = document.querySelector('#lower-network-canvas')
  const hero = document.querySelector('.hero')
  if (!canvas || !hero) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const isSmallScreen = window.matchMedia('(max-width: 720px)').matches
  const pointCount = prefersReduced ? 22 : isSmallScreen ? 28 : 44
  const points = []
  const mouse = { x: -9999, y: -9999, active: false }

  function updateClip() {
    const heroBottom = hero.getBoundingClientRect().bottom
    const clipTop = Math.max(0, heroBottom)
    document.documentElement.style.setProperty('--hero-clip', `${clipTop}px`)
  }

  function resize() {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    points.length = 0

    for (let i = 0; i < pointCount; i += 1) {
      points.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * (prefersReduced ? 0.08 : 0.24),
        vy: (Math.random() - 0.5) * (prefersReduced ? 0.08 : 0.24)
      })
    }

    updateClip()
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    for (let i = 0; i < points.length; i += 1) {
      const p = points[i]
      p.x += p.vx
      p.y += p.vy

      if (p.x < 0 || p.x > canvas.width) p.vx *= -1
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1

      const accentAlpha = mouse.active
        ? Math.max(0.06, 0.24 - Math.hypot(mouse.x - p.x, mouse.y - p.y) / 500)
        : 0.1

      ctx.beginPath()
      ctx.fillStyle = `rgba(137, 190, 255, ${accentAlpha})`
      ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2)
      ctx.fill()

      for (let j = i + 1; j < points.length; j += 1) {
        const q = points[j]
        const dist = Math.hypot(p.x - q.x, p.y - q.y)
        if (dist > 126) continue

        const opacity = (1 - dist / 126) * (prefersReduced ? 0.1 : 0.18)
        ctx.beginPath()
        ctx.strokeStyle = `rgba(98, 210, 214, ${opacity})`
        ctx.lineWidth = 0.6
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(q.x, q.y)
        ctx.stroke()
      }
    }

    window.requestAnimationFrame(draw)
  }

  window.addEventListener('resize', () => {
    resize()
  })
  window.addEventListener('scroll', updateClip, { passive: true })

  if (!prefersReduced) {
    window.addEventListener('pointermove', (event) => {
      mouse.x = event.clientX
      mouse.y = event.clientY
      mouse.active = true
    })
    window.addEventListener('pointerleave', () => {
      mouse.active = false
    })
  }

  resize()
  draw()
}

const logoReadyPromise = initShellChrome()
const heroReadyPromise = initHeroBackgroundVideo()
initPagePreloader(logoReadyPromise, heroReadyPromise)
initCarousel()
initLowerBackground()
