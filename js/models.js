// Photo-scanned furniture and decor from Poly Haven (CC0), loaded on demand as glTF.
// Each model becomes a furniture type `ph_<id>` with a catalog entry and a builder; the
// builder shows a placeholder box until the model arrives, then swaps the model in.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// id: [name, category, layer, [width, depth, height] m, keywords]
const TABLE = {
  modern_arm_chair_01: ['Modern lounge chair', 'Seating', 'floor', [0.82, 0.99, 1.02], 'armchair lounge chair accent chair'],
  mid_century_lounge_chair: ['Mid-century lounge chair', 'Seating', 'floor', [1.01, 1.19, 1.17], 'lounge chair recliner mid century eames'],
  ArmChair_01: ['Classic armchair', 'Seating', 'floor', [0.85, 0.77, 1.07], 'armchair classic chair'],
  GreenChair_01: ['Velvet accent chair', 'Seating', 'floor', [0.67, 0.66, 1.06], 'accent chair green chair velvet'],
  sofa_02: ['Sofa, 2-seat', 'Seating', 'floor', [1.81, 0.82, 0.71], 'sofa couch loveseat'],
  sofa_03: ['Sofa, large', 'Seating', 'floor', [2.73, 0.93, 1.12], 'sofa couch sectional'],
  Sofa_01: ['Compact sofa', 'Seating', 'floor', [1.57, 0.66, 0.8], 'sofa couch settee'],
  Ottoman_01: ['Upholstered ottoman', 'Seating', 'floor', [0.88, 0.62, 0.62], 'ottoman pouf footstool'],
  bar_chair_round_01: ['Bar stool, round', 'Seating', 'floor', [0.48, 0.49, 0.75], 'bar stool barstool counter stool'],
  metal_stool_03: ['Metal bar stool', 'Seating', 'floor', [0.46, 0.47, 1.02], 'bar stool metal stool tall stool'],
  metal_stool_02: ['Metal stool', 'Seating', 'floor', [0.45, 0.47, 0.46], 'stool metal stool'],
  dining_chair_02: ['Dining chair', 'Seating', 'floor', [0.43, 0.58, 0.97], 'dining chair side chair chair'],
  painted_wooden_bench: ['Wooden bench', 'Seating', 'floor', [1.16, 0.5, 0.89], 'bench'],
  metal_office_desk: ['Metal office desk', 'Tables', 'floor', [2.0, 0.95, 0.79], 'desk office desk metal desk'],
  industrial_coffee_table: ['Industrial coffee table', 'Tables', 'floor', [0.78, 0.76, 0.64], 'coffee table'],
  coffee_table_round_01: ['Round coffee table', 'Tables', 'floor', [1.3, 1.3, 0.49], 'coffee table round table'],
  modern_coffee_table_01: ['Modern coffee table', 'Tables', 'floor', [1.2, 0.6, 0.39], 'coffee table low table'],
  side_table_01: ['Side table', 'Tables', 'floor', [0.55, 0.45, 0.55], 'side table end table'],
  side_table_tall_01: ['Tall side table', 'Tables', 'floor', [0.38, 0.38, 0.76], 'side table pedestal'],
  round_wooden_table_02: ['Café table', 'Tables', 'floor', [0.8, 0.8, 0.75], 'cafe table bistro table small table'],
  dining_table: ['Long dining table', 'Tables', 'floor', [2.26, 1.39, 0.88], 'dining table long table'],
  WoodenTable_03: ['Wooden work table', 'Tables', 'floor', [1.33, 0.56, 0.83], 'work table wooden table'],
  small_wooden_table_01: ['Small console table', 'Tables', 'floor', [0.92, 0.44, 0.53], 'console table hall table'],
  steel_frame_shelves_01: ['Steel shelving, wide', 'Storage', 'floor', [1.1, 0.5, 2.14], 'shelving shelves rack steel shelves'],
  steel_frame_shelves_02: ['Steel shelving, narrow', 'Storage', 'floor', [0.59, 0.5, 2.14], 'shelving shelves rack'],
  steel_frame_shelves_03: ['Steel shelving, large', 'Storage', 'floor', [2.35, 0.72, 2.31], 'shelving shelves storage rack'],
  wooden_bookshelf_worn: ['Worn wooden bookshelf', 'Storage', 'floor', [1.37, 0.58, 2.06], 'bookshelf bookcase shelves'],
  wooden_display_shelves_01: ['Display shelves', 'Storage', 'floor', [1.08, 0.37, 1.56], 'display shelves shelf'],
  drawer_cabinet: ['Drawer cabinet', 'Storage', 'floor', [1.14, 0.49, 1.88], 'drawers cabinet chest dresser'],
  worn_metal_rack: ['Worn metal rack', 'Storage', 'floor', [0.92, 0.6, 1.9], 'rack metal rack shelving'],
  vintage_cabinet_01: ['Vintage cabinet', 'Storage', 'floor', [2.02, 0.67, 2.24], 'cabinet cupboard hutch'],
  modern_wooden_cabinet: ['Low wooden cabinet', 'Storage', 'floor', [2.44, 0.52, 0.68], 'credenza sideboard low cabinet media console'],
  industrial_storage_cart: ['Industrial storage cart', 'Storage', 'floor', [1.6, 1.1, 1.38], 'cart trolley storage cart'],
  CoffeeCart_01: ['Coffee cart', 'Kitchen', 'floor', [2.17, 1.07, 1.72], 'coffee cart espresso barista'],
  hanging_industrial_lamp: ['Industrial pendant', 'Lighting', 'ceiling', [0.55, 0.55, 1.36], 'pendant hanging lamp ceiling light'],
  caged_hanging_light: ['Caged pendant bar', 'Lighting', 'ceiling', [1.16, 0.31, 0.75], 'caged light cage pendant'],
  modern_ceiling_lamp_01: ['Modern ceiling lamp', 'Lighting', 'ceiling', [0.43, 0.43, 0.95], 'ceiling lamp modern pendant'],
  industrial_wall_sconce: ['Industrial wall sconce', 'Lighting', 'wall', [0.15, 0.25, 0.34], 'sconce wall light wall lamp'],
  industrial_wall_lamp: ['Industrial wall lamp', 'Lighting', 'wall', [0.27, 0.14, 0.43], 'wall lamp wall light'],
  desk_lamp_arm_01: ['Desk lamp', 'Lighting', 'floor', [0.61, 0.2, 0.89], 'desk lamp table lamp'],
  potted_plant_01: ['Potted plant, large', 'Plants', 'floor', [0.59, 0.64, 1.35], 'plant tree potted plant large plant'],
  potted_plant_02: ['Potted plant, medium', 'Plants', 'floor', [0.7, 0.66, 0.84], 'plant potted plant'],
  potted_plant_04: ['Succulent', 'Plants', 'floor', [0.17, 0.19, 0.27], 'succulent small plant'],
  planter_box_01: ['Planter box', 'Plants', 'floor', [0.91, 0.41, 0.42], 'planter box planter'],
  planter_box_02: ['Planter box, long', 'Plants', 'floor', [1.25, 0.47, 0.45], 'planter long planter'],
  hanging_picture_frame_01: ['Framed picture, portrait', 'Decor', 'wall', [0.59, 0.02, 0.84], 'painting picture frame art portrait'],
  hanging_picture_frame_02: ['Framed picture, landscape', 'Decor', 'wall', [0.75, 0.03, 0.5], 'painting picture art landscape frame'],
  hanging_picture_frame_03: ['Framed picture, small', 'Decor', 'wall', [0.39, 0.03, 0.5], 'picture frame small art'],
  fancy_picture_frame_01: ['Gilded frame', 'Decor', 'wall', [0.6, 0.02, 0.46], 'gilded frame classic painting'],
  fancy_picture_frame_02: ['Ornate frame', 'Decor', 'wall', [0.66, 0.09, 0.77], 'ornate frame'],
  ornate_mirror_01: ['Ornate mirror', 'Decor', 'wall', [0.49, 0.03, 0.74], 'ornate mirror'],
  vintage_telephone_wall_clock: ['Wall clock', 'Decor', 'wall', [0.34, 0.19, 0.5], 'clock wall clock'],
  dartboard: ['Dartboard', 'Decor', 'wall', [0.45, 0.04, 0.45], 'dartboard darts'],
  brass_vase_01: ['Brass vase', 'Decor', 'floor', [0.23, 0.23, 0.69], 'vase brass vase'],
  ceramic_vase_01: ['Ceramic vase', 'Decor', 'floor', [0.2, 0.21, 0.4], 'vase ceramic vase'],
  book_encyclopedia_set_01: ['Book set', 'Decor', 'floor', [0.55, 0.16, 0.24], 'books book set'],
  classic_laptop: ['Laptop', 'Tech', 'floor', [0.65, 0.49, 0.54], 'laptop computer'],
  projector_screen: ['Projector screen', 'Tech', 'floor', [1.09, 0.92, 1.8], 'projector screen presentation'],
};
// Small things that usually sit on a table/shelf: they get a "Lift" parameter.
const SMALL = new Set(['potted_plant_04', 'brass_vase_01', 'ceramic_vase_01', 'book_encyclopedia_set_01', 'classic_laptop', 'desk_lamp_arm_01']);
// Models whose "front" faces the other way from our convention (front = the side you face it from).
const YAW = { metal_office_desk: Math.PI, modern_coffee_table_01: Math.PI / 2, wooden_display_shelves_01: Math.PI / 2, desk_lamp_arm_01: Math.PI / 2 };
const WALL_HEIGHT = { industrial_wall_sconce: 1.8, industrial_wall_lamp: 1.8, vintage_telephone_wall_clock: 1.9, dartboard: 1.73 };

