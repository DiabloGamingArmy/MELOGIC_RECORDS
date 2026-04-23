export function floatingCard({ className = '', title, body, meta }) {
  return `
    <article class="floating-card ${className}">
      <p class="floating-meta">${meta}</p>
      <h3>${title}</h3>
      <p>${body}</p>
    </article>
  `
}
