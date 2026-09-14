import fs from 'node:fs'
const m=fs.readFileSync('src/music.js','utf8')
const a=fs.readFileSync('src/components/assetChrome.js','utf8')
const h=fs.readFileSync('music.html','utf8')
const g=fs.readFileSync('.gitignore','utf8')
const checks=[
 ['static boot class',h.includes('streaming-is-booting')],
 ['critical boot CSS',h.includes('streaming-critical-boot-style')],
 ['first paint guard retained',h.includes('streaming-first-paint')],
 ['canonical loader mounted on body',m.includes("document.body.insertAdjacentHTML('beforeend', renderPagePreloaderMarkup())")],
 ['app hidden until ready',m.includes("classList.add('streaming-is-booting')")],
 ['reveal only at settle',m.includes("classList.remove('streaming-is-booting')")],
 ['obsolete startup shell removed',!m.includes('function renderStreamingStartupShell()')],
 ['false global autoplay bridge removed',!a.includes('installPersistentMusicNavigationBridge')],
 ['backup directory ignored',g.includes('.melogic_patch_backups/')]
]
let fail=0
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'}  ${name}`);if(!ok)fail++}
if(fail)process.exit(1)
console.log('\nPatch 18 audit passed.')