const gltfURL = (id) => `https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/${id}/${id}_1k.gltf`;
const thumbURL = (id) => `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=200&height=200`;

// The glTF files point at "textures/…" next to them, but Poly Haven serves those from Models/jpg/.
const manager = new THREE.LoadingManager();
manager.setURLModifier((url) => url.replace(/\/Models\/gltf\/(\w+)\/([^/]+)\/textures\//, '/Models/jpg/$1/$2/'));
const loader = new GLTFLoader(manager);
const cache = new Map();
const pending = new Set();
let onLoaded = () => {};
export const setOnModelLoaded = (fn) => { onLoaded = fn; };
export const modelsReady = () => Promise.allSettled([...pending]);

// The JPG texture sets carry no transparency: cut-outs (leaves, fringe) need Poly Haven's separate
// alpha texture, and "_glass" layers (picture-frame and clock glass) should simply be clear.
const ALPHA = {
  potted_plant_01: { potted_plant_01_leaves: 'potted_plant_01_leaves_alpha' },
  potted_plant_02: { potted_plant_02_leaves: 'potted_plant_02_leaves_alpha' },
  sofa_03: { sofa_03_fringe: 'sofa_03_opacity' },
};
const texLoader = new THREE.TextureLoader();
async function fixTransparency(id, root) {
  const jobs = [];
  root.traverse((m) => {
    if (!m.isMesh) return;
    for (const mat of [].concat(m.material)) {
      if (/_glass$/.test(mat.name)) {
        Object.assign(mat, { map: null, transparent: true, opacity: 0.12, roughness: 0.04, metalness: 0, depthWrite: false });
        if ('transmission' in mat) mat.transmission = 0;
        mat.color.set('#ffffff');
        m.castShadow = false;
        mat.needsUpdate = true;
      }
      const a = ALPHA[id]?.[mat.name];
      if (a) {
        jobs.push(texLoader.loadAsync(`https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/${id}/${a}_1k.jpg`).then((t) => {
          t.flipY = false;                       // glTF texture convention
          Object.assign(mat, { alphaMap: t, alphaTest: 0.5, transparent: false, depthWrite: true });
          mat.needsUpdate = true;
        }).catch((e) => console.warn(`Alpha map for ${id} failed`, e)));
      }
    }
  });
  await Promise.all(jobs);
}

function template(id) {
  if (!cache.has(id)) {
    const p = loader.loadAsync(gltfURL(id)).then(async (g) => {
      const root = g.scene;
      if (YAW[id]) root.rotation.y += YAW[id];   // baked in before measuring, so placement maths stays the same
      root.traverse((m) => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; m.userData.shared = true; } });
      await fixTransparency(id, root);
      root.updateMatrixWorld(true);
      // A few files are exported in the wrong unit (e.g. 10× too big): match the published height.
      const h = TABLE[id][3][2], got = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y;
      if (got > 0 && (got / h > 1.4 || got / h < 0.7)) { root.scale.multiplyScalar(h / got); root.updateMatrixWorld(true); }
      return { root, box: new THREE.Box3().setFromObject(root) };
    });
    cache.set(id, p);
    pending.add(p);
    p.finally(() => pending.delete(p)).catch(() => { if (cache.get(id) === p) cache.delete(id); });   // a failed download is tried again on the next build
  }
  return cache.get(id);
}

