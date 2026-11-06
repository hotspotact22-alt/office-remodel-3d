// Professional space-planning standards used by auto-furnish and the design check.
// Values in metres unless noted. Sources are listed in the design notes panel.
import { Grid, OUTSIDE, SOLID } from './grid.js';
import { footprint, solidFootprints } from './catalog.js';
import { getWalls, openingGeom, facingDeg, dirFromDeg, add, sub, mul, dot, norm, dist, len, pointInPolygon } from './planmath.js';

export const RULES = {
  walkway: 0.915,          // ADA accessible route / primary path, 36"
  walkwayComfort: 1.12,    // preferred main aisle, 44"
  doorSwingExtra: 0.15,    // keep the door-swing square (+15 cm) clear (ADA 404.2.4 manoeuvring)
  deskWidth: 1.7, deskDepth: 0.78,
  deskChairZone: 1.0,      // desk edge → wall/obstacle behind chair: 915 min, 1065 comfortable
  deskChairMin: 0.915,
  deskVisitorClear: 0.915, // guests in front of the desk
  tableChairClear: 0.915,  // table edge → obstacle: 815 sit only, 915 edge past (NKBA)
  tablePassBehind: 1.12,   // to walk behind seated guests, 44"
  tableDiameter: { 2: 0.76, 4: 1.15, 6: 1.4 },   // round, 600–760 mm of edge per seat
  seatEdgeMin: 0.6,        // edge length per seated person, 24"
  pendantOverTable: [0.76, 0.91],  // shade bottom above tabletop, 30–36" for an 8 ft ceiling…
  pendantPerFoot: 0.075,           // …plus ~3" per extra foot of ceiling
  pendantOverDesk: [0.71, 0.86],
  headClearance: 2.03,     // ADA 307.4 protruding objects, 80"
  conversation: [1.0, 3.0],// seat-to-seat for conversation (4–10 ft, keep under 3 m)
  rugBorder: [0.2, 0.45],  // bare floor between rug and walls
  artCenter: [1.45, 1.55], // gallery eye level 57–60"
  daylightReach: 4.0,      // usable daylight ≈ 2× window head height
  glazingMin: 0.08,        // natural light: glazing ≥ 8 % of floor area (IBC §1204.2); below it, add general light
  downlightSHR: 1.0,       // downlight spacing ≈ 1.0–1.5 × mounting height above the desk (even light)
  rt60: [0.4, 0.6],        // reverberation target for private office / calls (WELL, Green Globes)
  lux: { desk: '500 lx (EN 12464-1)', meeting: '300–500 lx', reading: '300–500 lx', lounge: '100–300 lx' },
  cct: { work: '3000–4000 K', task: '4000 K', lounge: '2700–3000 K' },
};

// Pendant range above a surface, adjusted for ceiling height (rule of thumb: +3" per foot over 8 ft).
export const pendantRange = ([lo, hi], H) => {
  const extra = RULES.pendantPerFoot * Math.max(0, (H - 2.44) / 0.305);
  return [lo + extra, hi + extra];
};

export const SOURCES = [
  ['Natural light minimum', 'IBC 2021 §1204.2 — glazing ≥ 8% of floor area', 'https://codes.iccsafe.org/content/IBC2021P1/chapter-12-interior-environment'],
  ['Circulation, door & turning space', 'ADA Standards §304, §403, §404.2.4, §307.4', 'https://www.access-board.gov/ada/guides/chapter-3-clear-floor-or-ground-space-and-turning-space'],
  ['Table & seating clearances', 'NKBA Planning Guidelines; Neufert; Panero & Zelnik', 'https://kb.nkba.org/uploads/2022/05/Kitchen-Planning-Guidelines.pdf'],
  ['Monitor & window orientation', 'OSHA Computer Workstations eTool', 'https://www.osha.gov/etools/computer-workstations/components/monitors'],
  ['Illuminance & colour temperature', 'EN 12464-1; IES recommended levels', 'https://archtoolbox.com/recommended-lighting-levels'],
  ['Pendant heights', 'Lighting manufacturer sizing guides', 'https://www.hubbell.com/progresslighting/en/sizing-guidelines'],
  ['Acoustics (RT60)', 'WELL v2 Sound; Sabine formula', 'https://standard.wellcertified.com/v4/node/12130'],
  ['Rugs, art & lounge spacing', 'Designer conventions (Livingetc, Homes & Gardens)', 'https://www.livingetc.com/advice/rug-placement'],
];

