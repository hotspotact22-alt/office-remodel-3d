// Extra industrial-loft pieces, built procedurally with the same contract as furniture.js:
// builder(o, ctx) → Object3D at the origin, floor at y = 0, front facing +z.
// Wall items return a wrapper with userData.wallMounted; their back sits on the wall at z = 0.
import * as THREE from 'three';
import { box, rbox, cyl, rod, shadow, books, smallPlant, BUILDERS } from './furniture.js';
import { rng } from './materials.js';

const TAU = Math.PI * 2;

function wallItem(g, y) {
  g.position.y = y;
  const wrap = new THREE.Group(); wrap.add(g);
  wrap.userData.wallMounted = true;
  return wrap;
}

// Canvas for procedural textures; null where there is no DOM (tests, workers) → callers use a plain material.
function makeCanvas(w, h) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });   // kept in normal memory: a GPU reset wipes GPU canvases
  return x ? [c, x] : null;
}
function canvasTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
// Keyed material variants (sign text, board size) cached on M; the oldest is dropped past 12.
function cachedMat(M, bucket, key, make) {
  const c = (M[bucket] ??= new Map());
  if (!c.has(key)) {
    c.set(key, make());
    if (c.size > 12) { const [k, old] = c.entries().next().value; c.delete(k); old.map?.dispose(); old.dispose(); }
  }
  return c.get(key);
}

// Bar pull on two posts, standing off a front face at z = fz.
function barPull(g, mat, x, y, fz, len, vertical, off = 0.02, r = 0.006) {
  const z = fz + off, d = len / 2 - 0.015;
  g.add(rod(vertical ? [x, y - len / 2, z] : [x - len / 2, y, z], vertical ? [x, y + len / 2, z] : [x + len / 2, y, z], r, mat, 10));
  for (const s of [-1, 1]) {
    const px = vertical ? x : x + s * d, py = vertical ? y + s * d : y;
    g.add(rod([px, py, fz], [px, py, z], r * 0.7, mat, 8));
  }
}

function mug(M, mat = M.ceramic) {
  const g = new THREE.Group();
  g.add(cyl(0.04, 0.037, 0.095, mat, 0, 0.0475, 0, 16));
  const h = shadow(new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 6, 12, Math.PI), mat));
  h.rotation.z = -Math.PI / 2; h.position.set(0.04, 0.05, 0);
  g.add(h);
  return g;
}

// Glass storage jar with an oak lid; the contents fill most of it, so it still reads as a
// canister when the tracer hides M.glass in photo mode.
function jar(M, r, h, fill) {
  const g = new THREE.Group();
  g.add(cyl(r * 0.9, r * 0.9, h * 0.85, fill, 0, h * 0.425 + 0.004, 0, 16));
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), M.glass);
  glass.position.y = h / 2; glass.receiveShadow = true; glass.renderOrder = 2;
  g.add(glass);
  g.add(cyl(r * 1.04, r * 1.04, 0.025, M.wood, 0, h + 0.0125, 0, 20));
  return g;
}

const X = {};

// ── 1. Sofa ──────────────────────────────────────────────────────────────────
const SOFA_D = 0.92;
X.sofa = (o, { M }) => {
  const g = new THREE.Group();
  const W = o.width ?? 2.1, D = SOFA_D, seatH = 0.45, backH = 0.8;
  const legH = 0.14, rail = 0.03, base = legH + rail, deck = 0.33, armW = 0.16, armH = 0.62;
  const lx = W / 2 - 0.05, lz = D / 2 - 0.06;
  for (const x of W > 1.6 ? [-lx, 0, lx] : [-lx, lx]) for (const z of [-lz, lz]) g.add(box(0.03, legH, 0.03, M.steel, x, legH / 2, z));
  for (const z of [-lz, lz]) g.add(box(2 * lx + 0.03, rail, 0.03, M.steel, 0, legH + rail / 2, z));     // steel frame
  for (const x of [-lx, lx]) g.add(box(0.03, rail, 2 * lz - 0.03, M.steel, x, legH + rail / 2, 0));
  g.add(rbox(W, deck - base, D, 0.03, M.leather, 0, (base + deck) / 2, 0));                             // deck
  g.add(rbox(W, backH - base, 0.18, 0.05, M.leather, 0, (base + backH) / 2, -D / 2 + 0.09));           // back
  for (const s of [-1, 1]) g.add(rbox(armW, armH - base, D, 0.05, M.leather, s * (W / 2 - armW / 2), (base + armH) / 2, 0));
  const inner = W - 2 * armW;
  const backCush = rbox(inner - 0.01, 0.34, 0.12, 0.045, M.leather, 0, seatH + 0.17, -D / 2 + 0.23);  // tight back
  backCush.rotation.x = -0.1; g.add(backCush);
  const z0 = -D / 2 + 0.29, z1 = D / 2 - 0.01, cw = inner / 2 - 0.006;
  for (const s of [-1, 1]) g.add(rbox(cw, seatH - deck, z1 - z0, 0.04, M.leather, s * (cw / 2 + 0.003), (deck + seatH) / 2, (z0 + z1) / 2));
  const pillow = rbox(0.42, 0.38, 0.12, 0.05, M.wool, -W / 2 + armW + 0.3, seatH + 0.17, z0 + 0.07);
  pillow.rotation.set(-0.28, 0.25, 0.08); g.add(pillow);
  return g;
};

// ── 2. Conference table ──────────────────────────────────────────────────────
const CHAIR = [-0.23, -0.262, 0.23, 0.23];     // BUILDERS.meetingChair footprint, local (front +z)
const CHAIR_GAP = 0.18;                         // chair centre beyond the table edge (seat tucks 5 cm under)
function conferenceSeats(o) {
  const L = o.length ?? 2.4, Wd = o.width ?? 1.05, n = Math.max(0, Math.round(o.chairs ?? 6));
  const ends = n >= 8 ? 2 : 0, front = Math.ceil((n - ends) / 2), back = n - ends - front;
  const seats = [];
  const row = (k, z, rot) => { for (let i = 0; i < k; i++) seats.push([-L / 2 + ((i + 0.5) * L) / k, z, rot]); };
  row(front, Wd / 2 + CHAIR_GAP, Math.PI);
  row(back, -Wd / 2 - CHAIR_GAP, 0);
  if (ends) seats.push([L / 2 + CHAIR_GAP, 0, -Math.PI / 2], [-L / 2 - CHAIR_GAP, 0, Math.PI / 2]);
  return { L, Wd, seats };
}
function conferenceRect(o) {
  const { L, Wd, seats } = conferenceSeats(o);
  let x0 = -L / 2, z0 = -Wd / 2, x1 = L / 2, z1 = Wd / 2;
  for (const [cx, cz, rot] of seats) {
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const lx of [CHAIR[0], CHAIR[2]]) for (const lz of [CHAIR[1], CHAIR[3]]) {
      const wx = cx + lx * c + lz * s, wz = cz - lx * s + lz * c;
      x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
    }
  }
  return [x0, z0, x1, z1];
}
X.conferenceTable = (o, ctx) => {
  const { M } = ctx, g = new THREE.Group();
  const { L, Wd, seats } = conferenceSeats(o), Ht = 0.75, tt = 0.06, under = Ht - tt;
  g.add(box(L, tt, Wd, M.wood, 0, Ht - tt / 2, 0, true));
  const lx = Math.max(0.15, L / 2 - 0.3), zr = Wd / 2 - 0.06;
  for (const s of [-1, 1]) {                                     // closed U-frame legs, 8 × 4 cm flat bar
    g.add(box(0.08, 0.04, 2 * zr, M.steel, s * lx, 0.02, 0));
    g.add(box(0.08, 0.04, 2 * zr, M.steel, s * lx, under - 0.02, 0));
    for (const z of [-1, 1]) g.add(box(0.08, under - 0.08, 0.04, M.steel, s * lx, under / 2, z * (zr - 0.02)));
  }
  g.add(box(2 * lx, 0.05, 0.05, M.steel, 0, under - 0.025, 0));          // spine
  g.add(box(0.26, 0.004, 0.09, M.brass, 0, Ht + 0.002, 0));              // power / data grommet
  g.add(box(0.22, 0.002, 0.05, M.steel, 0, Ht + 0.005, 0));
  g.add(cyl(0.16, 0.1, 0.07, M.potConcrete, L / 4, Ht + 0.035, 0.05, 32)); // concrete bowl
  for (const [x, z, rot] of seats) {
    const c = BUILDERS.meetingChair(o, ctx);
    c.position.set(x, 0, z); c.rotation.y = rot;
    g.add(c);
  }
  return g;
};

