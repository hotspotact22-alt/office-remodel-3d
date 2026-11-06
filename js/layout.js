// Auto-furnish: lays out the brief (desk, client table, lounge, greenery, lighting) in any room
// outline using designer rules, and derives eye-level camera stops from the result.
import { Grid, FREE, SOLID, KEEP_CLEAR } from './grid.js';
import { footprint } from './catalog.js';
import { RULES, doorZone, pendantRange, checkDesign } from './rules.js';
import {
  getWalls, openingGeom, isConvex, normalizePlan, centroid, pointInPolygon, facingDeg, dirFromDeg, degFromDir,
  add, sub, mul, dot, norm, dist, round2, signedArea, bbox, distToSegment,
} from './planmath.js';

const P = (p) => [round2(p[0]), round2(p[1])];

function rectFrom(origin, ex, ey, [u0, v0, u1, v1]) {
  const pt = (u, v) => add(origin, add(mul(ex, u), mul(ey, v)));
  return { kind: 'poly', pts: [pt(u0, v0), pt(u1, v0), pt(u1, v1), pt(u0, v1)] };
}

// Lay out the brief, then check the result with the design rules. If the first layout leaves a
// walkway blocked or chairs too close, try the next-best desk spots, lounge corners and table
// sizes, and keep the first layout that passes (or the one with the fewest problems).
const FIXABLE = (c) => c.level === 'warn' && !/echo|daylight|window/i.test(c.title);
export function autoFurnish(plan) {
  normalizePlan(plan);
  const seats0 = plan.brief.meetingSeats ?? 4;
  const tries = [];
  for (const seats of [seats0, seats0 - 2].filter((n, i) => n >= 0 && (i === 0 || n >= 2))) {
    for (const loungeRank of [0, 1, 2]) for (const deskRank of [0, 1, 2, 3]) tries.push({ seats, loungeRank, deskRank });
  }
  // last resorts for tight rooms: leave out the table, then the lounge (each with a note)
  if (seats0 > 0) for (const deskRank of [0, 1, 2]) tries.push({ seats: 0, loungeRank: 0, deskRank });
  if (plan.brief.lounge) for (const seats of [seats0, 2, 0]) for (const deskRank of [0, 1, 2]) tries.push({ seats, lounge: false, deskRank });
  let best = null;
  for (const t of tries) {
    const p = { ...plan, furniture: [], notes: undefined };
    furnishOnce(p, t);
    const notes = p.layoutNotes; p.layoutNotes = [];
    const problems = checkDesign(p).filter(FIXABLE).length;
    const score = problems * 10 + (seats0 - t.seats) * 1.5 + (t.lounge === false ? 4 : 0) + (t.loungeRank ?? 0) * 0.3 + t.deskRank * 0.4;
    if (!best || score < best.score) best = { score, p, notes, problems };
    if (problems === 0) break;   // tries are in order of preference
  }
  plan.furniture = best.p.furniture;
  plan.views = 'auto';
  plan.layoutNotes = best.notes;
  return plan;
}

