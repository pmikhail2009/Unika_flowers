// One entrance per page opening. Re-rendering filters or the basket stays instant.
export function createCatalogEntrance(grid) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let started = false, observer;
  const pending = new Set();
  const finish = card => {
    card.classList.remove('bloom-waiting', 'bloom-opening');
    card.style.removeProperty('--bloom-delay');
    pending.delete(card);
  };
  const finishAll = () => {
    observer?.disconnect();
    for (const card of pending) finish(card);
  };
  reducedMotion.addEventListener?.('change', event => { if (event.matches) finishAll(); });
  // Keyboard users can interact immediately, even during the entrance.
  grid.addEventListener('focusin', event => {
    const card = event.target.closest('.card');
    if (card) { observer?.unobserve(card); finish(card); }
  });
  // A restored browser-history page should never replay or retain a closed bud.
  window.addEventListener('pageshow', event => { if (event.persisted) finishAll(); });
  return cards => {
    finishAll();
    if (started || !cards.length) return;
    started = true;
    if (reducedMotion.matches || !('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver(entries => {
      let order = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const card = entry.target;
        observer.unobserve(card);
        card.style.setProperty('--bloom-delay', `${Math.min(order++, 3) * 85}ms`);
        card.classList.replace('bloom-waiting', 'bloom-opening');
        // Timer also clears the state if CSS animations are unavailable.
        setTimeout(() => finish(card), 1550);
      }
    }, { threshold: 0.06, rootMargin: '0px 0px -24px 0px' });
    for (const card of cards) {
      pending.add(card);
      card.classList.add('bloom-waiting');
      observer.observe(card);
    }
  };
}
