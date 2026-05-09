import { ROUTES } from '../utils/routes'

export function studioSidebar({ active = 'projects' } = {}) {
  const is = (key) => (active === key ? 'is-active' : '')
  return `<aside class="studio-sidebar"><div class="studio-brand"><span class="studio-brand-mark"><img data-studio-logo alt="" hidden /><span class="studio-logo-fallback" data-studio-logo-fallback hidden aria-hidden="true">◈</span></span><span class="studio-brand-text">STUDIO</span></div><div class="studio-brand-underline"></div><nav class="studio-sidebar-nav" aria-label="Studio sections"><a class="studio-sidebar-link ${is('projects')}" href="${ROUTES.studio}">PROJECTS</a><a class="studio-sidebar-link ${is('demos')}" href="${ROUTES.studioDemos}">DEMOS</a><a class="studio-sidebar-link ${is('tutorials')}" href="${ROUTES.studioTutorials}">TUTORIALS</a><a class="studio-sidebar-link" href="${ROUTES.distribution || '/distribution'}">DISTRIBUTION</a></nav></aside>`
}
