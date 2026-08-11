import { authRoute, ROUTES } from '../../utils/routes'
import {
  formatUpdatedLabel,
  getStageTypeClass,
  sidebarItems,
  state,
  templateCards
} from './stageState'

const VERTIX_ICON_PATH = '/assets/app-icons/vertix.png'

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[char]
  )

function projectCard(project, compact = false) {
  const typeClass = getStageTypeClass(project?.stageType)

  const ownerLabel =
    state.user?.uid && project?.ownerId === state.user.uid
      ? 'Created by you'
      : 'Shared with you'

  const updated = formatUpdatedLabel(project)

  return `
    <article class="vertix-project-card ${compact ? 'is-compact' : ''}">
      <button
        class="vertix-project-open"
        data-open-project="${esc(project.id)}"
        type="button"
        aria-label="Open Vertix project ${esc(project.title)}"
      >
        <div
          class="vertix-project-thumb stage-project-thumb--${typeClass}"
          aria-hidden="true"
        ></div>

        <div class="vertix-project-info">
          <div class="vertix-project-title-row">
            <h4>${esc(project.title || 'Untitled Vertix Project')}</h4>
            <span class="vertix-project-menu" aria-hidden="true">•••</span>
          </div>

          <p class="vertix-project-type">
            ${esc(project.stageType || 'Blank Stage')}
          </p>

          <p class="vertix-project-updated">
            ${esc(updated)} · ${esc(ownerLabel)}
          </p>
        </div>
      </button>
    </article>
  `
}

function renderRecent() {
  if (!state.user) {
    return `
      <div class="vertix-empty-state">
        <p>Sign in to view recently modified projects.</p>
      </div>
    `
  }

  if (state.loadingProjects) {
    return `
      <div class="vertix-empty-state">
        <p>Loading recent Vertix projects…</p>
      </div>
    `
  }

  if (!state.recentProjects.length) {
    return `
      <div class="vertix-empty-state">
        <p>Recent projects will appear here once you start working.</p>
      </div>
    `
  }

  return `
    <div class="vertix-recent-row">
      ${state.recentProjects
        .slice(0, 4)
        .map((project) => projectCard(project, true))
        .join('')}
    </div>
  `
}

function renderProjectsArea() {
  if (!state.user) {
    return `
      <div class="vertix-empty-state">
        <p>Sign in to create and manage Vertix projects.</p>

        <a
          class="vertix-primary-button"
          href="${authRoute({
            redirect: ROUTES.studioVertix || ROUTES.studioStagemaker
          })}"
        >
          Sign In / Sign Up
        </a>
      </div>
    `
  }

  if (state.loadingProjects) {
    return `
      <div class="vertix-empty-state">
        <p>Loading Vertix projects…</p>
      </div>
    `
  }

  if (state.projectsError) {
    return `
      <div class="vertix-empty-state is-warning">
        <p>We could not load your Vertix projects.</p>

        <div class="vertix-empty-actions">
          <button
            class="vertix-primary-button"
            data-new-stage-plan
            type="button"
          >
            New Project
          </button>

          <button
            class="vertix-secondary-button"
            data-retry-stage-projects
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    `
  }

  if (!state.projects.length) {
    return `
      <div class="vertix-empty-state">
        <p>No Vertix projects yet.</p>

        <button
          class="vertix-primary-button"
          data-new-stage-plan
          type="button"
        >
          Create your first project
        </button>
      </div>
    `
  }

  return `
    <div class="vertix-project-grid">
      ${state.projects
        .map((project) => projectCard(project))
        .join('')}
    </div>
  `
}

function renderVertixBrand() {
  return `
    <header class="vertix-browser-brand">
      <span
        class="vertix-browser-brand-icon"
        aria-hidden="true"
      >
        <img
          src="${VERTIX_ICON_PATH}"
          alt=""
          draggable="false"
          onerror="this.hidden=true;this.nextElementSibling.hidden=false"
        />

        <span
          class="vertix-browser-brand-icon-fallback"
          hidden
        >
          V
        </span>
      </span>

      <div class="vertix-browser-brand-copy">
        <strong>Vertix</strong>
        <span>3D & Animation</span>
      </div>
    </header>
  `
}

function renderTemplates() {
  return `
    <div class="vertix-template-strip">
      ${templateCards
        .map(
          (template) => `
            <button
              class="vertix-template-card"
              type="button"
              data-use-template="${esc(template.type)}"
            >
              <span
                class="vertix-template-thumb stage-template-thumb--${esc(template.icon)}"
                aria-hidden="true"
              ></span>

              <span class="vertix-template-copy">
                <strong>${esc(template.title)}</strong>
                <small>${esc(template.subtitle)}</small>
              </span>
            </button>
          `
        )
        .join('')}
    </div>
  `
}

function renderDashboardMarkup() {
  return `
    <main class="vertix-browser">
      <aside class="vertix-browser-sidebar">
        ${renderVertixBrand()}

        <button
          class="vertix-new-project-button"
          data-new-stage-plan
          type="button"
        >
          <span>New Project</span>
          <span aria-hidden="true">＋</span>
        </button>

        <nav
          class="vertix-browser-nav"
          aria-label="Vertix project browser"
        >
          ${sidebarItems
            .map(
              (item) => `
                <button
                  class="vertix-browser-nav-item ${
                    item === 'My Projects' ? 'is-active' : ''
                  }"
                  type="button"
                  ${
                    item === 'My Projects'
                      ? 'aria-current="page"'
                      : ''
                  }
                >
                  ${item}
                </button>
              `
            )
            .join('')}
        </nav>

        <div class="vertix-browser-sidebar-bottom">
          <span class="vertix-browser-sidebar-label">Workspace</span>
          <span class="vertix-browser-sidebar-value">Cloud + Local</span>
        </div>
      </aside>

      <section class="vertix-browser-main">
        <header class="vertix-browser-header">
          <div>
            <p class="vertix-browser-eyebrow">Project Browser</p>
            <h1>Vertix Projects</h1>
            <p>
              Create a new workspace or continue an existing project.
            </p>
          </div>

          <div class="vertix-browser-header-actions">
            <button
              class="vertix-secondary-button"
              type="button"
            >
              Import
            </button>

            <button
              class="vertix-primary-button"
              data-new-stage-plan
              type="button"
            >
              New Project
            </button>
          </div>
        </header>

        <section class="vertix-browser-section vertix-browser-section-primary">
          <div class="vertix-section-heading">
            <div>
              <p class="vertix-section-kicker">Your Workspace</p>
              <h2>My Projects</h2>
            </div>

            <div class="vertix-section-actions">
              <button
                class="vertix-view-toggle is-active"
                type="button"
                aria-label="Grid view"
              >
                ▦
              </button>

              <button
                class="vertix-view-toggle"
                type="button"
                aria-label="List view"
              >
                ☰
              </button>
            </div>
          </div>

          ${renderProjectsArea()}
        </section>

        <section class="vertix-browser-section">
          <div class="vertix-section-heading">
            <div>
              <p class="vertix-section-kicker">Start Faster</p>
              <h2>Templates</h2>
            </div>
          </div>

          ${renderTemplates()}
        </section>

        <section class="vertix-browser-section">
          <div class="vertix-section-heading">
            <div>
              <p class="vertix-section-kicker">Continue Working</p>
              <h2>Recent</h2>
            </div>
          </div>

          ${renderRecent()}
        </section>

        <div data-stage-modal-root></div>
      </section>
    </main>
  `
}

export function renderDashboard() {
  return renderDashboardMarkup()
}
