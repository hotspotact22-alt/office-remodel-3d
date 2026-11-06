// Industrial-loft furniture, built procedurally. Every builder returns a group
// at the origin with its front facing +z; main.js places/rotates it from plan.js.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { metricUV, rng } from './materials.js';

const COMPASS = { south: 0, east: 90, north: 180, west: 270 };
export const facingToRadians = (f = 0) => THREE.MathUtils.degToRad(typeof f === 'string' ? COMPASS[f] ?? 0 : f);

const steelDS = (M) => (M.steelDS ??= Object.assign(M.steel.clone(), { side: THREE.DoubleSide }));
function shadow(m) { m.castShadow = m.receiveShadow = true; return m; }
function box(w, h, d, mat, x = 0, y = 0, z = 0, uv = false) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (uv) metricUV(geo, x, y, z);
  const m = shadow(new THREE.Mesh(geo, mat)); m.position.set(x, y, z); return m;
}
function rbox(w, h, d, r, mat, x = 0, y = 0, z = 0) {
  const m = shadow(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), mat)); m.position.set(x, y, z); return m;
}
function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 24) {
  const m = shadow(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat)); m.position.set(x, y, z); return m;
}
// Cylinder between two points (pipes, legs, rods).
function rod(a, b, r, mat, seg = 12) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = shadow(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat));
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

// Edison bulb + warm point light. Registered so day/evening mode can drive it.
function bulb(ctx, intensity, { shadow: castsShadow = false, distance = 0 } = {}) {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), ctx.M.bulb);
  glass.scale.set(1, 1.35, 1);
  g.add(glass);
  const light = new THREE.PointLight('#ffb36b', 0, distance, 2);
  if (castsShadow) {
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    light.shadow.bias = -0.002;
    light.shadow.radius = 4;
  }
  g.add(light);
  ctx.lamps.push({ light, intensity });
  return g;
}

function books(M, rand, width, maxH = 0.28) {
  const g = new THREE.Group();
  let x = 0;
  while (x < width) {
    const w = 0.02 + rand() * 0.035, h = maxH * (0.7 + rand() * 0.3), d = 0.17 + rand() * 0.06;
    if (x + w > width) break;
    const b = box(w, h, d, M.bookColors[Math.floor(rand() * M.bookColors.length)], x + w / 2, h / 2, 0);
    g.add(b);
    x += w + 0.002;
  }
  return g;
}

function smallPlant(M, rand, s = 1) {
  const g = new THREE.Group();
  g.add(cyl(0.07 * s, 0.055 * s, 0.12 * s, M.ceramic, 0, 0.06 * s, 0));
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), rand() > 0.5 ? M.leaf : M.leafDark);
    leaf.scale.set(0.03 * s, 0.006 * s, 0.07 * s);
    const piv = new THREE.Group();
    piv.position.y = 0.13 * s;
    piv.rotation.set(-0.6 - rand() * 0.6, rand() * Math.PI * 2, 0, 'YXZ');
    leaf.position.z = 0.06 * s;
    piv.add(leaf);
    g.add(piv);
  }
  return g;
}

// -- Builders -------------------------------------------------------------

const B = {};

