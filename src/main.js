import './styles/base.css'
import { navShell } from './components/navShell'
import navBrandLogo from './assets/brand/melogic-logo-mark-glow-black.png'

const releases = [
  { title: 'Afterglow Impact Pack', creator: 'Nyteform', type: 'Sample Pack', tags: '#MelodicBass #Cinematic', price: '$29' },
  { title: 'Riftline Serum Stack', creator: 'Voltgarden', type: 'Serum Presets', tags: '#ColorBass #Future', price: '$24' },
  { title: 'Fragments Vital Bank', creator: 'Aeraloom', type: 'Vital Bank', tags: '#Hybrid #EDM', price: '$19' },
  { title: 'Steel Halo Drums', creator: 'Terminal Coast', type: 'Drum Kit', tags: '#Metalcore #Heavy', price: '$27' },
  { title: 'Nocturne Wavetables', creator: 'Kryotone', type: 'Wavetables', tags: '#Dubstep #Dark', price: '$22' },
  { title: 'Pulseform FX Collection', creator: 'Vyre', type: 'Production Tools', tags: '#FX #SoundDesign', price: '$31' },
  { title: 'Ghostchain Vocal Chops', creator: 'Sable Arc', type: 'Sample Pack', tags: '#Vocals #FutureBass', price: '$18' },
  { title: 'Inferna Lead Banks', creator: 'Axiom Delta', type: 'Serum Presets', tags: '#Lead #Festival', price: '$26' },
]

const renderReleaseCard = (item) => `
  <article class="release-card" tabindex="0">
    <p class="product-type">${item.type}</p>
    <h3>${item.title}</h3>
    <p class="release-creator">by ${item.creator}</p>
    <p class="tags">${item.tags}</p>
    <div class="release-footer">
      <span>${item.price} · placeholder</span>
      <div class="release-actions">
        <button type="button">▶ Preview</button>
        <button type="button">+ Cart</button>
      </div>
    </div>
  </article>
`

const app = document.querySelector('#app')

app.innerHTML = `
  ${navShell(navBrandLogo)}

  <main>
    <section class="hero" id="explore">
      <div class="section-inner hero-inner">
        <div class="hero-copy">
          <h1>Where heavy sound design becomes a release pipeline.</h1>
          <p>
            Melogic Records builds tools, sample libraries, and artist infrastructure for producers
            pushing electronic music, melodic bass, and metalcore into the same future.
          </p>
          <div class="hero-actions">
            <a class="button button-accent" href="#products">Explore the Catalog</a>
            <a class="button button-muted" href="#forms">Submit / Connect</a>
          </div>
        </div>
      </div>
    </section>

    <div class="lower-page">
      <div class="lower-page-bg" aria-hidden="true">
        <canvas class="lower-network-canvas"></canvas>
      </div>

      <section class="section reveal" id="products">
        <div class="section-inner">
          <div class="section-head carousel-head">
            <div>
              <p class="eyebrow">Community releases</p>
              <h2>Tools from the Melogic Network</h2>
              <p>Explore sample packs, presets, wavetables, and production tools from creators building inside the Melogic ecosystem.</p>
            </div>
            <div class="carousel-controls" aria-label="Carousel controls">
              <button type="button" class="carousel-arrow" data-dir="left" aria-label="Scroll products left">←</button>
              <button type="button" class="carousel-arrow" data-dir="right" aria-label="Scroll products right">→</button>
            </div>
          </div>
          <div class="carousel-viewport" id="releases-carousel">
            <div class="carousel-track">
              ${releases.map(renderReleaseCard).join('')}
              ${releases.map(renderReleaseCard).join('')}
            </div>
          </div>
        </div>
      </section>

      <section class="section reveal" id="mission">
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

      <section class="section reveal" id="vision">
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

      <section class="section reveal" id="community">
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

      <section class="section reveal" id="pipeline">
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

      <section class="section reveal utility-links" id="forms">
        <div class="section-inner utility-grid">
          <article>
            <h3>Forms</h3>
            <p>Artist submission and partner forms will live here as Melogic onboarding expands.</p>
          </article>
          <article id="faq">
            <h3>FAQ</h3>
            <p>Quick answers for catalog usage, licensing basics, and release support expectations.</p>
          </article>
          <article id="support">
            <h3>Support</h3>
            <p>Contact channels for product help, account access, and creator-related questions.</p>
          </article>
        </div>
      </section>

      <section class="section closing reveal">
        <div class="section-inner closing-inner">
          <h2>Build the sound. Find the artists. Move the culture.</h2>
          <div class="hero-actions">
            <a class="button button-accent" href="#app">Enter Melogic</a>
            <a class="button button-muted" href="#products">View Catalog</a>
          </div>
        </div>
      </section>
    </div>
  </main>
`

