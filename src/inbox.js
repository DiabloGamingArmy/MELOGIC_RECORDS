import './styles/base.css'
import './styles/inbox.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { subscribeToAuthState, waitForInitialAuthState } from './firebase/auth'

const app = document.querySelector('#app')

const inboxFilters = ['All', 'Messages', 'Group Chats', 'Calls', 'Likes', 'Follows', 'Comments', 'Mentions', 'System']

const inboxCards = [
  {
    type: 'Follows',
    title: 'New follower',
    detail: 'Ari Vox started following your creator profile.',
    meta: '2m ago',
    unread: true
  },
  {
    type: 'Likes',
    title: 'Product like',
    detail: 'Nova liked your “Nightdriver Serum” sound pack.',
    meta: '9m ago',
    unread: true
  },
  {
    type: 'Comments',
    title: 'Reply in discussion',
    detail: 'Riley replied to your comment in Community feedback.',
    meta: '21m ago',
    unread: false
  },
  {
    type: 'Messages',
    title: 'Direct message thread',
    detail: 'Kairo: “Can we collab on a remix pack this week?”',
    meta: '43m ago',
    unread: true
  },
  {
    type: 'Calls',
    title: 'Missed call',
    detail: 'Group call “Producer Roundtable” ended while you were away.',
    meta: '1h ago',
    unread: false
  },
  {
    type: 'Mentions',
    title: 'Group mention',
    detail: 'You were mentioned in #release-feedback by Soma.',
    meta: '2h ago',
    unread: true
  }
]

app.innerHTML = `
  ${navShell({ currentPage: 'inbox' })}
  <main>
    <section class="section inbox-header-shell">
      <div class="section-inner">
        <h1>Inbox</h1>
      </div>
    </section>
    <section class="section inbox-main-shell">
      <div class="section-inner" data-inbox-root>
        <article class="inbox-auth-card">
          <h2>Loading inbox…</h2>
        </article>
      </div>
    </section>
  </main>
`

initShellChrome()

const inboxRoot = document.querySelector('[data-inbox-root]')

function renderSignedOutState() {
  inboxRoot.innerHTML = `
    <article class="inbox-auth-card">
      <h2>Sign in required</h2>
      <p>Inbox is available for signed-in members so your messages and community interactions stay private.</p>
      <a class="button button-accent" href="/auth.html">Go to Sign In / Sign Up</a>
    </article>
  `
}

function renderSignedInState() {
  const filterMarkup = inboxFilters
    .map(
      (filter, index) => `
        <button type="button" class="inbox-filter ${index === 0 ? 'is-active' : ''}" data-inbox-filter="${filter}">
          <span>${filter}</span>
          <span class="inbox-filter-count">${index < 4 ? [18, 5, 2, 1][index] : 0}</span>
        </button>
      `
    )
    .join('')

  const cardsMarkup = inboxCards
    .map(
      (card) => `
        <article class="inbox-card ${card.unread ? 'is-unread' : ''}" data-card-type="${card.type}">
          <div class="inbox-card-top">
            <p class="inbox-chip">${card.type}</p>
            <span>${card.meta}</span>
          </div>
          <h3>${card.title}</h3>
          <p>${card.detail}</p>
        </article>
      `
    )
    .join('')

  inboxRoot.innerHTML = `
    <div class="inbox-layout">
      <aside class="inbox-sidebar">
        <div class="inbox-panel-title">
          <h2>Channels</h2>
          <p>Messages + social events</p>
        </div>
        <div class="inbox-filters" data-inbox-filters>${filterMarkup}</div>
        <div class="inbox-recent">
          <h3>Recent Threads</h3>
          <button type="button" class="thread-item is-active">
            <strong>Kairo</strong>
            <span>DM • remix collab updates</span>
          </button>
          <button type="button" class="thread-item">
            <strong>Producer Roundtable</strong>
            <span>Group call summary and notes</span>
          </button>
          <button type="button" class="thread-item">
            <strong>#release-feedback</strong>
            <span>Community mentions and replies</span>
          </button>
        </div>
      </aside>

      <section class="inbox-main-panel">
        <header class="inbox-main-header">
          <div>
            <p class="eyebrow">Combined Feed</p>
            <h2>Everything that needs your attention</h2>
          </div>
          <button type="button" class="button button-muted">Mark all as read</button>
        </header>
        <div class="inbox-card-list" data-inbox-card-list>${cardsMarkup}</div>
      </section>
    </div>
  `

  const filterButtons = inboxRoot.querySelectorAll('[data-inbox-filter]')
  const cards = inboxRoot.querySelectorAll('[data-card-type]')

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.inboxFilter || 'All'
      filterButtons.forEach((item) => item.classList.toggle('is-active', item === button))
      cards.forEach((card) => {
        card.classList.toggle('is-hidden', filter !== 'All' && card.dataset.cardType !== filter)
      })
    })
  })
}

waitForInitialAuthState().then((user) => {
  if (!user) {
    renderSignedOutState()
    return
  }
  renderSignedInState()
})

subscribeToAuthState((user) => {
  if (!user) {
    renderSignedOutState()
    return
  }
  renderSignedInState()
})