// ── 3. Coffee bar / kitchenette ──────────────────────────────────────────────
const BAR_D = 0.62;
X.coffeeBar = (o, ctx) => {
  const { M } = ctx, g = new THREE.Group(), rand = rng(31);
  const W = o.width ?? 2.4, D = BAR_D, top = 0.92, ct = 0.05, under = top - ct, kick = 0.1;
  const back = -D / 2, face = D / 2 - 0.055, fT = 0.018, gap = 0.004;
  const n = Math.max(2, Math.round(W / 0.6)), mw = W / n;
  const sinkI = n >= 3 ? 1 : 0, sinkX = -W / 2 + (sinkI + 0.5) * mw, machI = n - 1, machX = W / 2 - mw / 2;
  const sw = Math.min(0.42, mw - 0.1), sd = 0.36, sz = 0, bowl = 0.18, wt = 0.008;
  const bowlBot = under - bowl - wt, sx0 = sinkX - sw / 2, sx1 = sinkX + sw / 2;
  const cd = face - back, cz = (face + back) / 2;

  // Carcass: recessed steel plinth, charcoal box with a pocket for the sink bowl.
  g.add(box(W - 0.02, kick, cd - 0.06, M.steel, 0, kick / 2, back + (cd - 0.06) / 2));
  g.add(box(W, bowlBot - kick, cd, M.charcoal, 0, (kick + bowlBot) / 2, cz));
  const lw = sx0 - wt + W / 2, rw = W / 2 - sx1 - wt, hU = under - bowlBot, yU = (under + bowlBot) / 2;
  g.add(box(lw, hU, cd, M.charcoal, -W / 2 + lw / 2, yU, cz));
  g.add(box(rw, hU, cd, M.charcoal, W / 2 - rw / 2, yU, cz));

  // Fronts: doors, plus a three-drawer stack under the espresso machine; brass bar pulls.
  const fy0 = kick + 0.003, fy1 = under - 0.003, fz = face + fT / 2, pz = face + fT;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + (i + 0.5) * mw, w = mw - gap;
    if (i === machI && n >= 3) {
      const rest = (fy1 - fy0 - 0.2 - 2 * gap) / 2;
      let y = fy1;
      for (const h of [0.2, rest, rest]) {
        g.add(box(w, h, fT, M.charcoal, x, y - h / 2, fz));
        barPull(g, M.brass, x, y - Math.min(h / 2, 0.08), pz, 0.22, false);
        y -= h + gap;
      }
    } else {
      g.add(box(w, fy1 - fy0, fT, M.charcoal, x, (fy0 + fy1) / 2, fz));
      barPull(g, M.brass, x + (i % 2 === 0 ? 1 : -1) * (w / 2 - 0.045), fy1 - 0.14, pz, 0.16, true);
    }
  }

  // Concrete countertop, cut around the undermount sink (metric UVs keep the pieces seamless).
  const slab = (x0, x1, z0, z1) => g.add(box(x1 - x0, ct, z1 - z0, M.concrete, (x0 + x1) / 2, top - ct / 2, (z0 + z1) / 2, true));
  slab(-W / 2, sx0, -D / 2, D / 2); slab(sx1, W / 2, -D / 2, D / 2);
  slab(sx0, sx1, sz + sd / 2, D / 2); slab(sx0, sx1, -D / 2, sz - sd / 2);
  g.add(box(sw + 2 * wt, wt, sd + 2 * wt, M.galvanized, sinkX, bowlBot + wt / 2, sz));          // stainless bowl
  for (const s of [-1, 1]) {
    g.add(box(wt, bowl, sd + 2 * wt, M.galvanized, sinkX + s * (sw / 2 + wt / 2), under - bowl / 2, sz));
    g.add(box(sw, bowl, wt, M.galvanized, sinkX, under - bowl / 2, sz + s * (sd / 2 + wt / 2)));
  }
  g.add(cyl(0.035, 0.035, 0.004, M.steel, sinkX, bowlBot + wt + 0.002, sz + 0.06, 20));          // drain

  // Brass gooseneck faucet.
  const tz = sz - sd / 2 - 0.06, R = 0.085, rise = 0.3;
  g.add(cyl(0.026, 0.03, 0.03, M.brass, sinkX, top + 0.015, tz, 20));
  g.add(rod([sinkX, top, tz], [sinkX, top + rise, tz], 0.012, M.brass));
  const neck = shadow(new THREE.Mesh(new THREE.TorusGeometry(R, 0.012, 8, 20, Math.PI), M.brass));
  neck.rotation.y = Math.PI / 2; neck.position.set(sinkX, top + rise, tz + R);
  g.add(neck);
  g.add(rod([sinkX, top + rise, tz + 2 * R], [sinkX, top + rise - 0.06, tz + 2 * R], 0.012, M.brass));
  g.add(rod([sinkX + 0.02, top + 0.07, tz], [sinkX + 0.09, top + 0.085, tz], 0.006, M.brass));      // lever

  // Espresso machine.
  const em = new THREE.Group();
  em.add(box(0.36, 0.035, 0.44, M.steel, 0, 0.0175, 0));
  em.add(box(0.34, 0.33, 0.3, M.galvanized, 0, 0.2, -0.07));
  em.add(box(0.35, 0.015, 0.31, M.steel, 0, 0.3725, -0.07));                   // cup-warmer lid
  em.add(box(0.09, 0.055, 0.05, M.galvanized, 0, 0.27, 0.105));                // group neck
  em.add(cyl(0.038, 0.034, 0.04, M.galvanized, 0, 0.225, 0.11, 20));           // group head
  em.add(cyl(0.04, 0.035, 0.028, M.steel, 0, 0.191, 0.11, 20));                // portafilter
  em.add(rod([0, 0.19, 0.14], [0, 0.18, 0.26], 0.012, M.wood));                // oak handle
  em.add(box(0.28, 0.02, 0.13, M.steel, 0, 0.045, 0.145));                     // drip tray
  em.add(cyl(0.028, 0.022, 0.05, M.ceramic, 0.04, 0.08, 0.13, 16));            // espresso cup
  const gauge = cyl(0.032, 0.032, 0.012, M.brass, -0.1, 0.29, 0.086, 24);
  gauge.rotation.x = Math.PI / 2; em.add(gauge);
  const dial = shadow(new THREE.Mesh(new THREE.CircleGeometry(0.026, 24), M.paper));
  dial.position.set(-0.1, 0.29, 0.0925); em.add(dial);
  em.add(rod([0.13, 0.25, 0.085], [0.15, 0.1, 0.13], 0.005, M.galvanized, 8));  // steam wand
  for (const [x, z] of [[-0.09, -0.12], [0, -0.02], [0.09, -0.13]]) em.add(cyl(0.03, 0.024, 0.05, M.ceramic, x, 0.405, z, 16));
  em.position.set(machX, top, -0.06);
  g.add(em);

  // Oak tray of mugs on the free counter between sink and machine.
  const gx0 = sx1 + 0.06, gx1 = machX - 0.22;
  if (gx1 - gx0 > 0.36) {
    const tx = (gx0 + gx1) / 2;
    g.add(box(0.34, 0.015, 0.2, M.wood, tx, top + 0.0075, -0.12, true));
    [-0.1, 0, 0.1].forEach((dx, i) => {
      const m = mug(M, i === 1 ? M.charcoal : M.ceramic);
      m.position.set(tx + dx - 0.01, top + 0.015, -0.13 + (i % 2) * 0.04); m.rotation.y = -Math.PI / 2 + (rand() - 0.5);
      g.add(m);
    });
  }

  // Two open oak shelves on flat-bar brackets, with mugs, jars, plates and a plant.
  const Ws = W - 0.1, sdp = 0.26, szc = back + sdp / 2, st = 0.04;
  const bxs = W > 1.6 ? [-Ws / 2 + 0.2, 0, Ws / 2 - 0.2] : [-Ws / 2 + 0.15, Ws / 2 - 0.15];
  const fills = [M.leatherDark, M.paper, M.wood, M.soil];
  for (const [y, odds] of [[1.5, [0.5, 0.8, 0.9]], [1.9, [0.25, 0.6, 0.8]]]) {
    g.add(box(Ws, st, sdp, M.wood, 0, y, szc, true));
    const yb = y + st / 2, yu = y - st / 2;
    for (const x of bxs) {
      g.add(box(0.03, 0.15, 0.006, M.steel, x, yu - 0.075, back + 0.003));
      g.add(box(0.03, 0.006, sdp - 0.03, M.steel, x, yu - 0.003, back + 0.006 + (sdp - 0.03) / 2));
      g.add(rod([x, yu - 0.14, back + 0.006], [x, yu - 0.006, back + 0.17], 0.005, M.steel, 8));
    }
    let x = -Ws / 2 + 0.06;
    const xEnd = Ws / 2 - 0.05;
    while (xEnd - x > 0.12) {
      const p = rand();
      if (p < odds[0]) {
        const k = Math.min(2 + Math.floor(rand() * 3), Math.floor((xEnd - x) / 0.105));
        for (let i = 0; i < k; i++) {
          const m = mug(M, rand() > 0.7 ? M.charcoal : M.ceramic);
          m.position.set(x + 0.045 + i * 0.105, yb, szc + 0.02); m.rotation.y = -Math.PI / 2 + (rand() - 0.5) * 0.8;
          g.add(m);
        }
        x += k * 0.105 + 0.06;
      } else if (p < odds[1]) {
        const k = Math.min(2 + Math.floor(rand() * 2), Math.floor((xEnd - x) / 0.12));
        for (let i = 0; i < k; i++) {
          const j = jar(M, 0.05, 0.14 + rand() * 0.07, fills[Math.floor(rand() * fills.length)]);
          j.position.set(x + 0.055 + i * 0.12, yb, szc); g.add(j);
        }
        x += k * 0.12 + 0.06;
      } else if (p < odds[2] && xEnd - x > 0.26) {
        for (let i = 0; i < 4; i++) g.add(cyl(0.11, 0.1, 0.012, M.ceramic, x + 0.12, yb + 0.006 + i * 0.014, szc, 28));
        x += 0.3;
      } else if (xEnd - x > 0.26) {
        const pl = smallPlant(M, rand, 0.9); pl.position.set(x + 0.11, yb, szc); g.add(pl);
        x += 0.28;
      } else x += 0.08;
    }
  }
  return g;
};