function furnishOnce(plan, opt = {}) {
  const brief = plan.brief, H = plan.ceilingHeight;
  const walls = getWalls(plan);
  const grid = new Grid(plan.outline);
  const doors = plan.openings.filter((o) => o.type === 'door').map((o) => ({ o, g: openingGeom(plan, o, walls) }));
  const windows = plan.openings.filter((o) => o.type === 'window').map((o) => openingGeom(plan, o, walls));
  for (const { o, g } of doors) grid.mark(doorZone(g, o.width), KEEP_CLEAR);
  const out = [], notes = [];
  const place = (item) => { out.push(item); const fp = footprint(item); if (fp && fp.layer === 'floor') grid.mark(fp, SOLID); return item; };
  const doorC = doors[0]?.g.center ?? centroid(plan.outline);
  const nearestWindow = (p) => Math.min(Infinity, ...windows.map((w) => dist(w.center, p)));
  const wallBlockedAt = (w, t0, t1, types) => plan.openings.some((o) => o.wall === w.i && types.includes(o.type) && o.offset < t1 && o.offset + o.width > t0);

  // ── 1. Workstation ──────────────────────────────────────────────────────
  const W = RULES.deskWidth, half = W / 2, zone = RULES.deskChairZone;
  const deskCands = [];
  for (const w of walls) {
    if (w.len < W + 0.3) continue;
    for (let t = half + 0.15; t <= w.len - half - 0.15 + 1e-6; t += 0.1) {
      const base = add(w.a, mul(w.u, t));
      for (const variant of ['command', 'wall']) {
        const shelf = variant === 'command' && brief.shelving && !wallBlockedAt(w, t - half - 0.2, t + half + 0.2, ['window', 'door']) ? 0.36 : 0;
        if (variant === 'command' && wallBlockedAt(w, t - half, t + half, ['window', 'door'])) continue;   // never sit with a window/door at your back
        const facing = variant === 'command' ? w.n : mul(w.n, -1);
        const at = variant === 'command' ? add(base, mul(w.n, shelf + zone + 0.39)) : add(base, mul(w.n, 0.41));
        const item = { type: 'workstation', at, facing: degFromDir(facing) };
        const fp = footprint(item);
        const front = rectFrom(at, w.u, facing, [-half, 0.4, half, 0.4 + RULES.deskVisitorClear]);
        if (!grid.fits(fp) || (variant === 'command' && !grid.fits(front, [FREE, KEEP_CLEAR]))) continue;
        let score = variant === 'command' ? 1.5 : 0;
        score += 2 * dot(norm(sub(doorC, at)), facing);                       // see the door
        const dDoor = dist(doorC, at);
        score += dDoor < 1.6 ? -2 : Math.min(dDoor, 4) / 4;                  // not right by the entry
        for (const win of windows) {
          const v = sub(win.center, at), c = Math.abs(dot(norm(v), facing));
          if (dist(win.center, at) < RULES.daylightReach + 1) score += c < 0.5 ? 1.2 : -1.2 * c;   // side light good, front/back glare bad
        }
        score -= 0.4 * Math.abs(t - w.len / 2) / w.len;                      // centred on its wall
        deskCands.push({ score, item, w, t, shelf, facing, front });
      }
    }
  }
  // distinct alternatives only: at least 1 m apart, or facing another way
  deskCands.sort((a, b) => b.score - a.score);
  const distinct = [];
  for (const c of deskCands) if (!distinct.some((d) => dist(d.item.at, c.item.at) < 1 && d.item.facing === c.item.facing)) distinct.push(c);
  const best = distinct[Math.min(opt.deskRank ?? 0, distinct.length - 1)] ?? null;
  let desk = null;
  if (!best) notes.push('No wall fits a 170 cm desk with 1 m of chair room.');
  if (best) {
    desk = place({ ...best.item, at: P(best.item.at) });
    grid.mark(best.front, KEEP_CLEAR);
    if (best.shelf) {
      // widest clear run of wall behind the desk, up to 2.2 m
      let a = best.t - half, b = best.t + half;
      while (a - 0.1 > 0.1 && b - a < 2.2 && !wallBlockedAt(best.w, a - 0.1, b, ['window', 'door'])) a -= 0.1;
      while (b + 0.1 < best.w.len - 0.1 && b - a < 2.2 && !wallBlockedAt(best.w, a, b + 0.1, ['window', 'door'])) b += 0.1;
      const c = add(best.w.a, mul(best.w.u, (a + b) / 2));
      place({ type: 'pipeShelf', at: P(add(c, mul(best.w.n, 0.18))), facing: degFromDir(best.w.n), width: round2(b - a) });
    }
    const x = [Math.cos((facingDeg(desk.facing) * Math.PI) / 180), -Math.sin((facingDeg(desk.facing) * Math.PI) / 180)];
    const ph = 0.75 + pendantRange(RULES.pendantOverDesk, H)[1];   // top of range: clears the monitor
    for (const s of [-1, 1]) out.push({ type: 'pendant', at: P(add(desk.at, mul(x, s * 0.42))), height: round2(ph) });
  }

  // ── 2. Client table ─────────────────────────────────────────────────────
  let seats = opt.seats ?? brief.meetingSeats ?? 4, table = null;
  while (seats >= 2 && !table) {
    const R = RULES.tableDiameter[seats] / 2;
    const dmap = grid.distance((v) => v !== FREE);
    for (const need of [R + RULES.tableChairClear + 0.06, R + 0.84]) {
      let bestT = null;
      for (let k = 0; k < dmap.length; k++) {
        if (dmap[k] < need) continue;
        const p = grid.center(k % grid.w, (k / grid.w) | 0);
        let score = windows.length ? -0.7 * nearestWindow(p) : 0;
        if (desk) score += 0.25 * Math.min(dist(p, desk.at), 3.5);
        score -= 0.3 * Math.max(0, dmap[k] - need - 0.6);                    // don't float in the exact middle
        if (!bestT || score > bestT.score) bestT = { score, p };
      }
      if (bestT) { table = place({ type: 'meetingTable', at: P(bestT.p), chairs: seats, diameter: RULES.tableDiameter[seats] }); break; }
    }
    if (!table) seats -= 2;
  }
  if ((brief.meetingSeats ?? 4) > 0 && seats < (brief.meetingSeats ?? 4)) notes.push(table ? `Client table reduced to ${seats} seats to keep 91 cm chair clearance and clear walkways.` : 'No room for a client table with 91 cm chair clearance.');
  if (table) {
    grid.mark({ kind: 'circle', c: table.at, r: table.diameter / 2 + RULES.tableChairClear }, KEEP_CLEAR);
    const [lo, hi] = pendantRange(RULES.pendantOverTable, H);
    out.push({ type: 'pendant', at: table.at, height: round2(0.75 + (lo + hi) / 2), size: 1.4 });
  }

  // ── 3. Lounge corner ────────────────────────────────────────────────────
  const corners = plan.outline.map((c, k) => ({ c, k })).filter(({ k }) => isConvex(plan, k)).map(({ c, k }) => {
    const n = walls.length;
    return { c, k, e1: walls[k].u, e2: mul(walls[(k - 1 + n) % n].u, -1), wA: walls[k], wB: walls[(k - 1 + n) % n] };
  });
  let lounge = null;
  const wantLounge = opt.lounge ?? brief.lounge;
  if (brief.lounge && !wantLounge) notes.push('Lounge corner left out: the room is too narrow for it and a 92 cm walkway to every zone.');
  if (wantLounge) {
    const SIZES = [[2.4, 1.95, 'full'], [2.0, 1.75, 'full'], [1.5, 1.4, 'single']];
    const cands = [];
    SIZES.forEach(([L1, L2, kind], si) => {
      for (const cn of corners) {
        for (const [ex, ey, wX, wY] of [[cn.e1, cn.e2, cn.wA, cn.wB], [cn.e2, cn.e1, cn.wB, cn.wA]]) {
          const rect = rectFrom(cn.c, ex, ey, [0.06, 0.06, L1, L2]);
          if (!grid.fits(rect)) continue;
          const mid = add(cn.c, add(mul(ex, L1 / 2), mul(ey, L2 / 2)));
          let score = 0.6 * Math.min(dist(mid, doorC), 5);
          if (desk) score += 0.4 * Math.min(dist(mid, desk.at), 4);
          if (windows.length && nearestWindow(mid) < 2.2) score += 0.3;
          cands.push({ si, score, cn, ex, ey, L1, L2, kind, rect, wX, wY });
        }
      }
    });
    cands.sort((a, b) => a.si - b.si || b.score - a.score);   // biggest lounge first, then the best corner
    lounge = cands[Math.min(opt.loungeRank ?? 0, cands.length - 1)] ?? null;
  }
  if (wantLounge && !lounge) notes.push('Not enough free floor for a lounge corner — try fewer table seats or no shelving.');
  if (lounge) {
    const { cn, ex, ey, L1, L2, kind } = lounge;
    const at = (u, v) => P(add(cn.c, add(mul(ex, u), mul(ey, v))));
    const face = (a, b) => degFromDir(norm(add(mul(ex, a), mul(ey, b))));
    const wallFacing = degFromDir(ex);
    // The wall the chair A backs onto runs along ey (u = 0).
    const wallAlongEy = dot(ey, cn.wB.u) !== 0 && Math.abs(dot(ey, cn.wB.u)) > 0.9 ? cn.wB : cn.wA;
    if (kind === 'full') {
      const b = RULES.rugBorder[0];   // bare-floor border to the walls
      out.push({ type: 'rug', at: at((L1 + b) / 2, (L2 + b) / 2), facing: degFromDir(ey), size: [round2(L1 - b), round2(L2 - b)] });
      place({ type: 'clubChair', at: at(0.5, L2 * 0.68), facing: face(1, 0.3) });
      place({ type: 'clubChair', at: at(L1 * 0.68, 0.5), facing: face(0.3, 1) });
      place({ type: 'sideTable', at: at(0.5, 0.5) });
      place({ type: 'floorLamp', at: at(0.17, 0.17), facing: face(1, 1) });
      place({ type: 'ottoman', at: at(L1 * 0.66, L2 * 0.7), facing: face(1, 1) });
    } else {
      out.push({ type: 'rug', at: at(L1 / 2, L2 / 2), facing: degFromDir(ey), size: [round2(L1 - 0.1), round2(L2 - 0.1)] });
      place({ type: 'clubChair', at: at(0.62, 0.72), facing: face(1, 0.6) });
      place({ type: 'floorLamp', at: at(0.17, 0.17), facing: face(1, 1) });
      place({ type: 'sideTable', at: at(1.2, 0.32) });
    }
    // Art above chair A, on the wall behind it (if that stretch of wall is solid)
    const artV = kind === 'full' ? L2 * 0.68 : 0.72;
    const artAt = add(cn.c, mul(ey, artV));
    const tOnWall = dot(sub(artAt, wallAlongEy.a), wallAlongEy.u);
    if (!wallBlockedAt(wallAlongEy, tOnWall - 0.5, tOnWall + 0.5, ['window', 'door'])) {
      out.push({ type: 'wallArt', at: P(artAt), facing: wallFacing, size: [0.9, 0.65], height: 1.52 });
    }
    grid.mark(lounge.rect, SOLID);
  }

  // ── 4. Greenery in free corners (prefer daylight) ───────────────────────
  if (brief.plants) {
    const spots = corners
      .map((cn) => ({ cn, p: add(cn.c, mul(add(cn.e1, cn.e2), 0.36)) }))
      .filter(({ p }) => dist(p, doorC) > 1.0 && grid.fits({ kind: 'circle', c: p, r: 0.3 }))
      .sort((a, b) => nearestWindow(a.p) - nearestWindow(b.p));
    const sizes = [1.6, 1.2, 1.0];
    spots.slice(0, 3).forEach(({ p }, i) => place({ type: 'plant', at: P(p), size: sizes[i] }));
  }

  // ── 5. Acoustics: felt panels on the wall you face at the desk, drapes at windows ──
  if (brief.acoustics) {
    for (const win of windows) out.push({ type: 'curtains', at: P(win.center), facing: degFromDir(win.n), width: round2(win.b ? dist(win.a, win.b) : 1.8) });
    const art = out.filter((it) => it.type === 'wallArt');
    const blocked = (w, t0, t1) => wallBlockedAt(w, t0, t1, ['window', 'door']) || art.some((a) => {
      const v = sub(a.at, w.a), t = dot(v, w.u);
      return Math.abs(dot(v, w.n)) < 0.05 && t + 0.6 > t0 && t - 0.6 < t1;   // keep panels off the art
    });
    const f = desk ? dirFromDeg(facingDeg(desk.facing)) : null;
    const target = f ? walls.slice().sort((a, b) => dot(a.n, f) - dot(b.n, f)) : walls.slice().sort((a, b) => b.len - a.len);
    let groups = windows.length ? 1 : 2;   // no windows → no curtains soaking up sound, so a second set of panels
    for (const w of target) {
      if (['brick', 'glass'].includes(plan.finishes?.[w.i])) continue;   // never cover a brick feature wall or glass
      // longest solid run on this wall
      let bestRun = null;
      for (let t0 = 0.2; t0 < w.len - 1.3; t0 += 0.1) {
        let t1 = t0 + 1.26;
        if (blocked(w, t0, t1)) continue;
        while (t1 + 0.1 < w.len - 0.2 && t1 - t0 < 2.6 && !blocked(w, t0, t1 + 0.1)) t1 += 0.1;
        if (!bestRun || t1 - t0 > bestRun[1] - bestRun[0]) bestRun = [t0, t1];
      }
      if (!bestRun) continue;
      const count = Math.max(2, Math.min(4, Math.floor((bestRun[1] - bestRun[0] + 0.06) / 0.66)));
      const c = add(w.a, mul(w.u, (bestRun[0] + bestRun[1]) / 2));
      out.push({ type: 'acousticPanels', at: P(c), facing: degFromDir(w.n), count, height: 1.45 });
      if (--groups === 0) break;
    }
  }

  // ── 5b. General light where daylight is short: an even grid of ceiling downlights ──
  const floorA = Math.abs(signedArea(plan.outline));
  const glazing = plan.openings.filter((o) => o.type === 'window').reduce((s, o) => s + o.width * (o.height ?? 1.5), 0);
  if (glazing < RULES.glazingMin * floorA) {
    const sp = Math.max(1.2, RULES.downlightSHR * (H - 0.75)), bb = bbox(plan.outline);
    const nx = Math.max(1, Math.round(bb.w / sp)), ny = Math.max(1, Math.round(bb.d / sp));
    const pendants = out.filter((it) => it.type === 'pendant');
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const p = [bb.minX + ((i + 0.5) * bb.w) / nx, bb.minY + ((j + 0.5) * bb.d) / ny];
      if (!pointInPolygon(p[0], p[1], plan.outline) || walls.some((w) => distToSegment(p, w.a, w.b) < 0.4)) continue;
      if (pendants.some((q) => dist(q.at, p) < 0.6)) continue;
      out.push({ type: 'downlight', at: P(p) });
    }
  }

  // ── 6. Exposed duct along the room's long axis (tall ceilings only) ─────
  if (H >= 2.9) {
    const longest = walls.reduce((a, w) => (w.len > a.len ? w : a));
    const c = centroid(plan.outline), u = longest.u;
    let run = null, cur = null;
    for (let t = -30; t <= 30; t += 0.05) {
      const p = add(c, mul(u, t)), inside = pointInPolygon(p[0], p[1], plan.outline);
      if (inside && !cur) cur = { a: t };
      if (!inside && cur) { cur.b = t; if (!run || cur.b - cur.a > run.b - run.a) run = cur; cur = null; }
    }
    if (run && run.b - run.a > 1.5) {
      const shift = mul(longest.n, 0.6);   // keep it off the centre line so it doesn't clash with pendants
      out.push({ type: 'duct', from: P(add(add(c, mul(u, run.a + 0.2)), shift)), to: P(add(add(c, mul(u, run.b - 0.2)), shift)) });
    }
  }

  plan.furniture = out;
  plan.views = 'auto';
  plan.layoutNotes = notes;
  return plan;
}

