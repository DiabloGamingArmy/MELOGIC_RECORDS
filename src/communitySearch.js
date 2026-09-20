import './styles/base.css'
import './styles/community.css'
import './styles/communitySearch.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { listCommunities, listCommunityPosts } from './data/communityService'
import { searchProfilesByUsername } from './data/profileSearchService'
import { communityPostRoute, communityRoute, publicProfileRoute, ROUTES } from './utils/routes'
import { iconSvg } from './utils/icons'
const app=document.querySelector('#app'); document.body.classList.add('is-community-search-page')
const esc=(v='')=>String(v).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))
const state={q:'',busy:false,people:[],communities:[],posts:[],request:0}
function render(){
  const h=app.querySelector('[data-results]'); if(!h)return;
  if(!state.q){h.innerHTML=`<div class="cs-empty">${iconSvg('search')}<strong>Search Community</strong><span>Find creators, communities, and posts.</span></div>`;return}
  if(state.busy){h.innerHTML='<div class="cs-empty"><strong>Searching…</strong></div>';return}
  const people=state.people.map(x=>`<a class="cs-row" data-search-type="Accounts" data-result-id="${esc(x.uid)}" href="${publicProfileRoute({uid:x.uid,username:x.username})}"><strong>${esc(x.displayName||x.username||'Creator')}</strong><small>@${esc(x.username||'creator')}</small></a>`).join('');
  const communities=state.communities.map(x=>`<a class="cs-row" data-search-type="Communities" data-result-id="${esc(x.id||x.slug)}" href="${communityRoute(x.slug)}"><strong>${esc(x.name||x.slug||'Community')}</strong><small>c/${esc(x.slug||'')}</small></a>`).join('');
  const posts=state.posts.map(x=>`<a class="cs-post" data-search-type="Posts" data-result-id="${esc(x.postId)}" href="${communityPostRoute(x.postId)}"><small>@${esc(x.authorUsername||'creator')}</small>${x.title?`<strong>${esc(x.title)}</strong>`:''}<p>${esc(String(x.body||'').slice(0,220))}</p></a>`).join('');
  h.innerHTML=(people?`<section data-result-section="Accounts"><h2>Creators</h2>${people}</section>`:'')+(communities?`<section data-result-section="Communities"><h2>Communities</h2>${communities}</section>`:'')+(posts?`<section data-result-section="Posts"><h2>Posts</h2>${posts}</section>`:'')||'<div class="cs-empty"><strong>No results</strong><span>Try another search.</span></div>';
  requestAnimationFrame(melogicApplySearchFilter)
}
async function run(raw){const q=String(raw||'').trim(),request=++state.request;state.q=q;if(!q){state.busy=false;state.people=[];state.communities=[];state.posts=[];render();return}state.busy=true;render();const [people,communities,page]=await Promise.all([q.length>1?searchProfilesByUsername(q).catch(()=>[]):Promise.resolve([]),listCommunities({search:q,limitCount:8}).catch(()=>[]),listCommunityPosts({search:q,limitCount:12,pageMode:true}).catch(()=>({posts:[]}))]);if(request!==state.request)return;state.people=Array.isArray(people)?people:[];state.communities=Array.isArray(communities)?communities:(communities?.communities||[]);state.posts=Array.isArray(page)?page:(page?.posts||[]);state.busy=false;render()}
app.innerHTML=`${navShell({currentPage:'communitySearch'})}<main class="cs-main"><div class="cs-shell"><header class="cs-desktop"><a href="${ROUTES.community}" aria-label="Back">${iconSvg('arrowLeft')}</a><h1>Search Community</h1></header><form class="cs-search" role="search" aria-label="Community"><span>${iconSvg('search')}</span><input type="search" placeholder="Search creators, communities, posts…" aria-label="Search Community" autocomplete="off" enterkeyhint="search" autofocus></form><div class="cs-results" data-results aria-live="polite"></div></div></main>`
initShellChrome({currentPage:'communitySearch'});const input=app.querySelector('.cs-search input');let timer;input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>run(input.value),180)});input.form.addEventListener('submit',e=>{e.preventDefault();clearTimeout(timer);run(input.value)});render()


// MELOGIC_SEARCH_FILTER_PATCH_V2
const MELOGIC_SEARCH_FILTERS = ['All','Accounts','Communities','Posts','Video','Audio','Live','Products'];
let melogicSearchFilter = 'All';

