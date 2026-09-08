import {exportMusicXML} from './scoreMusicXML.js'
import {layoutScore} from './scoreLayout.js'
import {engraveMeasure} from './scoreEngraver.js'
import {drawScoreConnections} from './scoreConnections.js'
import {esc} from './scoreUI.js'
export function downloadMusicXML(model,document,title,owner=window.document){
  const blob=new Blob([exportMusicXML(model,document,title)],{type:'application/vnd.recordare.musicxml+xml'})
  const url=URL.createObjectURL(blob),a=owner.createElement('a');a.href=url;a.download=`${(document.metadata.title||title||'score').replace(/[^\w -]/g,'_')}.musicxml`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000)
}
/** Separate vector print document: no copied app state, no transport, no audio. */
export async function printScore(model,document,title,owner=window.document){
  if(!model.measures.length)throw new Error('Choose at least one visible staff to print.')
  const popup=owner.defaultView.open('','soura-score-print','width=1000,height=800')
  if(!popup)throw new Error('Allow the score print window, then try Print / PDF again.')
  const layout=layoutScore(model,{...document.layout,type:'page'}),out=popup.document,metadata=document.metadata||{}
  out.open();out.write(`<!doctype html><html><head><title>${esc(metadata.title||title)}</title><style>@page{size:${document.layout.paper==='Letter'?'letter':'A4'} ${document.layout.orientation||'portrait'};margin:0}*{box-sizing:border-box}body{margin:0;background:#d6d9df;color:#202633}.page{position:relative;margin:0 auto 24px;background:#fff;break-after:page;overflow:hidden}.page:last-child{break-after:auto}.measure{position:absolute;transform-origin:top left}.measure svg{overflow:visible}.connections{position:absolute;inset:0;pointer-events:none}.soura-score-hit{display:none}.soura-score-note-name,.soura-score-measure-number{font:11px system-ui;fill:#566}.soura-score-lyric{font:14px serif;fill:#222}header{text-align:center;padding:30px 48px}header h1{font:24px serif;margin:10px}header p{margin:4px}footer{position:absolute;bottom:20px;width:100%;text-align:center;font:11px serif}button{margin:10px;padding:8px}@media print{body{background:white}.page{margin:0}button{display:none}}</style></head><body><button id="print">Print / Save as PDF</button></body></html>`);out.close()
  const rendered=new Map()
  for(const page of layout.pages){const node=out.createElement('section');node.className='page';node.style.cssText=`width:${page.width}px;height:${page.height}px`;node.dataset.page=page.index;node.innerHTML=`<header>${page.index===0?`<h1>${esc(metadata.title||title)}</h1><p>${esc(metadata.subtitle)}</p><p>${esc(metadata.movementNumber)} ${esc(metadata.movementTitle)}</p><p>${esc(metadata.composer)}${metadata.arranger?' · Arr. '+esc(metadata.arranger):''}${metadata.lyricist?' · Lyrics '+esc(metadata.lyricist):''}</p>`:''}</header><footer>${esc(metadata.copyright)} · ${page.index+1}</footer>`;out.body.append(node)}
  for(const position of layout.cells){const page=out.querySelector(`[data-page="${position.page}"]`),node=out.createElement('div');node.className='measure';node.style.cssText=`left:${position.x}px;top:${position.y-layout.pages[position.page].y}px;width:${position.width}px;transform:scale(${position.scale})`;page.append(node);rendered.set(position.id,{...engraveMeasure(node,{...position.measure,width:position.width},model,{},position),layout:position});if(rendered.size%12===0)await new Promise(resolve=>setTimeout(resolve,0))}
  for(const page of layout.pages){const node=out.querySelector(`[data-page="${page.index}"]`),svg=out.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('connections');svg.setAttribute('width',String(page.width));svg.setAttribute('height',String(page.height));svg.setAttribute('viewBox',`0 ${page.y} ${page.width} ${page.height}`);node.append(svg);drawScoreConnections(svg,rendered,layout,document.symbols)
    for(const system of layout.systems.filter(s=>s.page===page.index))for(const [i,staff]of model.staffDefinitions.entries()){const label=out.createElement('span');label.style.cssText=`position:absolute;left:${system.x}px;top:${system.y-page.y+(110+i*180)*system.scale}px;width:90px;font:12px serif`;label.textContent=system.index===0?staff.name:staff.abbreviation;node.append(label)}
  }
  out.getElementById('print').onclick=()=>popup.print()
  popup.focus()
}
