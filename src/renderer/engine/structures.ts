import type { RegionId } from '../../shared/types';
import { B } from './blocks';
import { CHUNK, PLAZA_RADIUS, PLAZA_Y, REGIONS, SPAWN_RADIUS, type RegionInfo } from './terrain';

/**
 * Hand-designed structures (spawn hub, region plazas, path lamps) expressed as
 * block placements, bucketed per chunk so chunk generation can apply them cheaply.
 */
export type StructureMap = Map<string, number[]>; // chunkKey -> [x,y,z,id, x,y,z,id, ...]

export const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;

class Builder {
  readonly map: StructureMap = new Map();
  put(x: number, y: number, z: number, id: number): void {
    const k = chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    let arr = this.map.get(k);
    if (!arr) { arr = []; this.map.set(k, arr); }
    arr.push(x, y, z, id);
  }
  column(x: number, y0: number, z: number, y1: number, id: number): void {
    for (let y = y0; y <= y1; y++) this.put(x, y, z, id);
  }
  disc(cx: number, cz: number, r: number, y: number, pick: (x: number, z: number, d: number) => number | null): void {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d <= r) { const id = pick(x, z, d); if (id !== null) this.put(x, y, z, id); }
    }
  }
  /** Clear air above a footprint so terrain bumps don't poke through floors. */
  clearAbove(cx: number, cz: number, r: number, y0: number, h: number): void {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
      if (Math.hypot(x - cx, z - cz) <= r) for (let y = y0; y < y0 + h; y++) this.put(x, y, z, B.AIR);
    }
  }
}

const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

function lampPost(b: Builder, x: number, z: number, post: number, height = 3, top: number = B.LAMP): void {
  b.column(x, PLAZA_Y + 1, z, PLAZA_Y + height, post);
  b.put(x, PLAZA_Y + height + 1, z, top);
}

function spawnHub(b: Builder): void {
  b.clearAbove(0, 0, SPAWN_RADIUS + 1, PLAZA_Y + 1, 12);
  b.disc(0, 0, SPAWN_RADIUS, PLAZA_Y, (x, z, d) => {
    if (d > SPAWN_RADIUS - 1.2) return B.COBBLE;
    if (d < 2.5) return B.STONE_BRICKS;
    return (Math.floor(d) % 3 === 0) ? B.MOSSY_COBBLE : (x + z) % 2 === 0 ? B.STONE_BRICKS : B.COBBLE;
  });
  b.put(0, PLAZA_Y + 1, 0, B.WAYSTONE);
  b.put(0, PLAZA_Y + 2, 0, B.WAYSTONE);
  const markers: Record<RegionId, number> = {
    survival: B.WOOL_GREEN, adventure: B.WOOL_YELLOW, rpg: B.WOOL_PURPLE, fps: B.WOOL_RED, indie: B.WOOL_ORANGE, sandbox: B.WOOL_BLUE,
  };
  for (const r of REGIONS) {
    // two banner posts flanking each path exit, coloured like their region
    for (const side of [-1, 1]) {
      const a = r.angle + side * 0.32;
      const x = Math.round(Math.cos(a) * (SPAWN_RADIUS - 2)), z = Math.round(Math.sin(a) * (SPAWN_RADIUS - 2));
      b.column(x, PLAZA_Y + 1, z, PLAZA_Y + 2, B.SPRUCE_LOG);
      b.put(x, PLAZA_Y + 3, z, markers[r.id]);
      b.put(x, PLAZA_Y + 4, z, B.TORCH);
    }
  }
}

function pathLamps(b: Builder): void {
  for (const r of REGIONS) {
    const len = Math.hypot(r.cx, r.cz);
    const ux = r.cx / len, uz = r.cz / len;
    for (let t = SPAWN_RADIUS + 8; t < len - PLAZA_RADIUS - 3; t += 12) {
      const x = Math.round(ux * t - uz * 3), z = Math.round(uz * t + ux * 3);
      b.column(x, PLAZA_Y + 1, z, PLAZA_Y + 2, B.LOG);
      b.put(x, PLAZA_Y + 3, z, B.TORCH);
    }
  }
}

function plazaFloor(b: Builder, r: RegionInfo, pick: (x: number, z: number, d: number) => number): void {
  b.clearAbove(r.cx, r.cz, PLAZA_RADIUS + 1, PLAZA_Y + 1, 14);
  b.disc(r.cx, r.cz, PLAZA_RADIUS, PLAZA_Y, pick);
  b.put(r.cx, PLAZA_Y + 1, r.cz, B.WAYSTONE);
  b.put(r.cx, PLAZA_Y + 2, r.cz, B.WAYSTONE);
}

/** Positions on a ring, skipping the gate facing spawn. */
function ring(r: RegionInfo, radius: number, count: number, gateHalfAngle = 0.28): [number, number, number][] {
  const toSpawn = Math.atan2(-r.cz, -r.cx);
  const out: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.13;
    if (angleDiff(a, toSpawn) < gateHalfAngle) continue;
    out.push([Math.round(r.cx + Math.cos(a) * radius), Math.round(r.cz + Math.sin(a) * radius), a]);
  }
  return out;
}