const placeholderMat = new THREE.MeshStandardMaterial({ color: '#b9b2a7', roughness: 1, transparent: true, opacity: 0.35, depthWrite: false });
const failedMat = placeholderMat.clone(); failedMat.color.set('#c96f3b');   // shown where a model couldn't download

export const MODEL_CATALOG = {};
export const MODEL_BUILDERS = {};

for (const [id, [name, cat, layer, [w, d, h], keywords]] of Object.entries(TABLE)) {
  const type = `ph_${id}`;
  const params = layer === 'wall' ? [['height', 'Centre height (m)', 0.05]] : SMALL.has(id) ? [['elev', 'Lift (m)', 0.05]] : [];
  const defaults = layer === 'wall' ? { height: WALL_HEIGHT[id] ?? 1.5 } : SMALL.has(id) ? { elev: 0 } : {};
  MODEL_CATALOG[type] = {
    name, cat, layer, keywords, params, defaults, thumb: thumbURL(id), scanned: true,
    spec: `${name} — photo-scanned model (Poly Haven, CC0)`,
    label: name.split(',')[0].replace(/^(Modern|Classic|Industrial|Upholstered|Mid-century) /, ''),
    ...(layer === 'wall' ? { rect: () => [-w / 2, 0, w / 2, Math.max(d, 0.03)] }
      : layer === 'ceiling' ? { circle: () => Math.max(w, d) / 2 }
        : { rect: () => [-w / 2, -d / 2, w / 2, d / 2] }),
  };

  MODEL_BUILDERS[type] = (o, ctx) => {
    const wrap = new THREE.Group(), H = ctx.H;
    const lift = SMALL.has(id) ? (o.elev ?? 0) : 0;
    const y0 = layer === 'wall' ? (o.height ?? 1.5) - h / 2 : layer === 'ceiling' ? H - h : lift;
    const ph = new THREE.Mesh(new THREE.BoxGeometry(w, h, Math.max(d, 0.02)), placeholderMat);
    ph.position.set(0, y0 + h / 2, layer === 'wall' ? Math.max(d, 0.02) / 2 : 0);
    wrap.add(ph);
    let light = null;
    if (cat === 'Lighting') {
      light = new THREE.PointLight('#ffb36b', 0, 0, 2);
      light.position.set(0, layer === 'ceiling' ? H - h + 0.12 : layer === 'wall' ? y0 + h * 0.4 : y0 + h * 0.75, layer === 'wall' ? d * 0.7 : 0);
      wrap.add(light);
      ctx.lamps.push({ light, intensity: layer === 'ceiling' ? 4 : 1.6 });
    }
    template(id).then(({ root, box }) => {
      wrap.remove(ph); ph.geometry.dispose();
      const c = root.clone(true), cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      if (layer === 'wall') c.position.set(-cx, (o.height ?? 1.5) - (box.min.y + box.max.y) / 2, -box.min.z);
      else if (layer === 'ceiling') c.position.set(-cx, H - box.max.y, -cz);
      else c.position.set(-cx, lift - box.min.y, -cz);
      wrap.add(c);
      if (light) {
        const sz = box.getSize(new THREE.Vector3());
        if (layer === 'ceiling') light.position.y = H - sz.y + 0.12;
        else if (layer === 'wall') { light.position.y = (o.height ?? 1.5); light.position.z = sz.z * 0.7; }
        else light.position.y = lift + sz.y * 0.8;
      }
      onLoaded(wrap);
    }).catch((e) => { console.warn(`Model ${id} failed to load`, e); ph.material = failedMat; });
    if (layer === 'wall') wrap.userData.wallMounted = true;
    return wrap;
  };
}
