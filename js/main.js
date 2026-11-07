import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { WebGLPathTracer, DenoiseMaterial } from 'three-gpu-pathtracer';
import samplePlan from '../plan.js';
import { createMaterials } from './materials.js';
import { buildRoom } from './room.js';
import { buildFurniture, registerBuilders, facingToRadians } from './furniture.js';
import { CATALOG, ADDABLE, registerCatalog, ridersOf, halfWidth } from './catalog.js';
import { normalizePlan, bbox, getWalls, centroid, pointInPolygon, round2, dot, sub } from './planmath.js';
import { MODEL_CATALOG, MODEL_BUILDERS, modelsReady, setOnModelLoaded } from './models.js';
import { createLibrary } from './library.js';
import { applyNote, notePoint, NOTE_SUGGESTIONS } from './notes.js';
import { autoFurnish, autoViews } from './layout.js';
import { checkDesign, SOURCES, RULES } from './rules.js';
import { createEditor, snapToWall } from './editor.js';

const $ = (s) => document.querySelector(s);
const Y = new THREE.Vector3(0, 1, 0);
// ?sandbox (used by the test suite) keeps its own saved plan, so tests never touch yours.
const SANDBOX = new URLSearchParams(location.search).has('sandbox');
const STORE = SANDBOX ? 'office-plan-sandbox' : 'office-plan-v2';

// ── Asset types: house-style pieces + photo-scanned models + extra office pieces ──
registerCatalog(MODEL_CATALOG);
registerBuilders(MODEL_BUILDERS);
try {
  const extra = await import('./extras.js');
  registerCatalog(extra.EXTRA_CATALOG ?? {});
  registerBuilders(extra.EXTRA_BUILDERS ?? {});
} catch (e) { console.warn('Extra assets not loaded:', e); }

// ── Plan state (saved in this browser) ──────────────────────────────────────
const ready = (p, dedupe = true) => { normalizePlan(p, { dedupe }); if (p.furniture === 'auto') autoFurnish(p); return p; };
const samplePlanCopy = () => ready(structuredClone(samplePlan));
function loadPlan() {
  let s = null;
  try { s = localStorage.getItem(STORE); if (s) return ready(JSON.parse(s)); } catch {
    if (s) try { localStorage.setItem(`${STORE}-broken`, s); } catch { /* storage full: skip the backup */ }   // keep the unreadable save
  }
  return samplePlanCopy();
}
function savePlan(p) { try { localStorage.setItem(STORE, JSON.stringify(p)); } catch (e) { console.warn('Could not save plan', e); } }
let plan = loadPlan();

// ── Renderer / scene ────────────────────────────────────────────────────────
const viewport = $('#viewport');
const vw = () => viewport.clientWidth || window.innerWidth, vh = () => viewport.clientHeight || window.innerHeight;
// Phones and tablets: render fewer pixels, smaller shadows and a lighter sky so they stay smooth.
const LOW = window.matchMedia?.('(pointer: coarse)').matches ?? false;
// No 3D graphics (hardware acceleration off, or the browser blocked WebGL after a graphics-card
// reset): say so plainly instead of a generic load error.
if (!document.createElement('canvas').getContext('webgl2')) {
  window.showError?.('This browser could not start 3D graphics (WebGL). Turn on hardware acceleration in the browser settings, or restart the browser, then reload this page.');
  throw new Error('WebGL 2 is not available');
}
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOW ? 1.5 : 2));
renderer.setSize(vw(), vh());
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute('aria-label', '3D view of the office: drag to orbit, click furniture to select and move it');
viewport.appendChild(renderer.domElement);
// The graphics card can reset (a driver timeout, memory pressure, a long Photo render on a weak
// GPU). Say so instead of leaving a black view, and carry on if the browser restores it.
let glLost = false;
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();                      // allows the browser to restore the context
  glLost = true;
  if (photo) stopPhoto();
  pathTracer = null; ptReady = false;      // its GPU buffers are gone; rebuilt on the next Photo
  $('#gpulost').hidden = false;
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  glLost = false;
  pathTracer = null; ptReady = false;
  if (!hdr) scene.environment = studioEnvironment();   // the old one lived only on the GPU
  $('#gpulost').hidden = true;
  build();
});
$('#gpulost [data-gl="reload"]').addEventListener('click', () => location.reload());

const labels = new CSS2DRenderer();
labels.setSize(vw(), vh());
labels.domElement.className = 'label-layer';
viewport.appendChild(labels.domElement);

