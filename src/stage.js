import './styles/base.css'
import './styles/stage.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'

const app = document.querySelector('#app')

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
          <button type="button" class="stage-tool-link is-active" aria-current="page">Overview</button>
          <button type="button" class="stage-tool-link">Stage Builder</button>
          <button type="button" class="stage-tool-link">Asset Library</button>
          <button type="button" class="stage-tool-link">Lighting</button>
          <button type="button" class="stage-tool-link">Rigging</button>
          <button type="button" class="stage-tool-link">Camera</button>
          <button type="button" class="stage-tool-link">Exports</button>
        </nav>

        <section class="stage-library" aria-label="Asset library preview">
          <h2>Library Sets</h2>
          <ul>
            <li>Stages</li>
            <li>Audio</li>
            <li>Lighting</li>
            <li>Rigging</li>
            <li>Video</li>
            <li>Backline</li>
            <li>Performers</li>
            <li>Venue</li>
          </ul>
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

              <div class="stage-deck">Stage Deck</div>
              <div class="stage-riser">Drum Riser</div>
              <div class="stage-truss">Truss A</div>
              <div class="stage-speaker stage-speaker-left">L Main</div>
              <div class="stage-speaker stage-speaker-right">R Main</div>
              <div class="stage-camera">Camera 1</div>
              <div class="stage-light stage-light-a">L1</div>
              <div class="stage-light stage-light-b">L2</div>
              <div class="stage-light stage-light-c">L3</div>

              <span class="stage-label stage-label-upstage">Upstage</span>
              <span class="stage-label stage-label-downstage">Downstage</span>
              <span class="stage-label stage-label-foh">FOH</span>
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

initShellChrome()