// ── 4. Credenza ──────────────────────────────────────────────────────────────
const CRED_D = 0.45;
X.credenza = (o, ctx) => {
  const { M } = ctx, g = new THREE.Group(), rand = rng(23);
  const W = o.width ?? 1.8, D = CRED_D, H = 0.7, legH = 0.2, tt = 0.035;
  const lx = W / 2 - 0.04, lz = D / 2 - 0.04;
  for (const x of W > 1.4 ? [-lx, 0, lx] : [-lx, lx]) for (const z of [-lz, lz]) g.add(box(0.035, legH, 0.035, M.steel, x, legH / 2, z));
  for (const z of [-lz, lz]) g.add(box(2 * lx + 0.035, 0.03, 0.035, M.steel, 0, legH - 0.015, z));
  for (const x of [-lx, lx]) g.add(box(0.035, 0.03, 2 * lz - 0.035, M.steel, x, legH - 0.015, 0));
  const back = -D / 2 + 0.01, face = D / 2 - 0.04, bodyH = H - tt - legH, yc = legH + bodyH / 2;
  g.add(box(W - 0.02, bodyH, face - back, M.charcoal, 0, yc, (back + face) / 2));
  g.add(box(W, tt, D, M.wood, 0, H - tt / 2, 0, true));
  const n = 2 * Math.max(1, Math.round(W / 0.9)), dw = (W - 0.02) / n;     // door pairs, pulls at the meeting edges
  for (let i = 0; i < n; i++) {
    const x = -(W - 0.02) / 2 + (i + 0.5) * dw;
    g.add(box(dw - 0.004, bodyH - 0.012, 0.018, M.wood, x, yc, face + 0.009, true));
    barPull(g, M.steel, x + (i % 2 === 0 ? 1 : -1) * (dw / 2 - 0.035), yc + 0.04, face + 0.018, 0.14, true, 0.015);
  }
  const stack = new THREE.Group();                                          // styling on top
  for (let k = 0; k < 3; k++) {
    const b = box(0.26 - k * 0.025, 0.035, 0.19 - k * 0.01, M.bookColors[(k * 3 + 1) % 8], 0, 0.0175 + k * 0.036, 0);
    b.rotation.y = (rand() - 0.5) * 0.25; stack.add(b);
  }
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), M.brass);
  orb.position.y = 0.148; stack.add(shadow(orb));
  stack.position.set(-W / 2 + 0.3, H, 0.02);
  g.add(stack);
  const vx = W / 2 - 0.13;                                                    // at the end, clear of a TV hung above
  g.add(cyl(0.06, 0.075, 0.26, M.ceramic, vx, H + 0.13, -0.03, 24));
  for (let i = 0; i < 3; i++) g.add(rod([vx, H + 0.2, -0.03], [vx + (i - 1) * 0.045, H + 0.5 + i * 0.03, -0.03 + (i % 2) * 0.05], 0.003, M.leafDark, 6));
  return g;
};