const scene = new THREE.Scene();
function studioEnvironment(r = renderer) {
  const pmrem = new THREE.PMREMGenerator(r), tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return tex;
}
scene.environment = studioEnvironment();
// The picture a renderer last drew, as a PNG. Read back from the GPU, not with canvas.toDataURL():
// after a graphics reset Chrome hands back a blank picture from the canvas.
function rendererPNG(r) {
  const gl = r.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
  const target = r.getRenderTarget();
  r.setRenderTarget(null);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  r.setRenderTarget(target);
  const img = new ImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) d.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);   // GL rows run bottom-up
  for (let i = 3; i < d.length; i += 4) {   // GL colour is premultiplied by alpha; an image wants it straight
    const a = d[i];
    if (a && a < 255) for (let k = i - 3; k < i; k++) d[k] = Math.min(255, Math.round((d[k] * 255) / a));
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

const FOV = { orbit: 42, eye: 62 };
const camera = new THREE.PerspectiveCamera(FOV.orbit, vw() / vh(), 0.03, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

const M = createMaterials();

// ── Lighting rig (re-aimed for every plan) ──────────────────────────────────
const hemi = new THREE.HemisphereLight('#e4ebf2', '#6b5a4a', 1);
const sun = new THREE.DirectionalLight('#fff1dc', 3);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(LOW ? 1024 : 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(hemi, sun, sun.target);

const HDR_RES = LOW ? '1k' : '2k';   // 1.7 MB instead of 6.6 MB on phones
const HDRI = {
  day: `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/${HDR_RES}/canary_wharf_${HDR_RES}.hdr`,
  evening: `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/${HDR_RES}/shanghai_bund_${HDR_RES}.hdr`,
};
const hdrCache = {};
const loadHDR = (name) => (hdrCache[name] ??= new HDRLoader().loadAsync(HDRI[name])
  .then((t) => { t.mapping = THREE.EquirectangularReflectionMapping; return t; })
  .catch((e) => { console.warn('HDRI failed, keeping studio environment:', e); return null; }));

// photoEnv / photoExposure apply to the path-traced Photo render from inside the room
// (dollhouse renders have no ceiling, so they keep the live exposure).
const MODES = {
  day:     { bg: '#e6e2db', hemi: 0.75, sun: 3.2, env: 0.45, bulb: 0.8, lamps: 0, exposure: 1.0,  photoEnv: 1.0, photoExposure: 3.4 },
  evening: { bg: '#13151a', hemi: 0.05, sun: 0,   env: 0.06, bulb: 9,   lamps: 1, exposure: 1.25, photoEnv: 0.5, photoExposure: 1.4 },
};
let lighting = 'day', hdr = null, inside = false;
function updateBackground() {
  scene.background = inside && hdr ? hdr : new THREE.Color(MODES[lighting].bg);
}
// A room with no real daylight is lit by its own lamps in both modes.
function lightMode() {
  const m = MODES[lighting];
  return world && !world.daylit ? { ...m, bulb: MODES.evening.bulb, lamps: 1, photoExposure: 1.0 } : m;
}
function applyLampLevels() {
  const m = lightMode();
  M.bulb.emissiveIntensity = m.bulb;
  for (const l of world?.lamps ?? []) l.light.intensity = l.intensity * m.lamps;
}
async function setLighting(name) {
  lighting = name;
  const m = MODES[name];
  hdr = null;
  updateBackground();
  hemi.intensity = m.hemi;
  sun.intensity = m.sun; sun.visible = m.sun > 0;
  scene.environmentIntensity = m.env;
  renderer.toneMappingExposure = m.exposure;
  applyLampLevels();
  document.body.dataset.lighting = name;
  $('#btn-light').textContent = name === 'day' ? '☀ Day' : '☾ Evening';
  const tex = await loadHDR(name);
  if (lighting !== name || !tex) return;
  hdr = tex;
  scene.environment = tex;
  updateBackground();
}

// ── World: everything built from the plan ───────────────────────────────────
let world = null;

// The path tracer assumes one material per mesh: split multi-material meshes (walls,
// monitor) into one mesh per material, and drop unused groups (BoxGeometry adds 6).
function splitMultiMaterial(root) {
  const multi = [];
  root.traverse((o) => { if (o.isMesh && Array.isArray(o.material)) multi.push(o); });
  for (const mesh of multi) {
    const src = mesh.geometry, byMat = new Map();
    for (const g of src.groups) {
      const mat = mesh.material[g.materialIndex];
      if (!byMat.has(mat)) byMat.set(mat, []);
      for (let i = g.start; i < g.start + g.count; i++) byMat.get(mat).push(src.index.getX(i));
    }
    const parts = new THREE.Group();
    parts.position.copy(mesh.position); parts.quaternion.copy(mesh.quaternion); parts.scale.copy(mesh.scale);
    for (const [mat, indices] of byMat) {
      const geo = new THREE.BufferGeometry();
      for (const k in src.attributes) geo.setAttribute(k, src.attributes[k]);
      geo.setIndex(indices);
      const part = new THREE.Mesh(geo, mat);
      part.castShadow = mesh.castShadow; part.receiveShadow = mesh.receiveShadow;
      parts.add(part);
    }
    mesh.parent.add(parts);
    mesh.removeFromParent();
  }
  root.traverse((o) => { if (o.isMesh) o.geometry.clearGroups(); });
}

function disposeWorld(w) {
  scene.remove(w.root);
  w.root.traverse((o) => {
    if (o.isMesh && !o.userData.shared) o.geometry.dispose();
    if (o.isLine) { o.geometry.dispose(); o.material.dispose(); }   // dimension lines: new every build
    if (o.isCSS2DObject) o.element.remove();
  });
}

// Build the 3D world from the plan. If a plan can't be built (a broken import or an old
// save), fall back to the last plan that worked, or to plan.js, instead of a blank view.
let lastGood = null;
function build() {
  try {
    buildWorld();
    lastGood = JSON.stringify(plan);
  } catch (e) {
    console.error('This plan could not be built:', e);
    try { localStorage.setItem(`${STORE}-broken`, JSON.stringify(plan)); } catch { /* full storage: skip the backup */ }
    const startup = !lastGood;
    plan = startup ? samplePlanCopy() : JSON.parse(lastGood);
    if (!startup) savePlan(plan);   // at startup the saved plan stays as it is until the next edit
    buildWorld();
    lastGood = JSON.stringify(plan);
    editor?.refresh();
    setTimeout(() => toast(startup ? 'Your saved plan couldn’t be built, so the starting room is shown. A backup copy of your plan was kept.'
      : 'That plan couldn’t be built, so the last working version was restored.'), 0);
  }
}
function buildWorld() {
  stopPhoto();
  if (world) disposeWorld(world);
  // Mid-drag, walls change length every frame: fit doors and windows to them for this build
  // only, so a wall that is briefly shorter than its window doesn't shrink or drop it for good.
  const dragging = !!editor?.dragging;
  const keepOpenings = dragging ? plan.openings.map((o) => [o, o.width, o.offset]) : null;
  ready(plan, !dragging);   // never renumber corners under a drag in progress
  const root = new THREE.Group();
  const room = buildRoom(plan, M);
  root.add(room.group);
  const ctx = { M, plan, H: plan.ceilingHeight, lamps: [...room.lamps] };
  const nearestWall = ([x, y]) => {
    let best = null, bestD = Infinity;
    for (const w of room.walls) {
      const [ax, ay] = w.p1, [bx, by] = w.p2, dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
      if (d < bestD) { bestD = d; best = w; }
    }
    return best;
  };
  const items = [];
  plan.furniture.forEach((item, idx) => {
    const obj = buildFurniture(item, ctx);
    if (!obj) return;
    obj.userData.item = idx;
    obj.userData.base = obj.position.clone().sub(new THREE.Vector3(item.at?.[0] ?? 0, 0, item.at?.[1] ?? 0));
    items[idx] = obj;
    (obj.userData.ceiling ? room.ceilingGroup : root).add(obj);
    if (obj.userData.wallMounted) nearestWall(item.at).attached.push(obj);   // hides with its wall
  });
  (plan.notes ?? []).forEach((n, j) => {
    if (!n.pin) return;
    const el = document.createElement('div');
    el.className = `pin3 ${n.status}`;
    el.innerHTML = `<b>${n.status === 'done' ? '✓' : j + 1}</b><span>${esc(n.text)}<em>${esc(n.result ?? '')}</em></span>`;
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); el.classList.toggle('open'); });   // tap to read
    const pin = new CSS2DObject(el);
    pin.position.set(n.pin[0], n.h ?? 1.2, n.pin[1]);
    root.add(pin);
  });
  splitMultiMaterial(root);
  scene.add(root);

  const b = room.bounds;
  const center = new THREE.Vector3(b.cx, 0, b.cy);
  const maxDim = Math.max(b.w, b.d);
  const windowWall = room.walls.reduce((a, w) => (w.windowArea > a.windowArea ? w : a), room.walls[0]);
  const sunDir = windowWall.outward.clone().applyAxisAngle(Y, 0.5);
  sun.position.copy(center).addScaledVector(sunDir, 10).add(new THREE.Vector3(0, 7, 0));
  sun.target.position.copy(center);
  const ext = maxDim * 0.85 + 1.5;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 40 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.environmentRotation.y = scene.backgroundRotation.y = Math.atan2(-windowWall.outward.z, windowWall.outward.x);

  if (LOW) for (const l of ctx.lamps) l.light.castShadow = false;   // each lamp shadow is 6 extra renders per frame
  if (keepOpenings) plan.openings = keepOpenings.map(([o, w, off]) => Object.assign(o, { width: w, offset: off }));
  world = { root, room, items, lamps: ctx.lamps, center, maxDim, windowWall, daylit: windowWall.windowArea > 0.5 };
  ceilingShown = null;
  applyLampLevels();
  buildViews();
  refreshUI();
  // Keep the selection on the same piece (by identity): deletes and notes shift indices.
  const keep = selRef ? plan.furniture.indexOf(selRef) : -1;
  setSelected(keep, { quiet: keep === selected });
}

