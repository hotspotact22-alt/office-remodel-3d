// Notes pinned anywhere in the plan or the 3D view. Plain-language notes the app understands
// ("glass wall", "painting here", "add a sofa", "remove this") are applied straight away;
// anything else stays open, saved with the plan, for Claude to carry out later.
import { CATALOG, ADDABLE, halfWidth } from './catalog.js';
import { getWalls, degFromDir, facingDeg, add, sub, mul, dot, norm, dist, centroid, distToSegment, round2 } from './planmath.js';

const STOP = new Set('a an the here there this that these add put place some new with on in at of to and for make i want need please like nice it its me my we our one more get have use maybe could would should can just over by up into onto near next beside under above wall walls floor ceiling corner area spot space room'.split(' '));
const FINISH = { brick: 'brick', bricks: 'brick', exposed: 'brick', plaster: 'plaster', white: 'plaster', painted: 'plaster', charcoal: 'charcoal', black: 'charcoal', dark: 'charcoal', concrete: 'concrete', cement: 'concrete', wood: 'wood', wooden: 'wood', timber: 'wood', oak: 'wood', paneling: 'wood', panelling: 'wood', slats: 'wood' };
// Wall-surface words: with a finish word ("wood panels", "white paint") they mean a finish, not furniture.
const SURFACE = new Set(['panel', 'panels', 'paneling', 'panelling', 'finish', 'paint', 'painted', 'color', 'colour', 'cladding', 'tile', 'tiles', 'wallpaper', 'surface']);
const words = (s) => s.toLowerCase().replace(/[^a-z0-9.\s-]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
// Every plausible singular is tried: tables → table, vases → vase, boxes → box, lilies → lily.
const forms = (x) => [x, x.replace(/ies$/, 'y'), x.replace(/es$/, ''), x.replace(/s$/, '')];
// "2m", "90 cm", "6 ft", "6'", "1.5 metres" → metres
function length(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(cm|mm|metres?|meters?|m|feet|foot|ft|'|′)(?![a-z])/i);
  if (!m) return null;
  const u = m[2].toLowerCase(), k = u === 'cm' ? 0.01 : u === 'mm' ? 0.001 : /^(feet|foot|ft|'|′)$/.test(u) ? 0.3048 : 1;
  return +m[1] * k;
}
const has = (text, re) => re.test(text.toLowerCase());
const P = (p) => [round2(p[0]), round2(p[1])];

// Quoted sign wording: "…", “…”, or '…' / ‘…’ that starts a word, so the apostrophe in
// "let's" or "Joe's" (straight or curly) is never taken for a quote.
const QUOTED = /"([^"]+)"|“([^”]+)”|(?<![\p{L}\p{N}])['‘]([^'’]+)['’](?![\p{L}\p{N}])/gu;
const quoted = (text) => { const m = [...text.matchAll(QUOTED)][0]; return m ? m[1] ?? m[2] ?? m[3] : null; };

// Best catalog type for the words in a note (house-style pieces win ties over scanned ones).
export function matchAsset(text, preferLayers = null) {
  const plain = text.replace(QUOTED, ' ');            // quoted text is sign wording, not a noun
  const ws = words(plain);
  const w = new Set(ws.flatMap(forms));
  const head = ws.length ? forms(ws[ws.length - 1]) : [];   // "leather sofa" → sofa
  const lower = ` ${plain.toLowerCase()} `;
  let best = null;
  for (const [type, c] of Object.entries(CATALOG)) {
    if (!c.keywords || !(type in ADDABLE)) continue;
    const list = Array.isArray(c.keywords) ? c.keywords : [c.keywords];   // phrases or one space-separated string
    const kw = new Set(list.join(' ').split(/\s+/));
    let hits = 0;
    for (const k of kw) if (k && w.has(k)) hits += 1;
    if (!hits) continue;
    let score = hits;
    if (head.some((h) => kw.has(h))) score += 0.6;                                          // the noun they typed last
    for (const ph of list) if (ph.includes(' ') && lower.includes(` ${ph} `)) score += 0.5;   // whole phrase typed
    if (preferLayers && !preferLayers.includes(c.layer)) score -= 0.5;                       // ranking only
    if (!c.scanned) score += 0.2;
    if (!best || score > best.score) best = { type, score };
  }
  return best ? best.type : null;
}

const nearestWall = (plan, p) => getWalls(plan).reduce((b, w) => {
  const d = distToSegment(p, w.a, w.b);
  return !b || d < b.d ? { w, d } : b;
}, null);

function newItem(plan, type, extra = {}) {
  const item = { type, facing: 0, ...structuredClone(ADDABLE[type] ?? {}), ...extra };
  plan.furniture.push(item);
  return item;
}
const backDepth = (item) => { const r = CATALOG[item.type]?.rect?.(item); return r ? -r[1] : 0.3; };

// Put an item against wall w at offset t (wall items sit on the wall line).
function placeOnWall(plan, item, w, t, h) {
  const c = CATALOG[item.type];
  const m = Math.min(halfWidth(item) + 0.03, w.len / 2);   // the whole piece stays on this wall, clear of corners
  const tt = Math.max(m, Math.min(w.len - m, t));
  const base = add(w.a, mul(w.u, tt));
  item.facing = degFromDir(w.n);
  if (c.layer === 'wall') {
    item.at = P(base);
    if (h != null && (c.params ?? []).some(([k]) => k === 'height') || (h != null && 'height' in (ADDABLE[item.type] ?? {}))) {
      item.height = round2(Math.max(0.5, Math.min(plan.ceilingHeight - 0.3, h)));
    }
  } else item.at = P(add(base, mul(w.n, backDepth(item) + 0.02)));
  return item;
}

function addOpening(plan, wi, type, t, text) {
  const w = getWalls(plan)[wi];
  let width = length(text) ?? (type === 'door' ? 0.9 : 1.6);
  width = Math.min(width, w.len - 0.2);
  if (width < 0.4) return null;
  const offset = round2(Math.max(0.05, Math.min(w.len - width - 0.05, t - width / 2)));
  plan.openings.push(type === 'door'
    ? { wall: wi, type, offset, width: round2(width), height: 2.13 }
    : { wall: wi, type, offset, width: round2(width), sill: 0.55, height: round2(Math.min(2.3, plan.ceilingHeight - 0.75)) });
  return width;
}

const label = (type) => CATALOG[type]?.name ?? type;

export function applyNote(plan, note) {
  const text = note.text.trim(), tg = note.target, walls = getWalls(plan), lower = text.toLowerCase();
  const removing = has(text, /\b(remove|delete|get rid|take out|no more|lose)\b/);
  const done = (result) => ({ done: true, result });

  // ── On a wall ──────────────────────────────────────────────────────────
  if (tg.kind === 'wall') {
    const w = walls[tg.wall];
    if (!w) return { done: false, result: '' };
    const t = tg.t ?? w.len / 2;
    if (removing) {
      const kind = has(text, /window/) ? 'window' : has(text, /door/) ? 'door' : null;
      if (kind) {
        const list = plan.openings.map((o, i) => ({ o, i })).filter(({ o }) => o.wall === tg.wall && o.type === kind);
        const hit = list.sort((a, b) => Math.abs(a.o.offset + a.o.width / 2 - t) - Math.abs(b.o.offset + b.o.width / 2 - t))[0];
        if (hit) { plan.openings.splice(hit.i, 1); return done(`Removed the ${kind} on wall ${tg.wall + 1}.`); }
      }
      const at = add(w.a, mul(w.u, t));
      const items = plan.furniture.map((f, i) => ({ f, i })).filter(({ f }) => f.at && CATALOG[f.type]?.layer === 'wall' && dist(f.at, at) < 1)
        .sort((a, b) => dist(a.f.at, at) - dist(b.f.at, at));   // the piece nearest the pin
      if (items.length) { const { f, i } = items[0]; plan.furniture.splice(i, 1); return done(`Removed ${label(f.type)}.`); }
      return { done: false, result: '' };
    }
    if (has(text, /\bglass\b|\bglazed\b|\bglazing\b|crittall/) && !has(text, /\bdoor\b/)) {
      plan.finishes = { ...plan.finishes, [tg.wall]: 'glass' };
      // nothing can hang on glass: take down art, panels, TVs… on that wall
      const onWall = (f) => f.at && CATALOG[f.type]?.layer === 'wall' && distToSegment(f.at, w.a, w.b) < 0.1;
      const gone = plan.furniture.filter(onWall).map((f) => label(f.type));
      plan.furniture = plan.furniture.filter((f) => !onWall(f));
      return done(`Wall ${tg.wall + 1} is now a steel-framed glass wall (doors kept)${gone.length ? `; took down ${[...new Set(gone)].join(', ')}` : ''}.`);
    }
    if (has(text, /\bwindows?\b/)) { const wd = addOpening(plan, tg.wall, 'window', t, text); if (wd) return done(`Added a ${wd.toFixed(1)} m window on wall ${tg.wall + 1}.`); }
    if (has(text, /\bdoor(way)?s?\b/)) { const wd = addOpening(plan, tg.wall, 'door', t, text); if (wd) return done(`Added a door on wall ${tg.wall + 1}.`); }
    // finish words ("white", "wood", "brick") never pick furniture on their own
    const finWords = words(text).filter((x) => FINISH[x]);
    const rest = finWords.length ? words(text).filter((x) => !FINISH[x] && !SURFACE.has(x)).join(' ') : text;
    const type = rest.trim() ? matchAsset(finWords.length ? rest : text, ['wall']) : null;
    if (type) {
      const extra = {};
      const q = quoted(text);
      if (q && 'text' in (ADDABLE[type] ?? {})) extra.text = q;
      const item = placeOnWall(plan, newItem(plan, type, extra), w, t, CATALOG[type].layer === 'wall' ? tg.h : null);
      return done(`Added ${label(item.type)} on wall ${tg.wall + 1}.`);
    }
    const fin = finWords.map((x) => FINISH[x]).pop();   // "white brick" → brick
    if (fin) { plan.finishes = { ...plan.finishes, [tg.wall]: fin }; return done(`Wall ${tg.wall + 1} finish → ${fin}.`); }
    return { done: false, result: '' };
  }

  // ── On a piece of furniture ────────────────────────────────────────────
  if (tg.kind === 'item') {
    const f = plan.furniture[tg.i];
    if (!f) return { done: false, result: '' };
    // "glass wall", "brick", "window"… on something hanging on a wall (or on furniture when no
    // furniture is named, e.g. "brick" on a sofa) → it's about the wall behind
    if (f.at && has(text, /\b(glass|glazed|glazing|windows?|doors?|brick|plaster|concrete|paneling|panelling)\b/)
      && (CATALOG[f.type]?.layer === 'wall' || !matchAsset(text))) {
      const nw = nearestWall(plan, f.at);
      if (nw && nw.d < 0.8) return applyNote(plan, { text, target: { kind: 'wall', wall: nw.w.i, t: dot(sub(f.at, nw.w.a), nw.w.u), h: tg.h } });
    }
    if (removing) { plan.furniture.splice(tg.i, 1); return done(`Removed ${label(f.type)}.`); }
    if (has(text, /\b(rotate|turn|spin|face)\b/)) {
      const m = text.match(/(-?\d+)\s*(°|deg)/);
      f.facing = (facingDeg(f.facing) + (m ? +m[1] : 90) + 360) % 360;
      return done(`Rotated ${label(f.type)}.`);
    }
    const grow = has(text, /\b(bigger|larger|wider|longer)\b/) ? 1.25 : has(text, /\b(smaller|narrower|shorter)\b/) ? 0.8 : 0;
    if (grow) {
      let changed = false;
      for (const k of ['width', 'length', 'diameter', 'size', 'count', 'chairs']) {
        if (typeof f[k] === 'number') { f[k] = k === 'count' || k === 'chairs' ? Math.max(1, Math.round(f[k] * grow)) : round2(f[k] * grow); changed = true; break; }
        if (Array.isArray(f[k])) { f[k] = f[k].map((v) => round2(v * grow)); changed = true; break; }
      }
      if (changed) return done(`Made ${label(f.type)} ${grow > 1 ? 'bigger' : 'smaller'}.`);
    }
    if (f.at && has(text, /against (the )?wall|to the wall|push back/)) {
      const nw = nearestWall(plan, f.at);
      if (nw) { placeOnWall(plan, f, nw.w, dot(sub(f.at, nw.w.a), nw.w.u)); return done(`Moved ${label(f.type)} against the wall.`); }
    }
    const type = matchAsset(text, [CATALOG[f.type]?.layer ?? 'floor']);
    if (!type || !f.at) return { done: false, result: '' };
    if (type !== f.type && has(text, /\b(replace|swap|instead|change (it |this )?(to|into)|turn (it |this )?into|make (it|this) an?)\b/)) {
      plan.furniture[tg.i] = { ...structuredClone(ADDABLE[type] ?? {}), type, at: f.at, facing: f.facing };
      return done(`Swapped ${label(f.type)} for ${label(type)}.`);
    }
    // Otherwise add it where they clicked: on the wall behind (wall pieces) or beside this item.
    const spot = tg.hit ?? f.at, nw = nearestWall(plan, spot);
    if (CATALOG[type].layer === 'wall' && nw && nw.d < 1.2) {
      return applyNote(plan, { text, target: { kind: 'wall', wall: nw.w.i, t: dot(sub(spot, nw.w.a), nw.w.u), h: tg.h } });
    }
    const beside = add(f.at, mul(norm(sub(centroid(plan.outline), f.at)), 0.9));
    return applyNote(plan, { text, target: { kind: 'floor', at: P(beside) } });
  }

  // ── On the floor or ceiling ────────────────────────────────────────────
  const at = tg.at;
  if (!at) return { done: false, result: '' };
  const type = matchAsset(text, tg.kind === 'ceiling' ? ['ceiling'] : ['floor']);
  if (!type) return { done: false, result: '' };
  const c = CATALOG[type];
  const nw = nearestWall(plan, at);
  if (type === 'glassPartition') {   // runs parallel to the nearest wall
    const item = newItem(plan, type, { at: P(at), facing: nw ? degFromDir(nw.w.n) : 0 });
    const len = length(text);
    if (len) item.width = round2(Math.max(0.6, Math.min(8, len)));
    return done('Added a steel-framed glass partition (drag to place, R to turn).');
  }
  if (c.layer === 'wall' && nw) {
    placeOnWall(plan, newItem(plan, type), nw.w, dot(sub(at, nw.w.a), nw.w.u));
    return done(`Added ${label(type)} on the nearest wall.`);
  }
  const item = newItem(plan, type, { at: P(at) });
  const againstWall = ['Storage', 'Kitchen'].includes(c.cat) || /sofa|credenza|cabinet|bookcase|shelf|whiteboard|coffeeBar/i.test(type);
  if (nw && nw.d < 1.0 && againstWall) placeOnWall(plan, item, nw.w, dot(sub(at, nw.w.a), nw.w.u));
  else item.facing = degFromDir(norm(sub(centroid(plan.outline), at)));
  return done(`Added ${label(type)}.`);
}

// Note → plan point for pins (walls: point on the wall line).
export function notePoint(plan, note) {
  const tg = note.target;
  if (tg.kind === 'wall') { const w = getWalls(plan)[tg.wall]; if (w) return { at: add(w.a, mul(w.u, tg.t ?? w.len / 2)), h: tg.h ?? 1.5 }; }
  return { at: tg.at ?? note.at ?? [0, 0], h: tg.h ?? (tg.kind === 'ceiling' ? plan.ceilingHeight - 0.05 : 0.9) };
}

export const NOTE_SUGGESTIONS = {
  wall: ['glass wall', 'painting', 'TV', 'whiteboard', 'logo sign "ACME"', 'window', 'brick', 'shelves', 'mirror', 'remove window'],
  floor: ['plant', 'sofa', 'coffee table', 'rug', 'bar stool', 'bookcase', 'coffee bar', 'glass partition', 'filing cabinet'],
  item: ['remove', 'rotate', 'bigger', 'smaller', 'against the wall', 'replace with sofa'],
  ceiling: ['pendant', 'downlight', 'industrial pendant'],
};
