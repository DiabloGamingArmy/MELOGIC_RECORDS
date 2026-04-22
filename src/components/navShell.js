export function navShell(logoSrc) {
  return `
    <header class="nav-shell">
      <div class="nav-inner">
        <a class="brand" href="/index.html" aria-label="Melogic Records home">
          <img src="${logoSrc}" alt="Melogic logo mark" class="brand-logo" />
          <span class="brand-text">MELOGIC RECORDS</span>
        </a>
        <nav class="main-nav" aria-label="Primary">
          <a href="#store">Store</a>
          <a href="#community">Community</a>
          <a href="#live">Live</a>
          <a href="#label">Label</a>
        </nav>
        <a class="button button-accent" href="#explore">Start Exploring</a>
      </div>
    </header>
  `
}
