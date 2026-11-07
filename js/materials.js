// Procedural textures (canvas) + shared material palette. No image files needed.
import * as THREE from 'three';

// Deterministic random so the room looks the same on every load.
export function rng(seed = 1) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d', { willReadFrequently: true })];   // kept in normal memory: a GPU reset wipes GPU canvases
}

function toTexture(c, metres, color = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / metres, 1 / metres);   // geometry UVs are in metres
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function speckle(ctx, size, n, rand, alpha, light) {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${rand() * alpha})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
}

// Running-bond brick, 1 m × 1 m tile.
function brickTextures() {
  const S = 1024, rand = rng(7);
  const [c, ctx] = canvas(S);
  const [b, bctx] = canvas(S);
  const rows = 14, cols = 4.5, bh = S / rows, bw = S / cols, m = 7;
  ctx.fillStyle = '#b9ab98'; ctx.fillRect(0, 0, S, S);         // mortar
  bctx.fillStyle = '#000'; bctx.fillRect(0, 0, S, S);
  const tones = ['#8f4630', '#9a4f36', '#a55a3d', '#7f3d2a', '#8a4a35', '#a8634a', '#6f3526'];
  for (let r = 0; r < rows; r++) {
    const shift = (r % 2) * bw / 2;
    for (let k = -1; k < cols + 1; k++) {
      const x = k * bw + shift, y = r * bh;
      ctx.fillStyle = tones[Math.floor(rand() * tones.length)];
      ctx.fillRect(x + m / 2, y + m / 2, bw - m, bh - m);
      // soot / wash variation
      ctx.fillStyle = `rgba(30,15,10,${rand() * 0.25})`;
      ctx.fillRect(x + m / 2, y + m / 2, bw - m, bh - m);
      ctx.fillStyle = `rgba(255,240,220,${rand() * 0.12})`;
      ctx.fillRect(x + m / 2, y + m / 2 + rand() * bh * 0.5, bw - m, bh * 0.3);
      bctx.fillStyle = '#fff';
      bctx.fillRect(x + m / 2, y + m / 2, bw - m, bh - m);
    }
  }
  speckle(ctx, S, 9000, rand, 0.35, false);
  speckle(ctx, S, 4000, rand, 0.2, true);
  return { map: toTexture(c, 1), bump: toTexture(b, 1, false) };
}