// ── Live editing: one selection shared by the 2D plan and the 3D view ───────
let selected = -1, selRef = null, selBox = null, buildQueued = false;
const requestBuild = () => { buildQueued = true; };
function syncItem(i) {
  const obj = world?.items[i], f = plan.furniture[i];
  if (!obj || !f?.at) return;
  const b = obj.userData.base;
  obj.position.set(b.x + f.at[0], b.y, b.z + f.at[1]);
  obj.rotation.y = facingToRadians(f.facing);
  selBox?.update();
}
function setSelected(i, { fromEditor = false, quiet = false } = {}) {
  selected = plan.furniture[i] ? i : -1;
  selRef = selected >= 0 ? plan.furniture[selected] : null;
  if (selBox) { scene.remove(selBox); selBox.geometry.dispose(); selBox = null; }
  const obj = world?.items[selected];
  if (obj) { selBox = new THREE.BoxHelper(obj, 0xc9864f); selBox.material.depthTest = false; selBox.renderOrder = 9; scene.add(selBox); }
  if (!fromEditor && !quiet) editor.select(selected >= 0 ? { kind: 'item', i: selected } : null);
  const bar = $('#selbar'), f = plan.furniture[selected];
  bar.hidden = !f;
  if (f) $('#sel-name').textContent = CATALOG[f.type]?.name ?? f.type;
  updateHint();
}
setOnModelLoaded(() => selBox?.update());

// ── Dollhouse cutaway: hide walls between camera and room, keep their shadows ─
const ghost = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
function setGhost(obj, on) {
  obj.traverse((m) => {
    if (!m.isMesh) return;
    if (on) { m.userData.mat ??= m.material; m.material = ghost; }
    else if (m.userData.mat) m.material = m.userData.mat;
  });
}
let ceilingShown = null;
function updateCutaway() {
  const { room } = world, p = camera.position;
  inside = room.contains(p.x, p.z) && p.y > 0 && p.y < room.H;
  for (const w of room.walls) {
    const cut = !inside && p.clone().sub(w.mid).dot(w.outward) > 0;
    if (cut !== w.cut) {
      w.cut = cut; setGhost(w.full, cut); w.stub.visible = cut;
      w.attached.forEach((o) => (o.visible = !cut));
    }
  }
  if (inside !== ceilingShown) { ceilingShown = inside; setGhost(room.ceilingGroup, !inside); updateBackground(); }
}

// ── Photo render: progressive path tracing + edge-aware denoise ─────────────
let pathTracer = null, photo = false, ptReady = false, photoHidden = [], photoSwapped = [], photoExposure = 1;
// Real glass for the path tracer: thin, clear, reflective (the live view uses cheap alpha glass).
const glassPT = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.02, metalness: 0, transmission: 1, ior: 1.5, thickness: 0, side: THREE.DoubleSide });
const denoise = new FullScreenQuad(new DenoiseMaterial({ map: null, blending: THREE.NoBlending }));
const setStatus = (t) => { $('#status').textContent = t; $('#status').hidden = !t; };
function ensurePathTracer() {
  if (pathTracer) return;
  pathTracer = new WebGLPathTracer(renderer);
  Object.assign(pathTracer, { bounces: 6, transmissiveBounces: 6, filterGlossyFactor: 0.5, minSamples: 1, renderToCanvas: false });
  pathTracer.tiles.set(2, 2);
  // Big screens converge much faster at a slightly lower internal resolution.
  pathTracer.renderScale = window.devicePixelRatio > 1.25 ? 0.75 : 1;
}

// The path tracer can only light from an equirectangular sky. If the HDRI could not download
// (offline, or a host that blocks it), the live view keeps its studio cube, which the path
// tracer cannot read, so Photo gets a soft generated sky instead.
let skyFallback = null;
function photoEnvironment() {
  if (hdr) return hdr;
  if (!skyFallback) {
    const w = 64, h = 32, data = new Float32Array(w * h * 4);
    const top = [214, 226, 240], horizon = [246, 244, 238], ground = [150, 142, 132];
    for (let j = 0; j < h; j++) {   // row 0 is the bottom (v = 0): ground, then horizon, then sky
      const t = 1 - j / (h - 1), c = t < 0.5 ? top.map((v, k) => v + (horizon[k] - v) * (t / 0.5)) : horizon.map((v, k) => v + (ground[k] - v) * ((t - 0.5) / 0.5));
      for (let i = 0; i < w; i++) data.set([...c.map((v) => v / 255), 1], (j * w + i) * 4);
    }
    // linear floats like a real HDRI (the path tracer can't decode an sRGB sky)
    skyFallback = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
    skyFallback.mapping = THREE.EquirectangularReflectionMapping;
    skyFallback.colorSpace = THREE.LinearSRGBColorSpace;
    skyFallback.needsUpdate = true;
  }
  return skyFallback;
}
let liveEnvironment = null;
function usePhotoEnvironment(on) {
  if (on) { liveEnvironment = scene.environment; scene.environment = photoEnvironment(); }
  else if (liveEnvironment) { scene.environment = hdr ?? liveEnvironment; liveEnvironment = null; }
}

// Compile the path-tracing shader in the background once the page is idle, so the
// first Photo render starts in seconds instead of ~30 s.
async function prewarmPathTracer() {
  await Promise.all([M.ready, loadHDR(lighting)]);
  if (photo || glLost) return;
  ensurePathTracer();
  usePhotoEnvironment(true);
  try { pathTracer.setScene(scene, camera); pathTracer.renderSample(); }
  finally { usePhotoEnvironment(false); }
}

async function startPhoto() {
  if (photo || glLost) return;   // no Photo while the graphics card is resetting
  if (tween) { tween.start = -Infinity; stepTween(performance.now()); }   // finish any camera move first
  photo = true; ptReady = false;
  document.body.classList.add('photo');
  $('#btn-photo').classList.add('active');
  setStatus('Loading materials…');
  await Promise.all([M.ready, loadHDR(lighting), Promise.race([modelsReady(), new Promise((r) => setTimeout(r, 20000))])]);
  if (!photo) return;
  if (selBox) selBox.visible = false;
  controls.update();
  updateCutaway();
  // Remove cut-away walls/ceiling (invisible-but-shadowing in the live view), and swap the
  // alpha glass for physically transmissive glass so panes stay visible and let light through.
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    if (o.material === ghost) { o.visible = false; photoHidden.push(o); }
    else if (o.material === M.glass) { o.material = glassPT; photoSwapped.push(o); }
  });
  const m = lightMode();
  scene.environmentIntensity = m.photoEnv;
  photoExposure = inside ? m.photoExposure : m.exposure;
  ensurePathTracer();
  setStatus('Preparing scene…');
  await new Promise((r) => setTimeout(r, 50));          // let the status paint before the blocking build
  if (!photo) return;                                    // cancelled meanwhile: skip the multi-second build
  usePhotoEnvironment(true);
  pathTracer.setScene(scene, camera);
  if (!photo) return;
  ptReady = true;
}