function survival(b: Builder, r: RegionInfo): void {
  plazaFloor(b, r, (x, z, d) => (d > PLAZA_RADIUS - 1.5 ? B.MOSSY_COBBLE : (x * 3 + z * 7) % 5 === 0 ? B.PATH : d < 3 ? B.COBBLE : B.GRASS));
  for (const [x, z] of ring(r, PLAZA_RADIUS - 1, 14)) lampPost(b, x, z, B.LOG, 2, B.TORCH);
  // a log cabin-ish shelter outside the plaza
  const ax = r.cx + Math.round(Math.cos(r.angle) * 26), az = r.cz + Math.round(Math.sin(r.angle) * 26);
  b.clearAbove(ax, az, 4, PLAZA_Y + 1, 7);
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
    b.put(ax + dx, PLAZA_Y, az + dz, B.PLANKS);
    const edge = Math.abs(dx) === 3 || Math.abs(dz) === 3;
    if (edge) for (let y = 1; y <= 3; y++) {
      const corner = Math.abs(dx) === 3 && Math.abs(dz) === 3;
      const door = dz === -3 && dx === 0 && y <= 2;
      if (!door) b.put(ax + dx, PLAZA_Y + y, az + dz, corner ? B.LOG : y === 2 && (dx === 0 || dz === 0) ? B.GLASS : B.SPRUCE_PLANKS);
    }
    b.put(ax + dx, PLAZA_Y + 4, az + dz, B.SPRUCE_PLANKS);
  }
  b.put(ax, PLAZA_Y + 3, az, B.LAMP);
}

function adventure(b: Builder, r: RegionInfo): void {
  plazaFloor(b, r, (x, z, d) => (d > PLAZA_RADIUS - 1.5 ? B.SANDSTONE : (Math.floor(d) % 4 === 0 ? B.SANDSTONE : B.SAND)));
  for (const [x, z] of ring(r, PLAZA_RADIUS - 1, 10)) {
    b.column(x, PLAZA_Y + 1, z, PLAZA_Y + 4, B.SANDSTONE);
    b.put(x, PLAZA_Y + 5, z, B.TORCH);
  }
  // stepped pyramid beyond the plaza
  const px = r.cx + Math.round(Math.cos(r.angle) * 34), pz = r.cz + Math.round(Math.sin(r.angle) * 34);
  for (let level = 0; level < 9; level++) {
    const s = 9 - level;
    for (let dx = -s; dx <= s; dx++) for (let dz = -s; dz <= s; dz++) b.put(px + dx, PLAZA_Y + level, pz + dz, level === 8 ? B.LAMP : B.SANDSTONE);
  }
}

function rpg(b: Builder, r: RegionInfo): void {
  plazaFloor(b, r, (x, z, d) => (d < 3 ? B.COBBLE : (x + z) % 2 === 0 ? B.STONE_BRICKS : B.COBBLE));
  const wallR = PLAZA_RADIUS + 1.5;
  const toSpawn = Math.atan2(-r.cz, -r.cx);
  for (let a = 0; a < Math.PI * 2; a += 1 / (wallR * 1.6)) {
    if (angleDiff(a, toSpawn) < 0.2) continue; // gate
    const x = Math.round(r.cx + Math.cos(a) * wallR), z = Math.round(r.cz + Math.sin(a) * wallR);
    b.column(x, PLAZA_Y - 2, z, PLAZA_Y + 5, B.STONE_BRICKS);
    if (Math.round(a * 10) % 2 === 0) b.put(x, PLAZA_Y + 6, z, B.STONE_BRICKS);
  }
  for (const k of [0, 1, 2, 3]) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    const tx = Math.round(r.cx + Math.cos(a) * wallR), tz = Math.round(r.cz + Math.sin(a) * wallR);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      if (!edge) continue;
      b.column(tx + dx, PLAZA_Y - 2, tz + dz, PLAZA_Y + 9, B.STONE_BRICKS);
      if ((dx + dz) % 2 === 0) b.put(tx + dx, PLAZA_Y + 10, tz + dz, B.STONE_BRICKS);
    }
    b.put(tx, PLAZA_Y + 9, tz, B.LAMP);
  }
  for (const [x, z] of ring(r, PLAZA_RADIUS - 2, 8)) b.put(x, PLAZA_Y + 1, z, B.TORCH);
}

function fps(b: Builder, r: RegionInfo): void {
  plazaFloor(b, r, (x, z, d) => (Math.floor(d) % 5 === 0 ? B.ARENA_PLATE : (Math.floor(x / 2) + Math.floor(z / 2)) % 2 === 0 ? B.DARK_STONE : B.ARENA_PLATE));
  for (const [x, z, a] of ring(r, PLAZA_RADIUS + 0.5, 36, 0.2)) {
    if (Math.round(a * 6) % 5 === 0) continue; // spaced openings
    b.column(x, PLAZA_Y + 1, z, PLAZA_Y + 3, B.OBSIDIAN);
  }
  for (const [x, z] of ring(r, PLAZA_RADIUS - 2.5, 7)) {
    b.put(x, PLAZA_Y + 1, z, B.CRATE);
    b.put(x + 1, PLAZA_Y + 1, z, B.CRATE);
    b.put(x, PLAZA_Y + 2, z, B.CRATE);
  }
  for (const [x, z] of ring(r, PLAZA_RADIUS - 1, 6)) lampPost(b, x, z, B.OBSIDIAN, 3);
}

