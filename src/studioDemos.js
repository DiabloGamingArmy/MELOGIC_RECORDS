import './styles/base.css'
import './styles/studio.css'
import './soura/themes/foundation.css'
import './soura/themes/shell.css'
import './soura/themes/deep-black-final.css'
import './soura/themes/missed-surfaces-v2.css'
import './soura/themes/missed-surfaces-v3.css'
import './soura/themes/track-selection-controls-v4.css'
import './soura/themes/transport-timeline-interaction-v5.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { studioSidebar } from './components/studioShell'
import { initStudioBrandLogo } from './components/studioBrandLogo'

document.querySelector('#app').innerHTML = `${navShell({ currentPage: 'studio' })}<main class="studio-page"><section class="studio-shell">${studioSidebar({ active: 'demos' })}<section class="studio-main"><h1>Studio Demos</h1><p>Demo projects will live here, organized by category, so users can open and explore finished Melogic Studio sessions.</p><div class="studio-demos-grid">${['Featured','Mixing','Production','Vocals','Sound Design'].map((c)=>`<article class="studio-demo-tile">${c}</article>`).join('')}</div></section></section></main>`
initShellChrome()
initStudioBrandLogo()