function stopPhoto() {
  if (!photo) return;
  photo = ptReady = false;
  photoHidden.forEach((o) => (o.visible = true));
  photoHidden = [];
  photoSwapped.forEach((o) => (o.material = M.glass));
  photoSwapped = [];
  usePhotoEnvironment(false);
  if (selBox) selBox.visible = true;
  const m = lightMode();
  scene.environmentIntensity = m.env;
  renderer.toneMappingExposure = m.exposure;
  document.body.classList.remove('photo');
  $('#btn-photo').classList.remove('active');
  setStatus('');
}
controls.addEventListener('start', stopPhoto);

// Past this the image no longer visibly improves (the denoiser is fully off from 400), so the
// path tracer stops and the finished photo is only redrawn, sparing the GPU and battery.
let photoSamples = 500;
const photoDone = () => !!pathTracer && pathTracer.samples >= photoSamples;
function renderPhotoFrame() {
  if (!photoDone()) pathTracer.renderSample();
  const n = Math.floor(pathTracer.samples);
  if (n < 1) {
    renderer.toneMappingExposure = MODES[lighting].exposure;
    renderer.render(scene, camera);
    setStatus(pathTracer.isCompiling ? 'Starting renderer… (first time only, up to ~30 s)' : 'Rendering…');
    return;
  }
  renderer.toneMappingExposure = photoExposure;
  const mat = denoise.material;
  mat.map = pathTracer.target.texture;
  // Strong smoothing while noisy, fading out as samples accumulate.
  const k = Math.max(0, 1 - n / 400);
  mat.sigma = 1 + 4 * k; mat.threshold = 0.012 + 0.09 * k;
  renderer.setRenderTarget(null);
  denoise.render(renderer);
  setStatus(`Photo render · ${n} samples${photoDone() ? ' — done' : n < 60 ? ' — refining…' : n < 250 ? ' — looking good' : ' — final quality'}`);
}

// ── Views / camera moves ────────────────────────────────────────────────────
let mode = 'orbit';
let tween = null;
let VIEWS = {};

function applyControlMode(m) {
  mode = m;
  const { maxDim } = world;
  if (m === 'eye') {
    Object.assign(controls, { enableZoom: false, enablePan: false, minDistance: 0.05, maxDistance: 0.2,
      minPolarAngle: 0.35, maxPolarAngle: Math.PI - 0.35, rotateSpeed: 0.45 });
  } else {
    Object.assign(controls, { enableZoom: true, enablePan: true, minDistance: 1.2, maxDistance: maxDim * 5,
      minPolarAngle: 0, maxPolarAngle: Math.PI * 0.49, rotateSpeed: 0.9 });
  }
  updateHint();
}
function updateHint() {
  if (noteMode) return;
  const f = plan.furniture[selected];
  const name = f && (CATALOG[f.type]?.name ?? 'piece').toLowerCase();
  $('#hint').textContent = f
    ? (LOW ? `Tap a spot to move the ${name} there · tap it again or ✕ to let go` : `Drag the ${name} to move it · drag anywhere else to orbit · click empty space to let go`)
    : mode === 'eye'
      ? (LOW ? 'Drag to look around · tap the floor to walk there · tap a piece to select it' : 'Drag to look around · click the floor or W A S D to walk · click a piece to select it')
      : (LOW ? 'Drag to orbit · pinch to zoom · tap a piece to select it' : 'Drag to orbit · scroll to zoom · right-drag to pan · click a piece to select it, then drag it');
}

// After walls move, a saved eye-level spot can sit outside the room (and walking would be
// blocked there): step it in toward the middle, a little past the wall.
function eyeInside([x, z]) {
  const { room, center: c } = world, at = (k) => [x + (c.x - x) * k, z + (c.z - z) * k];
  if (room.contains(x, z)) return [x, z];
  for (let k = 0.05; k <= 1; k += 0.05) {
    if (!room.contains(...at(k))) continue;
    const further = at(Math.min(1, k + 0.05));
    return room.contains(...further) ? further : at(k);
  }
  return [c.x, c.z];
}
function buildViews() {
  const { center, maxDim, windowWall } = world;
  VIEWS = {
    overview: { label: 'Overview', get: () => {
      const dir = windowWall.outward.clone().negate().applyAxisAngle(Y, 0.55);
      const d = maxDim * 1.45 * Math.max(1, 0.95 / camera.aspect);   // pull back when the 3D view is narrow
      return { pos: center.clone().addScaledVector(dir, d).add(new THREE.Vector3(0, d * 0.95, 0)), target: center.clone().setY(0.4), mode: 'orbit' };
    } },
    top: { label: 'Top plan', get: () => {
      const h = (maxDim / 2) / Math.tan(THREE.MathUtils.degToRad(FOV.orbit / 2)) * 1.3 * Math.max(1, 1 / camera.aspect) + plan.ceilingHeight;
      return { pos: center.clone().add(new THREE.Vector3(0, h, 0.001)), target: center.clone(), mode: 'orbit' };
    } },
  };
  const eyes = Array.isArray(plan.views) && plan.views.length ? plan.views : autoViews(plan);
  eyes.forEach((v, i) => {
    VIEWS[`eye${i}`] = { label: v.name, eye: true, get: () => {
      const [ex, ez] = eyeInside(v.eye);
      const pos = new THREE.Vector3(ex, v.eyeHeight ?? 1.6, ez);
      const dir = new THREE.Vector3(v.look[0] - ex, -0.12, v.look[1] - ez).normalize();
      return { pos, target: pos.clone().addScaledVector(dir, 0.1), far: pos.clone().addScaledVector(dir, 3), mode: 'eye' };
    } };
  });
  const bar = $('#views');
  bar.innerHTML = '';
  let sepDone = false;
  for (const [key, v] of Object.entries(VIEWS)) {
    if (v.eye && !sepDone) { const sep = document.createElement('span'); sep.className = 'sep'; bar.appendChild(sep); sepDone = true; }
    const el = document.createElement('button');
    el.dataset.view = key; el.textContent = v.label;
    el.addEventListener('click', () => goTo(key));
    bar.appendChild(el);
  }
}

function walkTo(p) {
  const pos = new THREE.Vector3(p.x, camera.position.y, p.z);
  if (!world.room.contains(pos.x, pos.z) || pos.distanceTo(camera.position) < 0.3) return;
  const look = controls.target.clone().sub(camera.position);
  controls.enabled = false;
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), f0: camera.fov, start: performance.now(), dur: 700,
    v: { pos, target: pos.clone().add(look), far: pos.clone().add(look.clone().normalize().multiplyScalar(3)), mode: 'eye' } };
}

function goTo(key, instant = false) {
  stopPhoto();
  const v = VIEWS[key].get();
  document.querySelectorAll('[data-view]').forEach((el) => el.classList.toggle('active', el.dataset.view === key));
  if (instant) {
    camera.position.copy(v.pos); controls.target.copy(v.target); applyControlMode(v.mode);
    camera.fov = FOV[v.mode]; camera.updateProjectionMatrix(); return;
  }
  controls.enabled = false;
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), f0: camera.fov, v, start: performance.now(), dur: 1300 };
}