// Polished concrete, 2 m tile, with faint saw-cut joints.
function concreteTexture() {
  const S = 1024, rand = rng(3);
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#8e8b86'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    const x = rand() * S, y = rand() * S, r = 20 + rand() * 140;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rand() > 0.5;
    g.addColorStop(0, dark ? 'rgba(60,58,55,0.10)' : 'rgba(200,196,188,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  speckle(ctx, S, 20000, rand, 0.15, rand() > 0.5);
  speckle(ctx, S, 12000, rand, 0.12, true);
  ctx.strokeStyle = 'rgba(40,38,36,0.35)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 1); ctx.lineTo(S, 1); ctx.moveTo(1, 0); ctx.lineTo(1, S); ctx.stroke();
  return toTexture(c, 2);
}

// Reclaimed oak planks, 1 m tile.
function woodTexture() {
  const S = 1024, rand = rng(11);
  const [c, ctx] = canvas(S);
  const planks = 6, ph = S / planks;
  const tones = ['#8a6440', '#7a5536', '#94704a', '#6e4a2e', '#85603e'];
  for (let p = 0; p < planks; p++) {
    ctx.fillStyle = tones[Math.floor(rand() * tones.length)];
    ctx.fillRect(0, p * ph, S, ph);
    for (let g = 0; g < 40; g++) {                      // grain lines
      const y0 = p * ph + rand() * ph, amp = 2 + rand() * 6, f = 0.004 + rand() * 0.01;
      ctx.strokeStyle = `rgba(${rand() > 0.5 ? '40,25,12' : '200,160,110'},${0.06 + rand() * 0.12})`;
      ctx.lineWidth = 1 + rand() * 2;
      ctx.beginPath();
      for (let x = 0; x <= S; x += 16) ctx.lineTo(x, y0 + Math.sin(x * f + g) * amp);
      ctx.stroke();
    }
    for (let k = 0; k < 2; k++) {                       // knots
      const x = rand() * S, y = p * ph + ph * (0.3 + rand() * 0.4);
      ctx.fillStyle = 'rgba(45,28,15,0.5)';
      ctx.beginPath(); ctx.ellipse(x, y, 10 + rand() * 12, 4 + rand() * 5, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(20,12,6,0.6)'; ctx.fillRect(0, p * ph, S, 3);   // plank seam
    const butt = rand() * S;
    ctx.fillRect(butt, p * ph, 3, ph);
  }
  return toTexture(c, 1);
}

// Faded vintage rug (stretched over the rug, UV 0..1).
function rugTexture() {
  const S = 1024, rand = rng(5);
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#6b3a2c'; ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = '#c9b48f'; ctx.lineWidth = 18; ctx.strokeRect(50, 50, S - 100, S - 100);
  ctx.strokeStyle = '#2e3a4a'; ctx.lineWidth = 30; ctx.strokeRect(95, 95, S - 190, S - 190);
  ctx.fillStyle = '#8a4b36'; ctx.fillRect(130, 130, S - 260, S - 260);
  ctx.save(); ctx.translate(S / 2, S / 2);
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#2e3a4a';
    ctx.beginPath(); ctx.moveTo(0, -260); ctx.lineTo(120, -130); ctx.lineTo(0, 0); ctx.lineTo(-120, -130); ctx.fill();
    ctx.fillStyle = '#c9b48f';
    ctx.beginPath(); ctx.moveTo(0, -200); ctx.lineTo(55, -130); ctx.lineTo(0, -60); ctx.lineTo(-55, -130); ctx.fill();
  }
  ctx.restore();
  for (let i = 0; i < 70; i++) {                      // worn patches
    const x = rand() * S, y = rand() * S, r = 30 + rand() * 120;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(220,200,175,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  speckle(ctx, S, 30000, rand, 0.2, false);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// Abstract print for the wall art.
function artTexture() {
  const S = 512, rand = rng(21);
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#e9e2d4'; ctx.fillRect(0, 0, S, S);
  const cols = ['#1e1e20', '#8b4a22', '#b08d57', '#56606b', '#c96f3b'];
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = cols[i % cols.length];
    ctx.globalAlpha = 0.85;
    if (rand() > 0.5) { ctx.beginPath(); ctx.arc(rand() * S, rand() * S, 30 + rand() * 110, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(rand() * S, rand() * S, 40 + rand() * 200, 8 + rand() * 60);
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Suspended acoustic ceiling: 2′ × 2′ (61 cm) mineral-fibre tiles in a white grid.
function ceilingTileTexture() {
  const S = 512, rand = rng(11), T = 0.6096;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#eeece7'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {                     // fissured mineral-fibre pinholes
    ctx.fillStyle = `rgba(120,116,110,${0.08 + rand() * 0.18})`;
    const w = 1 + rand() * 3;
    ctx.fillRect(rand() * S, rand() * S, w, 1 + rand() * 1.5);
  }
  ctx.fillStyle = '#f7f6f3'; ctx.fillRect(0, 0, S, 7); ctx.fillRect(0, 0, 7, S);   // grid tee
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, 7, S, 2); ctx.fillRect(7, 0, 2, S);   // shadow line
  return toTexture(c, T);
}

// Commercial loop-pile carpet tile, charcoal with a fine heather.
function carpetTexture() {
  const S = 512, rand = rng(17);
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#4e4b48'; ctx.fillRect(0, 0, S, S);   // neutral charcoal (daylight reads cool)
  speckle(ctx, S, 26000, rand, 0.22, false);
  speckle(ctx, S, 16000, rand, 0.12, true);
  return toTexture(c, 0.5);
}

export function createMaterials() {
  const brick = brickTextures();
  const M = {
    brick: new THREE.MeshStandardMaterial({ map: brick.map, bumpMap: brick.bump, bumpScale: 3, roughness: 0.92 }),
    plaster: new THREE.MeshStandardMaterial({ color: '#e6dfd3', roughness: 0.95 }),
    charcoal: new THREE.MeshStandardMaterial({ color: '#3a3936', roughness: 0.9 }),
    wallCut: new THREE.MeshStandardMaterial({ color: '#2a2928', roughness: 1 }),
    wallOutside: new THREE.MeshStandardMaterial({ color: '#cfcac2', roughness: 1 }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#2b2b2d', roughness: 0.95, side: THREE.DoubleSide }),
    ceilingTiles: new THREE.MeshStandardMaterial({ map: ceilingTileTexture(), roughness: 0.97, side: THREE.DoubleSide }),
    carpet: new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 1 }),
    slab: new THREE.MeshStandardMaterial({ color: '#3b3a38', roughness: 1 }),
    concrete: new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.38, metalness: 0.05 }),
    wood: new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.7 }),
    steel: new THREE.MeshStandardMaterial({ color: '#1e1e20', roughness: 0.42, metalness: 0.75 }),
    galvanized: new THREE.MeshStandardMaterial({ color: '#9aa0a6', roughness: 0.35, metalness: 0.9 }),
    brass: new THREE.MeshStandardMaterial({ color: '#b08d57', roughness: 0.3, metalness: 1 }),
    leather: new THREE.MeshStandardMaterial({ color: '#8b4a22', roughness: 0.5 }),
    leatherDark: new THREE.MeshStandardMaterial({ color: '#4a2716', roughness: 0.55 }),
    wool: new THREE.MeshStandardMaterial({ color: '#5d5a55', roughness: 1 }),
    rug: new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 1 }),
    art: new THREE.MeshStandardMaterial({ map: artTexture(), roughness: 0.9 }),
    glass: new THREE.MeshStandardMaterial({ color: '#cfe0ea', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false }),
    screen: new THREE.MeshStandardMaterial({ color: '#0d1117', roughness: 0.2, emissive: '#1c2a3a', emissiveIntensity: 0.15 }),
    leaf: new THREE.MeshStandardMaterial({ color: '#3d6b35', roughness: 0.75, side: THREE.DoubleSide }),
    leafDark: new THREE.MeshStandardMaterial({ color: '#2c5128', roughness: 0.75, side: THREE.DoubleSide }),
    potConcrete: new THREE.MeshStandardMaterial({ color: '#a5a29c', roughness: 0.95 }),
    soil: new THREE.MeshStandardMaterial({ color: '#3a2c20', roughness: 1 }),
    paper: new THREE.MeshStandardMaterial({ color: '#efe9de', roughness: 0.9 }),
    felt: new THREE.MeshStandardMaterial({ color: '#4a4945', roughness: 1 }),
    linen: new THREE.MeshStandardMaterial({ color: '#cbbfae', roughness: 1, side: THREE.DoubleSide }),
    ceramic: new THREE.MeshStandardMaterial({ color: '#d9d4cb', roughness: 0.4 }),
    // Bulbs: emissiveIntensity is driven by day / evening mode.
    bulb: new THREE.MeshStandardMaterial({ color: '#fff3dc', emissive: '#ffb066', emissiveIntensity: 0.4 }),
    bookColors: ['#7a2e24', '#2e3a4a', '#c9b48f', '#3f4b3a', '#1e1e20', '#8a6440', '#b5523b', '#e6dfd3'].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 })),
  };
  M.ready = loadScannedMaterials(M);
  return M;
}

