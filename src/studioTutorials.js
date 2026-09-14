import './styles/base.css'
import './styles/studio.css'
import './soura/themes/foundation.css'
import './soura/themes/shell.css'
import './soura/themes/deep-black-final.css'
import './soura/themes/missed-surfaces-v2.css'
import './soura/themes/missed-surfaces-v3.css'
import './soura/themes/track-selection-controls-v4.css'
import './soura/themes/transport-timeline-interaction-v5.css'
import './soura/themes/recovery-timeline-cycle-volume-v8.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { studioSidebar } from './components/studioShell'
import { initStudioBrandLogo } from './components/studioBrandLogo'

document.querySelector('#app').innerHTML = `${navShell({ currentPage: 'studio' })}<main class="studio-page"><section class="studio-shell">${studioSidebar({ active: 'tutorials' })}<section class="studio-main"><h1>Studio Tutorials</h1><p>Tutorial videos hosted through Firebase Storage will appear here.</p><div class="studio-demos-grid">${Array.from({length:6},(_,i)=>`<article class="studio-demo-tile">Tutorial Placeholder ${i+1}</article>`).join('')}</div></section></section></main>`
initShellChrome()
initStudioBrandLogo()
