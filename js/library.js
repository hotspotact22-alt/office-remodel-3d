// Asset library: browse every furniture/decor type by category, search, click to add.
import { CATALOG, ADDABLE, CATS } from './catalog.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createLibrary({ onPick, thumbFor }) {
  const el = document.createElement('div');
  el.id = 'library';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Asset library');
  el.className = 'card';
  el.hidden = true;
  el.innerHTML = `
    <div class="lib-head"><strong>Add to the room</strong><input type="search" placeholder="Search — sofa, plant, TV…" aria-label="Search assets"><button class="lib-x" aria-label="Close">×</button></div>
    <div class="lib-tabs"></div>
    <div class="lib-grid"></div>
    <p class="lib-foot">Click to add, then drag it in 2D or 3D. <span>Scanned</span> = photo-scanned model (Poly Haven, CC0), downloads on first use.</p>`;
  document.body.appendChild(el);
  const grid = el.querySelector('.lib-grid'), tabs = el.querySelector('.lib-tabs'), search = el.querySelector('input');
  let cat = 'All', thumbQueue = [], busy = false;

  const types = () => Object.keys(ADDABLE).filter((t) => CATALOG[t] && CATALOG[t].cat);
  function drawTabs() {
    const present = new Set(types().map((t) => CATALOG[t].cat));
    tabs.innerHTML = ['All', ...CATS.filter((c) => present.has(c))]
      .map((c) => `<button class="${c === cat ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  }
  function drawGrid() {
    const q = search.value.trim().toLowerCase();
    const list = types().filter((t) => {
      const c = CATALOG[t];
      if (cat !== 'All' && c.cat !== cat) return false;
      return !q || `${c.name} ${c.keywords ?? ''} ${c.cat}`.toLowerCase().includes(q);
    }).sort((a, b) => (CATALOG[a].scanned ? 1 : 0) - (CATALOG[b].scanned ? 1 : 0) || CATALOG[a].name.localeCompare(CATALOG[b].name));
    grid.innerHTML = list.map((t) => {
      const c = CATALOG[t];
      return `<button class="lib-card" data-type="${esc(t)}" title="${esc(c.spec ?? c.name)}">
        <img alt="" ${c.thumb ? `src="${esc(c.thumb)}" loading="lazy"` : ''} data-gen="${c.thumb ? '' : '1'}">
        <span>${esc(c.name)}</span>${c.scanned ? '<em>Scanned</em>' : ''}</button>`;
    }).join('') || '<p class="lib-empty">Nothing matches — try another word.</p>';
    thumbQueue = [...grid.querySelectorAll('img[data-gen="1"]')];
    pump();
  }
  // Render house-style thumbnails one at a time so the UI stays responsive.
  async function pump() {
    if (busy) return;
    busy = true;
    while (thumbQueue.length && !el.hidden) {
      const img = thumbQueue.shift(), type = img.closest('.lib-card')?.dataset.type;
      try { img.src = await thumbFor(type); } catch (e) { console.warn('thumbnail failed', type, e); }
      await new Promise((r) => setTimeout(r, 0));
    }
    busy = false;
  }

  tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; cat = b.dataset.cat; drawTabs(); drawGrid(); });
  search.addEventListener('input', drawGrid);
  grid.addEventListener('click', (e) => { const b = e.target.closest('[data-type]'); if (!b) return; close(); onPick(b.dataset.type); });
  el.querySelector('.lib-x').addEventListener('click', () => close());
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden) close(); });

  function open() { el.hidden = false; drawTabs(); drawGrid(); search.focus(); }
  function close() { el.hidden = true; }
  return { open, close, get isOpen() { return !el.hidden; } };
}