// ── 5. Wall TV (65″) ─────────────────────────────────────────────────────────
const TV = { w: 1.45, h: 0.84, gap: 0.035, t: 0.028 };
function tvScreenMat(M) {
  if (M.__tvScreen) return M.__tvScreen;
  const cv = makeCanvas(1024, 594);
  if (!cv) return (M.__tvScreen = M.screen);
  const [c, x] = cv;
  const lin = x.createLinearGradient(0, 0, c.width, c.height);
  lin.addColorStop(0, '#07090d'); lin.addColorStop(0.55, '#131a24'); lin.addColorStop(1, '#090b10');
  x.fillStyle = lin; x.fillRect(0, 0, c.width, c.height);
  const rad = x.createRadialGradient(c.width / 2, c.height * 0.45, 10, c.width / 2, c.height * 0.45, c.width * 0.5);
  rad.addColorStop(0, 'rgba(176,141,87,0.16)'); rad.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = rad; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = 'rgba(232,225,212,0.9)';
  x.font = '600 44px "Helvetica Neue", Helvetica, Arial, sans-serif';
  if ('letterSpacing' in x) x.letterSpacing = '14px';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('WELCOME', c.width / 2, c.height / 2);
  x.fillStyle = 'rgba(176,141,87,0.8)'; x.fillRect(c.width / 2 - 50, c.height / 2 + 36, 100, 2);
  const tex = canvasTex(c);
  return (M.__tvScreen = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.6, roughness: 0.2 }));
}
X.tv = (o, { M }) => {
  const g = new THREE.Group(), { w, h, gap, t } = TV;
  g.add(box(0.42, 0.3, gap, M.steel, 0, 0, gap / 2));                    // wall bracket
  g.add(box(w, h, t, M.steel, 0, 0, gap + t / 2));                       // panel; 8 mm bezel shows round the screen
  const scr = shadow(new THREE.Mesh(new THREE.PlaneGeometry(w - 0.016, h - 0.016), tvScreenMat(M)));
  scr.position.z = gap + t + 0.0005;
  g.add(scr);
  return wallItem(g, o.height ?? 1.3);
};

// ── 6. Whiteboard ────────────────────────────────────────────────────────────
const WB = { h: 1.2, tray: 0.07 };
function whiteboardMat(M, W, H) {
  return cachedMat(M, '__whiteboards', `${W.toFixed(2)}x${H.toFixed(2)}`, () => {
    const cv = makeCanvas(1024, Math.max(128, Math.round((1024 * H) / W)));
    if (!cv) return new THREE.MeshStandardMaterial({ color: '#f3f3ef', roughness: 0.16 });
    const [c, x] = cv, rand = rng(77), u = c.height / 100, Wu = c.width / u;   // drawing unit = 1 % of board height
    x.fillStyle = '#f4f4f0'; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 12; i++) {                                              // ghosting from old sessions
      x.fillStyle = `rgba(110,120,140,${0.025 + rand() * 0.035})`;
      x.beginPath(); x.ellipse(rand() * c.width, rand() * c.height, (6 + rand() * 18) * u, (1.5 + rand() * 4) * u, rand() * Math.PI, 0, TAU); x.fill();
    }
    x.lineCap = x.lineJoin = 'round';
    const stroke = (ax, ay, bx, by, col, lw = 0.9) => {                         // wobbly marker line
      const len = Math.hypot(bx - ax, by - ay) || 1, k = Math.max(2, Math.round(len / 4)), nx = -(by - ay) / len, ny = (bx - ax) / len;
      x.strokeStyle = col; x.lineWidth = lw * u; x.beginPath();
      for (let i = 0; i <= k; i++) {
        const t = i / k, j = i === 0 || i === k ? 0 : (rand() - 0.5) * 0.5;
        x[i ? 'lineTo' : 'moveTo']((ax + (bx - ax) * t + nx * j) * u, (ay + (by - ay) * t + ny * j) * u);
      }
      x.stroke();
    };
    const rect = (x0, y0, w, h, col) => {                                       // sides overshoot like a quick sketch
      stroke(x0 - 0.8, y0, x0 + w + 0.4, y0 + 0.4, col);
      stroke(x0 + w, y0 - 0.4, x0 + w - 0.3, y0 + h + 0.8, col);
      stroke(x0 + w + 0.3, y0 + h, x0 - 0.5, y0 + h - 0.3, col);
      stroke(x0, y0 + h + 0.3, x0 + 0.3, y0 - 0.6, col);
    };
    const arrow = (ax, ay, bx, by, col) => {
      stroke(ax, ay, bx, by, col);
      const a = Math.atan2(by - ay, bx - ax);
      for (const s of [-1, 1]) stroke(bx, by, bx - 3 * Math.cos(a + s * 0.45), by - 3 * Math.sin(a + s * 0.45), col);
    };
    const write = (txt, px, py, col, size, align = 'left') => {
      x.fillStyle = col; x.font = `${size * u}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`;
      x.textAlign = align; x.textBaseline = 'middle'; x.fillText(txt, px * u, py * u);
      return x.measureText(txt).width / u;
    };
    const BLUE = '#1f4e9c', BLACK = '#222326', RED = '#b42a22', GREEN = '#2f7a3b';
    const tw = write('Client journey', 6, 12, BLACK, 7);
    stroke(5, 17.5, 7 + tw, 17, BLACK, 0.7);
    const bw = Math.min(30, (Wu - 24) / 3.2), gx = (Wu - 12 - 3 * bw) / 2, y0 = 30, bh = 18;
    ['ENQUIRY', 'DESIGN', 'BUILD'].forEach((nm, i) => {
      const bx0 = 6 + i * (bw + gx), col = i === 2 ? RED : BLUE;
      rect(bx0, y0, bw, bh, col);
      write(nm, bx0 + bw / 2, y0 + bh / 2, col, Math.min(5.5, bw / 5.5), 'center');
      if (i < 2) arrow(bx0 + bw + 1.5, y0 + bh / 2, bx0 + bw + gx - 1.5, y0 + bh / 2 + 0.5, BLACK);
    });
    const mx = 6 + bw + gx + bw / 2;
    arrow(mx, y0 + bh + 1.5, mx + 8, y0 + bh + 12, BLACK);
    x.strokeStyle = RED; x.lineWidth = 0.9 * u;
    x.beginPath(); x.ellipse((mx + 12) * u, (y0 + bh + 20) * u, 13 * u, 6 * u, -0.05, 0.3, 0.3 + TAU * 0.96); x.stroke();
    write('budget?', mx + 12, y0 + bh + 20, RED, 5, 'center');
    ['– brick backdrop', '– 4 seats + lounge', '– warm 2700 K'].forEach((s, i) => write(s, 6, 64 + i * 9, GREEN, 4.5));
    return new THREE.MeshStandardMaterial({ map: canvasTex(c), roughness: 0.16 });
  });
}
X.whiteboard = (o, { M }) => {
  const g = new THREE.Group();
  const W = o.width ?? 1.8, Hb = WB.h, fw = 0.02, fd = 0.024;
  g.add(box(W - 0.01, Hb - 0.01, 0.016, M.paper, 0, 0, 0.008));                         // board
  const face = shadow(new THREE.Mesh(new THREE.PlaneGeometry(W - 2 * fw + 0.004, Hb - 2 * fw + 0.004), whiteboardMat(M, W - 2 * fw, Hb - 2 * fw)));
  face.position.z = 0.0165; g.add(face);
  for (const s of [-1, 1]) {                                                             // aluminium frame + corner caps
    g.add(box(W, fw, fd, M.galvanized, 0, s * (Hb / 2 - fw / 2), fd / 2));
    g.add(box(fw, Hb - 2 * fw, fd, M.galvanized, s * (W / 2 - fw / 2), 0, fd / 2));
    for (const t of [-1, 1]) g.add(box(0.032, 0.032, fd + 0.002, M.steel, s * (W / 2 - 0.016), t * (Hb / 2 - 0.016), fd / 2 + 0.001));
  }
  const tw = Math.min(W * 0.55, 0.9), ty = -Hb / 2 - 0.045, td = WB.tray;               // marker tray
  g.add(box(tw, 0.004, td, M.galvanized, 0, ty, td / 2));
  g.add(box(tw, 0.022, 0.004, M.galvanized, 0, ty + 0.009, td - 0.002));
  g.add(box(tw, 0.05, 0.004, M.galvanized, 0, ty + 0.023, 0.002));
  for (const s of [-1, 1]) g.add(box(0.004, 0.022, td, M.galvanized, s * (tw / 2 - 0.002), ty + 0.009, td / 2));
  [[M.bookColors[1], 0.024, -0.14], [M.bookColors[0], 0.048, -0.02]].forEach(([capMat, z, x0]) => {
    const body = cyl(0.009, 0.009, 0.1, M.paper, x0, ty + 0.0115, z, 12); body.rotation.z = Math.PI / 2; g.add(body);
    const cap = cyl(0.0095, 0.0095, 0.035, capMat, x0 + 0.065, ty + 0.0115, z, 12); cap.rotation.z = Math.PI / 2; g.add(cap);
  });
  g.add(box(0.12, 0.008, 0.045, M.felt, tw / 2 - 0.12, ty + 0.006, td / 2));             // eraser
  g.add(box(0.12, 0.022, 0.045, M.wood, tw / 2 - 0.12, ty + 0.021, td / 2));
  return wallItem(g, o.height ?? 1.45);
};