function stepTween(now) {
  if (!tween) return;
  const k = Math.min(1, (now - tween.start) / tween.dur);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const { v } = tween;
  camera.position.lerpVectors(tween.p0, v.pos, e);
  controls.target.lerpVectors(tween.t0, v.far ?? v.target, e);
  camera.fov = THREE.MathUtils.lerp(tween.f0, FOV[v.mode], e);
  camera.updateProjectionMatrix();
  if (k === 1) {
    controls.target.copy(v.target);
    applyControlMode(v.mode);
    controls.enabled = true;
    tween = null;
  }
}

// Walk with keyboard in eye-level mode
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;   // Ctrl+D etc. never walk
  keys.add(e.code);
  if (mode === 'eye' && /^(Key[WASD]|Arrow)/.test(e.code)) stopPhoto();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());   // Alt-Tab away while holding W must not keep walking
function walk(dt) {
  if (mode !== 'eye' || tween || !keys.size) return;
  const fwd = controls.target.clone().sub(camera.position).setY(0).normalize();
  const right = fwd.clone().cross(Y);
  const f = (keys.has('KeyW') || keys.has('ArrowUp')) - (keys.has('KeyS') || keys.has('ArrowDown'));
  const r = (keys.has('KeyD') || keys.has('ArrowRight')) - (keys.has('KeyA') || keys.has('ArrowLeft'));
  if (!f && !r) return;
  const move = fwd.multiplyScalar(f).add(right.multiplyScalar(r)).normalize().multiplyScalar(1.4 * dt);
  const next = camera.position.clone().add(move);
  if (world.room.contains(next.x, next.z)) { camera.position.copy(next); controls.target.add(move); }
}

// ── UI ──────────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let dimsOn = false;
const setDims = (on) => { dimsOn = on; world.room.dims.forEach((d) => (d.visible = on)); $('#btn-dims').classList.toggle('active', on); };

function scheduleRows() {
  const counts = new Map();
  for (const f of plan.furniture) if (CATALOG[f.type]) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
  let n = 0;
  return [...counts].map(([t, q]) => ({ tag: `F-${String(++n).padStart(2, '0')}`, item: CATALOG[t].name, spec: CATALOG[t].spec, qty: q }));
}

function refreshUI() {
  const b = bbox(plan.outline), area = world.room.area;
  $('#title').textContent = plan.concept?.title ?? 'Office';
  $('#meta').textContent =
    `${b.w.toFixed(1)} × ${b.d.toFixed(1)} m  ·  ${area.toFixed(1)} m² (${Math.round(area * 10.764)} ft²)  ·  ${plan.ceilingHeight} m ceiling`;
  $('#placeholder').hidden = !plan.placeholder;
  setDims(dimsOn);

  $('#concept').textContent = plan.concept?.summary ?? '';
  $('#palette').innerHTML = (plan.concept?.palette ?? [])
    .map((p) => `<li><span class="chip" style="background:${esc(p.hex)}"></span>${esc(p.name)}</li>`).join('');
  $('#schedule').innerHTML = scheduleRows()
    .map((r) => `<tr><td>${r.tag}</td><td><strong>${esc(r.item)}</strong> × ${r.qty}<br><span>${esc(r.spec)}</span></td></tr>`).join('');
  const checks = checkDesign(plan);
  const warns = checks.filter((c) => c.level === 'warn').length;
  $('#check-summary').textContent = warns ? `${warns} to review` : 'All clear';
  $('#check-summary').className = `pill ${warns ? 'warn' : 'ok'}`;
  $('#checks').innerHTML = checks.map((c) => `<li class="${c.level}"><strong>${esc(c.title)}</strong><span>${esc(c.detail)}</span></li>`).join('');
  $('#lighting-spec').innerHTML = Object.entries(RULES.lux).map(([k, v]) => `<li><strong>${k}</strong> ${v}</li>`).join('')
    + `<li><strong>colour</strong> work ${RULES.cct.work}, lounge ${RULES.cct.lounge}</li>`;
  const notes = plan.notes ?? [];
  $('#notes-list').innerHTML = notes.length
    ? notes.map((n, j) => `<li class="${n.status}"><b>${n.status === 'done' ? '✓' : j + 1}</b><span>${esc(n.text)}<em>${esc(n.result ?? '')}</em></span><button data-del="${j}" title="Delete note">×</button></li>`).join('')
    : '<li class="empty">No notes yet. Press 📍 Note and click anywhere.</li>';
  $('#notes-open').textContent = `${notes.filter((n) => n.status === 'open').length} open`;
  $('#sources').innerHTML = SOURCES.map(([topic, src, url]) => `<li><a href="${esc(url)}" target="_blank" rel="noopener">${esc(topic)}</a> — ${esc(src)}</li>`).join('');
}

