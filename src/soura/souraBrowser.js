import '../styles/base.css'
import '../styles/souraProjectBrowser.css'

import { waitForInitialAuthState } from '../firebase/auth'

import {
  createStudioProject,
  listAccessibleStudioProjects,
  touchStudioProject
} from '../data/studioProjectService'

import {
  authRoute,
  ROUTES,
  studioProjectRoute
} from '../utils/routes'

const app = document.querySelector('#app')
const SOURA_ICON = '/assets/app-icons/soura.png'

const state = {
  user: null,
  projects: [],
  loading: true,
  error: '',
  createOpen: false,
  creating: false,
  createError: '',
  pendingType: 'song'
}

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

function formatDate(value) {
  const millis =
    value?.toMillis?.()
    || (
      typeof value?.seconds === 'number'
        ? value.seconds * 1000
        : 0
    )

  if (!millis) return 'Recently'

  const date = new Date(millis)
  const today = new Date()

  const sameDay =
    date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()

  if (sameDay) return 'Today'

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year:
      date.getFullYear() === today.getFullYear()
        ? undefined
        : 'numeric'
  })
}

function projectTypeLabel(type = '') {
  const labels = {
    song: 'Song',
    beat: 'Beat',
    vocal: 'Vocal Production',
    podcast: 'Podcast',
    blank: 'Blank'
  }

  return labels[type] || 'Song'
}

function renderBrand() {
  return `
    <header class="soura-browser-brand">
      <span
        class="soura-browser-brand-icon"
        aria-hidden="true"
      >
        <img
          src="${SOURA_ICON}"
          alt=""
          draggable="false"
          onerror="this.hidden=true;this.nextElementSibling.hidden=false"
        />

        <span
          class="soura-browser-brand-fallback"
          hidden
        >
          S
        </span>
      </span>

      <div class="soura-browser-brand-copy">
        <strong>Soura</strong>
        <span>Audio Production</span>
      </div>
    </header>
  `
}

function projectCard(project) {
  return `
    <article class="soura-project-card">
      <button
        class="soura-project-open"
        data-open-project="${esc(project.id)}"
        type="button"
      >
        <div
          class="soura-project-art"
          aria-hidden="true"
        >
          <span class="soura-project-wave"></span>
          <span class="soura-project-wave is-two"></span>
          <span class="soura-project-wave is-three"></span>
        </div>

        <div class="soura-project-copy">
          <div class="soura-project-title-row">
            <h3>${esc(project.title)}</h3>
            <span aria-hidden="true">•••</span>
          </div>

          <p>
            ${esc(projectTypeLabel(project.type))}
            · ${esc(project.bpm)} BPM
            · ${esc(project.key)}
          </p>

          <small>
            ${esc(formatDate(
              project.lastOpenedAt
              || project.updatedAt
              || project.createdAt
            ))}
          </small>
        </div>
      </button>
    </article>
  `
}

function renderProjects() {
  if (!state.user) {
    return `
      <div class="soura-empty-state">
        <div>
          <strong>Sign in required</strong>
          <p>Sign in to access your Soura projects.</p>
        </div>

        <a
          class="soura-primary-button"
          href="${authRoute({
            redirect: ROUTES.studioDaw
          })}"
        >
          Sign in
        </a>
      </div>
    `
  }

  if (state.loading) {
    return `
      <div class="soura-empty-state">
        <p>Loading Soura projects…</p>
      </div>
    `
  }

  if (state.error) {
    return `
      <div class="soura-empty-state is-error">
        <div>
          <strong>Projects unavailable</strong>
          <p>${esc(state.error)}</p>
        </div>

        <button
          class="soura-secondary-button"
          data-retry-projects
          type="button"
        >
          Retry
        </button>
      </div>
    `
  }

  if (!state.projects.length) {
    return `
      <div class="soura-empty-state">
        <div>
          <strong>No projects yet</strong>
          <p>Create your first Soura project.</p>
        </div>

        <button
          class="soura-primary-button"
          data-new-project
          type="button"
        >
          New Project
        </button>
      </div>
    `
  }

  return `
    <div class="soura-project-grid">
      ${state.projects.map(projectCard).join('')}
    </div>
  `
}

