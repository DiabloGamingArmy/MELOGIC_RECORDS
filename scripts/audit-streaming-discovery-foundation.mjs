import fs from 'node:fs'
const svc=fs.readFileSync('src/data/musicService.js','utf8'),js=fs.readFileSync('src/music.js','utf8'),css=fs.readFileSync('src/styles/music.css','utf8')
const checks=[
['compatibility query',svc.includes('Ordered public catalog query failed; using compatibility query.')],
['public filters',svc.includes("where('status', '==', 'published')")&&svc.includes("where('visibility', '==', 'public')")],
['client sorting fallback',svc.includes('sortReleasesClientSide(compatibility.docs')],
['catalog errors surfaced',svc.includes('throw fallbackError')],
['catalog UI state',js.includes('catalogLoading: false')&&js.includes("catalogError: ''")],
['new releases rail',js.includes("eyebrow: 'Latest on Melogic'")&&js.includes("title: 'New releases'")],
['reusable discovery rail',js.includes('function renderDiscoveryReleaseRail(')],
['discovery CSS',css.includes('MELOGIC PATCH 8 - DISCOVERY FOUNDATION')],
['recently played preserved for Patch 9',js.includes('recentlyPlayed')]
]
let n=0;for(const[x,ok]of checks){console.log(`${ok?'PASS':'FAIL'}  ${x}`);if(!ok)n++}if(n)process.exit(1);console.log('\nPatch 8 discovery foundation audit passed.')