function downloadText(name, text, type) {
  const a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function wireUI() {
  $('#btn-light').addEventListener('click', () => { stopPhoto(); setLighting(lighting === 'day' ? 'evening' : 'day'); });
  $('#btn-photo').addEventListener('click', () => (photo ? stopPhoto() : startPhoto()));
  $('#btn-dims').addEventListener('click', () => setDims(!dimsOn));
  $('#btn-notes').addEventListener('click', () => {
    const open = $('#panel').classList.toggle('open');
    $('#btn-notes').classList.toggle('active', open);
  });
  $('#panel-close').addEventListener('click', () => { $('#panel').classList.remove('open'); $('#btn-notes').classList.remove('active'); });
  $('#btn-shot').addEventListener('click', () => {
    const a = document.createElement('a');
    a.download = `office-${Date.now()}.png`;
    a.href = rendererPNG(renderer);
    a.click();
  });
  $('#btn-csv').addEventListener('click', () => {
    const rows = [['Tag', 'Item', 'Specification', 'Qty'], ...scheduleRows().map((r) => [r.tag, r.item, r.spec, r.qty])];
    downloadText('ffe-schedule.csv', rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  });
  $('#btn-edit').addEventListener('click', () => (editorOpen ? closeEditor() : openEditor()));
  $('#btn-add').addEventListener('click', () => library.open());
  $('#btn-undo').addEventListener('click', () => editor.undo());
  $('#btn-redo').addEventListener('click', () => editor.redo());
  $('#btn-note').addEventListener('click', () => setNoteMode(!noteMode));
  $('#selbar').addEventListener('click', (e) => {
    const a = e.target.closest('[data-sa]')?.dataset.sa;
    if (!a || selected < 0) return;
    if (a === 'rotl') editor.rotate(selected, -15);
    else if (a === 'rotr') editor.rotate(selected, 15);
    else if (a === 'rot90') editor.rotate(selected, 90);
    else if (a === 'dup') { editor.duplicate(selected); setSelected(editor.selection?.i ?? -1); }
    else if (a === 'del') { editor.remove(selected); setSelected(-1); }
    else if (a === 'none') setSelected(-1);
  });
  $('#notes-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    editor.checkpoint(); plan.notes.splice(+b.dataset.del, 1); savePlan(plan); requestBuild(); editor.refresh();
  });
}

// ── Plan editor (2D), docked beside the live 3D view ────────────────────────
let editorOpen = false;
const editor = createEditor({
  getPlan: () => plan,
  setPlan: (p) => { plan = p; },
  onChange: () => { savePlan(plan); requestBuild(); },
  onClose: () => closeEditor(),
  samplePlan: samplePlanCopy,
  onLive: (kind, i) => (kind === 'item' ? syncItem(i) : requestBuild()),
  onSelect: (sel) => setSelected(sel?.kind === 'item' ? sel.i : -1, { fromEditor: true }),
  onLibrary: () => library.open(),
  onNote: (target, x, y) => showNotePopover(target, x, y),
});
function openEditor() {
  editorOpen = true;
  document.body.classList.add('split');
  onResize();
  editor.open();
  editor.select(selected >= 0 ? { kind: 'item', i: selected } : null);
  $('#btn-edit').textContent = '✕ Hide 2D plan';
}
function closeEditor() {
  editor.close();
  editorOpen = false;
  document.body.classList.remove('split');
  onResize();
  $('#btn-edit').textContent = '◧ 2D plan + 3D';
}

function onResize() {
  camera.aspect = vw() / vh();
  camera.updateProjectionMatrix();
  renderer.setSize(vw(), vh());
  labels.setSize(vw(), vh());
  if (ptReady) pathTracer.updateCamera();
}
window.addEventListener('resize', onResize);
new ResizeObserver(() => onResize()).observe(viewport);

// ── Asset library ───────────────────────────────────────────────────────────
let thumbRenderer = null, thumbEnv = null;
const thumbCache = {};
async function thumbFor(type) {
  if (thumbCache[type]) return thumbCache[type];
  await M.ready;
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(160, 160);
    thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    thumbEnv = studioEnvironment(thumbRenderer);
    thumbRenderer.domElement.addEventListener('webglcontextrestored', () => { thumbEnv = studioEnvironment(thumbRenderer); });
  }
  if (thumbRenderer.getContext().isContextLost()) throw new Error('graphics reset');   // never cache a blank picture; retried next time
  const s = new THREE.Scene();
  s.environment = thumbEnv;   // something for metal and mirrors to reflect
  s.environmentIntensity = 0.6;
  s.add(new THREE.HemisphereLight('#ffffff', '#6b5a4a', 1.8));
  const d = new THREE.DirectionalLight('#fff4e6', 2.6); d.position.set(2, 4, 3); s.add(d);
  const item = { type, at: [0, 0], facing: 0, ...structuredClone(ADDABLE[type] ?? {}) };
  const obj = buildFurniture(item, { M, plan, H: plan.ceilingHeight, lamps: [] });
  s.add(obj);
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100), r = Math.max(size.x, size.y, size.z, 0.2);
  cam.position.copy(c).add(new THREE.Vector3(0.75, 0.6, 1.2).normalize().multiplyScalar(r * 2.3));
  cam.lookAt(c);
  thumbRenderer.render(s, cam);
  thumbCache[type] = rendererPNG(thumbRenderer);
  obj.traverse((o) => { if (o.isMesh && !o.userData.shared) o.geometry.dispose(); });
  return thumbCache[type];
}
const library = createLibrary({ onPick: addFromLibrary, thumbFor });

// Where new things appear: in front of you (eye level) or at the orbit target.
function dropPoint() {
  let p = [controls.target.x, controls.target.z];
  if (mode === 'eye') {
    const f = controls.target.clone().sub(camera.position).setY(0).normalize();
    p = [camera.position.x + f.x * 1.6, camera.position.z + f.z * 1.6];
  }
  return pointInPolygon(p[0], p[1], plan.outline) ? p : centroid(plan.outline);
}
function addFromLibrary(type) {
  const c = CATALOG[type], p = dropPoint();
  editor.checkpoint();
  const item = { type, at: [round2(p[0]), round2(p[1])], facing: 0, ...structuredClone(ADDABLE[type] ?? {}) };
  if (c.layer === 'wall') { const sw = snapToWall(plan, p, 99, halfWidth(item)); if (sw) { item.at = sw.at.map(round2); item.facing = sw.facing; } }
  plan.furniture.push(item);
  savePlan(plan);
  build();
  setSelected(plan.furniture.length - 1);
  editor.refresh();
  toast(`Added ${c.name}${c.scanned ? ' (downloading the scanned model…)' : ''} — drag it in 3D or on the plan.`);
}

let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 4200);
}

// ── Notes: click anywhere, type what you want ───────────────────────────────
let noteMode = false, noteTarget = null;
function setNoteMode(on) {
  noteMode = on;
  renderer.domElement.style.cursor = '';   // let the crosshair style show
  $('#btn-note').classList.toggle('active', on);
  document.body.classList.toggle('noting', on);
  $('#hint').textContent = on ? 'Click a wall, the floor, the ceiling or any item to pin a note · Esc cancels' : '';
  if (!on) applyControlMode(mode);
}
function describe(t) {
  if (t.kind === 'wall') return `On wall ${t.wall + 1}`;
  if (t.kind === 'item') return `On ${CATALOG[plan.furniture[t.i]?.type]?.name ?? 'this item'}`;
  return t.kind === 'ceiling' ? 'On the ceiling' : 'On the floor';
}
function showNotePopover(target, x, y) {
  noteTarget = target;
  const pop = $('#note-pop');
  pop.querySelector('.np-where').textContent = describe(target);
  pop.querySelector('.np-chips').innerHTML = (NOTE_SUGGESTIONS[target.kind] ?? []).map((c) => `<button type="button" data-chip="${esc(c)}">${esc(c)}</button>`).join('');
  const input = pop.querySelector('input');
  input.value = '';
  pop.hidden = false;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x + 12))}px`;
  pop.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, y + 12))}px`;
  input.focus();
}
document.addEventListener('mousedown', (e) => { if (!$('#note-pop').hidden && e.target.closest?.('#viewport, svg')) e.preventDefault(); }, true);
// After a finger tap the browser also sends mouse events and a click to the same spot. When the tap
// just opened something there (the selection bar, the note box), they must not press it or take focus.
let tapGhost = null;
document.addEventListener('pointerdown', () => { tapGhost = null; }, true);
document.addEventListener('pointerup', (e) => {
  const area = e.pointerType === 'touch' && e.target.closest?.('#viewport, #ed-svg');
  tapGhost = area ? { area, until: performance.now() + 800 } : null;
}, true);
document.addEventListener('keydown', () => { tapGhost = null; }, true);
for (const type of ['mousedown', 'mouseup', 'click']) {
  document.addEventListener(type, (e) => {
    const g = tapGhost;
    if (type === 'click') tapGhost = null;   // the tap's own click ends it
    if (!g || performance.now() > g.until || e.detail === 0 || g.area.contains(e.target)) return;   // detail 0: Enter or a script
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
}
function hideNotePopover() { $('#note-pop').hidden = true; noteTarget = null; }
function addNote(text) {
  if (!noteTarget || !text.trim()) return hideNotePopover();
  editor.checkpoint();
  plan.notes ??= [];
  const note = { id: Date.now(), text: text.trim(), target: noteTarget, created: new Date().toISOString() };
  const pin = notePoint(plan, note);
  const r = applyNote(plan, note);
  note.status = r.done ? 'done' : 'open';
  note.result = r.done ? r.result : 'Saved for Claude to do';
  note.pin = [round2(pin.at[0]), round2(pin.at[1])];
  note.h = round2(pin.h);
  plan.notes.push(note);
  hideNotePopover();
  setNoteMode(false);
  normalizePlan(plan);
  savePlan(plan);
  build();
  editor.refresh();
  toast(r.done ? `✓ ${r.result}` : 'Note saved — ask Claude in chat to do your open notes.');
}
$('#note-pop').addEventListener('submit', (e) => { e.preventDefault(); addNote(e.target.querySelector('input').value); });
$('#note-pop').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-chip]');
  if (chip) { const inp = $('#note-pop input'); inp.value = chip.dataset.chip; inp.focus(); }
  if (e.target.closest('[data-np="cancel"]')) hideNotePopover();
});

