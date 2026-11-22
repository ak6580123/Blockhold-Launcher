export interface RayHit {
  x: number; y: number; z: number; // block hit
  nx: number; ny: number; nz: number; // face normal (place position = hit + normal)
  dist: number;
  id: number;
}

/**
 * Voxel DDA traversal (Amanatides & Woo). `pick(id)` decides which blocks stop the ray.
 */
export function raycastVoxels(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
  getBlock: (x: number, y: number, z: number) => number,
  pick: (id: number) => boolean,
): RayHit | null {
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return null;
  dx /= len; dy /= len; dz /= len;
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = dx !== 0 ? ((sx > 0 ? x + 1 - ox : ox - x) * tdx) : Infinity;
  let tmy = dy !== 0 ? ((sy > 0 ? y + 1 - oy : oy - y) * tdy) : Infinity;
  let tmz = dz !== 0 ? ((sz > 0 ? z + 1 - oz : oz - z) * tdz) : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  for (let i = 0; i < 256 && t <= maxDist; i++) {
    const id = getBlock(x, y, z);
    if (id !== 0 && pick(id)) return { x, y, z, nx, ny, nz, dist: t, id };
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
    else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
  }
  return null;
}
