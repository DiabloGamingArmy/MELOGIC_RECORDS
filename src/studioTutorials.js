import './styles/base.css'
import './styles/studio.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { studioSidebar } from './components/studioShell'

document.querySelector('#app').innerHTML = `${navShell({ currentPage: 'studio' })}<main class="studio-page"><section class="studio-shell">${studioSidebar({ active: 'tutorials' })}<section class="studio-main"><h1>Studio Tutorials</h1><p>Tutorial videos hosted through Firebase Storage will appear here.</p><div class="studio-demos-grid">${Array.from({length:6},(_,i)=>`<article class="studio-demo-tile">Tutorial Placeholder ${i+1}</article>`).join('')}</div></section></section></main>`
initShellChrome()