// ── 3D picking: click to select, drag to move, notes ────────────────────────
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hitPlane = new THREE.Plane();
function setRay(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
const shown = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return o.material !== ghost; };
function firstHit(e) {
  setRay(e);
  return ray.intersectObjects(world.root.children, true).find((h) => h.object.isMesh && shown(h.object)) ?? null;
}
function itemOf(o) { for (let q = o; q; q = q.parent) if (q.userData.item !== undefined) return q.userData.item; return -1; }
// What a click grabs: hanging lights don't block the table or desk underneath them.
const HANGING = new Set(['pendant', 'downlight']);
function grabTarget(e) {
  setRay(e);
  const hits = ray.intersectObjects(world.root.children, true).filter((h) => h.object.isMesh && shown(h.object));
  const first = hits[0] ?? null, items = hits.map((h) => ({ h, i: itemOf(h.object) })).filter((x) => x.i >= 0);
  const pick = items.find((x) => !HANGING.has(plan.furniture[x.i]?.type) && CATALOG[plan.furniture[x.i]?.type]?.layer !== 'ceiling') ?? items[0];
  if (!pick) return { hit: first, idx: -1 };
  // a wall or floor in front of the item wins (the item is hidden behind it)
  return first && itemOf(first.object) < 0 && first.distance < pick.h.distance - 0.05 ? { hit: first, idx: -1 } : { hit: pick.h, idx: pick.i };
}
function wallOf(o) { for (let q = o; q; q = q.parent) if (q.userData.wall !== undefined) return q.userData.wall; return -1; }
function planeHit(e, y) {
  setRay(e);
  hitPlane.set(new THREE.Vector3(0, 1, 0), -y);
  return ray.ray.intersectPlane(hitPlane, new THREE.Vector3());
}