// Photo-scanned PBR sets from Poly Haven (CC0). size = real-world tile size in metres
// (surfaces with metric UVs); repeat = tiles per face for 0..1-UV furniture parts.
// The procedural textures above stay as the fallback if these fail to load.
const PH = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k';
const SCANNED = {
  brick:       { id: 'large_red_bricks',  size: 2.0, roughness: 1 },
  concrete:    { id: 'brushed_concrete',  size: 2.5, roughness: 0.55, normalScale: 0.5, tint: '#efe8de' },
  wood:        { id: 'old_planks_02',     size: 1.4, roughness: 0.9, tint: '#f0c38f' },
  leather:     { id: 'fabric_leather_02', repeat: 1.5, roughness: 0.85 },
  leatherDark: { id: 'brown_leather',     repeat: 1.5, roughness: 0.85, diffuse: 'albedo' },
};

async function loadScannedMaterials(M) {
  const loader = new THREE.TextureLoader();
  const load = async (url, srgb, repeat) => {
    const t = await loader.loadAsync(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const results = await Promise.allSettled(Object.entries(SCANNED).map(async ([key, s]) => {
    const base = `${PH}/${s.id}/${s.id}`;
    const rep = s.size ? 1 / s.size : s.repeat;
    const [map, normalMap, roughnessMap] = await Promise.all([
      load(`${base}_${s.diffuse ?? 'diff'}_1k.jpg`, true, rep),
      load(`${base}_nor_gl_1k.jpg`, false, rep),
      load(`${base}_rough_1k.jpg`, false, rep),
    ]);
    Object.assign(M[key], { map, normalMap, roughnessMap, roughness: s.roughness, bumpMap: null });
    M[key].color.set(s.tint ?? '#ffffff');
    if (s.normalScale) M[key].normalScale.setScalar(s.normalScale);
    M[key].needsUpdate = true;
  }));
  results.filter((r) => r.status === 'rejected').forEach((r) => console.warn('Scanned texture failed, using fallback:', r.reason));
}

// Rewrite UVs so 1 UV unit = 1 metre in world space (seamless across pieces).
export function metricUV(geometry, ox = 0, oy = 0, oz = 0) {
  const pos = geometry.attributes.position, nor = geometry.attributes.normal, uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + ox, y = pos.getY(i) + oy, z = pos.getZ(i) + oz;
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    if (nz >= nx && nz >= ny) uv.setXY(i, x, y);
    else if (nx >= ny) uv.setXY(i, z, y);
    else uv.setXY(i, x, z);
  }
  uv.needsUpdate = true;
  return geometry;
}