function setupCarousel() {
  const viewport = document.querySelector('#releases-carousel')
  const track = viewport?.querySelector('.carousel-track')
  const controls = document.querySelectorAll('.carousel-arrow')

  if (!viewport || !track || controls.length === 0) return

  let autoScrollEnabled = true
  let idleTimer
  const step = 0.55

  const pauseAndResumeLater = () => {
    autoScrollEnabled = false
    window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => {
      autoScrollEnabled = true
    }, 20000)
  }

  controls.forEach((button) => {
    button.addEventListener('click', () => {
      const direction = button.dataset.dir === 'left' ? -1 : 1
      viewport.scrollBy({ left: direction * 320, behavior: 'smooth' })
      pauseAndResumeLater()
    })
  })

  window.setInterval(() => {
    if (!autoScrollEnabled) return

    viewport.scrollLeft += step
    if (viewport.scrollLeft >= track.scrollWidth / 2) {
      viewport.scrollLeft = 0
    }
  }, 16)
}

function setupRevealAnimations() {
  const revealItems = document.querySelectorAll('.reveal')
  if (!revealItems.length) return

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view')
          observer.unobserve(entry.target)
        }
      })
    },
    { threshold: 0.2 }
  )

  revealItems.forEach((item) => observer.observe(item))
}

function setupLowerNetworkBackground() {
  const canvas = document.querySelector('.lower-network-canvas')
  const hero = document.querySelector('.hero')
  const lowerPage = document.querySelector('.lower-page')
  if (!canvas || !hero || !lowerPage) return

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const pointer = { x: -9999, y: -9999 }
  const pointCount = window.innerWidth < 700 ? 26 : 44
  const points = Array.from({ length: pointCount }, () => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    vx: (Math.random() - 0.5) * 0.18,
    vy: (Math.random() - 0.5) * 0.18,
  }))

  const setCanvasSize = () => {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    const heroBottom = hero.offsetTop + hero.offsetHeight
    lowerPage.style.setProperty('--lower-page-start', `${heroBottom}px`)
  }

  const onPointerMove = (event) => {
    if (reducedMotion) return
    pointer.x = event.clientX
    pointer.y = event.clientY
  }

  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    points.forEach((point) => {
      point.x += point.vx
      point.y += point.vy

      if (point.x < 0 || point.x > canvas.width) point.vx *= -1
      if (point.y < 0 || point.y > canvas.height) point.vy *= -1

      const dx = pointer.x - point.x
      const dy = pointer.y - point.y
      const distance = Math.hypot(dx, dy)

      if (!reducedMotion && distance < 120) {
        point.x -= dx * 0.0012
        point.y -= dy * 0.0012
      }

      ctx.beginPath()
      ctx.fillStyle = 'rgba(158, 190, 255, 0.28)'
      ctx.arc(point.x, point.y, 1.1, 0, Math.PI * 2)
      ctx.fill()
    })

    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i]
        const b = points[j]
        const distance = Math.hypot(a.x - b.x, a.y - b.y)

        if (distance < 120) {
          const opacity = (1 - distance / 120) * 0.16
          ctx.strokeStyle = `rgba(110, 145, 210, ${opacity})`
          ctx.lineWidth = 0.8
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      }
    }

    if (!reducedMotion) {
      window.requestAnimationFrame(draw)
    }
  }

  setCanvasSize()
  window.addEventListener('resize', setCanvasSize)
  window.addEventListener('scroll', setCanvasSize, { passive: true })
  window.addEventListener('pointermove', onPointerMove, { passive: true })

  if (reducedMotion) {
    draw()
  } else {
    window.requestAnimationFrame(draw)
  }
}

setupCarousel()
setupRevealAnimations()
setupLowerNetworkBackground()