// Eye-level camera stops derived from the layout (so any floor plan gets sensible views).
export function autoViews(plan) {
  const pts = plan.outline, inside = (p) => pointInPolygon(p[0], p[1], pts);
  const walls = getWalls(plan), views = [];
  const F = (t) => plan.furniture.filter((f) => f.type === t);
  const c = centroid(pts);
  const door = plan.openings.find((o) => o.type === 'door');
  const table = F('meetingTable')[0], desk = F('workstation')[0], chair = F('clubChair')[0];
  if (door) {
    const g = openingGeom(plan, door, walls);
    const eye = add(g.center, mul(g.n, 0.7));
    if (inside(eye)) views.push({ name: 'From the door', eye: P(eye), look: P(table ? table.at : c) });
  }
  if (table && desk) {
    const R = (table.diameter ?? 1.2) / 2, n = table.chairs ?? 4;
    let bestSeat = null;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / 4, p = add(table.at, [Math.sin(a) * (R + 0.18), Math.cos(a) * (R + 0.18)]);
      if (!bestSeat || dist(p, desk.at) > dist(bestSeat, desk.at)) bestSeat = p;
    }
    if (inside(bestSeat)) views.push({ name: 'Client seat', eye: P(bestSeat), look: P(desk.at), eyeHeight: 1.2 });
  }
  if (desk) {
    const f = dirFromDeg(facingDeg(desk.facing)), x = [f[1], -f[0]];
    for (const side of [1, -1]) {
      const eye = add(add(desk.at, mul(f, -1.25)), mul(x, side * 0.6));
      if (inside(eye)) { views.push({ name: 'Your desk', eye: P(eye), look: P(add(add(desk.at, mul(f, 3)), mul(x, -side * 0.4))), eyeHeight: 1.6 }); break; }
    }
  }
  if (chair) {
    const f = dirFromDeg(facingDeg(chair.facing)), eye = add(chair.at, mul(f, -0.05));
    if (inside(eye)) views.push({ name: 'Lounge', eye: P(eye), look: P(add(chair.at, mul(f, 4))), eyeHeight: 1.1 });
  }
  return views;
}
