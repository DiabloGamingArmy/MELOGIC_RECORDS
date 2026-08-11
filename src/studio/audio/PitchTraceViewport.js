
const stateByRegion = new Map()
const clamp=(v,min,max)=>Math.min(max,Math.max(min,Number(v)||min))
function getState(id='pitch-trace'){id=String(id);if(!stateByRegion.has(id))stateByRegion.set(id,{xZoom:1,rowHeight:22,scrollLeft:0,scrollTop:0});return stateByRegion.get(id)}
function getViewId(view){return view?.dataset?.pitchTraceRegionId||'pitch-trace'}
function getScroll(view){return view?.querySelector?.('[data-pitch-trace-scroll]')||null}
function applyState(view,preserve=false,ax=.5,ay=.5){
 const s=getState(getViewId(view)), sc=getScroll(view); if(!sc)return;
 const ow=Math.max(1,sc.scrollWidth),oh=Math.max(1,sc.scrollHeight),rx=(sc.scrollLeft+sc.clientWidth*ax)/ow,ry=(sc.scrollTop+sc.clientHeight*ay)/oh;
 view.style.setProperty('--pt-x-zoom',String(s.xZoom)); view.style.setProperty('--pt-row-height',`${s.rowHeight}px`);
 requestAnimationFrame(()=>{if(preserve){sc.scrollLeft=Math.max(0,rx*Math.max(1,sc.scrollWidth)-sc.clientWidth*ax);sc.scrollTop=Math.max(0,ry*Math.max(1,sc.scrollHeight)-sc.clientHeight*ay)}else{sc.scrollLeft=s.scrollLeft;sc.scrollTop=s.scrollTop}})
}
function zoom(view,axis,dir,ax=.5,ay=.5){const s=getState(getViewId(view));if(axis==='x'){s.xZoom=dir==='fit'?1:clamp(s.xZoom*(dir==='in'?1.25:.8),1,24)}else{s.rowHeight=dir==='fit'?22:clamp(s.rowHeight*(dir==='in'?1.16:.86),14,58)}applyState(view,true,ax,ay)}
function hydrate(){document.querySelectorAll('.studio-pitch-trace-view').forEach(v=>{if(v.dataset.ptReady==='1')return;v.dataset.ptReady='1';applyState(v)})}
document.addEventListener('click',e=>{const b=e.target.closest?.('[data-pitch-trace-zoom]');if(!b)return;const v=b.closest('.studio-pitch-trace-view');if(v)zoom(v,b.dataset.pitchTraceAxis==='y'?'y':'x',b.dataset.pitchTraceZoom||'fit')})
document.addEventListener('wheel',e=>{const sc=e.target.closest?.('[data-pitch-trace-scroll]');if(!sc)return;const v=sc.closest('.studio-pitch-trace-view');if(!v)return;if(e.metaKey||e.ctrlKey){e.preventDefault();const r=sc.getBoundingClientRect();zoom(v,'x',e.deltaY<0?'in':'out',clamp((e.clientX-r.left)/Math.max(1,r.width),0,1),.5)}else if(e.altKey){e.preventDefault();const r=sc.getBoundingClientRect();zoom(v,'y',e.deltaY<0?'in':'out',.5,clamp((e.clientY-r.top)/Math.max(1,r.height),0,1))}else if(e.shiftKey&&Math.abs(e.deltaY)>Math.abs(e.deltaX)){e.preventDefault();sc.scrollLeft+=e.deltaY}}, {passive:false})
document.addEventListener('scroll',e=>{const sc=e.target;if(!(sc instanceof Element)||!sc.matches('[data-pitch-trace-scroll]'))return;const v=sc.closest('.studio-pitch-trace-view');if(!v)return;const s=getState(getViewId(v));s.scrollLeft=sc.scrollLeft;s.scrollTop=sc.scrollTop},true)
if(!globalThis.__souraPitchTraceViewportInstalled){globalThis.__souraPitchTraceViewportInstalled=true;new MutationObserver(hydrate).observe(document.documentElement,{subtree:true,childList:true});hydrate()}