// Touch never drags furniture in 3D: one finger orbits, two fingers zoom. A quick tap on a
// piece selects it, a tap on a spot moves the selected piece there, and a tap on the selected
// piece lets it go. A mouse clicks a piece to select it and can then drag it; a drag that starts
// on anything not selected orbits, so turning the view never moves furniture by accident.
const TAP_PX = (e) => (e.pointerType === 'mouse' ? 4 : 10);
const TAP_MS = 500;   // a longer press is a held finger starting to orbit, not a tap
const fingers = new Set();
let drag3 = null, click3 = null;
function noteTargetAt(e) {
  const hit = firstHit(e);
  if (!hit) return null;
  const P2 = [round2(hit.point.x), round2(hit.point.z)], idx = itemOf(hit.object), wi = wallOf(hit.object);
  if (idx >= 0) return { kind: 'item', i: idx, at: plan.furniture[idx].at ?? P2, hit: P2, h: round2(hit.point.y) };
  if (wi >= 0) { const w = getWalls(plan)[wi]; return { kind: 'wall', wall: wi, t: round2(dot(sub(P2, w.a), w.u)), h: round2(hit.point.y) }; }
  return { kind: hit.object.userData.surface === 'ceiling' ? 'ceiling' : 'floor', at: P2 };
}
viewport.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !world || drag3) return;   // a second pointer while dragging is ignored
  if (e.target.closest?.('.pin3')) return;           // tapping a note pin just opens it
  const touch = e.pointerType !== 'mouse';
  if (touch) {
    if (e.isPrimary) fingers.clear();   // the first finger down: nothing else is touching
    fingers.add(e.pointerId);
    if (fingers.size > 1) { click3 = null; return; }   // a pinch, not a tap
  }
  if (noteMode) {
    // a finger pins on lift-off, so the first finger of a pinch or an orbit never opens the box
    if (touch) { click3 = { x: e.clientX, y: e.clientY, idx: -1, touch, id: e.pointerId, t: performance.now(), tol: TAP_PX(e) }; return; }
    const target = noteTargetAt(e);
    if (!target) return;
    e.stopPropagation(); controls.enabled = false;
    setTimeout(() => { controls.enabled = true; }, 0);
    showNotePopover(target, e.clientX, e.clientY);
    return;
  }
  const { hit: gh, idx: hitIdx } = grabTarget(e);
  const idx = hitIdx >= 0 && plan.furniture[hitIdx]?.at ? hitIdx : -1;
  if (idx >= 0 && !touch && idx === selected) {
    stopPhoto();
    controls.enabled = false;
    const g = gh.point, f = plan.furniture[idx];
    drag3 = { i: idx, id: e.pointerId, y: g.y, grab: [f.at[0] - g.x, f.at[1] - g.z], s: [e.clientX, e.clientY], tol: TAP_PX(e), moved: false, riders: ridersOf(plan, idx) };
    viewport.setPointerCapture(e.pointerId);
  } else click3 = { x: e.clientX, y: e.clientY, idx, touch, id: e.pointerId, t: performance.now(), tol: TAP_PX(e) };
}, true);
let hoverAt = 0;
viewport.addEventListener('pointermove', (e) => {
  if (drag3 && e.pointerId !== drag3.id) return;
  if (!drag3) {
    // hover feedback: grab cursor over furniture (throttled raycast)
    const now = performance.now();
    if (noteMode || photo || e.buttons || now - hoverAt < 60 || !world) return;
    hoverAt = now;
    const h = firstHit(e);
    const hi = h ? itemOf(h.object) : -1;
    renderer.domElement.style.cursor = hi < 0 ? '' : hi === selected ? 'grab' : 'pointer';
    return;
  }
  renderer.domElement.style.cursor = 'grabbing';
  if (!drag3.moved && Math.hypot(e.clientX - drag3.s[0], e.clientY - drag3.s[1]) < drag3.tol) return;
  const p = planeHit(e, drag3.y);
  if (!p) return;
  if (!drag3.moved) { editor.checkpoint(); drag3.moved = true; }
  const f = plan.furniture[drag3.i];
  let q = [p.x + drag3.grab[0], p.z + drag3.grab[1]];
  if (!e.shiftKey) q = q.map((v) => Math.round(v / 0.05) * 0.05);
  if (CATALOG[f.type]?.layer === 'wall') { const sw = snapToWall(plan, q, 99, halfWidth(f)); if (sw) { q = sw.at; f.facing = sw.facing; } }
  else if (!pointInPolygon(q[0], q[1], plan.outline)) return;   // keep furniture inside the room
  f.at = [round2(q[0]), round2(q[1])];
  syncItem(drag3.i);
  for (const r of drag3.riders) { plan.furniture[r.j].at = [round2(f.at[0] + r.off[0]), round2(f.at[1] + r.off[1])]; syncItem(r.j); }
  editor.refresh({ inspector: false });
});
const endDrag3 = (e) => {
  if (e.pointerType !== 'mouse') fingers.delete(e.pointerId);
  if (drag3 && e.pointerId !== drag3.id) return;
  if (drag3) {
    const d = drag3; drag3 = null;
    controls.enabled = true;
    renderer.domElement.style.cursor = 'grab';
    if (d.moved) { savePlan(plan); requestBuild(); editor.refresh(); }
    return;
  }
  const c = click3;
  if (!c || e.pointerId !== c.id) return;
  click3 = null;
  if (e.type !== 'pointerup' || Math.hypot(e.clientX - c.x, e.clientY - c.y) >= c.tol) return;
  if (noteMode) { const t = noteTargetAt(e); if (t) showNotePopover(t, e.clientX, e.clientY); return; }
  if (c.touch) {
    if (performance.now() - c.t > TAP_MS) return;
    const sel = plan.furniture[selected];
    // with a piece selected, a tap on the floor, a wall or a rug moves the piece there
    const onFloor = c.idx < 0 || (plan.furniture[c.idx]?.type === 'rug' && c.idx !== selected && sel?.type !== 'rug');
    if (sel && onFloor) { if (!photo) placeSelected(e); return; }
    if (c.idx >= 0) { setSelected(c.idx === selected ? -1 : c.idx); return; }
  } else setSelected(c.idx);   // a click on empty space clears the selection
  if (c.idx < 0 && mode === 'eye' && !photo) {   // tap/click the floor to walk there (no keyboard needed)
    const h = firstHit(e);
    if (h?.object.userData.surface === 'floor') walkTo(h.point);
  }
};
// Move the selected piece to the tapped spot (wall pieces go to the nearest wall).
function placeSelected(e) {
  const i = selected, f = plan.furniture[i];
  if (!f?.at) return;
  const onWall = CATALOG[f.type]?.layer === 'wall';
  const p = (onWall ? firstHit(e)?.point : null) ?? planeHit(e, 0);
  if (!p) return;
  let q = [Math.round(p.x / 0.05) * 0.05, Math.round(p.z / 0.05) * 0.05], facing = f.facing;
  if (onWall) { const sw = snapToWall(plan, q, 99, halfWidth(f)); if (!sw) return; q = sw.at; facing = sw.facing; }
  else if (!pointInPolygon(q[0], q[1], plan.outline)) { toast('Tap a spot inside the room to move it there.'); return; }
  const riders = ridersOf(plan, i);
  editor.checkpoint();
  f.at = [round2(q[0]), round2(q[1])]; f.facing = facing;
  for (const r of riders) plan.furniture[r.j].at = [round2(f.at[0] + r.off[0]), round2(f.at[1] + r.off[1])];
  savePlan(plan); build(); setSelected(i); editor.refresh();
}
viewport.addEventListener('pointerup', endDrag3);
viewport.addEventListener('pointercancel', endDrag3);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideNotePopover(); if (noteMode) setNoteMode(false); }   // also from inside the note box
  if (e.target.closest?.('input, select, textarea')) return;
  if (drag3) return;                  // no deletes/undos under a 3D drag in progress
  if (editor.isOpen) return;          // the docked plan handles its own shortcuts
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? editor.redo() : editor.undo(); return; }
  if (ctrl && k === 'y') { e.preventDefault(); editor.redo(); return; }
  if (selected < 0) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); editor.remove(selected); setSelected(-1); }
  else if (ctrl && k === 'd') { e.preventDefault(); editor.duplicate(selected); setSelected(editor.selection?.i ?? -1); }
  else if (k === 'r' && !ctrl) editor.rotate(selected, e.shiftKey ? -15 : 90);
  else if (e.key === 'Escape') setSelected(-1);
});

// A plan saved in this browser from an older starting plan (plan.js has changed since, e.g. new
// measurements): offer the new room once. Undo brings the old layout back.
function offerUpdatedRoom() {
  if (!samplePlan.version || plan.version === samplePlan.version) return;
  const bar = $('#newroom');
  bar.hidden = false;
  bar.onclick = (e) => {
    const a = e.target.closest('[data-nr]')?.dataset.nr;
    if (!a) return;
    bar.hidden = true;
    if (a === 'keep') { plan.version = samplePlan.version; savePlan(plan); return; }
    plan.version = samplePlan.version;   // undo brings the old layout back without offering this again
    editor.checkpoint(); plan = samplePlanCopy(); savePlan(plan); setSelected(-1); build(); editor.refresh();
    goTo('overview', true);              // the old camera spot may be outside the new walls
    toast('Showing the updated room. Undo (↶) brings your old layout back.');
  };
}

wireUI();
build();
setLighting('day');
goTo('overview', true);
offerUpdatedRoom();
setTimeout(() => (window.requestIdleCallback ?? setTimeout)(() => prewarmPathTracer()), 5000);

const timer = new THREE.Timer();
function frame() {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  if (buildQueued && !drag3) { buildQueued = false; build(); }
  if (photo) { if (ptReady) renderPhotoFrame(); return; }
  stepTween(performance.now());
  walk(dt);
  // during a camera move the tween owns the camera: the orbit limits of the view we're
  // leaving (e.g. eye level's 0.2 m leash) must not drag it around
  if (tween) camera.lookAt(controls.target); else controls.update();
  updateCutaway();
  renderer.render(scene, camera);
  labels.render(scene, camera);
}
// Full frame rate while anything is moving or being touched; a still scene is redrawn only
// 4 times a second (enough to show models that finish loading). Keeps phones cool and smooth.
let activeUntil = 0, lastFrame = 0;
const wake = () => { activeUntil = performance.now() + 1500; };
for (const t of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'resize']) window.addEventListener(t, wake, { capture: true, passive: true });
controls.addEventListener('change', wake);
renderer.setAnimationLoop((now) => {
  if ((photo && !photoDone()) || tween || keys.size || drag3 || buildQueued || now < activeUntil || now - lastFrame > 250) { lastFrame = now; frame(); }
});
document.body.classList.add('ready');
setTimeout(() => $('#loading').remove(), 600);
window.__office = { scene, camera, controls, renderer, goTo, setLighting, MODES, frame, editor, library, addFromLibrary, thumbFor, setSelected, syncItem, openEditor, closeEditor, get world() { return world; }, get plan() { return plan; }, get pathTracer() { return pathTracer; }, get photoSamples() { return photoSamples; }, set photoSamples(n) { photoSamples = n; }, build };
