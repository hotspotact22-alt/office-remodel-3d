// Builds the architectural shell (floor, walls with openings, ceiling, dimensions)
// from plan.js. Plan (x, y) maps to world (x, 0, z).
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { metricUV } from './materials.js';

const SLAB = 0.2;          // floor slab depth shown in cutaway
const STUB = 0.12;         // height of cut-away walls

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function formatLength(m) {
  const totalIn = Math.round(m * 39.3701);
  return `${m.toFixed(2)} m  ·  ${Math.floor(totalIn / 12)}′${totalIn % 12}″`;
}

// Solid wall pieces (u along wall, v up) around the openings.
function wallPieces(L, H, openings, extS, extE) {
  const pieces = [];
  let cursor = -extS;
  for (const o of openings) {
    if (o.offset > cursor) pieces.push([cursor, o.offset, -SLAB, H]);
    const sill = o.type === 'door' ? 0 : o.sill;
    pieces.push([o.offset, o.offset + o.width, -SLAB, Math.min(sill, H)]);
    const top = sill + o.height;
    if (top < H) pieces.push([o.offset, o.offset + o.width, top, H]);
    cursor = o.offset + o.width;
  }
  if (cursor < L + extE) pieces.push([cursor, L + extE, -SLAB, H]);
  return pieces.filter(([u0, u1, v0, v1]) => u1 - u0 > 1e-4 && v1 - v0 > 1e-4);
}

function piecesToMeshes(pieces, t, s, H, finish, M) {
  const g = new THREE.Group();
  for (const [u0, u1, v0, v1] of pieces) {
    const w = u1 - u0, h = v1 - v0;
    const cx = (u0 + u1) / 2, cy = (v0 + v1) / 2, cz = -s * t / 2;
    const geo = metricUV(new THREE.BoxGeometry(w, h, t), cx, cy, cz);
    const inner = finish, outer = M.wallOutside;
    const mats = [
      finish, finish,
      v1 >= H - 1e-6 ? M.wallCut : finish,
      v0 <= -SLAB + 1e-6 ? M.wallCut : finish,
      s > 0 ? inner : outer,
      s > 0 ? outer : inner,
    ];
    const mesh = new THREE.Mesh(geo, mats);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

// Steel-framed (factory style) glazing: frame + mullion grid + glass.
function steelGlazing(width, height, M, { door = false } = {}) {
  const g = new THREE.Group();
  const bar = 0.045, depth = 0.05;
  const add = (w, h, x, y) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), M.steel);
    m.position.set(x, y, 0); m.castShadow = true; g.add(m);
  };
  add(width, bar, width / 2, bar / 2);
  add(width, bar, width / 2, height - bar / 2);
  add(bar, height, bar / 2, height / 2);
  add(bar, height, width - bar / 2, height / 2);
  const cols = Math.max(2, Math.round(width / (door ? 0.33 : 0.48)));
  const rows = Math.max(2, Math.round(height / (door ? 0.45 : 0.55)));
  for (let i = 1; i < cols; i++) add(bar * 0.6, height, (width * i) / cols, height / 2);
  for (let j = 1; j < rows; j++) add(width, bar * 0.6, width / 2, (height * j) / rows);
  if (door) add(width, bar * 2.2, width / 2, height * 0.42);   // kick / lock rail
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(width - bar, height - bar), M.glass);
  glass.position.set(width / 2, height / 2, 0);
  glass.renderOrder = 2;
  g.add(glass);
  return g;
}

// A glass wall: steel-framed glazing fills every stretch between the doors.
function glassWallOpenings(openings, L, H) {
  const out = [], doors = openings.filter((o) => o.type === 'door');
  let cur = 0;
  for (const d of [...doors, { offset: L, width: 0 }]) {
    if (d.offset - cur > 0.15) out.push({ type: 'window', offset: cur, width: d.offset - cur, sill: 0, height: H, interior: true });
    if (d.width) out.push(d);
    cur = d.offset + d.width;
  }
  return out;
}

