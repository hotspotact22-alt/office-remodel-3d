import { facingDeg, localToPlan, pointInPolygon, dist } from './planmath.js';

// Furniture catalog: schedule names/specs + plan footprints (used by the editor, auto-furnish,
// and design check). Footprints are in item-local coords: lx across, lz toward the item's front.
// layer: 'floor' items block walking, 'rug' and 'ceiling'/'wall' items do not.

export const CATALOG = {
  workstation: { cat: 'Tables', keywords: 'desk workstation work desk computer',
    name: 'Workstation', spec: 'Reclaimed-oak desk 170×78 cm on blackened-steel trestles, leather task chair, task lamp',
    layer: 'floor', rect: () => [-0.85, -1.4, 0.85, 0.39], label: 'Desk',   // includes 1.0 m chair zone
  },
  pipeShelf: { cat: 'Storage', keywords: 'shelf shelving shelves pipe bookshelf',
    name: 'Pipe shelving', spec: 'Black iron pipe frame, reclaimed-oak shelves (34 cm deep), leather storage boxes',
    layer: 'floor', rect: (o) => { const w = (o.width ?? 2) / 2 + 0.03; return [-w, -0.17, w, 0.17]; }, label: 'Shelving',
  },
  meetingTable: { cat: 'Tables', keywords: 'meeting table round table client table',
    name: 'Client table', spec: 'Round reclaimed-oak top on steel pedestal, leather-seat steel chairs',
    layer: 'floor', circle: (o) => (o.diameter ?? 1.2) / 2 + 0.42, label: 'Table',
  },
  clubChair: { cat: 'Seating', keywords: 'club chair armchair leather chair', name: 'Club chair', spec: 'Cognac leather, low steel feet, wool lumbar cushion', layer: 'floor', rect: () => [-0.44, -0.42, 0.44, 0.42], label: 'Chair' },
  ottoman: { cat: 'Seating', keywords: 'ottoman footstool pouf', name: 'Ottoman', spec: 'Dark leather, doubles as extra seat', layer: 'floor', rect: () => [-0.31, -0.25, 0.31, 0.25], label: 'Ottoman' },
  sideTable: { cat: 'Tables', keywords: 'side table drum table end table', name: 'Drum side table', spec: 'Blackened steel with galvanized bands, oak top, 52 cm high', layer: 'floor', circle: () => 0.25, label: 'Side' },
  floorLamp: { cat: 'Lighting', keywords: 'floor lamp reading lamp lamp', name: 'Floor lamp', spec: 'Overhanging steel arm, brass cage, warm 2700 K Edison bulb', layer: 'floor', circle: () => 0.17, label: 'Lamp' },
  plant: { cat: 'Plants', keywords: 'plant fig tree greenery', name: 'Planter', spec: 'Concrete pot, fiddle-leaf fig', layer: 'floor', circle: (o) => 0.2 * Math.min(o.size ?? 1, 1.2) + 0.04, label: 'Plant' },
  rug: { cat: 'Decor', keywords: 'rug carpet', name: 'Rug', spec: 'Faded vintage wool; zones the lounge and absorbs sound', layer: 'rug', rect: (o) => { const [w, d] = o.size ?? [2, 1.4]; return [-w / 2, -d / 2, w / 2, d / 2]; }, label: 'Rug' },
  pendant: { cat: 'Lighting', keywords: 'pendant pendant light dome light hanging light', name: 'Pendant', spec: 'Spun-steel dome, cloth cord, warm 2700 K Edison bulb, dimmable', layer: 'ceiling', circle: (o) => 0.2 * (o.size ?? 1), label: '' },
  wallArt: { cat: 'Decor', keywords: 'art painting artwork print abstract picture', name: 'Wall art', spec: 'Abstract print in thin steel frame', layer: 'wall', rect: (o) => { const [w] = o.size ?? [1, 0.7]; return [-w / 2, 0, w / 2, 0.04]; }, label: 'Art' },
  acousticPanels: { cat: 'Walls & partitions', keywords: 'acoustic panels felt panel sound absorber', name: 'Acoustic panels', spec: 'Charcoal wool-felt panels 60×120 cm, NRC ≈ 0.85 — tames echo for calls', layer: 'wall', rect: (o) => { const w = (o.count ?? 4) * 0.66 / 2; return [-w, 0, w, 0.05]; }, label: 'Felt' },
  curtains: { cat: 'Decor', keywords: 'curtains drapes', name: 'Curtains', spec: 'Floor-to-ceiling heavy linen drapes on steel rod — softens light and sound', layer: 'wall', rect: (o) => { const w = (o.width ?? 2) / 2 + 0.2; return [-w, 0, w, 0.18]; }, label: 'Drapes' },
  duct: { name: 'Exposed duct', spec: 'Galvanized spiral duct on rod hangers', layer: 'ceiling', label: '' },
  column: { cat: 'Walls & partitions', keywords: 'column pillar post structural', name: 'Structural column', spec: 'Existing building column (boxed, painted) — keep clear; can carry shelves or a sign', layer: 'floor', rect: (o) => { const h = (o.size ?? 0.45) / 2; return [-h, -h, h, h]; }, label: 'Column', params: [['size', 'Size (m)', 0.05]] },
  downlight: { cat: 'Lighting', keywords: 'downlight spotlight recessed light ceiling light can light', name: 'Cylinder downlight', spec: 'Black surface-mount LED cylinder, 3000 K, dimmable — general light', layer: 'ceiling', circle: () => 0.06, label: '' },
};