// ── 7. Glass partition (Crittall style) ──────────────────────────────────────
// Optional glass door: door = opening width (m), doorAt = distance from the left end to the door's
// left edge (default: centred). The door leaf is drawn closed; walkways treat the opening as open.
function partitionDoor(o) {
  const W = o.width ?? 2.0, dw = Math.min(o.door ?? 0, W - 0.3);
  if (!(dw >= 0.6)) return null;
  const a = Math.max(0.15, Math.min(o.doorAt ?? (W - dw) / 2, W - dw - 0.15)) - W / 2;
  return [a, a + dw];   // local x range of the opening
}
X.glassPartition = (o, { M }) => {
  const g = new THREE.Group();
  const W = o.width ?? 2.0, Hp = o.panelHeight ?? 2.2, f = 0.04, fd = 0.045, m = 0.022, md = 0.035, ch = 0.03;
  const door = partitionDoor(o);
  const y0 = ch + f + 0.02, y1 = Hp - f, rows = Math.max(1, Math.round((y1 - y0) / 0.55));
  // Optional frosted privacy band (frostFrom → frostTo metres above the floor) on all the glass.
  const frost = o.frostTo > (o.frostFrom ?? 0) ? [o.frostFrom ?? 0, o.frostTo] : null;
  if (frost && !M.frosted) {
    M.frosted = new THREE.MeshStandardMaterial({ color: '#f6f8f9', emissive: '#ffffff', emissiveIntensity: 0.06, roughness: 1, metalness: 0, transparent: true, opacity: 0.93 });
    M.frosted.userData.frosted = true;
  }
  const pane = (w, h, x, y, d = 0.008) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.glass);
    p.position.set(x, y, 0); p.receiveShadow = true; p.renderOrder = 2;   // like room glazing: no shadow
    g.add(p);
    const a = frost && Math.max(frost[0], y - h / 2), b = frost && Math.min(frost[1], y + h / 2);
    if (frost && b > a) {
      const f2 = new THREE.Mesh(new THREE.BoxGeometry(w, b - a, d + 0.004), M.frosted);
      f2.position.set(x, (a + b) / 2, 0); f2.receiveShadow = true; f2.renderOrder = 3;
      g.add(f2);
    }
  };
  // fixed glazing with its mullion grid between xa and xb (frame posts at both ends)
  const fixed = (xa, xb) => {
    g.add(box(xb - xa, ch, 0.1, M.steel, (xa + xb) / 2, ch / 2, 0));                     // floor channel
    g.add(box(xb - xa, f + 0.02, fd, M.steel, (xa + xb) / 2, ch + (f + 0.02) / 2, 0));   // deeper bottom rail
    for (const x of [xa + f / 2, xb - f / 2]) g.add(box(f, Hp - ch, fd, M.steel, x, ch + (Hp - ch) / 2, 0));
    const x0 = xa + f, x1 = xb - f, cols = Math.max(1, Math.round((x1 - x0) / 0.5));
    for (let i = 1; i < cols; i++) g.add(box(m, y1 - y0, md, M.steel, x0 + ((x1 - x0) * i) / cols, (y0 + y1) / 2, 0));
    for (let j = 1; j < rows; j++) g.add(box(x1 - x0, m, md, M.steel, (x0 + x1) / 2, y0 + ((y1 - y0) * j) / rows, 0));
    pane(x1 - x0 + 0.01, y1 - y0 + 0.01, (x0 + x1) / 2, (y0 + y1) / 2);
  };
  g.add(box(W, f, fd, M.steel, 0, Hp - f / 2, 0));                                       // head
  if (!door) { fixed(-W / 2, W / 2); return g; }
  const [da, db] = door;
  fixed(-W / 2, da); fixed(db, W / 2);
  // door leaf: slim steel frame, one sheet of glass, a mid rail and a long bar pull on both faces
  const lx0 = da + 0.012, lx1 = db - 0.012, top = Hp - f - 0.005, bot = 0.012, s = 0.035, cx = (lx0 + lx1) / 2;
  for (const x of [lx0 + s / 2, lx1 - s / 2]) g.add(box(s, top - bot, 0.04, M.steel, x, (top + bot) / 2, 0));
  g.add(box(lx1 - lx0, s, 0.04, M.steel, cx, top - s / 2, 0));
  g.add(box(lx1 - lx0, s * 2, 0.04, M.steel, cx, bot + s, 0));
  // rail and pull at hand height, kept inside a low leaf
  const hy = Math.min(1.05, (top + bot) / 2), bl = Math.min(0.9, (top - bot) * 0.6);
  g.add(box(lx1 - lx0, s * 0.6, 0.03, M.steel, cx, hy - 0.05, 0));
  pane(lx1 - lx0 - 2 * s + 0.01, top - bot - 3 * s + 0.01, cx, (top + bot + s) / 2, 0.01);
  for (const z of [-1, 1]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, bl, 12), M.brass);
    bar.position.set(lx0 + 0.09, hy, z * 0.055); bar.castShadow = true; g.add(bar);
    for (const y of [hy - bl / 2 + 0.05, hy + bl / 2 - 0.05]) g.add(box(0.02, 0.02, 0.035, M.brass, lx0 + 0.09, y, z * 0.037));
  }
  return g;
};