B.workstation = (o, ctx) => {
  const { M } = ctx, g = new THREE.Group(), rand = rng(42);
  const W = 1.7, D = 0.78, Ht = 0.75;
  g.add(box(W, 0.05, D, M.wood, 0, Ht - 0.025, 0, true));
  for (const sx of [-1, 1]) {                                  // steel trestle frames
    const x = sx * (W / 2 - 0.1);
    g.add(box(0.05, 0.05, D - 0.06, M.steel, x, 0.025, 0));
    g.add(box(0.05, 0.04, D - 0.06, M.steel, x, Ht - 0.07, 0));
    for (const sz of [-1, 1]) g.add(box(0.05, Ht - 0.1, 0.05, M.steel, x, (Ht - 0.05) / 2, sz * (D / 2 - 0.06)));
  }
  g.add(box(W - 0.25, 0.32, 0.012, M.steel, 0, 0.52, D / 2 - 0.07));     // modesty panel (visitor side)

  // Monitor faces the user (-z)
  const mon = new THREE.Group();
  mon.add(box(0.24, 0.012, 0.16, M.steel, 0, 0.006, 0));
  mon.add(box(0.035, 0.32, 0.025, M.steel, 0, 0.17, 0.04));
  mon.add(new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.39, 0.025),
    [M.steel, M.steel, M.steel, M.steel, M.steel, M.screen]));
  mon.children[2].position.set(0, 0.34, 0.02); mon.children[2].castShadow = true;
  mon.position.set(0, Ht, 0.12);
  g.add(mon);

  g.add(box(0.42, 0.015, 0.13, M.wool, 0, Ht + 0.008, -0.17));            // keyboard
  g.add(box(0.07, 0.02, 0.11, M.wool, 0.3, Ht + 0.01, -0.17));             // mouse
  g.add(box(0.21, 0.012, 0.29, M.paper, -0.5, Ht + 0.006, -0.12));         // notebook
  g.add(cyl(0.04, 0.035, 0.1, M.ceramic, 0.62, Ht + 0.05, -0.05));         // mug
  const stack = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const b = box(0.24 - i * 0.02, 0.035, 0.17 - i * 0.01, M.bookColors[i + 2], 0, 0.018 + i * 0.036, 0);
    b.rotation.y = (rand() - 0.5) * 0.3; stack.add(b);
  }
  stack.position.set(0.6, Ht, 0.22);
  g.add(stack);

  // Industrial task lamp
  const lamp = new THREE.Group();
  lamp.add(cyl(0.08, 0.09, 0.025, M.steel, 0, 0.012, 0));
  lamp.add(rod([0, 0.02, 0], [0, 0.42, 0.05], 0.009, M.steel));
  lamp.add(rod([0, 0.42, 0.05], [0, 0.48, -0.28], 0.009, M.steel));
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.14, 24, 1, true), steelDS(M));
  shade.castShadow = true;
  shade.position.set(0, 0.42, -0.3);
  lamp.add(shade);
  const lb = bulb(ctx, 1.2); lb.position.set(0, 0.38, -0.3); lb.scale.setScalar(0.7);
  lamp.add(lb);
  lamp.position.set(-0.68, Ht, 0.2);
  g.add(lamp);

  const chair = B.deskChair(o, ctx);
  chair.position.set(0.05, 0, -0.62);
  chair.rotation.y = 0.12;
  g.add(chair);
  return g;
};

B.deskChair = (o, { M }) => {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spoke = box(0.3, 0.03, 0.045, M.steel, Math.cos(a) * 0.15, 0.07, Math.sin(a) * 0.15);
    spoke.rotation.y = -a; g.add(spoke);
    const caster = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), M.steel);
    caster.position.set(Math.cos(a) * 0.29, 0.025, Math.sin(a) * 0.29); g.add(caster);
  }
  g.add(cyl(0.025, 0.025, 0.36, M.galvanized, 0, 0.26, 0));
  g.add(rbox(0.52, 0.09, 0.5, 0.035, M.leather, 0, 0.47, 0.02));
  const back = rbox(0.5, 0.6, 0.08, 0.035, M.leather, 0, 0.84, -0.24);
  back.rotation.x = -0.12; g.add(back);
  for (const sx of [-1, 1]) {
    g.add(box(0.035, 0.2, 0.035, M.steel, sx * 0.27, 0.6, -0.02));
    g.add(rbox(0.06, 0.03, 0.3, 0.01, M.leatherDark, sx * 0.27, 0.71, 0.02));
  }
  return g;
};

