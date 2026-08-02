import { ROUTES } from '../utils/routes'

const STUDIO_APPS = [
  { key: 'daw', activeKeys: ['daw', 'projects'], label: 'Soura', href: ROUTES.studioDaw, icon: 'soura' },
  { key: 'stagemaker', label: 'Vertix', href: ROUTES.studioStagemaker, icon: 'vertix' },
  { key: 'lucentra', label: 'Lucentra', href: ROUTES.studioLucentra, icon: 'lucentra' },
  { key: 'inkora', label: 'Inkora', href: ROUTES.studioInkora, icon: 'inkora' },
  { key: 'cineara', label: 'Cineara', href: ROUTES.studioCineara, icon: 'cineara' },
  { key: 'rundownpilot', label: 'Rundown Pilot', href: ROUTES.studioRundownPilot, icon: 'rundownpilot' }
]

function appIcon(item) {
  const storagePath = `assets/profilePictures/${item.icon}/${item.iconFile || item.icon}.png`
  const fallback = item.label.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  return `<span class="studio-sidebar-app-icon" aria-hidden="true"><img data-studio-app-icon data-studio-app-icon-path="${storagePath}" alt="" hidden /><span data-studio-app-icon-fallback>${fallback}</span></span>`
}

export function studioSidebar({ active = 'projects' } = {}) {
  const is = (key) => (active === key ? 'is-active' : '')
  const apps = STUDIO_APPS.map((item) => {
    const activeKeys = item.activeKeys || [item.key]
    return `<a class="studio-sidebar-link studio-sidebar-app ${activeKeys.includes(active) ? 'is-active' : ''}" href="${item.href}" data-studio-shell-nav ${activeKeys.includes(active) ? 'aria-current="page"' : ''}>${appIcon(item)}<span>${item.label}</span></a>`
  }).join('')

  return `<aside class="studio-sidebar">
    <div class="studio-brand"><span class="studio-brand-mark"><img data-studio-logo alt="" hidden /><span class="studio-logo-fallback" data-studio-logo-fallback hidden aria-hidden="true">◈</span></span><span class="studio-brand-text">STUDIO</span></div>
    <div class="studio-brand-underline"></div>
    <nav class="studio-sidebar-nav" aria-label="Studio sections">
      <a class="studio-sidebar-link studio-sidebar-home ${is('hub')}" href="${ROUTES.studio}" data-studio-shell-nav ${active === 'hub' ? 'aria-current="page"' : ''}>Studio Home</a>
      <div class="studio-sidebar-group">
        <span class="studio-sidebar-group-label">Apps</span>
        ${apps}
      </div>
      <div class="studio-sidebar-group studio-sidebar-group--resources">
        <span class="studio-sidebar-group-label">Workspace</span>
        <a class="studio-sidebar-link ${is('live')}" href="${ROUTES.studioLive}" data-studio-shell-nav>Live Studio</a>
        <a class="studio-sidebar-link ${is('demos')}" href="${ROUTES.studioDemos}">Demos</a>
        <a class="studio-sidebar-link ${is('tutorials')}" href="${ROUTES.studioTutorials}">Tutorials</a>
        <a class="studio-sidebar-link" href="${ROUTES.distribution || '/distribution'}">Distribution</a>
      </div>
    </nav>
  </aside>`
}