// What you see through an interior glass wall: a closed, lit corridor 2.2 m deep (not the sky).
// beyond = depth in metres, or { depth, extendEnd, columns: [{ t: along the wall, d: out from it, size }] }
// (the starting plan describes the real hallway from the floor-plan drawing). extendEnd: the
// hallway carries on past the wall's end (e.g. opens into the entry) before it stops.
function beyondGlass(L, H, t, s, M, lamps, beyond = 2.2) {
  const D = typeof beyond === 'number' ? beyond : beyond?.depth ?? 2.2, ext = beyond?.extendEnd ?? 0;
  const g = new THREE.Group(), W = L + 2 * t + ext, zb = -s * (t + D), xc = (L + ext) / 2;
  const mesh = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  const floor = mesh(metricUV(new THREE.PlaneGeometry(W, D + t)), M.concrete, xc, 0.002, zb / 2);
  floor.rotation.x = -Math.PI / 2; floor.castShadow = false;
  const ceil = mesh(new THREE.PlaneGeometry(W + 0.24, D + t + 0.12), M.ceiling, xc, H, zb / 2);   // also covers the wall top
  ceil.rotation.x = Math.PI / 2;
  mesh(new THREE.BoxGeometry(W + 0.24, H, 0.12), M.wallOutside, xc, H / 2, zb - s * 0.06);           // far wall
  for (const x of [-t - 0.06, L + t + ext + 0.06]) mesh(new THREE.BoxGeometry(0.12, H, D + t), M.wallOutside, x, H / 2, zb / 2);   // ends
  for (const c of beyond?.columns ?? []) {
    if (!(c.d > 0 && c.d < D) || c.t < -t || c.t > L + t + ext) continue;   // only columns that stand in this hallway
    const sz = c.size ?? 0.6;
    mesh(new THREE.BoxGeometry(sz, H, sz), M.wallOutside, c.t, H / 2, -s * (t + c.d));
  }
  const n = Math.max(1, Math.round((L + ext) / 3));
  for (let i = 0; i < n; i++) {
    const light = new THREE.PointLight('#ffe2bf', 0, 0, 2);
    light.position.set(((i + 0.5) * (L + ext)) / n, H - 0.25, zb / 2);
    g.add(light);
    lamps.push({ light, intensity: 3 });
  }
  return g;
}

