// Axis-aligned box vs voxel grid collision, resolved one axis at a time.

export interface AABB { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

export type SolidFn = (x: number, y: number, z: number) => boolean;

export function boxAt(x: number, y: number, z: number, halfW: number, height: number): AABB {
  return { minX: x - halfW, minY: y, minZ: z - halfW, maxX: x + halfW, maxY: y + height, maxZ: z + halfW };
}

export function boxCollides(b: AABB, solid: SolidFn): boolean {
  const eps = 1e-6;
  for (let x = Math.floor(b.minX + eps); x <= Math.floor(b.maxX - eps); x++)
    for (let y = Math.floor(b.minY + eps); y <= Math.floor(b.maxY - eps); y++)
      for (let z = Math.floor(b.minZ + eps); z <= Math.floor(b.maxZ - eps); z++)
        if (solid(x, y, z)) return true;
  return false;
}

/**
 * Move a box along one axis by `delta`, stopping flush against the first solid voxel.
 * Returns the distance actually moved.
 */
export function sweepAxis(b: AABB, axis: 0 | 1 | 2, delta: number, solid: SolidFn): number {
  if (delta === 0) return 0;
  const step = Math.sign(delta);
  let remaining = Math.abs(delta);
  let moved = 0;
  // sub-step so fast movement can't tunnel through 1-block walls
  while (remaining > 0) {
    const d = Math.min(remaining, 0.45) * step;
    shift(b, axis, d);
    if (boxCollides(b, solid)) {
      shift(b, axis, -d);
      // snap flush to the voxel boundary
      if (step > 0) {
        const edge = axis === 0 ? b.maxX : axis === 1 ? b.maxY : b.maxZ;
        const target = Math.floor(edge + d) - 0.0001;
        const gap = Math.max(0, target - edge);
        shift(b, axis, gap);
        moved += gap;
      } else {
        const edge = axis === 0 ? b.minX : axis === 1 ? b.minY : b.minZ;
        const target = Math.ceil(edge + d) + 0.0001;
        const gap = Math.min(0, target - edge);
        shift(b, axis, gap);
        moved += gap;
      }
      return moved;
    }
    moved += d;
    remaining -= Math.abs(d);
  }
  return moved;
}

function shift(b: AABB, axis: 0 | 1 | 2, d: number): void {
  if (axis === 0) { b.minX += d; b.maxX += d; }
  else if (axis === 1) { b.minY += d; b.maxY += d; }
  else { b.minZ += d; b.maxZ += d; }
}