B.pipeShelf = (o, ctx) => {
  const { M } = ctx, g = new THREE.Group(), rand = rng(9);
  const W = o.width ?? 2.0, D = 0.34, levels = [0.12, 0.56, 1.0, 1.44, 1.88], r = 0.017;
  const posts = W > 1.4 ? [-W / 2 + 0.06, 0, W / 2 - 0.06] : [-W / 2 + 0.06, W / 2 - 0.06];
  for (const x of posts) for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) {
    g.add(rod([x, 0, z], [x, 2.08, z], r, M.steel));
    g.add(cyl(0.035, 0.035, 0.015, M.steel, x, 0.008, z));
    for (const y of levels) g.add(cyl(0.026, 0.026, 0.05, M.steel, x, y - 0.045, z, 12)); // fittings
  }
  levels.forEach((y, li) => {
    g.add(box(W + 0.06, 0.04, D, M.wood, 0, y, 0, true));
    if (li === 0) {                                            // leather storage boxes
      for (let k = 0; k < Math.floor(W / 0.42); k++) g.add(rbox(0.36, 0.3, 0.28, 0.02, M.leatherDark, -W / 2 + 0.25 + k * 0.42, y + 0.17, 0));
      return;
    }
    let x = -W / 2 + 0.05;
    while (x < W / 2 - 0.15) {
      const pick = rand();
      if (pick < 0.55) {
        const run = 0.2 + rand() * 0.35;
        const bk = books(M, rand, Math.min(run, W / 2 - 0.05 - x), 0.24 + rand() * 0.08);
        bk.position.set(x, y + 0.02, 0); g.add(bk); x += run + 0.05;
      } else if (pick < 0.72) {
        const p = smallPlant(M, rand, 1.2); p.position.set(x + 0.1, y + 0.02, 0); g.add(p); x += 0.25;
      } else if (pick < 0.86) {
        g.add(cyl(0.05, 0.07, 0.22, M.ceramic, x + 0.08, y + 0.13, 0)); x += 0.2;
      } else {
        for (let k = 0; k < 3; k++) g.add(box(0.22 - k * 0.02, 0.03, 0.16, M.bookColors[(k + 3) % 8], x + 0.12, y + 0.035 + k * 0.03, 0));
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), M.brass);
        orb.position.set(x + 0.12, y + 0.14, 0); g.add(orb);
        x += 0.3;
      }
    }
  });
  return g;
};

B.meetingTable = (o, ctx) => {
  const { M } = ctx, g = new THREE.Group();
  const R = (o.diameter ?? 1.2) / 2, Ht = 0.75;
  g.add(cyl(R, R, 0.05, M.wood, 0, Ht - 0.025, 0, 48));
  g.add(cyl(0.055, 0.055, Ht - 0.07, M.steel, 0, (Ht - 0.05) / 2, 0));
  g.add(cyl(0.22, 0.22, 0.02, M.steel, 0, Ht - 0.06, 0, 32));
  for (const a of [0, Math.PI / 2]) {
    const foot = box(0.8, 0.04, 0.07, M.steel, 0, 0.02, 0); foot.rotation.y = a; g.add(foot);
  }
  g.add(cyl(0.05, 0.06, 0.18, M.ceramic, 0.12, Ht + 0.09, -0.1));       // vase + stems
  for (let i = 0; i < 3; i++) g.add(rod([0.12, Ht + 0.15, -0.1], [0.12 + (i - 1) * 0.06, Ht + 0.42, -0.1 + (i % 2) * 0.05], 0.003, M.leafDark));
  const n = o.chairs ?? 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 4;
    const c = B.meetingChair(o, ctx);
    c.position.set(Math.sin(a) * (R + 0.18), 0, Math.cos(a) * (R + 0.18));
    c.rotation.y = a + Math.PI;
    g.add(c);
  }
  return g;
};

B.meetingChair = (o, { M }) => {
  const g = new THREE.Group();
  const S = 0.46, sh = 0.46;
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    g.add(rod([x * 0.2, 0, z * 0.2], [x * 0.19, sh - 0.03, z * 0.19], 0.012, M.steel));
  }
  g.add(rbox(S, 0.045, S, 0.015, M.leather, 0, sh, 0));
  g.add(rod([-0.19, sh, -0.2], [-0.2, 0.86, -0.25], 0.012, M.steel));
  g.add(rod([0.19, sh, -0.2], [0.2, 0.86, -0.25], 0.012, M.steel));
  const back = box(0.44, 0.16, 0.025, M.wood, 0, 0.76, -0.235, true);
  back.rotation.x = -0.12; g.add(back);
  g.add(box(0.4, 0.02, 0.02, M.steel, 0, 0.18, -0.19));
  g.add(box(0.4, 0.02, 0.02, M.steel, 0, 0.18, 0.19));
  return g;
};

