// Occupancy grid over the room (10 cm cells) for auto-furnish and the design check.
import { pointInPolygon, bbox } from './planmath.js';

export const FREE = 0, OUTSIDE = 1, SOLID = 2, KEEP_CLEAR = 3;

export class Grid {
  constructor(pts, cell = 0.1) {
    const b = bbox(pts);
    Object.assign(this, { cell, x0: b.minX, y0: b.minY });
    this.w = Math.ceil(b.w / cell); this.h = Math.ceil(b.d / cell);
    this.cells = new Uint8Array(this.w * this.h);
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const [x, y] = this.center(i, j);
      this.cells[j * this.w + i] = pointInPolygon(x, y, pts) ? FREE : OUTSIDE;
    }
  }
  clone() { const g = Object.create(Grid.prototype); Object.assign(g, this); g.cells = this.cells.slice(); return g; }
  center(i, j) { return [this.x0 + (i + 0.5) * this.cell, this.y0 + (j + 0.5) * this.cell]; }
  at(x, y) {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((y - this.y0) / this.cell);
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? OUTSIDE : this.cells[j * this.w + i];
  }
  // Visit cells whose centre lies inside a footprint ({kind:'poly'|'circle'}).
  eachIn(fp, fn) {
    const pts = fp.kind === 'poly' ? fp.pts : null;
    const xs = pts ? pts.map((p) => p[0]) : [fp.c[0] - fp.r, fp.c[0] + fp.r];
    const ys = pts ? pts.map((p) => p[1]) : [fp.c[1] - fp.r, fp.c[1] + fp.r];
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - this.x0) / this.cell));
    const i1 = Math.min(this.w - 1, Math.floor((Math.max(...xs) - this.x0) / this.cell));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - this.y0) / this.cell));
    const j1 = Math.min(this.h - 1, Math.floor((Math.max(...ys) - this.y0) / this.cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const [x, y] = this.center(i, j);
      const inside = pts ? pointInPolygon(x, y, pts) : Math.hypot(x - fp.c[0], y - fp.c[1]) <= fp.r;
      if (inside) fn(j * this.w + i);
    }
  }
  mark(fp, value) { this.eachIn(fp, (k) => { if (this.cells[k] !== OUTSIDE) this.cells[k] = value; }); }
  // True if the footprint is fully inside the room and only covers cells in `allowed`.
  fits(fp, allowed = [FREE]) {
    let ok = true, any = false;
    this.eachIn(fp, (k) => { any = true; if (!allowed.includes(this.cells[k])) ok = false; });
    if (!any) return false;
    // also reject footprints whose outline pokes outside the room
    const probe = fp.kind === 'poly' ? fp.pts : [0, 1, 2, 3].map((q) => [fp.c[0] + fp.r * Math.cos(q * Math.PI / 2), fp.c[1] + fp.r * Math.sin(q * Math.PI / 2)]);
    return ok && probe.every(([x, y]) => this.at(x, y) !== OUTSIDE);
  }
  // Approximate Euclidean distance (m) from each cell to the nearest blocked cell (chamfer 3-4).
  distance(blocked = (v) => v !== FREE) {
    const { w, h } = this, d = new Float32Array(w * h), INF = 1e9;
    for (let k = 0; k < w * h; k++) d[k] = blocked(this.cells[k]) ? 0 : INF;
    const relax = (k, k2, c) => { if (d[k2] + c < d[k]) d[k] = d[k2] + c; };
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (i > 0) relax(k, k - 1, 3);
      if (j > 0) { relax(k, k - w, 3); if (i > 0) relax(k, k - w - 1, 4); if (i < w - 1) relax(k, k - w + 1, 4); }
      if (i === 0 || j === 0 || i === w - 1 || j === h - 1) d[k] = Math.min(d[k], 3);   // grid edge = wall
    }
    for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i;
      if (i < w - 1) relax(k, k + 1, 3);
      if (j < h - 1) { relax(k, k + w, 3); if (i < w - 1) relax(k, k + w + 1, 4); if (i > 0) relax(k, k + w - 1, 4); }
    }
    for (let k = 0; k < w * h; k++) d[k] = (d[k] / 3) * this.cell;
    return d;
  }
}
