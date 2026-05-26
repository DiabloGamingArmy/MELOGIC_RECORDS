import './styles/base.css'
import './styles/stage.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { ROUTES } from './utils/routes'

const app = document.querySelector('#app')

app.innerHTML = `
  ${navShell({ currentPage: 'stage' })}
  <main class="stage-page">
    <section class="stage-hero">
      <p class="stage-kicker">Melogic Workspace</p>
      <h1>Melogic Stage</h1>
      <p class="stage-subtitle">Design the show before load-in.</p>
      <p class="stage-description">
        Build stage concepts, map lighting and rigging ideas, plan camera positions, organize gear,
        and share production-ready layouts with collaborators, venues, and crews.
      </p>
      <div class="stage-actions" aria-label="Stage actions">
        <button type="button" class="stage-action stage-action-primary" disabled aria-disabled="true">Start Stage Plan <span>Coming soon</span></button>
        <a href="#stage-templates" class="stage-action stage-action-secondary" aria-disabled="true" onclick="return false;">Browse Templates <span>Coming soon</span></a>
      </div>
    </section>

    <section class="stage-workspace" aria-label="Stage planning canvas placeholder">
      <header class="stage-workspace-header">
        <h2>Planning Canvas</h2>
        <p>Viewport foundation only. Interactive editing tools will be added in a future release.</p>
      </header>
      <div class="stage-canvas-placeholder" role="img" aria-label="Placeholder stage planning layout canvas">
        <div class="stage-grid"></div>
        <div class="stage-layer stage-layer-stage">Main stage footprint</div>
        <div class="stage-layer stage-layer-rig">Rigging line set</div>
        <div class="stage-layer stage-layer-cam">Camera lane</div>
      </div>
      <footer class="stage-workspace-footer" id="stage-templates">
        <p>Template library, scene modes, and export tools are planned for upcoming iterations.</p>
        <a href="${ROUTES.studio}">Need active project tools now? Open Studio.</a>
      </footer>
    </section>
  </main>
`

initShellChrome()