function melogicSearchFilterPatch() {
  const input = document.querySelector('#community-search-input, input[type="search"]');
  if (!input || document.querySelector('.melogic-search-filter-wrap')) return;

  const title = [...document.querySelectorAll('h1,h2,.page-title')]
    .find(el => el.textContent.trim().toLowerCase() === 'search');
  if (title?.parentElement) {
    title.parentElement.classList.add('melogic-search-header');
    title.classList.add('melogic-search-title');
  }

  const field = input.closest('.community-search-input,.search-input,.search-field') || input.parentElement;
  field.classList.add('melogic-search-field');
  const row = document.createElement('div');
  row.className = 'melogic-search-row';
  field.parentNode.insertBefore(row, field);
  row.appendChild(field);

  const wrap = document.createElement('div');
  wrap.className = 'melogic-search-filter-wrap';
  const btn = document.createElement('button');
  btn.type='button'; btn.className='melogic-search-filter-btn';
  btn.setAttribute('aria-label','Filter search results');
  btn.setAttribute('aria-haspopup','menu'); btn.setAttribute('aria-expanded','false');
  btn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M7 14v6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';

  const menu=document.createElement('div');
  menu.className='melogic-search-filter-menu'; menu.hidden=true; menu.setAttribute('role','menu');
  menu.innerHTML=MELOGIC_SEARCH_FILTERS.map(x=>`<button type="button" role="menuitemradio" aria-checked="${x===melogicSearchFilter}" data-filter="${x}" class="${x===melogicSearchFilter?'selected':''}"><span>${x}</span><span class="check" aria-hidden="true">&#10003;</span></button>`).join('');
  wrap.append(btn,menu); row.appendChild(wrap);

  const close=()=>{menu.hidden=true;btn.setAttribute('aria-expanded','false')};
  btn.onclick=e=>{e.stopPropagation();menu.hidden=!menu.hidden;btn.setAttribute('aria-expanded',String(!menu.hidden))};
  menu.onclick=e=>{
    const option=e.target.closest('[data-filter]'); if(!option)return;
    melogicSearchFilter=option.dataset.filter;
    menu.querySelectorAll('[data-filter]').forEach(x=>{const on=x.dataset.filter===melogicSearchFilter;x.classList.toggle('selected',on);x.setAttribute('aria-checked',String(on))});
    btn.classList.toggle('active',melogicSearchFilter!=='All'); close(); melogicApplySearchFilter();
  };
  document.addEventListener('pointerdown',e=>{if(!wrap.contains(e.target))close()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  input.addEventListener('input',()=>requestAnimationFrame(melogicApplySearchFilter));
  new MutationObserver(()=>requestAnimationFrame(melogicApplySearchFilter))
    .observe(document.querySelector('.community-search-results,.search-results,main')||document.body,{childList:true,subtree:true});
  melogicApplySearchFilter();
}

function melogicResultType(el){
  const h=`${el.dataset.searchType||''} ${el.dataset.resultType||''} ${el.dataset.contentType||''} ${el.className||''}`.toLowerCase();
  if(/communit/.test(h))return'Communities';
  if(/account|creator|profile|user/.test(h))return'Accounts';
  if(/product|marketplace/.test(h))return'Products';
  if(/live/.test(h))return'Live';
  if(/video|reel/.test(h)||el.querySelector?.('video'))return'Video';
  if(/audio|track|song|music/.test(h)||el.querySelector?.('audio'))return'Audio';
  return'Posts';
}
function melogicEmpty(noResults){
  let e=document.querySelector('.melogic-search-empty');
  if(!e){e=document.createElement('section');e.className='melogic-search-empty';(document.querySelector('main')||document.body).appendChild(e)}
  e.innerHTML=`<svg class="melogic-empty-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m15.5 15.5 4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><strong>${noResults?'No results found':'Search Community'}</strong><span>${noResults?'Try another search or filter.':'Find creators, communities, and posts.'}</span>`;
  e.hidden=false; return e;
}
function melogicApplySearchFilter(){
  const input=document.querySelector('#community-search-input,input[type="search"]'); if(!input)return;
  const root=document.querySelector('[data-results],.community-search-results,.search-results');
  const items=root?[...root.querySelectorAll('[data-search-type],[data-result-type],[data-content-type],[data-result-id],[data-post-id],article,.search-result,.community-search-result')]:[];
  let shown=0;
  items.forEach(el=>{const on=melogicSearchFilter==='All'||melogicResultType(el)===melogicSearchFilter;el.hidden=!on;if(on)shown++});
  root?.querySelectorAll('[data-result-section]').forEach(section=>{const visible=[...section.querySelectorAll('[data-search-type]')].some(item=>!item.hidden);section.hidden=!visible});
  const old=document.querySelector('.melogic-search-empty');
  if(!input.value.trim() && !items.length) melogicEmpty(false);
  else if(input.value.trim() && items.length && !shown) melogicEmpty(true);
  else if(old) old.hidden=true;
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',melogicSearchFilterPatch,{once:true});else melogicSearchFilterPatch();