B.clubChair = (o, { M }) => {
  const g = new THREE.Group();
  for (const x of [-1, 1]) for (const z of [-1, 1]) g.add(cyl(0.025, 0.02, 0.09, M.steel, x * 0.36, 0.045, z * 0.34, 12));
  g.add(rbox(0.88, 0.3, 0.84, 0.06, M.leather, 0, 0.24, 0));
  g.add(rbox(0.6, 0.13, 0.64, 0.05, M.leather, 0, 0.44, 0.06));
  const back = rbox(0.88, 0.48, 0.22, 0.08, M.leather, 0, 0.6, -0.32);
  back.rotation.x = -0.14; g.add(back);
  for (const x of [-1, 1]) g.add(rbox(0.17, 0.3, 0.82, 0.07, M.leather, x * 0.36, 0.5, 0.0));
  const cushion = rbox(0.36, 0.3, 0.1, 0.05, M.wool, 0, 0.66, -0.17);
  cushion.rotation.set(-0.25, 0, 0.08); g.add(cushion);
  return g;
};

B.ottoman = (o, { M }) => {
  const g = new THREE.Group();
  g.add(rbox(0.62, 0.36, 0.5, 0.06, M.leatherDark, 0, 0.22, 0));
  for (const x of [-1, 1]) for (const z of [-1, 1]) g.add(cyl(0.02, 0.018, 0.05, M.steel, x * 0.25, 0.025, z * 0.19, 10));
  g.add(box(0.3, 0.008, 0.22, M.wool, 0.08, 0.405, 0.02));                 // throw
  return g;
};

B.sideTable = (o, ctx) => {
  const { M } = ctx, g = new THREE.Group(), rand = rng(4);
  g.add(cyl(0.23, 0.23, 0.5, M.steel, 0, 0.25, 0, 32));
  for (const y of [0.1, 0.4]) g.add(cyl(0.235, 0.235, 0.02, M.galvanized, 0, y, 0, 32));
  g.add(cyl(0.25, 0.25, 0.03, M.wood, 0, 0.515, 0, 32));
  const p = smallPlant(M, rand, 1.3); p.position.set(-0.08, 0.53, 0.05); g.add(p);
  g.add(box(0.2, 0.03, 0.14, M.bookColors[0], 0.08, 0.545, -0.05));
  return g;
};

B.floorLamp = (o, ctx) => {
  const { M } = ctx, g = new THREE.Group();
  g.add(cyl(0.16, 0.17, 0.03, M.steel, 0, 0.015, 0, 32));
  g.add(rod([0, 0, 0], [0, 1.72, 0], 0.014, M.steel));
  g.add(rod([0, 1.72, 0], [0, 1.72, 0.55], 0.012, M.steel));
  g.add(cyl(0.022, 0.022, 0.06, M.brass, 0, 1.72, 0, 12));
  g.add(rod([0, 1.72, 0.55], [0, 1.6, 0.55], 0.004, M.steel));
  // wire cage shade
  const cage = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    cage.add(rod([0, 0, 0], [Math.cos(a) * 0.09, -0.16, Math.sin(a) * 0.09], 0.003, M.brass, 6));
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.003, 6, 32), M.brass);
  ring.rotation.x = Math.PI / 2; ring.position.y = -0.16; cage.add(ring);
  const b = bulb(ctx, 3.5); b.position.y = -0.09; cage.add(b);
  cage.position.set(0, 1.6, 0.55);
  g.add(cage);
  return g;
};

B.pendant = (o, ctx) => {
  const { M, H } = ctx, g = new THREE.Group();
  const s = o.size ?? 1, bottom = o.height ?? 1.9;
  const profile = [
    [0.02, 0.24], [0.035, 0.235], [0.05, 0.2], [0.09, 0.14], [0.15, 0.07], [0.19, 0.02], [0.2, 0],
  ].map(([r, y]) => new THREE.Vector2(r * s, y * s));
  const dome = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), steelDS(M));
  dome.castShadow = true;
  dome.position.y = bottom;
  g.add(dome);
  g.add(cyl(0.012 * s, 0.012 * s, 0.05, M.brass, 0, bottom + 0.25 * s, 0, 12));
  g.add(rod([0, bottom + 0.24 * s, 0], [0, H, 0], 0.004, M.steel, 6));
  g.add(cyl(0.05, 0.05, 0.025, M.steel, 0, H - 0.012, 0));
  const b = bulb(ctx, o.intensity ?? 4.5 * s, { shadow: s > 1.1 });
  b.position.y = bottom + 0.12 * s;   // recessed: ~60° cutoff, so light pools down instead of washing the walls
  b.scale.setScalar(s);
  g.add(b);
  return g;
};