// Approximate absorption coefficients at 500–1000 Hz, and sabins (m²) per object.
const ALPHA = { brick: 0.04, plaster: 0.06, charcoal: 0.06, floor: 0.02, ceiling: 0.03, glass: 0.04 };
const SABINS = { clubChair: 0.4, ottoman: 0.15, workstation: 0.35, meetingTable: 0.9, pipeShelf: 0.6, plant: 0.1 };
export function estimateRT60(plan, walls = getWalls(plan)) {
  const H = plan.ceilingHeight, area = Math.abs(plan.outline.reduce((s, p, i, a) => s + p[0] * a[(i + 1) % a.length][1] - a[(i + 1) % a.length][0] * p[1], 0)) / 2;
  let A = area * (ALPHA.floor + ALPHA.ceiling);
  for (const w of walls) {
    const glass = plan.openings.filter((o) => o.wall === w.i).reduce((s, o) => s + o.width * o.height, 0);
    const fin = plan.finishes?.[w.i] ?? plan.finishes?.default ?? 'plaster';
    A += (w.len * H - glass) * (ALPHA[fin] ?? 0.05) + glass * ALPHA.glass;
  }
  for (const f of plan.furniture) {
    if (f.type === 'rug') { const [rw, rd] = f.size ?? [2, 1.4]; A += rw * rd * 0.35; }
    else if (f.type === 'acousticPanels') A += (f.count ?? 4) * 0.6 * (f.panelHeight ?? 1.2) * 0.85;
    else if (f.type === 'curtains') A += ((f.width ?? 2) + 0.4) * (H - 0.15) * 0.3;   // heavy drape, mostly open
    else A += SABINS[f.type] ?? 0;
  }
  return (0.161 * area * H) / Math.max(A, 0.1);
}

function doorZone(g, width) {
  const depth = width + RULES.doorSwingExtra;
  return { kind: 'poly', pts: [g.a, g.b, add(g.b, mul(g.n, depth)), add(g.a, mul(g.n, depth))] };
}
export { doorZone };

// Walk from a point along a direction until a blocked cell; returns distance travelled.
function rayClear(grid, p, dir, max = 4, blocked = (v) => v === OUTSIDE || v === SOLID) {
  for (let t = 0; t <= max; t += grid.cell / 2) {
    if (blocked(grid.at(p[0] + dir[0] * t, p[1] + dir[1] * t))) return t;
  }
  return max;
}

function gridWithout(plan, skip) {
  const g = new Grid(plan.outline);
  for (const f of plan.furniture) {
    if (f === skip) continue;
    for (const fp of solidFootprints(f)) if (fp.layer === 'floor') g.mark(fp, SOLID);
  }
  return g;
}