// ── 8. Floating wall shelves ─────────────────────────────────────────────────
const WSHELF_D = 0.25;
X.wallShelf = (o, ctx) => {
  const { M } = ctx, g = new THREE.Group(), rand = rng(13);
  const W = o.width ?? 1.2, D = WSHELF_D, t = 0.04, gap = 0.36, ys = [-gap, 0, gap];
  const bx = W / 2 - Math.min(0.2, W * 0.2), yLo = -gap - t / 2 - 0.08, yHi = gap - t / 2;
  for (const s of [-1, 1]) {                                                             // flat-bar wall straps + arms
    g.add(box(0.03, yHi - yLo, 0.006, M.steel, s * bx, (yLo + yHi) / 2, 0.003));
    for (const y of ys) g.add(box(0.03, 0.006, D - 0.03, M.steel, s * bx, y - t / 2 - 0.003, 0.006 + (D - 0.03) / 2));
  }
  const zc = D / 2 + 0.005;
  ys.forEach((y, i) => {
    g.add(box(W, t, D, M.wood, 0, y, D / 2, true));
    const yb = y + t / 2;
    if (i === 0) {
      const bk = books(M, rand, W * 0.4, 0.26); bk.position.set(-W / 2 + 0.05, yb, zc); g.add(bk);
      const pl = smallPlant(M, rand, 0.85); pl.position.set(W / 2 - 0.15, yb, zc); g.add(pl);
    } else if (i === 1) {
      for (let k = 0; k < 3; k++) {
        const b = box(0.22 - k * 0.02, 0.03, 0.16 - k * 0.01, M.bookColors[(k + 5) % 8], -W / 2 + 0.17, yb + 0.015 + k * 0.03, zc);
        b.rotation.y = (rand() - 0.5) * 0.2; g.add(b);
      }
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), M.brass);
      orb.position.set(-W / 2 + 0.17, yb + 0.125, zc); g.add(shadow(orb));
      const run = Math.min(W * 0.35, W - 0.55);
      if (run > 0.05) { const bk = books(M, rand, run, 0.25); bk.position.set(-W / 2 + 0.33, yb, zc); g.add(bk); }
      if (W >= 0.9) g.add(cyl(0.05, 0.065, 0.2, M.ceramic, W / 2 - 0.12, yb + 0.1, zc, 20));
    } else {
      const pl = smallPlant(M, rand, 0.85); pl.position.set(-W / 2 + 0.15, yb, zc); g.add(pl);
      const bk = books(M, rand, W * 0.4, 0.24); bk.position.set(W / 2 - 0.05 - W * 0.4, yb, zc); g.add(bk);
    }
  });
  return wallItem(g, o.height ?? 1.5);
};

// ── 9. Lateral filing cabinet ────────────────────────────────────────────────
const FILE = { W: 0.9, D: 0.5, H: 1.0 };
X.filingCabinet = (o, ctx) => {
  const { M } = ctx, g = new THREE.Group(), rand = rng(5);
  const { W, D, H } = FILE, kick = 0.05, back = -D / 2, face = D / 2 - 0.035, fT = 0.018, gap = 0.006;
  g.add(box(W - 0.04, kick, face - back - 0.04, M.steel, 0, kick / 2, back + (face - back - 0.04) / 2));   // recessed plinth
  g.add(box(W, H - kick, face - back, M.steel, 0, kick + (H - kick) / 2, (back + face) / 2));
  const fy0 = kick + gap, fy1 = H - 0.02, dh = (fy1 - fy0 - 2 * gap) / 3, fz = face + fT;
  for (let i = 0; i < 3; i++) {
    const y = fy1 - dh / 2 - i * (dh + gap);
    g.add(box(W - 0.02, dh, fT, M.steel, 0, y, face + fT / 2));
    barPull(g, M.brass, 0, y + 0.01, fz, 0.32, false, 0.012, 0.005);
    g.add(box(0.1, 0.045, 0.003, M.brass, 0, y + 0.075, fz + 0.0015));                     // label holder + card
    g.add(box(0.086, 0.032, 0.002, M.paper, 0, y + 0.075, fz + 0.004));
  }
  const lock = cyl(0.011, 0.011, 0.008, M.brass, W / 2 - 0.07, fy1 - 0.04, fz + 0.004, 16);
  lock.rotation.x = Math.PI / 2; g.add(lock);
  for (let k = 0; k < 3; k++) {                                                             // folders on top
    const b = box(0.32, 0.025, 0.24, M.bookColors[[1, 2, 4][k]], -0.17, H + 0.0125 + k * 0.026, -0.02);
    b.rotation.y = (rand() - 0.5) * 0.2; g.add(b);
  }
  const pl = smallPlant(M, rand, 1.1); pl.position.set(0.26, H, 0); g.add(pl);
  return g;
};

// ── 10. Illuminated wall sign ────────────────────────────────────────────────
function signMat(M, text) {
  return cachedMat(M, '__signs', text, () => {
    const cv = makeCanvas(1024, 256);
    if (!cv) return new THREE.MeshStandardMaterial({ color: '#ffd9a0', emissive: '#ffd9a0', emissiveIntensity: 1.6 });
    const [c, x] = cv, font = (s) => `900 ${s}px "Arial Black", "Helvetica Neue", Helvetica, Arial, sans-serif`;
    let size = 150;
    x.font = font(size);
    const w = x.measureText(text).width;
    if (w > c.width * 0.92) size = Math.floor((size * c.width * 0.92) / w);
    x.font = font(size); x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#ffffff'; x.fillText(text, c.width / 2, c.height / 2 + size * 0.04);   // white letters, clear background
    const tex = canvasTex(c);
    // Cut-out letters: alphaMap + alphaTest (no blending); the map carries the same alpha for the path tracer.
    return new THREE.MeshStandardMaterial({ color: '#ffd9a0', map: tex, alphaMap: tex, alphaTest: 0.5, emissive: '#ffd9a0', emissiveIntensity: 1.6, roughness: 0.6 });
  });
}
const SIGN_Z = 0.028;
X.wallSign = (o, { M }) => {
  const g = new THREE.Group();
  const W = o.width ?? 1.6, Hs = W / 4, text = String(o.text ?? 'YOUR LOGO');
  g.add(box(W * 0.96, Math.max(0.035, Hs * 0.14), 0.016, M.steel, 0, 0, 0.008));         // steel backer bar
  const letters = shadow(new THREE.Mesh(new THREE.PlaneGeometry(W, Hs), signMat(M, text)));
  letters.position.z = SIGN_Z;
  g.add(letters);
  return wallItem(g, o.height ?? 1.8);
};