B.rug = (o, { M }) => {
  const [w, d] = o.size ?? [2, 1.4];
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), M.rug);
  m.position.y = 0.006; m.receiveShadow = true;
  return m;
};

B.wallArt = (o, { M }) => {
  const g = new THREE.Group();
  const [w, h] = o.size ?? [1, 0.7];
  g.add(box(w, h, 0.03, M.steel, 0, 0, 0.015));
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.08, h - 0.08), M.art);
  art.position.z = 0.031; g.add(art);
  g.position.y = o.height ?? 1.6;
  const wrap = new THREE.Group(); wrap.add(g);
  wrap.userData.wallMounted = true;
  return wrap;
};

B.plant = (o, { M }) => {
  const g = new THREE.Group(), s = o.size ?? 1, rand = rng(Math.round((o.at[0] + o.at[1]) * 100));
  g.add(cyl(0.2 * Math.min(s, 1.2), 0.16 * Math.min(s, 1.2), 0.42, M.potConcrete, 0, 0.21, 0, 28));
  g.add(cyl(0.18 * Math.min(s, 1.2), 0.18 * Math.min(s, 1.2), 0.02, M.soil, 0, 0.41, 0, 20));
  const top = 0.42 + 1.0 * s;
  g.add(rod([0, 0.4, 0], [0.03, top, 0.02], 0.018, M.leatherDark));
  const leaves = Math.round(26 * s);
  for (let i = 0; i < leaves; i++) {
    const y = 0.42 + 0.35 * s + rand() * (top - 0.42 - 0.3 * s);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), rand() > 0.4 ? M.leaf : M.leafDark);
    leaf.scale.set(0.09 * Math.sqrt(s), 0.012, 0.15 * Math.sqrt(s));
    leaf.position.z = 0.13 * Math.sqrt(s);
    leaf.castShadow = true;
    const piv = new THREE.Group();
    piv.position.set(0.02, y, 0.01);
    piv.rotation.set(-0.2 - rand() * 0.7, rand() * Math.PI * 2, 0, 'YXZ');
    piv.add(leaf);
    g.add(piv);
  }
  return g;
};

// Acoustic felt panels (wall-mounted row) — NRC ≈ 0.85.
B.acousticPanels = (o, { M }) => {
  const g = new THREE.Group(), n = o.count ?? 4, w = 0.6, h = o.panelHeight ?? 1.2, gap = 0.06;
  const total = n * w + (n - 1) * gap;
  for (let i = 0; i < n; i++) g.add(rbox(w, h, 0.045, 0.012, M.felt, -total / 2 + w / 2 + i * (w + gap), 0, 0.024));
  g.position.y = o.height ?? 1.45;
  const wrap = new THREE.Group(); wrap.add(g);
  wrap.userData.wallMounted = true;
  return wrap;
};

// Floor-to-ceiling pleated drapes stacked either side of a window, on a black steel rod.
B.curtains = (o, { M, H }) => {
  const g = new THREE.Group(), W = o.width ?? 2, top = H - 0.12, stack = 0.42, z = 0.13;
  g.add(rod([-W / 2 - 0.2, top + 0.03, z], [W / 2 + 0.2, top + 0.03, z], 0.013, M.steel));
  for (const s of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(stack, top - 0.02, 28, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, 0.035 * Math.sin((pos.getX(i) / 0.06) * Math.PI));
    geo.computeVertexNormals();
    const m = shadow(new THREE.Mesh(geo, M.linen));
    m.position.set(s * (W / 2 + 0.2 - stack / 2), (top - 0.02) / 2 + 0.02, z);
    g.add(m);
  }
  g.userData.wallMounted = true;
  return g;
};