function indie(b: Builder, r: RegionInfo): void {
  plazaFloor(b, r, (x, z, d) => (d > PLAZA_RADIUS - 1.5 ? B.GRASS : d < 3 ? B.COBBLE : (Math.floor(d) % 6 === 0 ? B.SPRUCE_PLANKS : B.PLANKS)));
  for (const [x, z] of ring(r, PLAZA_RADIUS - 0.5, 24, 0.2)) b.put(x, PLAZA_Y + 1, z, (x + z) % 2 ? B.FLOWER_RED : B.FLOWER_YELLOW);
  for (const [x, z] of ring(r, PLAZA_RADIUS - 2, 6)) lampPost(b, x, z, B.SPRUCE_LOG, 2);
  const houseColors = [B.WOOL_ORANGE, B.WOOL_BLUE, B.WOOL_RED];
  for (let i = 0; i < 3; i++) {
    const a = r.angle + (i - 1) * 0.75;
    const hx = r.cx + Math.round(Math.cos(a) * 27), hz = r.cz + Math.round(Math.sin(a) * 27);
    b.clearAbove(hx, hz, 4, PLAZA_Y + 1, 8);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      b.put(hx + dx, PLAZA_Y, hz + dz, B.PLANKS);
      const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      if (edge) for (let y = 1; y <= 3; y++) {
        const door = dx === 0 && dz === -2 && y <= 2;
        const win = y === 2 && (dx === 0 || dz === 0) && !door;
        if (!door) b.put(hx + dx, PLAZA_Y + y, hz + dz, win ? B.GLASS : B.PLANKS);
      }
    }
    for (let lvl = 0; lvl < 3; lvl++) for (let dx = -3 + lvl; dx <= 3 - lvl; dx++) for (let dz = -3 + lvl; dz <= 3 - lvl; dz++) {
      if (lvl === 2 || Math.abs(dx) === 3 - lvl || Math.abs(dz) === 3 - lvl) b.put(hx + dx, PLAZA_Y + 4 + lvl, hz + dz, houseColors[i]);
    }
    b.put(hx, PLAZA_Y + 3, hz, B.LAMP);
  }
}

function sandbox(b: Builder, r: RegionInfo): void {
  const rainbow = [B.WOOL_RED, B.WOOL_ORANGE, B.WOOL_YELLOW, B.WOOL_GREEN, B.WOOL_BLUE, B.WOOL_PURPLE, B.WOOL_WHITE];
  plazaFloor(b, r, (_x, _z, d) => (d < 3 ? B.WOOL_WHITE : rainbow[Math.floor(d / 2) % rainbow.length]));
  let i = 0;
  for (const [x, z] of ring(r, PLAZA_RADIUS - 1, 9)) {
    const h = 2 + (i % 3);
    for (let y = 1; y <= h; y++) b.put(x, PLAZA_Y + y, z, rainbow[(i + y) % rainbow.length]);
    b.put(x, PLAZA_Y + h + 1, z, B.LAMP);
    i++;
  }
  // a big glass-and-brick cube sculpture outside
  const sx = r.cx + Math.round(Math.cos(r.angle) * 28), sz = r.cz + Math.round(Math.sin(r.angle) * 28);
  for (let dx = -3; dx <= 3; dx++) for (let dy = 0; dy <= 6; dy++) for (let dz = -3; dz <= 3; dz++) {
    const edges = [Math.abs(dx) === 3, dy === 0 || dy === 6, Math.abs(dz) === 3].filter(Boolean).length;
    if (edges >= 2) b.put(sx + dx, PLAZA_Y + 1 + dy, sz + dz, B.BRICKS);
    else if (edges === 1) b.put(sx + dx, PLAZA_Y + 1 + dy, sz + dz, B.GLASS);
  }
  b.put(sx, PLAZA_Y + 4, sz, B.LAMP);
}

const BUILDERS: Record<RegionId, (b: Builder, r: RegionInfo) => void> = { survival, adventure, rpg, fps, indie, sandbox };

export function buildStructures(): StructureMap {
  const b = new Builder();
  pathLamps(b);
  for (const r of REGIONS) BUILDERS[r.id](b, r);
  spawnHub(b);
  return b.map;
}

/** Waystone locations (spawn + each plaza) for fast travel. */
export function waystones(): { id: RegionId | 'spawn'; x: number; z: number }[] {
  return [{ id: 'spawn', x: 0, z: 0 }, ...REGIONS.map((r) => ({ id: r.id, x: r.cx, z: r.cz }))];
}
