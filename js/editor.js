// 2D plan editor (SVG, metres). Draw/trace a room, drag corners and walls, type exact
// lengths, place doors/windows and furniture, then auto-furnish and review the design check.
import {
  getWalls, openingGeom, normalizePlan, facingDeg, degFromDir, add, sub, mul, dot, dist, bbox, round2,
  distToSegment, pointInPolygon,
} from './planmath.js';
import { CATALOG, ADDABLE, ridersOf, halfWidth } from './catalog.js';
import { autoFurnish } from './layout.js';
import { checkDesign } from './rules.js';

const SNAP = 0.05;
const snap = (v) => Math.round(v / SNAP) * SNAP;
const UNDERLAY_KEY = new URLSearchParams(location.search).has('sandbox') ? 'office-underlay-sandbox' : 'office-underlay-v1';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f2 = (v) => round2(v).toFixed(2);
const P = (p) => `${f2(p[0])},${f2(p[1])}`;

const COLORS = { wood: '#b8915f', leather: '#9a5a2e', leatherDark: '#5a3320', steel: '#2b2b2d', rug: '#a8644c', plant: '#5c8a4e', fabric: '#8d877e' };

// Per-type editable parameters in the inspector.
const PARAMS = {
  rug: [['size.0', 'Width (m)', 0.1], ['size.1', 'Depth (m)', 0.1]],
  pipeShelf: [['width', 'Width (m)', 0.1]],
  plant: [['size', 'Size', 0.1]],
  meetingTable: [['chairs', 'Seats', 2], ['diameter', 'Diameter (m)', 0.05]],
  pendant: [['height', 'Shade bottom (m)', 0.05], ['size', 'Size', 0.1]],
  wallArt: [['size.0', 'Width (m)', 0.05], ['size.1', 'Height (m)', 0.05], ['height', 'Centre height (m)', 0.01]],
  acousticPanels: [['count', 'Panels', 1], ['height', 'Centre height (m)', 0.05]],
  curtains: [['width', 'Window width (m)', 0.1]],
};

const TEMPLATE = `
  <div class="ed-top card">
    <strong class="ed-title">Plan editor</strong>
    <button data-act="undo" title="Undo (Ctrl+Z)">↶ Undo</button>
    <button data-act="redo" title="Redo (Ctrl+Y)">↷</button>
    <span class="sep"></span>
    <button data-act="draw" title="Click the corners of your room; click the first corner to close">✎ Draw room</button>
    <button data-act="furnish" title="Lay out the brief using designer clearances">✦ Auto-furnish</button>
    <button data-act="fit" title="Fit the plan to the screen">⤢ Fit</button>
    <span class="sep"></span>
    <button data-act="library" class="primary" title="Pick furniture, lighting, plants and decor">＋ Add</button>
    <button data-act="note" title="Pin a note anywhere: “glass wall”, “painting”, “sofa here”…">📍 Note</button>
    <span class="sep"></span>
    <button data-act="close" title="Close the plan and show only 3D">✕ Close plan</button>
  </div>
  <svg id="ed-svg" xmlns="http://www.w3.org/2000/svg"></svg>
  <aside id="ed-inspector" class="card"></aside>
  <div class="ed-hint" id="ed-hint"></div>
  <input type="file" id="ed-file-img" accept="image/*" hidden>
  <input type="file" id="ed-file-json" accept="application/json,.json" hidden>`;

// Nearest wall within reach → point on its inner face + inward facing (for wall-mounted items).
export function snapToWall(plan, p, reach = 1.2, half = 0.12) {
  let best = null;
  for (const w of getWalls(plan)) {
    const d = distToSegment(p, w.a, w.b);
    if (d < reach && (!best || d < best.d)) best = { w, d };
  }
  if (!best) return null;
  // keep the whole piece on this wall: its ends stay 3 cm short of the corners
  const { w } = best, m = Math.min(half + 0.03, w.len / 2), t = Math.max(m, Math.min(w.len - m, dot(sub(p, w.a), w.u)));
  return { at: add(w.a, mul(w.u, t)), facing: degFromDir(w.n), wall: w.i, t };
}

const HANGING = new Set(['pendant', 'downlight']);
const CAT_FILL = { Seating: '#9a5a2e', Tables: '#b8915f', Storage: '#8a7a66', Kitchen: '#6f6a63', Lighting: '#e0b45c', Plants: '#5c8a4e', Decor: '#c96f3b', Tech: '#3c4148', 'Walls & partitions': '#7d93a3' };