export function checkDesign(plan) {
  const out = [];
  for (const n of plan.layoutNotes ?? []) out.push({ level: 'info', title: 'Auto-furnish', detail: n });
  const ok = (title, detail) => out.push({ level: 'ok', title, detail });
  const warn = (title, detail) => out.push({ level: 'warn', title, detail });
  const info = (title, detail) => out.push({ level: 'info', title, detail });
  const walls = getWalls(plan);
  const doors = plan.openings.filter((o) => o.type === 'door').map((o) => ({ o, g: openingGeom(plan, o, walls) }));
  const windows = plan.openings.filter((o) => o.type === 'window').map((o) => openingGeom(plan, o, walls));
  const F = (t) => plan.furniture.filter((f) => f.type === t);
  const grid = gridWithout(plan, null);
  const cm = (m) => `${Math.round(m * 100)} cm`;

  // 1. Door swings
  for (const { o, g } of doors) {
    let blocked = false;
    grid.eachIn(doorZone(g, o.width), (k) => { if (grid.cells[k] === SOLID) blocked = true; });
    if (blocked) warn('Door swing blocked', 'Furniture sits inside the door’s swing zone; keep a clear square the width of the door.');
    else ok('Door swing clear', `Clear ${cm(o.width + RULES.doorSwingExtra)} zone inside the door.`);
  }

  // 2. Walkways: can a person (90 cm wide) get from the door to every zone?
  const d = grid.distance((v) => v === OUTSIDE || v === SOLID);
  const half = RULES.walkway / 2 - 0.02;
  if (doors.length) {
    const { g } = doors[0];
    const start = add(g.center, mul(g.n, 0.5));
    const seen = new Uint8Array(grid.w * grid.h), queue = [];
    const si = Math.floor((start[0] - grid.x0) / grid.cell), sj = Math.floor((start[1] - grid.y0) / grid.cell);
    const startK = sj * grid.w + si;
    if (si >= 0 && sj >= 0 && si < grid.w && sj < grid.h && d[startK] >= half - 0.05) { seen[startK] = 1; queue.push(startK); }
    while (queue.length) {
      const k = queue.pop(), i = k % grid.w, j = (k / grid.w) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= grid.w || nj >= grid.h) continue;
        const nk = nj * grid.w + ni;
        if (!seen[nk] && d[nk] >= half) { seen[nk] = 1; queue.push(nk); }
      }
    }
    const reachable = (p, r) => {
      let hit = false;
      grid.eachIn({ kind: 'circle', c: p, r }, (k) => { if (seen[k]) hit = true; });
      return hit;
    };
    const targets = [];
    for (const f of F('workstation')) targets.push(['your desk', f.at, 1.3]);
    for (const f of F('meetingTable')) targets.push(['the client table', f.at, (f.diameter ?? 1.2) / 2 + 1.0]);
    const rug = F('rug')[0];
    if (rug) targets.push(['the lounge', rug.at, 1.4]);
    const blockedTargets = targets.filter(([, p, r]) => !reachable(p, r));
    if (!seen[startK]) warn('Entry is pinched', `Less than ${cm(RULES.walkway)} of clear floor just inside the door.`);
    else if (blockedTargets.length) warn('Walkway too narrow', `No ${cm(RULES.walkway)} path from the door to ${blockedTargets.map((t) => t[0]).join(' and ')}.`);
    else if (targets.length) ok('Walkways', `${cm(RULES.walkway)}+ clear path from the door to every zone.`);
  } else {
    info('No door', 'Add a door so walkways can be checked.');
  }

  // 3. Desk: command position, glare, daylight, chair room
  for (const ws of F('workstation')) {
    const f = dirFromDeg(facingDeg(ws.facing));
    if (doors.length) {
      const toDoor = norm(sub(doors[0].g.center, ws.at));
      const c = dot(toDoor, f);
      if (c > 0.3) ok('Command position', 'You face the door while working: you see who enters, and guests approach from the front.');
      else info('Back or side to the door', 'Designers prefer a desk facing the entry (“command position”).');
    }
    let glare = null, side = false, nearest = Infinity;
    for (const w of windows) {
      const v = sub(w.center, ws.at), dd = len(v), c = dot(norm(v), f);
      nearest = Math.min(nearest, dd);
      if (dd > RULES.daylightReach + 1) continue;
      if (c > 0.75) glare = glare ?? 'ahead';
      else if (c < -0.75) glare = 'behind';
      else side = true;
    }
    if (glare === 'behind') warn('Screen glare', 'A window is behind your seat: it will reflect on the monitor. Turn the desk so windows are to the side.');
    else if (glare === 'ahead') warn('Facing the window', 'Looking past the screen into bright daylight causes eye strain. Windows to the side are ideal.');
    else if (side) ok('Glare-free daylight', 'Windows sit to the side of the desk — daylight without screen glare.');
    if (windows.length) {
      if (nearest <= RULES.daylightReach) ok('Daylight at the desk', `Desk is ${nearest.toFixed(1)} m from a window.`);
      else info('Far from daylight', `Desk is ${nearest.toFixed(1)} m from the nearest window; add a strong task light.`);
    }
    const g2 = gridWithout(plan, ws);
    const back = add(ws.at, mul(f, -0.39));
    const room = rayClear(g2, back, mul(f, -1));
    if (room >= RULES.deskChairMin - 0.03) ok('Chair clearance', `${cm(Math.min(room, 1.5))} behind the desk to roll the chair out (min ${cm(RULES.deskChairMin)}, comfortable 107 cm).`);
    else warn('Tight behind the desk', `Only ${cm(room)} behind the desk; you need ${cm(RULES.deskChairMin)} to pull the chair out.`);
  }

  // 4. Client table clearances + pendant height
  for (const t of F('meetingTable')) {
    const R = (t.diameter ?? 1.2) / 2;
    const g2 = gridWithout(plan, t);
    let minEdge = Infinity;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
      minEdge = Math.min(minEdge, rayClear(g2, add(t.at, [Math.sin(a) * R, Math.cos(a) * R]), [Math.sin(a), Math.cos(a)]));
    }
    if (minEdge >= RULES.tableChairClear - 0.02) ok('Table chair room', `${cm(minEdge)} from the table edge to the nearest obstacle (min ${cm(RULES.tableChairClear)}).`);
    else warn('Table too close', `Only ${cm(minEdge)} from table edge to obstacle; chairs need ${cm(RULES.tableChairClear)} to pull out.`);
    const seats = t.chairs ?? 4, perSeat = (Math.PI * 2 * R) / seats;
    if (perSeat < RULES.seatEdgeMin - 0.03) warn('Crowded table', `${seats} seats on a Ø${Math.round(R * 200)} cm table leaves ${cm(perSeat)} per person (aim ≥ 60 cm).`);
    const p = F('pendant').find((pp) => dist(pp.at, t.at) < 0.4);
    if (p) {
      const above = (p.height ?? 1.9) - 0.75;
      const [lo, hi] = pendantRange(RULES.pendantOverTable, plan.ceilingHeight);
      if (above >= lo - 0.03 && above <= hi + 0.03) ok('Pendant height', `Shade ${cm(above)} above the tabletop (target ${cm(lo)}–${cm(hi)} for a ${plan.ceilingHeight} m ceiling).`);
      else warn('Pendant height', `Shade is ${cm(above)} above the table; for a ${plan.ceilingHeight} m ceiling hang it ${cm(lo)}–${cm(hi)} above.`);
    }
  }

  // 5. Lounge: conversation distance, rug, reading light
  const chairs = F('clubChair');
  if (chairs.length >= 2) {
    const dd = dist(chairs[0].at, chairs[1].at);
    const [lo, hi] = RULES.conversation;
    if (dd >= lo && dd <= hi) ok('Conversation distance', `Lounge chairs ${dd.toFixed(1)} m apart — close enough to talk without raising voices.`);
    else warn('Conversation distance', `Lounge chairs are ${dd.toFixed(1)} m apart; ${lo}–${hi} m feels conversational.`);
  }
  const rug = F('rug')[0];
  if (rug && chairs.length) {
    const fp = footprint(rug);
    const on = chairs.filter((c) => {
      const front = add(c.at, mul(dirFromDeg(facingDeg(c.facing)), 0.3));
      return pointInPolygon(front[0], front[1], fp.pts);
    });
    if (on.length === chairs.length) ok('Rug anchors the lounge', 'At least the front legs of every lounge chair sit on the rug.');
    else warn('Rug too small', 'Lounge chairs should have at least their front legs on the rug.');
  }
  if (chairs.length) {
    const lamp = F('floorLamp').find((l) => chairs.some((c) => dist(l.at, c.at) < 1.2));
    if (lamp) ok('Reading light', 'Floor lamp beside the lounge chairs (warm 2700 K).');
    else info('Reading light', 'Add a floor lamp within reach of the lounge chairs.');
  }

  // 6. Lighting layers
  const floorA = Math.abs(plan.outline.reduce((a, p, i, o) => a + p[0] * o[(i + 1) % o.length][1] - o[(i + 1) % o.length][0] * p[1], 0)) / 2;
  const glazing = plan.openings.filter((o) => o.type === 'window').reduce((a, o) => a + o.width * (o.height ?? 1.5), 0);
  if (glazing < RULES.glazingMin * floorA) {
    const n = F('downlight').length;
    (n ? info : warn)('Little daylight', `Windows are ${Math.round((100 * glazing) / floorA)}% of the floor area (natural-light minimum 8%). ${n ? `${n} ceiling downlights give the general light — aim for 500 lx at the desk, 3000 K.` : 'Add ceiling downlights for general light (500 lx at the desk).'}`);
  }
  const ambient = F('pendant').length + F('downlight').length > 0, task = F('workstation').length > 0, accent = F('floorLamp').length + F('wallArt').length > 0;
  const layers = [ambient && 'ambient', task && 'task', accent && 'accent'].filter(Boolean);
  if (layers.length === 3) ok('Layered lighting', 'Ambient pendants, task lamp at the desk, accent floor lamp — all three layers.');
  else info('Lighting layers', `Has ${layers.join(', ') || 'none'}; designers layer ambient + task + accent.`);

  // 7. Art height
  for (const a of F('wallArt')) {
    const h = a.height ?? 1.6, [lo, hi] = RULES.artCenter;
    if (h >= lo && h <= hi) ok('Art height', `Art centred at ${cm(h)} — eye level (57–63″).`);
    else warn('Art height', `Art centre is ${cm(h)}; galleries hang at ${cm(lo)}–${cm(hi)}.`);
  }

  // 8. Greenery
  if (F('plant').length) ok('Greenery', `${F('plant').length} plants soften the hard industrial palette.`);

  // 9. Acoustics — Sabine estimate RT60 = 0.161·V / A (mid-frequency absorption coefficients)
  const rt = estimateRT60(plan, walls);
  const [lo, hi] = RULES.rt60;
  const has = (t) => plan.furniture.some((f) => f.type === t);
  if (rt <= hi + 0.05) ok('Acoustics', `Estimated echo time ${rt.toFixed(1)} s (target ${lo}–${hi} s) — good for client calls.`);
  else if (rt <= 0.95) info('Acoustics: lively', `Estimated echo time ${rt.toFixed(1)} s (target ${lo}–${hi} s). Workable; felt ceiling baffles or more upholstery would bring it to target.`);
  else warn('Echoey room', `Estimated echo time ${rt.toFixed(1)} s (target ${lo}–${hi} s). Brick, concrete and glass reflect sound: add ${[!has('acousticPanels') && 'felt panels on the wall you face', !has('curtains') && 'heavy curtains', 'a larger rug'].filter(Boolean).join(', ')}.`);

  return out;
}
