const ns = 'http://www.w3.org/2000/svg';
const glyphs = { '↗': 'arrow-up-right', '↘': 'arrow-down-right', '→': 'arrow-right', '←': 'arrow-left', '↻': 'refresh', '⌕': 'search', '♡': 'heart', '♥': 'heart', '✓': 'check', '×': 'close', '✳': 'flower' };
const pattern = /[↗↘→←↻⌕♡♥✓×✳]\uFE0F?/g;
const targets = 'button,a,.flower-mark,.announcement>span,.catalog-note>span,.search>span,.success-mark,.faq summary>span,.choice-row>b';
function icon(name, filled = false) {
  const svg = document.createElementNS(ns, 'svg'); svg.classList.add('icon');
  if (filled) svg.classList.add('icon-filled'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(ns, 'use'); use.setAttribute('href', `/assets/icons.svg#${name}`); svg.append(use); return svg;
}
function decorate(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), texts = [];
  while (walker.nextNode()) if (walker.currentNode.parentElement?.namespaceURI !== ns) texts.push(walker.currentNode);
  for (const text of texts) {
    const value = text.nodeValue;
    if (value === '+' && text.parentElement.matches('.faq summary>span')) { text.replaceWith(icon('plus')); continue; }
    pattern.lastIndex = 0; if (!pattern.test(value)) continue; pattern.lastIndex = 0;
    const fragment = document.createDocumentFragment(); let offset = 0;
    for (const match of value.matchAll(pattern)) {
      fragment.append(document.createTextNode(value.slice(offset, match.index)), icon(glyphs[match[0][0]], match[0][0] === '♥'));
      offset = match.index + match[0].length;
    }
    fragment.append(document.createTextNode(value.slice(offset))); text.replaceWith(fragment);
  }
}
export function setupIcons() {
  document.querySelectorAll('.contact-flower').forEach(node => node.remove());
  document.querySelectorAll(targets).forEach(decorate);
  // Labels and cart buttons change after filtering and checkout. Convert their
  // text nodes only; user messages and product descriptions remain plain text.
  new MutationObserver(records => {
    const roots = new Set();
    for (const record of records) {
      const element = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      const target = element?.closest?.(targets); if (target) roots.add(target);
      for (const added of record.addedNodes || []) if (added.nodeType === Node.ELEMENT_NODE && added.namespaceURI !== ns) {
        if (added.matches(targets)) roots.add(added);
        added.querySelectorAll(targets).forEach(node => roots.add(node));
      }
    }
    roots.forEach(decorate);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
