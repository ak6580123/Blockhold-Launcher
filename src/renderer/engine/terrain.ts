import { REGION_IDS, type RegionId } from '../../shared/types';
import { B } from './blocks';
import { Simplex2, hash2, lerp, smoothstep } from './noise';

export const CHUNK = 16;
export const HEIGHT = 128;
export const SEA_LEVEL = 26;
export const PLAZA_Y = 32; // top surface block y of all plazas & paths
export const SPAWN_RADIUS = 13;
export const PLAZA_RADIUS = 17;
export const REGION_DISTANCE = 78;

export interface RegionInfo {
  id: RegionId;
  cx: number;
  cz: number;
  angle: number;
}

/** Regions sit on a ring around the spawn hub, joined to it by paths. */
export const REGIONS: RegionInfo[] = REGION_IDS.map((id, i) => {
  const angle = (i / REGION_IDS.length) * Math.PI * 2 + Math.PI / 6;
  return { id, angle, cx: Math.round(Math.cos(angle) * REGION_DISTANCE), cz: Math.round(Math.sin(angle) * REGION_DISTANCE) };
});
export const regionById = (id: RegionId): RegionInfo => REGIONS.find((r) => r.id === id)!;

export interface Column {
  height: number; // y of top solid block
  surface: number; // block id for top
  sub: number; // block id beneath top (3 deep)
  region: RegionId | null; // which region influences this column (for decoration)
  flat: number; // 0..1 how much this column is part of a plaza/path
  path: boolean;
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  const x = ax + dx * t - px, z = az + dz * t - pz;
  return Math.sqrt(x * x + z * z);
}

export class TerrainGen {
  private n1: Simplex2;
  private n2: Simplex2;
  private n3: Simplex2;
  private n4: Simplex2;

  constructor(public readonly seed: number) {
    this.n1 = new Simplex2(seed);
    this.n2 = new Simplex2(seed + 101);
    this.n3 = new Simplex2(seed + 202);
    this.n4 = new Simplex2(seed + 303);
  }

  /** Raw natural height before plazas/paths are carved. */
  naturalHeight(x: number, z: number): number {
    const base = 30 + this.n1.fbm(x / 140, z / 140, 4) * 11;
    const hills = Math.max(0, this.n2.fbm(x / 70, z / 70, 3)) * 10;
    const distFromSpawn = Math.sqrt(x * x + z * z);
    const mountainMask = smoothstep(115, 175, distFromSpawn);
    const ridge = 1 - Math.abs(this.n3.fbm(x / 210, z / 210, 4));
    const mountains = Math.max(0, ridge - 0.55) * 120 * mountainMask;
    return base + hills + mountains;
  }

  column(x: number, z: number): Column {
    let h = this.naturalHeight(x, z);
    let flat = 0;
    let region: RegionId | null = null;
    let regionDist = Infinity;

    // Spawn hub
    const ds = Math.sqrt(x * x + z * z);
    const fs = 1 - smoothstep(SPAWN_RADIUS + 1, SPAWN_RADIUS + 18, ds);
    flat = Math.max(flat, fs);

    // Region plazas + their influence area
    for (const r of REGIONS) {
      const d = Math.hypot(x - r.cx, z - r.cz);
      const f = 1 - smoothstep(PLAZA_RADIUS + 2, PLAZA_RADIUS + 22, d);
      flat = Math.max(flat, f);
      if (d < 58 && d < regionDist) { regionDist = d; region = r.id; }
    }

    // Paths from spawn to each plaza
    let pathD = Infinity;
    for (const r of REGIONS) pathD = Math.min(pathD, distToSegment(x, z, 0, 0, r.cx, r.cz));
    const fp = 1 - smoothstep(3, 11, pathD);
    flat = Math.max(flat, fp);

    h = lerp(h, PLAZA_Y, flat);
    const height = Math.max(4, Math.min(HEIGHT - 20, Math.round(h)));
    const isPath = pathD < 2.2 && ds > SPAWN_RADIUS && regionDist > PLAZA_RADIUS;

    let surface: number = B.GRASS;
    let sub: number = B.DIRT;
    const beach = height <= SEA_LEVEL + 1;
    if (region === 'adventure' && regionDist < 50) { surface = B.SAND; sub = B.SANDSTONE; }
    else if (region === 'fps' && regionDist < 40) { surface = this.n4.noise(x / 9, z / 9) > 0.2 ? B.GRAVEL : B.DARK_STONE; sub = B.STONE; }
    else if (beach) { surface = B.SAND; sub = B.SAND; }
    if (height > 70) { surface = B.SNOW; sub = B.STONE; }
    else if (height > 58 && !region) { surface = this.n4.noise(x / 6, z / 6) > 0 ? B.STONE : B.GRASS; sub = B.STONE; }
    if (isPath) { surface = region === 'adventure' ? B.SANDSTONE : B.PATH; }
    return { height, surface, sub, region, flat, path: isPath };
  }

  /** Deterministic per-column value used for vegetation decisions. */
  rand(x: number, z: number, salt = 0): number {
    return hash2(x, z, this.seed + salt * 7919);
  }

  /** Tree kind to plant at a column, or null. */
  treeAt(x: number, z: number, c: Column): 'oak' | 'spruce' | 'cactus' | null {
    if (c.flat > 0.35 || c.height <= SEA_LEVEL + 1 || c.path) return null;
    if (c.surface !== B.GRASS && c.surface !== B.SAND && c.surface !== B.SNOW) return null;
    const r = this.rand(x, z, 1);
    if (c.surface === B.SAND) return c.region === 'adventure' && r < 0.012 ? 'cactus' : null;
    let density = 0.012;
    switch (c.region) {
      case 'survival': density = 0.05; break;
      case 'indie': density = 0.02; break;
      case 'rpg': density = 0.018; break;
      case 'sandbox': density = 0.008; break;
      case 'fps': density = 0.003; break;
      default: density = 0.015 + Math.max(0, this.n2.noise(x / 50, z / 50)) * 0.04;
    }
    if (r >= density) return null;
    return c.height > 50 || c.surface === B.SNOW ? 'spruce' : 'oak';
  }

  /** Small plant on top of grass, or AIR. */
  plantAt(x: number, z: number, c: Column): number {
    if (c.surface !== B.GRASS || c.flat > 0.6) return B.AIR;
    const r = this.rand(x, z, 2);
    const flowerBoost = c.region === 'indie' ? 0.05 : 0.008;
    if (r < flowerBoost) return this.rand(x, z, 3) < 0.5 ? B.FLOWER_RED : B.FLOWER_YELLOW;
    if (r < flowerBoost + 0.12) return B.TALL_GRASS;
    return B.AIR;
  }
}