function renderNewProjectDialog() {
  if (!state.createOpen) return ''

  return `
    <div
      class="soura-modal-backdrop"
      data-close-create
    >
      <section
        class="soura-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="soura-create-title"
        data-soura-modal
      >
        <p class="soura-kicker">New Soura Project</p>

        <h2 id="soura-create-title">
          Name your project
        </h2>

        <p class="soura-modal-description">
          Soura will create the project in your
          Melogic workspace and open the editor.
        </p>

        ${
          state.createError
            ? `
              <div
                class="soura-create-error"
                role="alert"
              >
                ${esc(state.createError)}
              </div>
            `
            : ''
        }

        <form data-create-project-form>
          <label class="soura-field">
            <span>Project name</span>

            <input
              data-project-name
              type="text"
              maxlength="120"
              autocomplete="off"
              placeholder="Untitled Project"
              ${state.creating ? 'disabled' : ''}
            />
          </label>

          <div class="soura-modal-actions">
            <button
              class="soura-secondary-button"
              data-cancel-create
              type="button"
              ${state.creating ? 'disabled' : ''}
            >
              Cancel
            </button>

            <button
              class="soura-primary-button"
              type="submit"
              ${state.creating ? 'disabled' : ''}
            >
              ${
                state.creating
                  ? 'Creating…'
                  : 'Create & Open'
              }
            </button>
          </div>
        </form>
      </section>
    </div>
  `
}

function render() {
  app.innerHTML = `
    <main class="soura-browser">
      <aside class="soura-browser-sidebar">
        ${renderBrand()}

        <button
          class="soura-new-project-button"
          data-new-project
          type="button"
        >
          <span>New Project</span>
          <span aria-hidden="true">＋</span>
        </button>

        <nav
          class="soura-browser-nav"
          aria-label="Soura project browser"
        >
          <button
            class="soura-browser-nav-item is-active"
            type="button"
            aria-current="page"
          >
            My Projects
          </button>

          <button
            class="soura-browser-nav-item"
            type="button"
          >
            Templates
          </button>

          <button
            class="soura-browser-nav-item"
            type="button"
          >
            Shared With Me
          </button>

          <button
            class="soura-browser-nav-item"
            type="button"
          >
            Imports
          </button>

          <button
            class="soura-browser-nav-item"
            type="button"
          >
            Learn
          </button>
        </nav>

        <div class="soura-browser-sidebar-bottom">
          <span>Workspace</span>
          <strong>Cloud + Local</strong>
        </div>
      </aside>

      <section class="soura-browser-main">
        <header class="soura-browser-header">
          <div>
            <p class="soura-kicker">Project Browser</p>

            <h1>Soura Projects</h1>

            <p>
              Start a new session or continue
              your existing audio work.
            </p>
          </div>

          <div class="soura-browser-header-actions">
            <button
              class="soura-secondary-button"
              type="button"
            >
              Import
            </button>

            <button
              class="soura-primary-button"
              data-new-project
              type="button"
            >
              New Project
            </button>
          </div>
        </header>

        <section class="soura-browser-section">
          <div class="soura-section-heading">
            <div>
              <p class="soura-kicker">Your Workspace</p>
              <h2>My Projects</h2>
            </div>

            <span>
              ${state.projects.length}
              ${
                state.projects.length === 1
                  ? 'project'
                  : 'projects'
              }
            </span>
          </div>

          ${renderProjects()}
        </section>

        <section class="soura-browser-section">
          <div class="soura-section-heading">
            <div>
              <p class="soura-kicker">Start Faster</p>
              <h2>Templates</h2>
            </div>
          </div>

          <div class="soura-template-grid">
            <button
              class="soura-template-card"
              data-template-project="song"
              type="button"
            >
              <span class="soura-template-icon">♪</span>
              <strong>Song</strong>
              <small>Arrangement-ready music session</small>
            </button>

            <button
              class="soura-template-card"
              data-template-project="beat"
              type="button"
            >
              <span class="soura-template-icon">◫</span>
              <strong>Beat</strong>
              <small>Drum and production workspace</small>
            </button>

            <button
              class="soura-template-card"
              data-template-project="vocal"
              type="button"
            >
              <span class="soura-template-icon">◉</span>
              <strong>Vocal</strong>
              <small>Vocal recording and editing</small>
            </button>

            <button
              class="soura-template-card"
              data-template-project="blank"
              type="button"
            >
              <span class="soura-template-icon">＋</span>
              <strong>Blank</strong>
              <small>Empty production session</small>
            </button>
          </div>
        </section>
      </section>

      ${renderNewProjectDialog()}
    </main>
  `

  bindEvents()
}

