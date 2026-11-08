// Пространственная сетка для быстрых запросов «что рядом».
// Генерация острова живёт в shared/worldgen.js (её использует и браузер).
export { generateMap, generateResources, generateZones, zoneStrength, zoneAt, zoneFalloff, mulberry32, tilesHash } from '../shared/worldgen.js';

// Сетка для статичных объектов (ресурсы, постройки, останки)
export class Grid {
  constructor(cell) {
    this.cell = cell;
    this.cells = new Map();
    this.stamp = 0;
  }

  cellsFor(x, y, r) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c);
    const x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c);
    const y1 = Math.floor((y + r) / c);
    const keys = [];
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) keys.push(cx * 65536 + cy);
    return keys;
  }

  insert(o) {
    o._cells = this.cellsFor(o.x, o.y, o.r);
    for (const k of o._cells) {
      let arr = this.cells.get(k);
      if (!arr) this.cells.set(k, (arr = []));
      arr.push(o);
    }
  }

  remove(o) {
    if (!o._cells) return;
    for (const k of o._cells) {
      const arr = this.cells.get(k);
      if (!arr) continue;
      const i = arr.indexOf(o);
      if (i >= 0) arr.splice(i, 1);
      if (!arr.length) this.cells.delete(k);
    }
    o._cells = null;
  }

  query(x, y, r) {
    const out = [];
    const stamp = ++this.stamp;
    for (const k of this.cellsFor(x, y, r)) {
      const arr = this.cells.get(k);
      if (!arr) continue;
      for (const o of arr) {
        if (o._q === stamp) continue;
        o._q = stamp;
        out.push(o);
      }
    }
    return out;
  }
}
