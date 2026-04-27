import { navShell } from './navShell'
import { renderPagePreloaderMarkup } from './pagePreloader'
import { ROUTES } from '../utils/routes'

export function mountStandardPage({
  currentPage,
  pageId,
  eyebrow = 'Melogic',
  title,
  description,
  primaryCta = { label: 'Browse Products', href: ROUTES.products },
  secondaryCta = { label: 'Back Home', href: ROUTES.home }
}) {
  const app = document.querySelector('#app')
  if (!app) return

  app.innerHTML = `
    ${renderPagePreloaderMarkup()}
    ${navShell({ currentPage })}

    <main>
      <section class="standard-hero section" id="${pageId}-top">
        <div class="hero-media" aria-hidden="true">
          <video
            id="${pageId}-hero-video"
            class="hero-bg-video"
            muted
            loop
            autoplay
            playsinline
            preload="metadata"
          ></video>
          <div class="hero-media-overlay"></div>
        </div>

        <div class="section-inner hero-inner hero-content-layer">
          <div class="hero-copy">
            <p class="eyebrow">${eyebrow}</p>
            <h1>${title}</h1>
            <p>${description}</p>
            <div class="hero-actions">
              <a class="button button-accent" href="${primaryCta.href}">${primaryCta.label}</a>
              <a class="button button-muted" href="${secondaryCta.href}">${secondaryCta.label}</a>
            </div>
          </div>
        </div>
      </section>
    </main>
  `
}
