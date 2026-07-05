import './styles/base.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'

document.querySelector('#app').innerHTML = `${navShell({ currentPage: 'distribution' })}<main style="min-height:calc(100vh - 64px);padding:40px 24px;color:#e7ecff;background:#0b0d13"><section style="max-width:980px;margin:0 auto"><h1>Melogic Distribution</h1><p>Distribution tools are being prepared. In the future, projects built in Melogic Studio will be able to move directly into distribution.</p></section></main>`
initShellChrome()