export function buildRoom(plan, M) {
  const pts = plan.outline, H = plan.ceilingHeight, t = plan.wallThickness;
  const area = signedArea(pts);
  const s = area > 0 ? 1 : -1;          // which local-z side is "inside"
  const n = pts.length;
  const group = new THREE.Group();
  const walls = [];
  const dims = [];
  const lamps = [];

  // Floor + slab
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, -y)));
  const floorGeo = new THREE.ShapeGeometry(shape);
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(floorGeo, plan.floorFinish === 'carpet' ? M.carpet : M.concrete);
  floor.receiveShadow = true;
  floor.userData.surface = 'floor';
  group.add(floor);
  const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: SLAB - 0.002, bevelEnabled: false });
  slabGeo.rotateX(-Math.PI / 2);
  const slab = new THREE.Mesh(slabGeo, M.slab);
  slab.position.y = -SLAB;
  group.add(slab);

  // Ceiling (hidden from view in dollhouse mode but still blocks sunlight)
  const ceilGeo = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))));
  ceilGeo.rotateX(Math.PI / 2);
  const ceiling = new THREE.Mesh(ceilGeo, plan.ceilingFinish === 'tiles' ? M.ceilingTiles : M.ceiling);
  ceiling.position.y = H;
  ceiling.castShadow = true;
  ceiling.userData.surface = 'ceiling';
  const ceilingGroup = new THREE.Group();
  ceilingGroup.add(ceiling);
  group.add(ceilingGroup);

  const dimMat = new THREE.LineBasicMaterial({ color: '#2a2928' });

  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const L = Math.hypot(dx, dy);
    if (L < 1e-6) continue;   // a corner dropped onto its neighbour mid-drag: no wall to build
    const ux = dx / L, uy = dy / L;
    const nIn = [s * -uy, s * ux];                       // inward normal (plan)
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const convexStart = Math.sign(cross(p0, p1, p2)) === Math.sign(area);
    const convexEnd = Math.sign(cross(p1, p2, p3)) === Math.sign(area);
    const extS = convexStart ? t : 0, extE = convexEnd ? t : 0;

    const finKey = plan.finishes?.[i] ?? plan.finishes?.default ?? 'plaster';
    let openings = (plan.openings || []).filter((o) => o.wall === i).sort((a, b) => a.offset - b.offset);
    if (finKey === 'glass') openings = glassWallOpenings(openings, L, H);
    const finish = finKey === 'glass' ? M.steel : M[finKey] || M.plaster;

    const frame = new THREE.Group();                      // wall-local frame
    frame.position.set(p1[0], 0, p1[1]);
    frame.rotation.y = Math.atan2(-dy, dx);
    group.add(frame);

    const full = piecesToMeshes(wallPieces(L, H, openings, extS, extE), t, s, H, finish, M);
    const stub = piecesToMeshes(wallPieces(L, STUB, openings, extS, extE), t, s, STUB, finish, M);
    stub.visible = false;

    for (const o of openings) {
      const isDoor = o.type === 'door';
      const glazing = steelGlazing(o.width, o.height, M, { door: isDoor });
      glazing.position.set(o.offset, isDoor ? 0 : o.sill, -s * t * (isDoor ? 0.75 : 0.5));
      full.add(glazing);
      if (isDoor) {
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 12), M.brass);
        handle.position.set(o.offset + o.width - 0.12, 1.05, -s * (t * 0.75 - 0.05));
        full.add(handle);
      } else {
        const sill = new THREE.Mesh(new THREE.BoxGeometry(o.width + 0.1, 0.035, t * 0.5 + 0.06), M.steel);
        sill.position.set(o.offset + o.width / 2, o.sill + 0.017, s * 0.03 - s * t * 0.25);
        sill.castShadow = sill.receiveShadow = true;
        full.add(sill);
      }
    }
    if (finKey === 'glass') full.add(beyondGlass(L, H, t, s, M, lamps, plan.beyond?.[i] ?? 2.2));   // number or { depth, columns }
    frame.add(full, stub);
    full.traverse((m) => { m.userData.wall = i; });

    const mid = new THREE.Vector3(p1[0] + dx / 2, 0, p1[1] + dy / 2);
    walls.push({
      index: i, full, stub, mid, p1, p2, attached: [],
      outward: new THREE.Vector3(-nIn[0], 0, -nIn[1]),
      windowArea: openings.filter((o) => o.type === 'window' && !o.interior).reduce((a, o) => a + o.width * o.height, 0),
    });

    // Dimension line + label, just inside the wall
    const off = 0.28, a = new THREE.Vector3(p1[0] + nIn[0] * off, 0.015, p1[1] + nIn[1] * off);
    const b = new THREE.Vector3(p2[0] + nIn[0] * off, 0.015, p2[1] + nIn[1] * off);
    const tick = new THREE.Vector3(nIn[0] * 0.08, 0, nIn[1] * 0.08);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      a, b, a.clone().add(tick), a.clone().sub(tick), b.clone().add(tick), b.clone().sub(tick),
    ]);
    const line = new THREE.LineSegments(lineGeo, dimMat);
    const el = document.createElement('div');
    el.className = 'dim-label';
    el.textContent = formatLength(L);
    const label = new CSS2DObject(el);
    label.position.copy(a.clone().add(b).multiplyScalar(0.5)).add(new THREE.Vector3(nIn[0] * 0.18, 0, nIn[1] * 0.18));
    group.add(line, label);
    dims.push(line, label);
  }

  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const bounds = {
    minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
  };
  bounds.w = bounds.maxX - bounds.minX; bounds.d = bounds.maxY - bounds.minY;
  bounds.cx = (bounds.minX + bounds.maxX) / 2; bounds.cy = (bounds.minY + bounds.maxY) / 2;

  return {
    group, walls, ceilingGroup, dims, bounds, H, lamps,
    contains: (x, z) => pointInPolygon(x, z, pts),
    area: Math.abs(area),
  };
}