export function createEditor({ getPlan, setPlan, onChange, onClose, samplePlan, onLive = () => {}, onSelect = () => {}, onLibrary = () => {}, onNote = () => {} }) {
  const root = document.getElementById('editor');
  root.innerHTML = TEMPLATE;
  const svg = root.querySelector('#ed-svg');
  const insp = root.querySelector('#ed-inspector');
  const hintEl = root.querySelector('#ed-hint');
  let sel = null, vb = null, drag = null, mode = null, drawPts = [], calPts = [], cursor = null, isOpen = false;
  let underlay = null;
  try { underlay = JSON.parse(localStorage.getItem(UNDERLAY_KEY)); } catch { underlay = null; }
  const undo = [], redo = [];
  const plan = () => getPlan();

  // ── History / commit ──────────────────────────────────────────────────
  const checkpoint = () => { undo.push(JSON.stringify(plan())); if (undo.length > 100) undo.shift(); redo.length = 0; };
  function changed({ inspector = true } = {}) {
    normalizePlan(plan());
    if (!Array.isArray(plan().furniture)) autoFurnish(plan());   // imported plans may say furniture: 'auto'
    onChange();
    render();
    if (inspector) renderInspector();
  }
  function restore(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(plan()));
    setPlan(JSON.parse(from.pop()));
    sel = null; lastSelKey = '';
    onSelect(null);   // tell the 3D view even if the plan panel has never been drawn
    changed();
  }
  const saveUnderlay = () => {
    try { underlay ? localStorage.setItem(UNDERLAY_KEY, JSON.stringify(underlay)) : localStorage.removeItem(UNDERLAY_KEY); }
    catch { hint('Image is too large to remember between visits — it stays for this session.'); }
  };

  // ── View box (metres) ─────────────────────────────────────────────────
  // Fit the room into the screen area not covered by the toolbar and inspector.
  function fit() {
    const b = bbox(plan().outline), r = svg.getBoundingClientRect();
    const W = r.width || 800, Hh = r.height || 600;
    const top = root.querySelector('.ed-top').getBoundingClientRect().bottom - r.top + 10;
    const ir = insp.getBoundingClientRect();
    const docked = ir.width > W * 0.7;   // inspector runs along the bottom
    const area = docked
      ? { l: 14, t: top, r: W - 14, b: ir.top - r.top - 14 }
      : { l: 20, t: top, r: W - ir.width - 40, b: Hh - 40 };
    const m = 0.9, s = Math.min((area.r - area.l) / (b.w + m * 2), (area.b - area.t) / (b.d + m * 2));
    vb = { w: W / s, h: Hh / s };
    vb.x = b.cx - ((area.l + area.r) / 2) / s;
    vb.y = b.cy - ((area.t + area.b) / 2) / s;
    render();
  }
  function toPlan(e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, p.y];
  }
  const px = () => vb.w / Math.max(svg.getBoundingClientRect().width, 1);   // metres per screen pixel

  // ── Symbols ───────────────────────────────────────────────────────────
  function symbol(f) {
    const c = CATALOG[f.type], s = [];
    const R = (x0, y0, x1, y1, fill, rx = 0.02, extra = '') => s.push(`<rect x="${f2(Math.min(x0, x1))}" y="${f2(Math.min(y0, y1))}" width="${f2(Math.abs(x1 - x0))}" height="${f2(Math.abs(y1 - y0))}" rx="${rx}" fill="${fill}" ${extra}/>`);
    const C = (x, y, r, fill, extra = '') => s.push(`<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(r)}" fill="${fill}" ${extra}/>`);
    switch (f.type) {
      case 'workstation':
        R(-0.85, -1.4, 0.85, -0.39, 'none', 0, 'class="zone"');
        R(-0.85, -0.39, 0.85, 0.39, COLORS.wood, 0.02);
        R(-0.33, 0.1, 0.33, 0.15, COLORS.steel, 0.01);
        C(0.02, -0.62, 0.27, COLORS.leather);
        R(-0.25, -0.86, 0.29, -0.78, COLORS.leatherDark, 0.03);
        break;
      case 'pipeShelf': {
        const w = (f.width ?? 2) / 2;
        R(-w, -0.17, w, 0.17, COLORS.wood, 0.01);
        for (let x = -w + 0.3; x < w - 0.1; x += 0.3) s.push(`<line x1="${f2(x)}" y1="-0.15" x2="${f2(x)}" y2="0.15" class="detail"/>`);
        break;
      }
      case 'meetingTable': {
        const r = (f.diameter ?? 1.2) / 2, n = f.chairs ?? 4;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + Math.PI / 4, cx = Math.sin(a) * (r + 0.2), cy = Math.cos(a) * (r + 0.2);
          s.push(`<rect x="-0.22" y="-0.21" width="0.44" height="0.42" rx="0.06" fill="${COLORS.leather}" transform="translate(${f2(cx)} ${f2(cy)}) rotate(${f2((-a * 180) / Math.PI)})"/>`);
        }
        C(0, 0, r, COLORS.wood);
        break;
      }
      case 'clubChair':
        R(-0.44, -0.42, 0.44, 0.42, COLORS.leather, 0.1);
        R(-0.27, -0.2, 0.27, 0.36, '#b4703f', 0.06);
        break;
      case 'ottoman': R(-0.31, -0.25, 0.31, 0.25, COLORS.leatherDark, 0.07); break;
      case 'sideTable': C(0, 0, 0.25, COLORS.steel); C(0, 0, 0.19, COLORS.wood); break;
      case 'floorLamp': s.push('<line x1="0" y1="0" x2="0" y2="0.55" class="detail" stroke-width="0.03"/>'); C(0, 0, 0.16, COLORS.steel); C(0, 0.55, 0.1, '#f2c36b'); break;
      case 'plant': {
        const r = 0.2 * Math.min(f.size ?? 1, 1.2) + 0.15;
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          s.push(`<ellipse cx="${f2(Math.cos(a) * r * 0.55)}" cy="${f2(Math.sin(a) * r * 0.55)}" rx="${f2(r * 0.5)}" ry="${f2(r * 0.25)}" transform="rotate(${f2((a * 180) / Math.PI)} ${f2(Math.cos(a) * r * 0.55)} ${f2(Math.sin(a) * r * 0.55)})" fill="${i % 2 ? COLORS.plant : '#47703c'}"/>`);
        }
        C(0, 0, 0.12, '#a5a29c');
        break;
      }
      case 'rug': {
        const [w, d] = f.size ?? [2, 1.4];
        R(-w / 2, -d / 2, w / 2, d / 2, COLORS.rug, 0.02, 'opacity="0.55"');
        R(-w / 2 + 0.1, -d / 2 + 0.1, w / 2 - 0.1, d / 2 - 0.1, 'none', 0.01, 'class="detail"');
        break;
      }
      case 'pendant': C(0, 0, 0.2 * (f.size ?? 1), 'none', 'class="ceiling"'); C(0, 0, 0.03, '#f2c36b'); break;
      case 'downlight': C(0, 0, 0.07, 'none', 'class="ceiling"'); C(0, 0, 0.025, '#f2c36b'); break;
      case 'wallArt': { const [w] = f.size ?? [1, 0.7]; R(-w / 2, 0, w / 2, 0.05, '#c96f3b', 0.005); break; }
      case 'acousticPanels': {
        const n = f.count ?? 4;
        for (let i = 0; i < n; i++) R(-n * 0.33 + i * 0.66 + 0.03, 0, -n * 0.33 + i * 0.66 + 0.63, 0.06, '#55534e', 0.01);
        break;
      }
      case 'curtains': {
        const w = (f.width ?? 2) / 2 + 0.2;
        let d = `M${f2(-w)} 0.13`;
        for (let x = -w; x < w; x += 0.1) d += ` Q${f2(x + 0.05)} ${x % 0.2 < 0.1 ? 0.2 : 0.06} ${f2(x + 0.1)} 0.13`;
        s.push(`<path d="${d}" fill="none" stroke="#a89a85" stroke-width="0.035"/>`);
        break;
      }
      default: {
        const fill = CAT_FILL[c?.cat] ?? '#8d877e';
        if (c?.circle) C(0, 0, c.circle(f), fill, 'opacity="0.85"');
        else if (c?.rect) { const [x0, z0, x1, z1] = c.rect(f); R(x0, z0, x1, z1, fill, 0.03, 'opacity="0.85"'); R(x0, z1 - 0.04, x1, z1, 'rgba(0,0,0,.35)', 0); }
        break;
      }
    }
    if (c?.label && c.layer !== 'wall') s.push(`<text class="label" transform="rotate(${facingDeg(f.facing)})" dy="0.045">${esc(c.label)}</text>`);
    return s.join('');
  }

  // ── Render SVG ────────────────────────────────────────────────────────
  function render() {
    if (!vb) return;
    const p = plan(), walls = getWalls(p), t = p.wallThickness, k = px();
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    const s = [];
    const K = (m) => f2(k * m);
    s.push(`<style>
      .zone{fill:none;stroke:#9a948a;stroke-width:${K(1)};stroke-dasharray:${K(4)} ${K(3)}}
      .detail{fill:none;stroke:rgba(0,0,0,.35);stroke-width:${K(1)}}
      .label{font:600 0.13px Inter,'Segoe UI',sans-serif;fill:#2a2928;text-anchor:middle;paint-order:stroke;stroke:rgba(255,255,255,.8);stroke-width:0.035;pointer-events:none}
      .dim{font:600 0.17px Inter,'Segoe UI',sans-serif;fill:#2a2928;text-anchor:middle;dominant-baseline:middle;cursor:pointer;paint-order:stroke;stroke:#f7f4ef;stroke-width:0.05}
      .dim.live{fill:#c9864f}
      .item{cursor:move}.item.sel>*{stroke:#c9864f;stroke-width:${K(2.5)}}
      .ceiling{fill:none!important;stroke:#b6a48c;stroke-width:${K(1.2)};stroke-dasharray:${K(5)} ${K(4)}}
      .duct{stroke:rgba(140,150,160,.22);stroke-width:0.4;stroke-dasharray:none;cursor:pointer}.duct.sel{stroke:rgba(201,134,79,.45)}
      .wallhit{fill:transparent;cursor:grab}.wallhit:hover{fill:rgba(201,134,79,.25)}.wallhit.sel{fill:rgba(201,134,79,.5)}
      .opening{cursor:ew-resize}.opening.sel polygon{stroke:#c9864f;stroke-width:${K(3)}}
      .corner{fill:#fff;stroke:#2a2928;stroke-width:${K(1.5)};cursor:move}.corner.sel,.corner:hover{fill:#c9864f}
      .keepclear{fill:rgba(201,134,79,.07);stroke:rgba(201,134,79,.4);stroke-width:${K(1)};stroke-dasharray:${K(3)} ${K(3)}}
      .pin circle{fill:#c9864f;stroke:#fff;stroke-width:${K(2)}}.pin.done circle{fill:#5f9a64}.pin text{fill:#fff;font-weight:700;text-anchor:middle;font-family:Inter,'Segoe UI',sans-serif}
      .drawline{fill:none;stroke:#c9864f}.drawpt{fill:#c9864f}.calpt{fill:#3b82f6}.calline{stroke:#3b82f6}
    </style>`);
    s.push(`<defs>
      <pattern id="ed-g1" width="0.1" height="0.1" patternUnits="userSpaceOnUse"><path d="M0.1 0H0V0.1" fill="none" stroke="#ebe6dd" stroke-width="${f2(k * 0.8)}"/></pattern>
      <pattern id="ed-g10" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="url(#ed-g1)"/><path d="M1 0H0V1" fill="none" stroke="#d8d1c5" stroke-width="${f2(k * 1.2)}"/></pattern>
    </defs>`);
    s.push(`<rect x="${vb.x - 1}" y="${vb.y - 1}" width="${vb.w + 2}" height="${vb.h + 2}" fill="#f7f4ef" data-kind="bg"/>`);
    s.push(`<rect x="${vb.x - 1}" y="${vb.y - 1}" width="${vb.w + 2}" height="${vb.h + 2}" fill="url(#ed-g10)" pointer-events="none"/>`);
    if (underlay?.src) {
      s.push(`<image href="${underlay.src}" x="${underlay.x}" y="${underlay.y}" width="${underlay.w}" opacity="${underlay.opacity ?? 0.5}" preserveAspectRatio="xMinYMin" ${mode === 'moveImage' ? 'data-kind="underlay" style="cursor:move"' : 'pointer-events="none"'}/>`);
    }
    const poly = p.outline.map(P).join(' ');
    s.push(`<polygon points="${poly}" fill="none" stroke="#2a2928" stroke-width="${f2(t * 2)}" stroke-linejoin="miter" pointer-events="none"/>`);
    s.push(`<polygon points="${poly}" fill="#efe9df" pointer-events="none"/>`);

    // door clearance zones (subtle)
    for (const o of p.openings.filter((oo) => oo.type === 'door')) {
      const g = openingGeom(p, o, walls); if (!g) continue;
      const d = o.width + 0.15;
      s.push(`<polygon points="${[g.a, g.b, add(g.b, mul(g.n, d)), add(g.a, mul(g.n, d))].map(P).join(' ')}" class="keepclear" pointer-events="none"/>`);
    }

    // furniture: rugs, floor, ceiling now; wall-mounted pieces after the walls so they stay clickable
    const order = { rug: 0, floor: 1, wall: 2, ceiling: 3 };
    const items = p.furniture.map((f, i) => ({ f, i })).sort((a, b) => (order[CATALOG[a.f.type]?.layer] ?? 1) - (order[CATALOG[b.f.type]?.layer] ?? 1));
    const itemSvg = ({ f, i }) => {
      const isSel = sel?.kind === 'item' && sel.i === i, c = CATALOG[f.type];
      if (f.type === 'duct' && f.from && f.to) {
        return `<line x1="${f2(f.from[0])}" y1="${f2(f.from[1])}" x2="${f2(f.to[0])}" y2="${f2(f.to[1])}" class="ceiling duct ${isSel ? 'sel' : ''}" stroke-width="0.4" data-kind="item" data-i="${i}"/>`;
      }
      if (!f.at) return '';
      const deg = facingDeg(f.facing);
      let pad = '';   // wall pieces are only a few cm deep: give them a comfortable grab area
      if (c?.layer === 'wall') { const r = c.rect?.(f) ?? [-0.4, 0, 0.4, 0.05]; pad = `<rect x="${f2(r[0])}" y="-0.05" width="${f2(r[2] - r[0])}" height="${f2(Math.max(r[3], 0.28) + 0.05)}" fill="transparent"/>`; }
      return `<g class="item ${c?.layer ?? ''} ${isSel ? 'sel' : ''}" data-kind="item" data-i="${i}" transform="translate(${f2(f.at[0])} ${f2(f.at[1])}) rotate(${-deg})">${pad}${symbol(f)}</g>`;
    };
    const isWallItem = ({ f }) => CATALOG[f.type]?.layer === 'wall';
    for (const it of items) if (!isWallItem(it)) s.push(itemSvg(it));

    // wall hit areas
    walls.forEach((w) => {
      const pts = [add(w.a, mul(w.n, 0.06)), add(w.b, mul(w.n, 0.06)), sub(w.b, mul(w.n, t)), sub(w.a, mul(w.n, t))];
      s.push(`<polygon points="${pts.map(P).join(' ')}" class="wallhit ${sel?.kind === 'wall' && sel.i === w.i ? 'sel' : ''}" data-kind="wall" data-i="${w.i}"/>`);
    });

    // openings
    p.openings.forEach((o, i) => {
      const g = openingGeom(p, o, walls); if (!g) return;
      const isSel = sel?.kind === 'open' && sel.i === i;
      const quad = [g.a, g.b, sub(g.b, mul(g.n, t)), sub(g.a, mul(g.n, t))];
      if (o.type === 'window') {
        s.push(`<g data-kind="open" data-i="${i}" class="opening ${isSel ? 'sel' : ''}"><polygon points="${quad.map(P).join(' ')}" fill="#ffffff" stroke="#2a2928" stroke-width="${f2(k)}"/>`
          + `<line x1="${f2(sub(g.a, mul(g.n, t / 2))[0])}" y1="${f2(sub(g.a, mul(g.n, t / 2))[1])}" x2="${f2(sub(g.b, mul(g.n, t / 2))[0])}" y2="${f2(sub(g.b, mul(g.n, t / 2))[1])}" stroke="#6b9bc3" stroke-width="${f2(k * 2)}"/></g>`);
      } else {
        const leaf = add(g.a, mul(g.n, o.width));
        const cross = g.u[0] * g.n[1] - g.u[1] * g.n[0];
        s.push(`<g data-kind="open" data-i="${i}" class="opening ${isSel ? 'sel' : ''}"><polygon points="${quad.map(P).join(' ')}" fill="#ffffff"/>`
          + `<line x1="${f2(g.a[0])}" y1="${f2(g.a[1])}" x2="${f2(leaf[0])}" y2="${f2(leaf[1])}" stroke="#2a2928" stroke-width="${f2(k * 2)}"/>`
          + `<path d="M${P(g.b)} A${f2(o.width)} ${f2(o.width)} 0 0 ${cross > 0 ? 1 : 0} ${P(leaf)}" fill="none" stroke="#2a2928" stroke-width="${f2(k)}" stroke-dasharray="${f2(k * 4)} ${f2(k * 3)}"/></g>`);
      }
    });

    for (const it of items) if (isWallItem(it)) s.push(itemSvg(it));

    // dimension labels outside each wall
    walls.forEach((w) => {
      const m = sub(w.mid, mul(w.n, t + 0.28));
      let ang = (Math.atan2(w.u[1], w.u[0]) * 180) / Math.PI;
      if (ang > 90 || ang < -90) ang += 180;
      s.push(`<text class="dim" x="${f2(m[0])}" y="${f2(m[1])}" transform="rotate(${f2(ang)} ${f2(m[0])} ${f2(m[1])})" data-kind="wall" data-i="${w.i}">${w.len.toFixed(2)} m</text>`);
    });

    // corner handles
    const hr = k * 7;
    p.outline.forEach((c, i) => {
      s.push(`<circle cx="${f2(c[0])}" cy="${f2(c[1])}" r="${f2(hr)}" class="corner ${sel?.kind === 'corner' && sel.i === i ? 'sel' : ''}" data-kind="corner" data-i="${i}"/>`);
    });

    // tool overlays
    if (mode === 'draw' && drawPts.length) {
      const pts = cursor ? [...drawPts, cursor] : drawPts;
      s.push(`<polyline points="${pts.map(P).join(' ')}" class="drawline" stroke-width="${f2(k * 2)}"/>`);
      drawPts.forEach((q, i) => s.push(`<circle cx="${f2(q[0])}" cy="${f2(q[1])}" r="${f2(hr * (i === 0 ? 1.4 : 0.8))}" class="drawpt"/>`));
      if (cursor) {
        const last = drawPts[drawPts.length - 1];
        s.push(`<text class="dim live" x="${f2((last[0] + cursor[0]) / 2)}" y="${f2((last[1] + cursor[1]) / 2 - 0.15)}">${dist(last, cursor).toFixed(2)} m</text>`);
      }
    }
    if (mode === 'calibrate') {
      calPts.forEach((q) => s.push(`<circle cx="${f2(q[0])}" cy="${f2(q[1])}" r="${f2(hr)}" class="calpt"/>`));
      if (calPts.length === 1 && cursor) s.push(`<line x1="${f2(calPts[0][0])}" y1="${f2(calPts[0][1])}" x2="${f2(cursor[0])}" y2="${f2(cursor[1])}" class="calline" stroke-width="${f2(k * 2)}"/>`);
    }
    // note pins
    (p.notes ?? []).forEach((nt, j) => {
      const q = nt.pin; if (!q) return;
      s.push(`<g class="pin ${nt.status}" transform="translate(${f2(q[0])} ${f2(q[1])})" pointer-events="none"><circle r="${f2(k * 10)}"/><text dy="${f2(k * 3.5)}" style="font-size:${f2(k * 11)}px">${nt.status === 'done' ? '✓' : j + 1}</text></g>`);
    });
    svg.innerHTML = s.join('');
    const key = sel ? `${sel.kind}:${sel.i}` : '';
    if (key !== lastSelKey) { lastSelKey = key; onSelect(sel); }
  }
  let lastSelKey = '';

  // ── Inspector ─────────────────────────────────────────────────────────
  const num = (field, label, value, step = 0.05, extra = '') =>
    `<label class="f"><span>${label}</span><input type="number" data-field="${field}" value="${round2(value)}" step="${step}" ${extra}></label>`;
  const btn = (act, label, cls = '') => `<button data-act="${act}" class="${cls}">${label}</button>`;

  function renderInspector() {
    const p = plan(), walls = getWalls(p), h = [];
    if (sel?.kind === 'wall' && walls[sel.i]) {
      const w = walls[sel.i], fin = p.finishes?.[sel.i] ?? p.finishes?.default ?? 'plaster';
      h.push(`<h3>Wall ${sel.i + 1}</h3>`, num('wall.length', 'Length (m)', w.len, 0.05, 'min="0.5"'));
      h.push(`<label class="f"><span>Finish</span><select data-field="wall.finish">${['plaster', 'brick', 'charcoal', 'concrete', 'wood', 'glass'].map((x) => `<option ${x === fin ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`);
      const by = p.beyond?.[sel.i], depth = typeof by === 'number' ? by : by?.depth ?? 2.2;
      if (fin === 'glass') h.push(num('wall.beyond', 'Space behind glass (m)', depth, 0.1, 'min="0.6" max="12"'), `<p class="tip">How deep the corridor or room on the other side of the glass is${by?.columns?.length ? ' (columns from your floor plan are shown)' : ''}.</p>`);
      h.push(`<div class="row">${btn('add-window', '+ Window')}${btn('add-door', '+ Door')}${btn('add-corner', '+ Corner')}</div>`);
      h.push('<p class="tip">Drag the wall to move it. Double-click it (or + Corner) to add a corner.</p>');
    } else if (sel?.kind === 'corner' && p.outline[sel.i]) {
      const c = p.outline[sel.i];
      h.push(`<h3>Corner ${sel.i + 1}</h3>`, num('corner.x', 'x (m)', c[0]), num('corner.y', 'y (m)', c[1]));
      if (p.outline.length > 3) h.push(`<div class="row">${btn('del', 'Delete corner', 'danger')}</div>`);
      h.push('<p class="tip">Drag to move · snaps to 5 cm and lines up with neighbours (hold Shift to free-move).</p>');
    } else if (sel?.kind === 'open' && p.openings[sel.i]) {
      const o = p.openings[sel.i];
      h.push(`<h3>${o.type === 'door' ? 'Door' : 'Window'}</h3>`);
      h.push(`<label class="f"><span>Type</span><select data-field="open.type"><option ${o.type === 'window' ? 'selected' : ''}>window</option><option ${o.type === 'door' ? 'selected' : ''}>door</option></select></label>`);
      h.push(num('open.width', 'Width (m)', o.width), num('open.offset', 'From wall start (m)', o.offset));
      if (o.type === 'window') h.push(num('open.sill', 'Sill height (m)', o.sill ?? 0.55));
      h.push(num('open.height', 'Height (m)', o.height));
      h.push(`<div class="row">${btn('del', 'Delete', 'danger')}</div><p class="tip">Drag along the wall to slide it.</p>`);
    } else if (sel?.kind === 'item' && p.furniture[sel.i]) {
      const f = p.furniture[sel.i], c = CATALOG[f.type];
      h.push(`<h3>${esc(c?.name ?? f.type)}</h3><p class="tip">${esc(c?.spec ?? '')}</p>`);
      if (f.at) {
        h.push(num('item.x', 'x (m)', f.at[0]), num('item.y', 'y (m)', f.at[1]), num('item.facing', 'Facing (°)', facingDeg(f.facing), 15));
        h.push(`<div class="row">${btn('rot-15', '⟲ 15°')}${btn('rot+15', '⟳ 15°')}${btn('rot90', '⟳ 90°')}</div>`);
      }
      for (const [key, label, step] of PARAMS[f.type] ?? c?.params ?? []) {
        const [k1, k2] = key.split('.');
        const v = k2 !== undefined ? f[k1]?.[+k2] : f[k1];
        h.push(num(`item.${key}`, label, v ?? ADDABLE[f.type]?.[k1] ?? 1, step));
      }
      if (typeof f.text === 'string') h.push(`<label class="f"><span>Text</span><input type="text" data-field="item.text" value="${esc(f.text)}" maxlength="40"></label>`);
      h.push(`<div class="row">${btn('dup', '⧉ Duplicate')}${btn('del', 'Delete', 'danger')}</div><p class="tip">Drag here or in 3D to move · R rotates 90° · Ctrl+D duplicates · Delete removes.</p>`);
    } else {
      sel = null;
      const b = bbox(p.outline), br = p.brief;
      h.push('<h3>Room</h3>');
      h.push(num('room.ceilingHeight', 'Ceiling height (m)', p.ceilingHeight, 0.05), num('room.wallThickness', 'Wall thickness (m)', p.wallThickness, 0.01));
      h.push(`<p class="tip">${b.w.toFixed(2)} × ${b.d.toFixed(2)} m outer size · click a wall, corner, door/window or item to edit it.</p>`);
      h.push('<h3>Quick shapes</h3>');
      h.push(`<div class="grid2">${num('tpl.w', 'Width (m)', b.w)}${num('tpl.d', 'Depth (m)', b.d)}</div><div class="row">${btn('tpl-rect', 'Rectangle')}${btn('tpl-l', 'L-shape')}</div>`);
      h.push('<h3>Trace your floor plan</h3>');
      h.push(`<div class="row">${btn('ul-upload', underlay ? 'Replace image' : 'Upload image')}${underlay ? btn('ul-scale', 'Set scale') + btn('ul-move', mode === 'moveImage' ? 'Done moving' : 'Move image') : ''}</div>`);
      if (underlay) h.push(`<label class="f"><span>Image opacity</span><input type="range" min="0.1" max="1" step="0.05" data-field="ul.opacity" value="${underlay.opacity ?? 0.5}"></label><div class="row">${btn('ul-remove', 'Remove image', 'danger')}</div>`);
      h.push('<p class="tip">1. Upload a photo/scan. 2. Set scale: click both ends of a wall with a known length. 3. Draw room over it, then add doors and windows.</p>');
      h.push('<h3>Brief</h3>');
      h.push(`<label class="f"><span>Client seats</span><select data-field="brief.meetingSeats">${[0, 2, 4, 6].map((n) => `<option value="${n}" ${n === br.meetingSeats ? 'selected' : ''}>${n || 'none'}</option>`).join('')}</select></label>`);
      for (const [key, label] of [['lounge', 'Lounge / reading corner'], ['shelving', 'Shelving behind desk'], ['plants', 'Plants'], ['acoustics', 'Acoustic treatment']]) {
        h.push(`<label class="chk"><input type="checkbox" data-field="brief.${key}" ${br[key] ? 'checked' : ''}> ${label}</label>`);
      }
      h.push(`<div class="row">${btn('furnish', '✦ Auto-furnish', 'primary')}</div>`);
      h.push(`<h3>Add furniture</h3><div class="row">${btn('library', '＋ Open the asset library', 'primary')}</div>`);
      const notes = p.notes ?? [];
      h.push(`<h3>Notes <span class="pill ${notes.some((n) => n.status === 'open') ? 'warn' : 'ok'}">${notes.filter((n) => n.status === 'open').length} open</span></h3>`);
      h.push(notes.length ? `<ul class="notes">${notes.map((n, j) => `<li class="${n.status}"><b>${n.status === 'done' ? '✓' : j + 1}</b><span>${esc(n.text)}<em>${esc(n.result || (n.status === 'open' ? 'Saved for Claude to do' : ''))}</em></span><button data-act="note-del" data-n="${j}" title="Delete note">×</button></li>`).join('')}</ul>`
        : '<p class="tip">Press 📍 Note and click any wall, spot or item, then type what you want — “glass wall”, “painting”, “sofa here”, “remove”. Notes the app can’t apply are saved for Claude.</p>');
      h.push(`<h3>File</h3><div class="row">${btn('export', 'Export JSON')}${btn('import', 'Import JSON')}${btn('svg', 'Plan (SVG)')}</div><div class="row">${btn('reset', 'Reset to starting plan', 'danger')}</div>`);
    }
    const checks = checkDesign(p);
    const warns = checks.filter((c) => c.level === 'warn');
    h.push(`<h3>Design check <span class="pill ${warns.length ? 'warn' : 'ok'}">${warns.length ? `${warns.length} to review` : 'all clear'}</span></h3>`);
    h.push(`<ul class="checks">${checks.map((c) => `<li class="${c.level}"><strong>${esc(c.title)}</strong><span>${esc(c.detail)}</span></li>`).join('')}</ul>`);
    insp.innerHTML = h.join('');
  }

  // ── Plan operations ───────────────────────────────────────────────────
  function duplicateItem(i) {
    const f = plan().furniture[i];
    if (!f?.at) return;
    checkpoint();
    const c = structuredClone(f);
    c.at = [round2(f.at[0] + 0.4), round2(f.at[1] + 0.4)];
    if (CATALOG[c.type]?.layer === 'wall') { const sw = snapToWall(plan(), c.at, 99, halfWidth(c)); if (sw) { c.at = sw.at; c.facing = sw.facing; } }
    plan().furniture.push(c);
    sel = { kind: 'item', i: plan().furniture.length - 1 };
    changed();
  }
  function remapFinishes(fn) {
    const f = plan().finishes, nf = { default: f.default ?? 'plaster' };
    for (const [k, v] of Object.entries(f)) { if (k === 'default') continue; for (const j of [].concat(fn(+k))) if (j != null) nf[j] = v; }
    plan().finishes = nf;
    if (plan().beyond) {   // per-wall depth behind glass follows the wall too
      const nb = {};
      for (const [k, v] of Object.entries(plan().beyond)) for (const j of [].concat(fn(+k))) if (j != null) nb[j] = v;
      plan().beyond = nb;
    }
  }
  function insertCorner(wi, pt) {
    const p = plan(), w = getWalls(p)[wi], t = dot(sub(pt, w.a), w.u);
    if (t < 0.2 || t > w.len - 0.2) return;
    checkpoint();
    p.outline.splice(wi + 1, 0, [round2(w.a[0] + w.u[0] * t), round2(w.a[1] + w.u[1] * t)]);
    for (const o of p.openings) {
      if (o.wall > wi) o.wall++;
      else if (o.wall === wi && o.offset >= t) { o.wall = wi + 1; o.offset -= t; }
    }
    remapFinishes((j) => (j > wi ? j + 1 : j === wi ? [wi, wi + 1] : j));
    sel = { kind: 'corner', i: wi + 1 };
    changed();
  }
  function deleteCorner(k) {
    const p = plan();
    if (p.outline.length <= 3) return;
    checkpoint();
    p.outline.splice(k, 1);
    const map = (j) => (j === k ? null : j > k ? j - 1 : j);
    p.openings = p.openings.filter((o) => o.wall !== k).map((o) => ({ ...o, wall: map(o.wall) }));
    remapFinishes(map);
    sel = null;
    changed();
  }
  function setWallLength(i, L) {
    const p = plan(), w = getWalls(p)[i], n = p.outline.length;
    if (!(L > 0.3)) return;
    const d = mul(w.u, L - w.len);
    checkpoint();
    for (const j of [(i + 1) % n, (i + 2) % n]) if (j !== i) p.outline[j] = [round2(p.outline[j][0] + d[0]), round2(p.outline[j][1] + d[1])];
    changed();
  }
  function applyTemplate(kind, W, D) {
    if (!(W >= 1.5 && D >= 1.5)) { hint('Width and depth must be at least 1.5 m.'); return; }
    checkpoint();
    const p = plan();
    if (kind === 'rect') {
      p.outline = [[0, 0], [W, 0], [W, D], [0, D]];
      p.openings = [
        { wall: 0, type: 'window', offset: round2(W * 0.2), width: round2(Math.min(2.4, W * 0.6)), sill: 0.55, height: round2(Math.min(2.3, p.ceilingHeight - 0.7)) },
        { wall: 2, type: 'door', offset: 0.4, width: 0.9, height: 2.1 },
      ];
    } else {
      const nw = round2(W * 0.4), nd = round2(D * 0.45);
      p.outline = [[0, 0], [W, 0], [W, D - nd], [W - nw, D - nd], [W - nw, D], [0, D]];
      p.openings = [
        { wall: 0, type: 'window', offset: round2(W * 0.15), width: round2(Math.min(2.4, W * 0.5)), sill: 0.55, height: round2(Math.min(2.3, p.ceilingHeight - 0.7)) },
        { wall: 4, type: 'door', offset: 0.4, width: 0.9, height: 2.1 },
      ];
    }
    p.finishes = { default: 'plaster', 0: 'brick' };
    p.placeholder = false;
    autoFurnish(p);
    sel = null;
    changed();
    fit();
  }
  function addOpening(type) {
    const p = plan(), w = getWalls(p)[sel.i];
    const width = type === 'door' ? Math.min(0.9, w.len - 0.2) : Math.min(1.6, w.len - 0.4);
    if (width < 0.4) { hint('Wall is too short for that.'); return; }
    checkpoint();
    p.openings.push(type === 'door'
      ? { wall: sel.i, type, offset: round2((w.len - width) / 2), width, height: 2.1 }
      : { wall: sel.i, type, offset: round2((w.len - width) / 2), width: round2(width), sill: 0.55, height: round2(Math.min(2.3, p.ceilingHeight - 0.75)) });
    sel = { kind: 'open', i: p.openings.length - 1 };
    changed();
  }
  function deleteSelection() {
    const p = plan();
    if (!sel) return;
    if (sel.kind === 'corner') return deleteCorner(sel.i);
    if (sel.kind !== 'open' && sel.kind !== 'item') return;   // walls can't be deleted (and must not wipe redo)
    checkpoint();
    if (sel.kind === 'open') p.openings.splice(sel.i, 1);
    else if (sel.kind === 'item') p.furniture.splice(sel.i, 1);
    else return;
    sel = null;
    changed();
  }
  function rotateItem(by) {
    const f = plan().furniture[sel?.i];
    if (sel?.kind !== 'item' || !f?.at) return;
    checkpoint();
    const riders = ridersOf(plan(), sel.i), r = (by * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    f.facing = (facingDeg(f.facing) + by + 360) % 360;
    for (const { j, off } of riders) {   // pendants over a desk/table turn with it
      plan().furniture[j].at = [round2(f.at[0] + off[0] * c + off[1] * s), round2(f.at[1] - off[0] * s + off[1] * c)];
    }
    changed();
  }
  function finishDrawing() {
    if (drawPts.length < 3) { hint('A room needs at least 3 corners.'); return; }
    checkpoint();
    const p = plan();
    p.outline = drawPts.map((q) => [round2(q[0]), round2(q[1])]);
    p.openings = [];
    p.finishes = { default: 'plaster' };
    p.placeholder = false;
    autoFurnish(p);
    mode = null; drawPts = []; sel = null;
    changed();
    hint('Room drawn. Click a wall to add the door and windows, then press Auto-furnish.');
  }

  function uploadImage(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 2000, k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const b = bbox(plan().outline);
        underlay = { src: c.toDataURL('image/jpeg', 0.85), x: b.minX - 0.5, y: b.minY - 0.5, w: Math.max(b.w, b.d) + 1, opacity: 0.55 };
        saveUnderlay();
        render(); renderInspector();
        hint('Image added. Now press “Set scale” and click both ends of a wall whose length you know.');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function downloadText(name, text, type) {
    const a = document.createElement('a');
    a.download = name;
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ── Events ────────────────────────────────────────────────────────────
  function hint(text) { hintEl.textContent = text; hintEl.hidden = !text; }
  const defaultHint = () => hint(mode === 'draw' ? 'Click each corner of the room · click the first corner (or press Enter) to finish · Esc cancels'
    : mode === 'calibrate' ? 'Click both ends of a wall (or any distance) you know on the image'
      : mode === 'note' ? 'Click a wall, a spot on the floor, or a piece of furniture to pin a note · Esc cancels'
      : mode === 'moveImage' ? 'Drag the image to line it up with the room'
        : window.matchMedia?.('(pointer: coarse)').matches ? 'Tap a piece to select it, then drag it · pinch to zoom · drag elsewhere to pan'
          : 'Scroll to zoom · drag empty space to pan · double-click a wall to add a corner');

  // Touch: two fingers pinch-zoom and pan the plan.
  const touches = new Map();
  function startPinch() {
    const [a, b] = [...touches.values()], r = svg.getBoundingClientRect();
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (drag?.moved && drag.kind !== 'pan') changed();   // keep whatever the first finger already moved
    drag = { kind: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, vb0: { ...vb },
      mid: [vb.x + (m[0] - r.left) * (vb.w / r.width), vb.y + (m[1] - r.top) * (vb.h / r.height)] };
  }
  function movePinch() {
    const [a, b] = [...touches.values()], r = svg.getBoundingClientRect();
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], f = drag.d0 / (Math.hypot(a[0] - b[0], a[1] - b[1]) || 1);
    const w = drag.vb0.w * f, h = drag.vb0.h * f;
    vb = { w, h, x: drag.mid[0] - (m[0] - r.left) * (w / r.width), y: drag.mid[1] - (m[1] - r.top) * (h / r.height) };
    render();
  }

  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size === 2) { svg.setPointerCapture(e.pointerId); startPinch(); return; }
      if (touches.size > 2) return;
    }
    const p = toPlan(e);
    let el = e.target.closest('[data-kind]');
    // a hanging light's bulb dot must not block the table or desk underneath it
    if (el?.dataset.kind === 'item' && HANGING.has(plan().furniture[+el.dataset.i]?.type)) {
      const under = document.elementsFromPoint(e.clientX, e.clientY).map((n) => n.closest?.('[data-kind="item"]'))
        .find((n) => n && !HANGING.has(plan().furniture[+n.dataset.i]?.type));
      if (under) el = under;
    }
    const kind = el?.dataset.kind, i = el ? +el.dataset.i : -1;
    svg.setPointerCapture(e.pointerId);
    if (mode === 'note') {
      const pl = plan();
      let target = null;
      if (kind === 'item' && pl.furniture[i]?.at) target = { kind: 'item', i, at: [...pl.furniture[i].at] };
      else {
        const nw = getWalls(pl).map((w) => ({ w, d: distToSegment(p, w.a, w.b) })).sort((a, b) => a.d - b.d)[0];
        if (nw && nw.d < Math.max(0.3, px() * 14)) target = { kind: 'wall', wall: nw.w.i, t: round2(dot(sub(p, nw.w.a), nw.w.u)), h: 1.5 };
        else if (pointInPolygon(p[0], p[1], pl.outline)) target = { kind: 'floor', at: [round2(p[0]), round2(p[1])] };
      }
      if (target) { mode = null; defaultHint(); onNote(target, e.clientX, e.clientY); }
      return;
    }
    if (mode === 'draw') {
      let q = [snap(p[0]), snap(p[1])];
      if (drawPts.length) {
        const last = drawPts[drawPts.length - 1], dx = Math.abs(q[0] - last[0]), dy = Math.abs(q[1] - last[1]);
        if (dx < dy * 0.2) q[0] = last[0]; else if (dy < dx * 0.2) q[1] = last[1];
        if (drawPts.length >= 3 && dist(q, drawPts[0]) < px() * 14) { finishDrawing(); return; }
      }
      if (drawPts.length && dist(q, drawPts[drawPts.length - 1]) < 0.01) return;   // double-click: same corner twice
      drawPts.push(q); render(); return;
    }
    if (mode === 'calibrate') {
      calPts.push(p);
      if (calPts.length === 2) {
        const measured = dist(calPts[0], calPts[1]);
        const real = parseFloat(window.prompt('Real length between the two points, in metres:', measured.toFixed(2)));
        if (real > 0 && measured > 0.01) {
          const s = real / measured, [ox, oy] = calPts[0];
          underlay = { ...underlay, x: ox + (underlay.x - ox) * s, y: oy + (underlay.y - oy) * s, w: underlay.w * s };
          saveUnderlay();
          hint('Scale set. Press “Draw room” and click the corners over the image.');
        }
        mode = null; calPts = [];
        renderInspector();
      }
      render(); return;
    }
    if (kind === 'underlay' && mode === 'moveImage') { drag = { kind: 'underlay', p0: p, o0: [underlay.x, underlay.y] }; return; }
    const s0 = [e.clientX, e.clientY], tol = e.pointerType === 'mouse' ? 3 : 10;
    // Touch: a tap selects, and only what is already selected can be dragged; a finger
    // starting on anything else pans the plan. A mouse drags directly.
    const grabbable = kind === 'corner' || kind === 'open' || kind === 'item' || kind === 'wall';
    if (grabbable && e.pointerType !== 'mouse' && !(sel?.kind === kind && sel.i === i)) {
      drag = { kind: 'pan', s0, vb0: { ...vb }, tol, moved: false, tap: { kind, i } };
      return;
    }
    if (kind === 'corner') { sel = { kind, i }; drag = { kind, i, s0, tol, moved: false }; render(); renderInspector(); return; }
    if (kind === 'open') { const o = plan().openings[i], w = getWalls(plan())[o.wall]; sel = { kind, i }; drag = { kind, i, s0, tol, grab: dot(sub(p, w.a), w.u) - o.offset, moved: false }; render(); renderInspector(); return; }
    if (kind === 'item') { const f = plan().furniture[i]; sel = { kind, i }; drag = f.at ? { kind, i, s0, tol, p0: p, a0: [...f.at], moved: false, riders: ridersOf(plan(), i) } : null; render(); renderInspector(); return; }
    if (kind === 'wall') { const pl = plan(), n = pl.outline.length; sel = { kind, i }; drag = { kind, i, s0, tol, p0: p, v0: [[...pl.outline[i]], [...pl.outline[(i + 1) % n]]], moved: false }; render(); renderInspector(); return; }
    // background → pan (and deselect on click)
    drag = { kind: 'pan', s0, vb0: { ...vb }, tol, moved: false };
  });

  svg.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (drag?.kind === 'pinch') { if (touches.size === 2) movePinch(); return; }
    const p = toPlan(e);
    if (mode === 'draw' || mode === 'calibrate') {
      cursor = mode === 'draw' ? [snap(p[0]), snap(p[1])] : p;
      if (mode === 'draw' && drawPts.length) {
        const last = drawPts[drawPts.length - 1], dx = Math.abs(cursor[0] - last[0]), dy = Math.abs(cursor[1] - last[1]);
        if (dx < dy * 0.2) cursor[0] = last[0]; else if (dy < dx * 0.2) cursor[1] = last[1];
      }
      render(); return;
    }
    if (!drag) return;
    const pl = plan();
    const first = () => { if (!drag.moved) { checkpoint(); drag.moved = true; } };
    if (drag.kind === 'pan') {
      const k = px(), dx = (e.clientX - drag.s0[0]) * k, dy = (e.clientY - drag.s0[1]) * k;
      if (Math.abs(dx) + Math.abs(dy) > k * drag.tol) drag.moved = true;
      vb = { ...drag.vb0, x: drag.vb0.x - dx, y: drag.vb0.y - dy };
      render(); return;
    }
    if (drag.kind === 'underlay') { underlay.x = drag.o0[0] + p[0] - drag.p0[0]; underlay.y = drag.o0[1] + p[1] - drag.p0[1]; render(); return; }
    // a small wobble of the finger or mouse while tapping must not move anything
    if (!drag.moved && Math.hypot(e.clientX - drag.s0[0], e.clientY - drag.s0[1]) < drag.tol) return;
    if (drag.kind === 'corner') {
      first();
      let [x, y] = p;
      if (!e.shiftKey) {
        x = snap(x); y = snap(y);
        const n = pl.outline.length;
        for (const j of [(drag.i - 1 + n) % n, (drag.i + 1) % n]) {
          if (Math.abs(pl.outline[j][0] - x) < 0.12) x = pl.outline[j][0];
          if (Math.abs(pl.outline[j][1] - y) < 0.12) y = pl.outline[j][1];
        }
      }
      pl.outline[drag.i] = [round2(x), round2(y)];
    } else if (drag.kind === 'wall') {
      const w = getWalls({ ...pl, outline: [...pl.outline] })[drag.i];
      const d = snap(dot(sub(p, drag.p0), w.n));
      if (!drag.moved && Math.abs(d) < 0.05) return;
      first();
      const n = pl.outline.length;
      pl.outline[drag.i] = [round2(drag.v0[0][0] + w.n[0] * d), round2(drag.v0[0][1] + w.n[1] * d)];
      pl.outline[(drag.i + 1) % n] = [round2(drag.v0[1][0] + w.n[0] * d), round2(drag.v0[1][1] + w.n[1] * d)];
    } else if (drag.kind === 'open') {
      first();
      const o = pl.openings[drag.i], w = getWalls(pl)[o.wall];
      o.offset = round2(Math.max(0.05, Math.min(w.len - o.width - 0.05, snap(dot(sub(p, w.a), w.u) - drag.grab))));
    } else if (drag.kind === 'item') {
      first();
      const f = pl.furniture[drag.i];
      let q = [drag.a0[0] + p[0] - drag.p0[0], drag.a0[1] + p[1] - drag.p0[1]];
      if (!e.shiftKey) q = [snap(q[0]), snap(q[1])];
      if (CATALOG[f.type]?.layer === 'wall') {
        const sw = snapToWall(pl, q, 99, halfWidth(f));   // wall items always stay on a wall, clear of corners
        if (sw) { q = sw.at; f.facing = sw.facing; }
      } else if (!pointInPolygon(q[0], q[1], pl.outline)) { render(); return; }   // keep furniture inside the room
      f.at = [round2(q[0]), round2(q[1])];
      onLive('item', drag.i);
      for (const r of drag.riders ?? []) { pl.furniture[r.j].at = [round2(f.at[0] + r.off[0]), round2(f.at[1] + r.off[1])]; onLive('item', r.j); }
    }
    if (drag.kind !== 'item') onLive('shape');
    render();
  });

  const endPointer = (e) => {
    touches.delete(e.pointerId);
    if (drag?.kind === 'pinch') { if (touches.size < 2) drag = null; return; }
    if (!drag) return;
    const d = drag; drag = null;
    if (d.kind === 'pan') { if (!d.moved && e.type === 'pointerup') { sel = d.tap ?? null; render(); renderInspector(); } return; }
    if (d.kind === 'underlay') { saveUnderlay(); return; }
    if (d.moved) changed();
  };
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  svg.addEventListener('dblclick', (e) => {
    const el = e.target.closest('[data-kind="wall"]');
    if (el && !mode) insertCorner(+el.dataset.i, toPlan(e));
  });

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = toPlan(e), f = Math.exp(e.deltaY * 0.0015);
    vb = { x: p[0] - (p[0] - vb.x) * f, y: p[1] - (p[1] - vb.y) * f, w: vb.w * f, h: vb.h * f };
    render();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (!isOpen || e.target.closest('input, select, textarea')) return;
    if (drag && drag.kind !== 'pan') return;   // no deletes/undos while something is being dragged
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? restore(redo, undo) : restore(undo, redo); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); restore(redo, undo); return; }
    if (e.key === 'Escape') { mode = null; drawPts = []; calPts = []; sel = null; render(); renderInspector(); defaultHint(); return; }
    if (e.key === 'Enter' && mode === 'draw') { finishDrawing(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); if (sel?.kind === 'item') duplicateItem(sel.i); return; }
    if (e.key.toLowerCase() === 'r') rotateItem(e.shiftKey ? -15 : 90);
  });

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, p = plan();
    const val = (f) => parseFloat(insp.querySelector(`[data-field="${f}"]`)?.value);
    switch (act) {
      case 'undo': return restore(undo, redo);
      case 'redo': return restore(redo, undo);
      case 'close': mode = null; return onClose();
      case 'library': return onLibrary();
      case 'note': mode = mode === 'note' ? null : 'note'; sel = null; render(); renderInspector(); return defaultHint();
      case 'note-del': { checkpoint(); p.notes.splice(+b.dataset.n, 1); return changed(); }
      case 'dup': return duplicateItem(sel?.i);
      case 'fit': return fit();
      case 'draw': mode = mode === 'draw' ? null : 'draw'; drawPts = []; sel = null; render(); renderInspector(); return defaultHint();
      case 'furnish': checkpoint(); autoFurnish(p); sel = null; changed(); return hint('Auto-furnished using designer clearances — review the design check.');
      case 'tpl-rect': return applyTemplate('rect', val('tpl.w'), val('tpl.d'));
      case 'tpl-l': return applyTemplate('l', val('tpl.w'), val('tpl.d'));
      case 'add-window': return addOpening('window');
      case 'add-door': return addOpening('door');
      case 'add-corner': { const w = getWalls(p)[sel?.i]; return w ? insertCorner(sel.i, w.mid) : undefined; }
      case 'del': return deleteSelection();
      case 'rot-15': return rotateItem(-15);
      case 'rot+15': return rotateItem(15);
      case 'rot90': return rotateItem(90);
      case 'ul-upload': return root.querySelector('#ed-file-img').click();
      case 'ul-scale': mode = 'calibrate'; calPts = []; return defaultHint();
      case 'ul-move': mode = mode === 'moveImage' ? null : 'moveImage'; render(); renderInspector(); return defaultHint();
      case 'ul-remove': underlay = null; saveUnderlay(); mode = null; render(); return renderInspector();
      case 'export': return downloadText('office-plan.json', JSON.stringify(p, null, 2), 'application/json');
      case 'import': return root.querySelector('#ed-file-json').click();
      case 'svg': {
        const clone = svg.cloneNode(true);
        clone.querySelectorAll('.corner').forEach((n) => n.remove());
        return downloadText('office-plan.svg', clone.outerHTML, 'image/svg+xml');
      }
      case 'reset':
        if (!window.confirm('Replace the current plan with the starting plan from plan.js? (You can undo.)')) return;
        checkpoint(); setPlan(samplePlan()); sel = null; changed(); return fit();
      default: return undefined;
    }
  });

  insp.addEventListener('change', (e) => {
    const field = e.target.dataset.field;
    if (!field || field.startsWith('tpl.')) return;
    const p = plan(), v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'text' ? e.target.value : e.target.tagName === 'SELECT' && isNaN(+e.target.value) ? e.target.value : parseFloat(e.target.value);
    const [group, key, sub2] = field.split('.');
    if (group === 'ul') { underlay.opacity = v; saveUnderlay(); return render(); }
    if (group === 'wall' && key === 'length') return setWallLength(sel.i, v);
    if (typeof v === 'number' && Number.isNaN(v)) return;
    checkpoint();
    if (group === 'room') p[key] = v;
    else if (group === 'brief') p.brief[key] = v;
    else if (group === 'wall' && key === 'beyond') {
      const d = round2(Math.max(0.6, Math.min(12, v))), old = p.beyond?.[sel.i];
      p.beyond = { ...p.beyond, [sel.i]: old && typeof old === 'object' ? { ...old, depth: d } : d };   // keep any columns
    }
    else if (group === 'wall') { p.finishes = { ...p.finishes, [sel.i]: v }; }
    else if (group === 'corner') p.outline[sel.i][key === 'x' ? 0 : 1] = round2(v);
    else if (group === 'open') p.openings[sel.i][key] = typeof v === 'number' ? round2(v) : v;
    else if (group === 'item') {
      const f = p.furniture[sel.i];
      if (key === 'x') f.at[0] = round2(v);
      else if (key === 'y') f.at[1] = round2(v);
      else if (key === 'facing') f.facing = ((v % 360) + 360) % 360;
      else if (sub2 !== undefined) { f[key] = [...(f[key] ?? ADDABLE[f.type]?.[key] ?? [1, 1])]; f[key][+sub2] = round2(v); }
      else if (key === 'text') f.text = String(v).slice(0, 40);
      else f[key] = round2(v);
    }
    changed();
  });

  root.querySelector('#ed-file-img').addEventListener('change', (e) => { if (e.target.files[0]) uploadImage(e.target.files[0]); e.target.value = ''; });
  root.querySelector('#ed-file-json').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (!Array.isArray(obj.outline) || obj.outline.length < 3) throw new Error('missing outline');
      checkpoint(); setPlan(normalizePlan(obj)); sel = null; changed(); fit();
    } catch (err) { hint(`Could not read that file (${err.message}).`); }
  });
  window.addEventListener('resize', () => { if (isOpen) fit(); });

  return {
    open() { isOpen = true; root.hidden = false; renderInspector(); fit(); defaultHint(); },
    close() { isOpen = false; root.hidden = true; mode = null; },
    get isOpen() { return isOpen; },
    get dragging() { return !!drag && drag.kind !== 'pan'; },
    // used by the 3D view so both views share one selection and one undo history
    select(s) { sel = s; lastSelKey = s ? `${s.kind}:${s.i}` : ''; if (isOpen) { render(); renderInspector(); } },
    get selection() { return sel; },
    refresh({ inspector = true } = {}) { if (!isOpen) return; render(); if (inspector) renderInspector(); },
    checkpoint,
    undo: () => restore(undo, redo),
    redo: () => restore(redo, undo),
    rotate(i, by) { sel = { kind: 'item', i }; rotateItem(by); },
    remove(i) { sel = { kind: 'item', i }; deleteSelection(); },
    duplicate: duplicateItem,
    fit,
  };
}