export const CATS = ['Seating', 'Tables', 'Storage', 'Kitchen', 'Lighting', 'Plants', 'Decor', 'Tech', 'Walls & partitions'];

// Items the plan editor can add (with sensible defaults).
export const ADDABLE = {
  workstation: {}, pipeShelf: { width: 1.8 }, meetingTable: { chairs: 4, diameter: 1.2 }, clubChair: {},
  ottoman: {}, sideTable: {}, floorLamp: {}, plant: { size: 1.2 }, rug: { size: [2.3, 1.7] },
  pendant: { height: 1.95 }, downlight: {}, curtains: { width: 1.8 }, column: { size: 0.45 }, wallArt: { size: [1.0, 0.7], height: 1.5 }, acousticPanels: { count: 4, height: 1.45 },
};

// Plan-space footprint: { kind: 'poly', pts } or { kind: 'circle', c, r }, plus layer.
export function footprint(item) {
  const c = CATALOG[item.type];
  if (!c || !item.at) return null;
  const deg = facingDeg(item.facing);
  if (c.circle) return { kind: 'circle', c: item.at, r: c.circle(item), layer: c.layer };
  if (c.rect) {
    const [x0, z0, x1, z1] = c.rect(item);
    const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map((p) => localToPlan(item.at, deg, p));
    return { kind: 'poly', pts, layer: c.layer };
  }
  return null;
}

// Half the width of a piece along the wall it backs onto (keeps wide pieces clear of corners).
export function halfWidth(item) {
  const r = CATALOG[item.type]?.rect?.(item);
  return r ? (r[2] - r[0]) / 2 : 0.15;
}

// Hanging lights above a table or desk travel with it when it is dragged.
const CARRIES = new Set(['meetingTable', 'conferenceTable', 'workstation', 'ph_dining_table', 'ph_metal_office_desk', 'ph_WoodenTable_03']);
const RIDES = new Set(['pendant', 'ph_hanging_industrial_lamp', 'ph_caged_hanging_light', 'ph_modern_ceiling_lamp_01']);
export function ridersOf(plan, i) {
  const f = plan.furniture[i];
  if (!f?.at || !CARRIES.has(f.type)) return [];
  const fp = footprint(f);
  if (!fp) return [];
  const inside = (p) => (fp.kind === 'circle' ? dist(p, fp.c) <= fp.r : pointInPolygon(p[0], p[1], fp.pts));
  return plan.furniture.map((g, j) => ({ g, j }))
    .filter(({ g, j }) => j !== i && g.at && RIDES.has(g.type) && inside(g.at))
    .map(({ g, j }) => ({ j, off: [g.at[0] - f.at[0], g.at[1] - f.at[1]] }));
}

// Merge more asset types (scanned models, extra procedural pieces) into the catalog.
export function registerCatalog(entries) {
  for (const [type, e] of Object.entries(entries)) {
    CATALOG[type] = e;
    if (!e.noAdd) ADDABLE[type] = structuredClone(e.defaults ?? {});
  }
}