function bindEvents() {
  app.querySelectorAll('[data-new-project]').forEach((button) => {
    button.addEventListener('click', () => openCreateDialog('song'))
  })

  app.querySelector('[data-retry-projects]')?.addEventListener(
    'click',
    loadProjects
  )

  app.querySelectorAll('[data-open-project]').forEach((button) => {
    button.addEventListener(
      'click',
      () => openProject(button.dataset.openProject)
    )
  })

  app.querySelectorAll('[data-template-project]').forEach((button) => {
    button.addEventListener(
      'click',
      () => openCreateDialog(button.dataset.templateProject)
    )
  })

  const backdrop = app.querySelector('[data-close-create]')

  backdrop?.addEventListener('click', (event) => {
    if (event.target === backdrop) closeCreateDialog()
  })

  app.querySelector('[data-cancel-create]')?.addEventListener(
    'click',
    closeCreateDialog
  )

  app.querySelector('[data-create-project-form]')?.addEventListener(
    'submit',
    handleCreateProject
  )

  requestAnimationFrame(() => {
    app.querySelector('[data-project-name]')?.focus()
  })
}

function openCreateDialog(templateType = 'song') {
  if (!state.user) {
    window.location.href = authRoute({
      redirect: ROUTES.studioDaw
    })
    return
  }

  state.createOpen = true
  state.createError = ''
  state.pendingType = templateType || 'song'

  render()
}

function closeCreateDialog() {
  if (state.creating) return

  state.createOpen = false
  state.createError = ''

  render()
}

async function handleCreateProject(event) {
  event.preventDefault()

  if (!state.user || state.creating) return

  const input = app.querySelector('[data-project-name]')
  const title = String(input?.value || '').trim()

  state.creating = true
  state.createError = ''

  render()

  try {
    const project = await createStudioProject(
      state.user,
      {
        title: title || 'Untitled Project',
        type: state.pendingType || 'song'
      }
    )

    window.location.href = studioProjectRoute(project.id)
  } catch (error) {
    console.error('[Soura Browser] Project creation failed:', error)

    state.creating = false
    state.createError =
      error?.message
      || 'Soura could not create the project.'

    render()
  }
}

async function openProject(projectId) {
  const id = String(projectId || '').trim()

  if (!id) return

  try {
    await touchStudioProject(id)
  } catch (error) {
    console.warn(
      '[Soura Browser] Could not update last-opened time:',
      error,
    )
  }

  window.location.href = studioProjectRoute(id)
}

async function loadProjects() {
  if (!state.user) {
    state.projects = []
    state.loading = false
    state.error = ''
    render()
    return
  }

  state.loading = true
  state.error = ''

  render()

  try {
    state.projects =
      await listAccessibleStudioProjects(state.user.uid)

    state.loading = false
  } catch (error) {
    console.error('[Soura Browser] Project load failed:', error)

    state.projects = []
    state.loading = false
    state.error =
      error?.message
      || 'Soura could not load your projects.'
  }

  render()
}

async function boot() {
  state.user = await waitForInitialAuthState()
  await loadProjects()
}

boot().catch((error) => {
  console.error('[Soura Browser] Boot failed:', error)

  state.loading = false
  state.error =
    error?.message
    || 'Soura could not start.'

  render()
})
