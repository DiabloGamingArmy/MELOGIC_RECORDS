import './styles/base.css'
import './styles/stage.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { STAGE_ASSET_CATEGORIES, STAGE_PLACEHOLDER_ASSETS } from './data/stageAssetService'

const app = document.querySelector('#app')

const toolSections = ['Overview', 'Stage Builder', 'Asset Library', 'Lighting', 'Rigging', 'Camera', 'Exports']

const categoryRows = STAGE_ASSET_CATEGORIES.map((category) => `<li>${category.label}</li>`).join('')
const placeholderAssetRows = STAGE_PLACEHOLDER_ASSETS.slice(0, 6)
  .map((asset) => `<li><span>${asset.name}</span><small>${asset.category}</small></li>`)
  .join('')

app.innerHTML = `
  ${navShell({ currentPage: 'stage' })}
  <main class="stage-page">
    <section class="stage-shell" aria-label="Melogic Stage foundation preview">
      <aside class="stage-sidebar" aria-label="Stage tools and library">
        <header class="stage-sidebar-header">
          <p class="stage-sidebar-kicker">Melogic Workspace</p>
          <h1>STAGE</h1>
          <span class="stage-sidebar-line" aria-hidden="true"></span>
        </header>

        <nav class="stage-tool-nav" aria-label="Stage sections">
          ${toolSections.map((label, index) => `<button type="button" class="stage-tool-link ${index === 0 ? 'is-active' : ''}" ${index === 0 ? 'aria-current="page"' : ''}>${label}</button>`).join('')}
        </nav>

        <section class="stage-library" aria-label="Asset library preview">
          <h2>Library Sets</h2>
          <ul>${categoryRows}</ul>
          <h3>Starter Assets</h3>
          <ul class="stage-library-assets">${placeholderAssetRows}</ul>
        </section>
      </aside>

      <section class="stage-main">
        <header class="stage-topbar">
          <div class="stage-plan-meta">
            <h2>Untitled Stage Plan</h2>
            <span class="stage-pill">Foundation Preview</span>
          </div>
          <div class="stage-top-actions" aria-label="Stage actions">
            <button type="button" class="stage-action" disabled aria-disabled="true">New Plan <small>Coming soon</small></button>
            <button type="button" class="stage-action" disabled aria-disabled="true">Share <small>Coming soon</small></button>
            <button type="button" class="stage-action" disabled aria-disabled="true">Export <small>Coming soon</small></button>
          </div>
        </header>

        <div class="stage-workgrid">
          <section class="stage-viewport-panel" aria-label="Stage viewport placeholder">
            <header class="stage-panel-header">
              <h3>Viewport</h3>
              <p>3D interaction layer is planned next. This is visual structure only.</p>
            </header>

            <div class="stage-viewport" role="img" aria-label="Mock stage planning viewport with deck, truss, speakers, and camera markers">
              <div class="stage-viewport-grid" aria-hidden="true"></div>
              <div class="stage-perspective-lines" aria-hidden="true"></div>

              <div class="stage-deck" aria-hidden="true">Stage Deck</div>
              <div class="stage-riser" aria-hidden="true">Drum Riser</div>
              <div class="stage-truss" aria-hidden="true">Truss A</div>
              <div class="stage-speaker stage-speaker-left" aria-hidden="true">L Main</div>
              <div class="stage-speaker stage-speaker-right" aria-hidden="true">R Main</div>
              <div class="stage-camera" aria-hidden="true">Camera 1</div>
              <div class="stage-light stage-light-a" aria-hidden="true">L1</div>
              <div class="stage-light stage-light-b" aria-hidden="true">L2</div>
              <div class="stage-light stage-light-c" aria-hidden="true">L3</div>

              <span class="stage-label stage-label-upstage" aria-hidden="true">Upstage</span>
              <span class="stage-label stage-label-downstage" aria-hidden="true">Downstage</span>
              <span class="stage-label stage-label-foh" aria-hidden="true">FOH</span>
            </div>
          </section>

          <aside class="stage-inspector" aria-label="Inspector details panel">
            <header class="stage-panel-header">
              <h3>Inspector</h3>
              <p>Selection details</p>
            </header>
            <dl class="stage-inspector-grid">
              <div><dt>Selected</dt><dd>Stage Deck</dd></div>
              <div><dt>Width</dt><dd>32 ft</dd></div>
              <div><dt>Depth</dt><dd>20 ft</dd></div>
              <div><dt>Height</dt><dd>4 ft</dd></div>
              <div><dt>Snap</dt><dd>Grid enabled</dd></div>
              <div><dt>Units</dt><dd>Feet</dd></div>
              <div><dt>Share</dt><dd>Coming soon</dd></div>
            </dl>
          </aside>
        </div>

        <footer class="stage-status-strip" aria-label="Plan status and spec strip">
          <span>View: Audience perspective</span>
          <span>Grid: 2 ft increments</span>
          <span>Rig set: Truss A baseline</span>
          <span>Safety lines: Visual guide only</span>
        </footer>
      </section>
    </section>
  </main>
`

// TODO: Future: replace CSS viewport mock with a real 3D renderer.
// TODO: Future: create/save stage projects and export PDF/PNG stage plots.
initShellChrome()
