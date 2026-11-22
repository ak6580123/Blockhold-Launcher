import type * as THREE from 'three';
import { B, LIGHT } from './blocks';
import { chunkKey, type StructureMap } from './structures';
import { CHUNK, HEIGHT, SEA_LEVEL, type Column, type TerrainGen } from './terrain';

export const idx = (x: number, y: number, z: number): number => x + z * CHUNK + y * CHUNK * CHUNK;

export class Chunk {
  readonly data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
  readonly key: string;
  maxY = 0;
  /** packed local indices of light-emitting blocks */
  lights = new Set<number>();
  meshes: THREE.Mesh[] = [];
  dirty = true;
  meshed = false;

  constructor(readonly cx: number, readonly cz: number) {
    this.key = chunkKey(cx, cz);
  }

  get(x: number, y: number, z: number): number {
    return this.data[idx(x, y, z)];
  }

  set(x: number, y: number, z: number, id: number): void {
    const i = idx(x, y, z);
    this.data[i] = id;
    if (LIGHT[id]) this.lights.add(i); else this.lights.delete(i);
    if (id !== B.AIR && y > this.maxY) this.maxY = y;
  }
}

function placeTree(c: Chunk, kind: 'oak' | 'spruce' | 'cactus', wx: number, y0: number, wz: number, r: number): void {
  const ox = c.cx * CHUNK, oz = c.cz * CHUNK;
  const put = (x: number, y: number, z: number, id: number, onlyAir: boolean) => {
    const lx = x - ox, lz = z - oz;
    if (lx < 0 || lz < 0 || lx >= CHUNK || lz >= CHUNK || y < 0 || y >= HEIGHT) return;
    const cur = c.get(lx, y, lz);
    if (onlyAir && cur !== B.AIR && cur !== B.TALL_GRASS && cur !== B.FLOWER_RED && cur !== B.FLOWER_YELLOW) return;
    c.set(lx, y, lz, id);
  };
  if (kind === 'cactus') {
    const h = 2 + Math.floor(r * 3);
    for (let y = 0; y < h; y++) put(wx, y0 + y, wz, B.CACTUS, true);
    return;
  }
  if (kind === 'oak') {
    const h = 4 + Math.floor(r * 3);
    const top = y0 + h;
    for (let y = top - 3; y <= top + 1; y++) {
      const rad = y >= top ? 1 : 2;
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        if (Math.abs(dx) === rad && Math.abs(dz) === rad && (y >= top || ((dx * 31 + dz * 17 + y) & 1))) continue;
        put(wx + dx, y, wz + dz, B.LEAVES, true);
      }
    }
    for (let y = 0; y < h; y++) put(wx, y0 + y, wz, B.LOG, false);
    return;
  }
  const h = 6 + Math.floor(r * 4);
  const top = y0 + h;
  for (let y = y0 + 2; y <= top + 1; y++) {
    const fromTop = top + 1 - y;
    const rad = fromTop === 0 ? 0 : fromTop % 2 === 1 ? 1 : Math.min(3, 1 + Math.floor(fromTop / 3));
    for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
      if (Math.abs(dx) + Math.abs(dz) > rad + 1) continue;
      put(wx + dx, y, wz + dz, B.SPRUCE_LEAVES, true);
    }
  }
  for (let y = 0; y < h; y++) put(wx, y0 + y, wz, B.SPRUCE_LOG, false);
}

/** Fill a chunk from the terrain generator, then trees, then structures. */
export function generateChunk(c: Chunk, gen: TerrainGen, structures: StructureMap): void {
  const ox = c.cx * CHUNK, oz = c.cz * CHUNK;
  const M = 3; // tree margin
  const W = CHUNK + M * 2;
  const cols: Column[] = new Array(W * W);
  for (let z = -M; z < CHUNK + M; z++) for (let x = -M; x < CHUNK + M; x++) cols[(x + M) + (z + M) * W] = gen.column(ox + x, oz + z);

  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const col = cols[(x + M) + (z + M) * W];
    const h = col.height;
    c.set(x, 0, z, B.BEDROCK);
    for (let y = 1; y <= h; y++) {
      let id: number;
      if (y === h) id = col.surface;
      else if (y >= h - 3) id = col.sub;
      else id = B.STONE;
      if (id === B.GRASS && h < SEA_LEVEL) id = B.DIRT;
      c.data[idx(x, y, z)] = id;
    }
    for (let y = h + 1; y <= SEA_LEVEL; y++) c.data[idx(x, y, z)] = B.WATER;
    if (h >= SEA_LEVEL) {
      const plant = gen.plantAt(ox + x, oz + z, col);
      if (plant) c.data[idx(x, h + 1, z)] = plant;
    }
    if (h + 1 > c.maxY) c.maxY = Math.max(h + 1, SEA_LEVEL);
  }

  for (let z = -M; z < CHUNK + M; z++) for (let x = -M; x < CHUNK + M; x++) {
    const col = cols[(x + M) + (z + M) * W];
    const kind = gen.treeAt(ox + x, oz + z, col);
    if (kind) placeTree(c, kind, ox + x, col.height + 1, oz + z, gen.rand(ox + x, oz + z, 4));
  }

  const placements = structures.get(c.key);
  if (placements) {
    for (let i = 0; i < placements.length; i += 4) {
      const lx = placements[i] - ox, y = placements[i + 1], lz = placements[i + 2] - oz;
      if (y >= 0 && y < HEIGHT) c.set(lx, y, lz, placements[i + 3]);
    }
  }
  // record light emitters & final maxY
  c.lights.clear();
  let maxY = 0;
  for (let i = 0; i < c.data.length; i++) {
    const id = c.data[i];
    if (id !== B.AIR) {
      if (LIGHT[id]) c.lights.add(i);
      const y = Math.floor(i / (CHUNK * CHUNK));
      if (y > maxY) maxY = y;
    }
  }
  c.maxY = maxY;
}