// Structural column (warehouse buildings have a steel or concrete column grid), floor to ceiling.
B.column = (o, { M, H }) => {
  const g = new THREE.Group(), sz = o.size ?? 0.45;
  g.add(box(sz, H, sz, o.finish === 'steel' ? M.steel : M.wallOutside, 0, H / 2, 0, true));
  g.add(box(sz + 0.04, 0.1, sz + 0.04, M.steel, 0, 0.05, 0));   // base plate / kick
  return g;
};

// Surface-mounted black cylinder downlight — general light where daylight is short.
B.downlight = (o, ctx) => {
  const { M, H } = ctx, g = new THREE.Group();
  g.add(cyl(0.06, 0.06, 0.16, steelDS(M), 0, H - 0.08, 0, 24));
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.048, 24), M.bulb);
  lens.rotation.x = Math.PI / 2; lens.position.y = H - 0.162;
  g.add(lens);
  const light = new THREE.SpotLight('#ffc994', 0, 0, Math.PI * 0.3, 0.7, 2);
  light.position.y = H - 0.17;
  g.add(light, light.target);   // target at the group origin = the floor below
  ctx.lamps.push({ light, intensity: o.intensity ?? 14 });
  g.userData.ceiling = true;
  return g;
};

// Exposed spiral duct (lives with the ceiling: hidden in dollhouse view).
B.duct = (o, { M, H }) => {
  const g = new THREE.Group(), r = 0.2, y = H - 0.38;
  const a = [o.from[0], y, o.from[1]], b = [o.to[0], y, o.to[1]];
  g.add(rod(a, b, r, M.galvanized, 32));
  const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), len = A.distanceTo(Bv);
  for (let d = 0.6; d < len; d += 1.2) {
    const p = A.clone().lerp(Bv, d / len);
    const q = p.clone().add(Bv.clone().sub(A).normalize().multiplyScalar(0.04));
    const ring = rod(p.toArray(), q.toArray(), r + 0.012, M.galvanized, 32);
    g.add(ring);
    g.add(rod([p.x, p.y + r, p.z], [p.x, H, p.z], 0.006, M.steel, 6));
  }
  g.userData.ceiling = true;
  return g;
};

export const CATALOG = {
  workstation: ['Workstation', 'Reclaimed-oak desk on blackened-steel trestles, leather task chair, task lamp'],
  pipeShelf: ['Pipe shelving', 'Black iron pipe frame, reclaimed-oak shelves, leather storage boxes'],
  meetingTable: ['Client table', 'Ø1.2 m reclaimed-oak top, steel pedestal, leather-seat steel chairs'],
  clubChair: ['Club chair', 'Cognac leather, low steel feet, wool lumbar cushion'],
  ottoman: ['Ottoman', 'Dark leather, doubles as extra seat'],
  sideTable: ['Drum side table', 'Blackened steel with galvanized bands, oak top'],
  floorLamp: ['Floor lamp', 'Overhanging steel arm, brass cage, Edison bulb'],
  pendant: ['Pendant', 'Spun-steel dome, cloth cord, Edison bulb (2700 K)'],
  rug: ['Rug', 'Faded vintage wool, zones the lounge'],
  wallArt: ['Wall art', 'Abstract print in thin steel frame'],
  plant: ['Planter', 'Concrete pot, fiddle-leaf fig'],
  duct: ['Exposed duct', 'Galvanized spiral duct on rod hangers'],
};

// Shared helpers + a hook for builders defined in other modules (extras, scanned models).
export { box, rbox, cyl, rod, shadow, bulb, steelDS, books, smallPlant, B as BUILDERS };
export function registerBuilders(obj) { Object.assign(B, obj); }

export function buildFurniture(item, ctx) {
  const builder = B[item.type];
  if (!builder) { console.warn(`Unknown furniture type: ${item.type}`); return null; }
  const obj = builder(item, ctx);
  if (item.at) {
    obj.position.x += item.at[0];
    obj.position.z += item.at[1];
  }
  obj.rotation.y = facingToRadians(item.facing);
  return obj;
}