// ── 11. Round mirror ─────────────────────────────────────────────────────────
const MIRROR = { fw: 0.022, fd: 0.035 };
X.mirror = (o, { M }) => {
  const g = new THREE.Group(), R = (o.diameter ?? 0.8) / 2, { fw, fd } = MIRROR;
  const ring = new THREE.Shape(); ring.absarc(0, 0, R + fw, 0, TAU, false);
  const hole = new THREE.Path(); hole.absarc(0, 0, R - 0.004, 0, TAU, true);
  ring.holes.push(hole);
  g.add(shadow(new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: fd, bevelEnabled: false, curveSegments: 32 }), M.steel)));
  M.__mirror ??= new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 1, roughness: 0.03 });
  const glass = shadow(new THREE.Mesh(new THREE.CircleGeometry(R, 64), M.__mirror));
  glass.position.z = fd - 0.012;
  g.add(glass);
  return wallItem(g, o.height ?? 1.5);
};

// ── 12. Pipe coat rack ───────────────────────────────────────────────────────
X.coatRack = (o, { M }) => {
  const g = new THREE.Group(), Ht = 1.75, hy = 1.6, hr = 0.15;
  g.add(cyl(0.2, 0.21, 0.022, M.steel, 0, 0.011, 0, 40));                                 // cast base
  g.add(cyl(0.045, 0.05, 0.03, M.steel, 0, 0.037, 0, 20));                                // floor flange
  g.add(rod([0, 0.04, 0], [0, Ht - 0.03, 0], 0.017, M.steel));
  for (const y of [0.9, hy]) g.add(cyl(0.026, 0.026, 0.05, M.steel, 0, y, 0, 16));        // couplings
  g.add(cyl(0.026, 0.024, 0.03, M.steel, 0, Ht - 0.015, 0, 16));                          // top cap
  const angles = [1, 3, 5, 7].map((k) => (k * Math.PI) / 4);
  for (const a of angles) {
    const dx = Math.sin(a) * hr, dz = Math.cos(a) * hr;
    g.add(rod([0, hy, 0], [dx, hy, dz], 0.012, M.steel));
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), M.steel);
    elbow.position.set(dx, hy, dz); g.add(shadow(elbow));
    g.add(rod([dx, hy, dz], [dx, hy + 0.065, dz], 0.012, M.steel));
    g.add(cyl(0.015, 0.015, 0.02, M.brass, dx, hy + 0.07, dz, 12));
  }
  const tote = new THREE.Group(), bz = hr - 0.02, bagTop = hy - 0.24;                     // leather tote on the front-right hook
  tote.add(rbox(0.34, 0.34, 0.1, 0.03, M.leather, 0, bagTop - 0.17, bz));
  for (const s of [-1, 1]) tote.add(rod([s * 0.08, bagTop - 0.01, bz], [0, hy + 0.012, bz], 0.007, M.leatherDark, 8));
  tote.rotation.y = angles[0];
  g.add(tote);
  return g;
};
const COAT_RECT = [-0.21, -0.21, 0.235, 0.235];

// ── 13. Industrial bookcase ──────────────────────────────────────────────────
const BOOKCASE_D = 0.38;
X.bookcase = (o, ctx) => {
  const { M } = ctx, g = new THREE.Group(), rand = rng(19);
  const W = o.width ?? 1.0, D = BOOKCASE_D, H = o.height ?? 2.0, t = 0.035, n = 5;
  const y0 = 0.1, y1 = H - 0.06, levels = Array.from({ length: n }, (_, i) => y0 + ((y1 - y0) * i) / (n - 1));
  const clear = (y1 - y0) / (n - 1) - t;                                                 // headroom per shelf
  const px = W / 2 - 0.045, pz = D / 2 - 0.045;
  for (const x of [-px, px]) for (const z of [-pz, pz]) {
    g.add(rod([x, 0, z], [x, H - 0.02, z], 0.017, M.steel));
    g.add(cyl(0.035, 0.035, 0.012, M.steel, x, 0.006, z, 16));                            // floor flange
    g.add(cyl(0.024, 0.024, 0.02, M.steel, x, H - 0.01, z, 12));                          // cap
    for (const y of levels) g.add(cyl(0.026, 0.026, 0.045, M.steel, x, y - t / 2 - 0.0225, z, 12));   // shelf flanges
  }
  levels.forEach((y, li) => {
    g.add(box(W, t, D, M.wood, 0, y, 0, true));
    const yb = y + t / 2;
    if (li === n - 1) return;                                                            // top board stays clear
    if (li === 0) {                                                                      // leather storage boxes
      const k = Math.max(1, Math.floor((W - 0.08) / 0.42)), bh = Math.min(0.3, clear - 0.04);
      for (let i = 0; i < k; i++) g.add(rbox(0.36, bh, 0.28, 0.02, M.leatherDark, (i - (k - 1) / 2) * 0.42, yb + bh / 2, 0));
      return;
    }
    const maxH = Math.min(0.32, clear - 0.06), x1 = W / 2 - 0.05;
    let x = -W / 2 + 0.05;
    while (x1 - x > 0.12) {
      const p = rand();
      if (p < 0.6) {
        const run = Math.min(0.18 + rand() * 0.3, x1 - x);
        const bk = books(M, rand, run, maxH * (0.8 + rand() * 0.2)); bk.position.set(x, yb, 0); g.add(bk);
        x += run + 0.04;
      } else if (p < 0.72 && x1 - x > 0.24 && clear > 0.32) {
        const pl = smallPlant(M, rand, 1.1); pl.position.set(x + 0.11, yb, 0); g.add(pl);
        x += 0.26;
      } else if (p < 0.86) {
        const vh = Math.min(0.2, clear - 0.05);
        g.add(cyl(0.05, 0.065, vh, M.ceramic, x + 0.07, yb + vh / 2, 0, 20));
        x += 0.17;
      } else if (x1 - x > 0.26) {
        for (let k = 0; k < 3; k++) g.add(box(0.22 - k * 0.02, 0.03, 0.16, M.bookColors[(k + 3) % 8], x + 0.12, yb + 0.015 + k * 0.03, 0));
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), M.brass);
        orb.position.set(x + 0.12, yb + 0.125, 0); g.add(shadow(orb));
        x += 0.3;
      } else x += 0.06;
    }
  });
  return g;
};

export const EXTRA_BUILDERS = X;

