// 2D plan geometry shared by the 3D builder, the plan editor, auto-furnish and the design check.
// Plan coordinates: metres, x → east, y → south (as on a drawing with north up).

const COMPASS = { south: 0, east: 90, north: 180, west: 270 };
export const facingDeg = (f = 0) => (typeof f === 'string' ? COMPASS[f] ?? 0 : f);
export const dirFromDeg = (deg) => { const r = (deg * Math.PI) / 180; return [Math.sin(r), Math.cos(r)]; };
export const degFromDir = ([x, y]) => Math.round(((Math.atan2(x, y) * 180) / Math.PI + 360) % 360);

export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const len = (a) => Math.hypot(a[0], a[1]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
export const dist = (a, b) => len(sub(a, b));

export function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToSegment(p, a, b) {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return dist(p, add(a, mul(ab, t)));
}

export function bbox(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const b = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  return { ...b, w: b.maxX - b.minX, d: b.maxY - b.minY, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 };
}

export function centroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  return a ? [cx / (3 * a), cy / (3 * a)] : [pts[0][0], pts[0][1]];
}

// Walls with unit direction u and inward normal n.
export function getWalls(plan) {
  const pts = plan.outline, s = signedArea(pts) > 0 ? 1 : -1;
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length], L = dist(a, b), u = norm(sub(b, a));
    return { i, a, b, len: L, u, n: [s * -u[1], s * u[0]], mid: add(a, mul(sub(b, a), 0.5)) };
  });
}

// Interior angle test: a vertex is convex (a normal room corner) if the turn matches the winding.
export function isConvex(plan, k) {
  const pts = plan.outline, n = pts.length;
  const a = pts[(k - 1 + n) % n], b = pts[k], c = pts[(k + 1) % n];
  const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  return Math.sign(cr) === Math.sign(signedArea(pts));
}

export function openingGeom(plan, o, walls = getWalls(plan)) {
  const w = walls[o.wall];
  if (!w) return null;
  const a = add(w.a, mul(w.u, o.offset)), b = add(w.a, mul(w.u, o.offset + o.width));
  return { wall: w, a, b, center: mul(add(a, b), 0.5), u: w.u, n: w.n };
}

// Local item coords (lx across, lz toward the item's front) → plan coords.
export function localToPlan(at, deg, [lx, lz]) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [at[0] + lx * c + lz * s, at[1] - lx * s + lz * c];
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const isPt = (p) => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]);

// Remove zero-length walls (duplicate consecutive corners), remapping doors, windows,
// finishes and glass-wall depths so they stay on the same physical walls.
function dropZeroWalls(plan) {
  const pts = plan.outline;
  for (let guard = 0; guard < 64 && pts.length > 3; guard++) {
    const n = pts.length;
    const k = pts.findIndex((p, i) => dist(p, pts[(i + 1) % n]) < 1e-3);
    if (k < 0) break;
    const drop = (k + 1) % n;
    pts.splice(drop, 1);
    const map = drop === 0 ? (j) => (j === n - 1 ? null : j === 0 ? n - 2 : j - 1) : (j) => (j === k ? null : j > k ? j - 1 : j);
    plan.openings = (plan.openings || []).filter((o) => map(o.wall) != null).map((o) => ({ ...o, wall: map(o.wall) }));
    for (const key of ['finishes', 'beyond']) {
      if (!plan[key]) continue;
      const next = key === 'finishes' ? { default: plan.finishes.default ?? 'plaster' } : {};
      for (const [w, v] of Object.entries(plan[key])) { if (w === 'default') continue; const j = map(+w); if (j != null) next[j] = v; }
      plan[key] = next;
    }
  }
}

// Make any plan safe to build: repair or default bad fields from imports or old saves,
// keep openings inside their walls after the outline changes, drop ones that no longer fit.
export function normalizePlan(plan, { dedupe = true } = {}) {
  plan.outline = (Array.isArray(plan.outline) ? plan.outline : []).filter(isPt).map((p) => [p[0], p[1]]);
  if (plan.outline.length < 3) plan.outline = [[0, 0], [6, 0], [6, 4.8], [0, 4.8]];
  if (!(finite(plan.ceilingHeight) && plan.ceilingHeight >= 2 && plan.ceilingHeight <= 12)) plan.ceilingHeight = 2.75;
  if (!(finite(plan.wallThickness) && plan.wallThickness >= 0.05 && plan.wallThickness <= 0.6)) plan.wallThickness = 0.15;
  plan.openings = (Array.isArray(plan.openings) ? plan.openings : [])
    .filter((o) => o && Number.isInteger(o.wall) && finite(o.offset) && finite(o.width) && finite(o.height) && (o.type === 'door' || o.type === 'window'))
    .map((o) => (o.type === 'window' && !finite(o.sill) ? { ...o, sill: 0.55 } : o));
  if (dedupe) dropZeroWalls(plan);
  if (Array.isArray(plan.furniture)) {   // every item needs a type and a position (ducts: a start and end)
    plan.furniture = plan.furniture.filter((f) => f && typeof f.type === 'string'
      && (f.type === 'duct' ? isPt(f.from) && isPt(f.to) : isPt(f.at)));
    for (const f of plan.furniture) if (f.facing != null && !finite(f.facing) && typeof f.facing !== 'string') f.facing = 0;
  }
  if (plan.notes != null && !Array.isArray(plan.notes)) plan.notes = [];
  const walls = getWalls(plan);
  plan.openings = (plan.openings || []).filter((o) => {
    const w = walls[o.wall];
    if (!w || w.len < 0.4) return false;
    o.width = Math.min(o.width, w.len - 0.1);
    o.offset = Math.max(0.05, Math.min(o.offset, w.len - o.width - 0.05));
    return o.width >= 0.3;
  });
  if (!Array.isArray(plan.furniture)) plan.furniture = plan.furniture === 'auto' ? 'auto' : [];
  plan.finishes ??= { default: 'plaster' };
  plan.brief ??= {};
  plan.brief = { meetingSeats: 4, lounge: true, shelving: true, plants: true, acoustics: true, ...plan.brief };
  return plan;
}

export const round2 = (v) => Math.round(v * 100) / 100;
