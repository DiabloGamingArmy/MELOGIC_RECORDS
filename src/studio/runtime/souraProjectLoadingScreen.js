import '../../styles/souraProjectLoading.css'

const DEFAULT_STEPS = [
  { id: 'session', label: 'Restoring Melogic session' },
  { id: 'project', label: 'Loading project data' },
  { id: 'workspace', label: 'Restoring workspace' },
  { id: 'audio', label: 'Preparing audio engine' },
  { id: 'media', label: 'Hydrating project media' }
]

const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, value))

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

export function createSouraProjectLoader(
  root,
  {
    iconPath = '/assets/app-icons/soura.png',
    title = 'Soura',
    subtitle = 'Loading your project'
  } = {}
) {
  const state = {
    steps: DEFAULT_STEPS.map((step) => ({
      ...step,
      status: 'pending',
      detail: ''
    })),
    activeId: '',
    error: ''
  }

  function indexOf(stepId) {
    return state.steps.findIndex(
      (step) => step.id === stepId
    )
  }

  function progress() {
    const done =
      state.steps.filter(
        (step) => step.status === 'done'
      ).length

    const active =
      state.steps.some(
        (step) => step.status === 'active'
      )
        ? 0.45
        : 0

    return clamp(
      (done + active)
        / Math.max(1, state.steps.length),
      0,
      1
    )
  }

  function markup() {
    const value = progress()
    const percent = Math.round(value * 100)

    return `
      <main
        class="soura-project-loader"
        data-soura-project-loader
      >
        <section
          class="soura-project-loader-card"
          aria-live="polite"
        >
          <div
            class="soura-project-loader-icon"
            aria-hidden="true"
          >
            <img
              src="${esc(iconPath)}"
              alt=""
              draggable="false"
              onerror="this.hidden=true;this.nextElementSibling.hidden=false"
            />

            <span hidden>S</span>
          </div>

          <div class="soura-project-loader-heading">
            <strong>${esc(title)}</strong>
            <span>${esc(subtitle)}</span>
          </div>

          <div
            class="soura-project-loader-track"
            role="progressbar"
            aria-label="Soura project loading"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="${percent}"
          >
            <i style="width:${percent}%"></i>
          </div>

          <ol class="soura-project-loader-steps">
            ${state.steps
              .map((step) => `
                <li
                  class="is-${step.status}"
                  data-soura-load-step="${esc(step.id)}"
                >
                  <span
                    class="soura-project-loader-step-state"
                    aria-hidden="true"
                  ></span>

                  <span class="soura-project-loader-step-copy">
                    <strong>${esc(step.label)}</strong>

                    ${
                      step.detail
                        ? `<small>${esc(step.detail)}</small>`
                        : ''
                    }
                  </span>
                </li>
              `)
              .join('')}
          </ol>

          ${
            state.error
              ? `
                <div
                  class="soura-project-loader-error"
                  role="alert"
                >
                  ${esc(state.error)}
                </div>
              `
              : ''
          }
        </section>
      </main>
    `
  }

  function render() {
    if (!root) return
    root.innerHTML = markup()
  }

  function start() {
    state.error = ''
    state.activeId = ''

    state.steps.forEach((step) => {
      step.status = 'pending'
      step.detail = ''
    })

    render()
  }

  function activate(stepId, detail = '') {
    const targetIndex = indexOf(stepId)
    if (targetIndex < 0) return

    state.steps.forEach((step, index) => {
      if (
        index < targetIndex
        && step.status !== 'failed'
      ) {
        step.status = 'done'
      } else if (index === targetIndex) {
        step.status = 'active'
        step.detail = detail
      } else if (
        step.status !== 'done'
        && step.status !== 'failed'
        && step.status !== 'warning'
      ) {
        step.status = 'pending'
      }
    })

    state.activeId = stepId
    render()
  }

  function complete(stepId, detail = '') {
    const index = indexOf(stepId)
    if (index < 0) return

    state.steps[index].status = 'done'
    state.steps[index].detail = detail

    if (state.activeId === stepId) {
      state.activeId = ''
    }

    render()
  }

  function warn(stepId, detail = '') {
    const index = indexOf(stepId)
    if (index < 0) return

    state.steps[index].status = 'warning'
    state.steps[index].detail = detail

    render()
  }

  function fail(
    stepId,
    message = 'Soura could not load this project.'
  ) {
    const index = indexOf(stepId)

    if (index >= 0) {
      state.steps[index].status = 'failed'
      state.steps[index].detail = message
    }

    state.error = message
    state.activeId = ''
    render()
  }

  function finish() {
    state.steps.forEach((step) => {
      if (
        step.status !== 'warning'
        && step.status !== 'failed'
      ) {
        step.status = 'done'
      }
    })

    render()
  }

  return {
    start,
    activate,
    complete,
    warn,
    fail,
    finish
  }
}

export function waitForWarmup(
  promise,
  timeoutMs = 2200
) {
  let timer = 0

  return Promise.race([
    Promise.resolve(promise)
      .then((value) => ({
        status: 'complete',
        value
      }))
      .catch((error) => ({
        status: 'failed',
        error
      })),

    new Promise((resolve) => {
      timer = window.setTimeout(
        () =>
          resolve({
            status: 'background'
          }),
        timeoutMs
      )
    })
  ]).finally(() => {
    if (timer) {
      window.clearTimeout(timer)
    }
  })
}