const half = (w) => w / 2;
export const EXTRA_CATALOG = {
  sofa: {
    name: 'Leather sofa', spec: 'Cognac leather 3-seat sofa, tight back, two seat cushions, slim blackened-steel legs on a low steel frame',
    layer: 'floor', rect: (o) => [-half(o.width ?? 2.1), -SOFA_D / 2, half(o.width ?? 2.1), SOFA_D / 2], label: 'Sofa', cat: 'Seating',
    keywords: ['sofa', 'couch', 'settee', 'loveseat'], defaults: { width: 2.1 }, params: [['width', 'Width (m)', 0.1]],
  },
  conferenceTable: {
    name: 'Conference table', spec: 'Reclaimed-oak top on two blackened-steel U-frame legs, leather-seat steel chairs',
    layer: 'floor', rect: conferenceRect, label: 'Table', cat: 'Tables',   // includes the chairs
    keywords: ['conference', 'boardroom', 'board table', 'conference table', 'long table'],
    defaults: { length: 2.4, width: 1.05, chairs: 6 },
    params: [['length', 'Length (m)', 0.1], ['width', 'Width (m)', 0.05], ['chairs', 'Seats', 2]],
  },
  coffeeBar: {
    name: 'Coffee bar', spec: 'Charcoal base cabinets with brass pulls, concrete counter, undermount sink, brass gooseneck faucet, espresso machine, open oak shelves on steel brackets',
    layer: 'floor', rect: (o) => [-half(o.width ?? 2.4), -BAR_D / 2, half(o.width ?? 2.4), BAR_D / 2], label: 'Coffee', cat: 'Kitchen',
    keywords: ['coffee', 'coffee bar', 'kitchenette', 'kitchen', 'espresso', 'sink', 'pantry', 'hospitality'],
    defaults: { width: 2.4 }, params: [['width', 'Width (m)', 0.1]],
  },
  credenza: {
    name: 'Credenza', spec: 'Low charcoal cabinet with reclaimed-oak top and doors on blackened-steel legs, 70 cm high',
    layer: 'floor', rect: (o) => [-half(o.width ?? 1.8), -CRED_D / 2, half(o.width ?? 1.8), CRED_D / 2], label: 'Credenza', cat: 'Storage',
    keywords: ['credenza', 'sideboard', 'buffet', 'media console', 'low cabinet'],
    defaults: { width: 1.8 }, params: [['width', 'Width (m)', 0.1]],
  },
  tv: {
    name: 'Wall TV', spec: '65″ display 145×84 cm, thin black bezel, flush wall bracket',
    layer: 'wall', rect: () => [-TV.w / 2, 0, TV.w / 2, TV.gap + TV.t + 0.001], label: 'TV', cat: 'Tech',
    keywords: ['tv', 'television', 'screen', 'display', 'presentation'],
    defaults: { height: 1.3 }, params: [['height', 'Centre height (m)', 0.05]],
  },
  whiteboard: {
    name: 'Whiteboard', spec: 'White marker board, 120 cm high, aluminium frame and marker tray',
    layer: 'wall', rect: (o) => [-half(o.width ?? 1.8), 0, half(o.width ?? 1.8), WB.tray], label: 'Board', cat: 'Walls & partitions',
    keywords: ['whiteboard', 'white board', 'marker board', 'dry erase', 'board'],
    defaults: { width: 1.8, height: 1.45 }, params: [['width', 'Width (m)', 0.1], ['height', 'Centre height (m)', 0.05]],
  },
  glassPartition: {
    name: 'Glass partition', spec: 'Freestanding Crittall-style partition: blackened-steel frame and mullion grid, clear glass, floor channel',
    layer: 'floor', rect: (o) => [-half(o.width ?? 2.0), -0.05, half(o.width ?? 2.0), 0.05], label: 'Glass', cat: 'Walls & partitions',
    // what blocks walking: the glass either side of the door opening, if there is one
    solids: (o) => { const W = half(o.width ?? 2.0), d = partitionDoor(o); return d ? [[-W, -0.05, d[0], 0.05], [d[1], -0.05, W, 0.05]] : [[-W, -0.05, W, 0.05]]; },
    keywords: ['partition', 'glass partition', 'glass wall', 'divider', 'room divider', 'crittall', 'glass door'],
    defaults: { width: 2.0, panelHeight: 2.2, door: 0 },
    // 4th entry: the value shown when the field is unset (the door is centred by default)
    params: [['width', 'Width (m)', 0.1], ['panelHeight', 'Height (m)', 0.05], ['door', 'Door width (m, 0 = none)', 0.05],
      ['doorAt', 'Door from left end (m)', 0.05, (o) => { const d = partitionDoor(o); return d ? Math.round((d[0] + (o.width ?? 2.0) / 2) * 100) / 100 : 0; }],
      ['frostFrom', 'Frosted band from (m)', 0.05, 0], ['frostTo', 'Frosted band to (m, 0 = none)', 0.05, 0]],
  },
  wallShelf: {
    name: 'Wall shelves', spec: 'Three floating reclaimed-oak shelves (25 cm deep) on slim blackened-steel brackets, books and plant',
    layer: 'wall', rect: (o) => [-half(o.width ?? 1.2), 0, half(o.width ?? 1.2), WSHELF_D], label: 'Shelves', cat: 'Storage',
    keywords: ['wall shelf', 'wall shelves', 'floating shelves', 'floating shelf', 'shelves'],
    defaults: { width: 1.2, height: 1.5 }, params: [['width', 'Width (m)', 0.1], ['height', 'Centre height (m)', 0.05]],
  },
  filingCabinet: {
    name: 'Filing cabinet', spec: 'Blackened-steel 3-drawer lateral file 90×50×100 cm, brass pulls and label holders',
    layer: 'floor', rect: () => [-FILE.W / 2, -FILE.D / 2, FILE.W / 2, FILE.D / 2], label: 'Files', cat: 'Storage',
    keywords: ['filing', 'filing cabinet', 'file cabinet', 'files', 'lateral file', 'drawers'],
    defaults: {}, params: [],
  },
  wallSign: {
    name: 'Illuminated sign', spec: 'Illuminated logo letters, warm white, on a blackened-steel backer bar',
    layer: 'wall', rect: (o) => [-half(o.width ?? 1.6), 0, half(o.width ?? 1.6), SIGN_Z + 0.002], label: 'Sign', cat: 'Decor',
    keywords: ['sign', 'logo', 'neon', 'signage', 'branding', 'lettering'],
    defaults: { text: 'YOUR LOGO', width: 1.6, height: 1.8 },
    params: [['width', 'Width (m)', 0.1], ['height', 'Centre height (m)', 0.05]],   // `text` is a string param (not a number field)
  },
  mirror: {
    name: 'Round mirror', spec: 'Round mirror in a blackened-steel band frame',
    layer: 'wall', rect: (o) => { const r = half(o.diameter ?? 0.8) + MIRROR.fw; return [-r, 0, r, MIRROR.fd]; }, label: 'Mirror', cat: 'Decor',
    keywords: ['mirror', 'round mirror', 'looking glass'],
    defaults: { diameter: 0.8, height: 1.5 }, params: [['diameter', 'Diameter (m)', 0.05], ['height', 'Centre height (m)', 0.05]],
  },
  coatRack: {
    name: 'Coat rack', spec: 'Black iron pipe coat stand, 175 cm, four hooks with brass caps, cast round base',
    layer: 'floor', rect: () => [...COAT_RECT], label: 'Coats', cat: 'Storage',
    keywords: ['coat rack', 'coat stand', 'hat stand', 'coats', 'hooks', 'coat'],
    defaults: {}, params: [],
  },
  bookcase: {
    name: 'Bookcase', spec: 'Tall black iron pipe bookcase, five reclaimed-oak shelves (38 cm deep), books and objects',
    layer: 'floor', rect: (o) => [-half(o.width ?? 1.0), -BOOKCASE_D / 2, half(o.width ?? 1.0), BOOKCASE_D / 2], label: 'Books', cat: 'Storage',
    keywords: ['bookcase', 'bookshelf', 'book shelf', 'books', 'library', 'shelving unit'],
    defaults: { width: 1.0, height: 2.0 }, params: [['width', 'Width (m)', 0.1], ['height', 'Height (m)', 0.1]],
  },
};
