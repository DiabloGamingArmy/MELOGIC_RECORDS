import './styles/base.css'
import './styles/studio.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { studioSidebar } from './components/studioShell'

document.querySelector('#app').innerHTML = `${navShell({ currentPage: 'studio' })}<main class="studio-page"><section class="studio-shell">${studioSidebar({ active: 'demos' })}<section class="studio-main"><h1>Studio Demos</h1><p>Demo projects will live here, organized by category, so users can open and explore finished Melogic Studio sessions.</p><div class="studio-demos-grid">${['Featured','Mixing','Production','Vocals','Sound Design'].map((c)=>`<article class="studio-demo-tile">${c}</article>`).join('')}</div></section></section></main>`
initShellChrome()
