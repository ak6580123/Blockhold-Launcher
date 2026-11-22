import { describe, expect, it } from 'vitest';
import { B } from '../src/renderer/engine/blocks';
import { Chunk, generateChunk } from '../src/renderer/engine/chunk';
import { buildStructures } from '../src/renderer/engine/structures';
import { PLAZA_RADIUS, PLAZA_Y, REGIONS, TerrainGen } from '../src/renderer/engine/terrain';
import { breakTime } from '../src/renderer/interaction/blockInteraction';
import { Inventory } from '../src/renderer/inventory/inventory';
import { boxAt, sweepAxis } from '../src/renderer/player/physics';
import { raycastVoxels } from '../src/renderer/player/raycast';

describe('terrain', () => {
  it('is deterministic per seed', () => {
    const a = new TerrainGen(42), b = new TerrainGen(42), c = new TerrainGen(43);
    expect(a.column(100, -37)).toEqual(b.column(100, -37));
    const differs = [...Array(20)].some((_, i) => a.column(300 + i * 17, 250).height !== c.column(300 + i * 17, 250).height);
    expect(differs).toBe(true);
  });

  it('flattens spawn and every region plaza to the plaza level', () => {
    const g = new TerrainGen(7);
    expect(g.column(0, 0).height).toBe(PLAZA_Y);
    for (const r of REGIONS) {
      expect(g.column(r.cx, r.cz).height).toBe(PLAZA_Y);
      expect(g.column(r.cx + PLAZA_RADIUS - 2, r.cz).height).toBe(PLAZA_Y);
    }
  });

  it('generates chunks with bedrock, terrain and structures', () => {
    const g = new TerrainGen(7);
    const s = buildStructures();
    const c = new Chunk(0, 0);
    generateChunk(c, g, s);
    expect(c.get(0, 0, 0)).toBe(B.BEDROCK);
    expect(c.get(0, PLAZA_Y + 1, 0)).toBe(B.WAYSTONE); // spawn waystone
    expect(c.lights.size).toBeGreaterThan(0); // waystone/torches emit light
  });

  it('builds every region plaza in the right place (floor + waystone + free chest ring)', () => {
    const g = new TerrainGen(123);
    const s = buildStructures();
    const at = (x: number, y: number, z: number) => {
      const c = new Chunk(Math.floor(x / 16), Math.floor(z / 16));
      generateChunk(c, g, s);
      return c.get(x - c.cx * 16, y, z - c.cz * 16);
    };
    for (const r of REGIONS) {
      expect(at(r.cx, PLAZA_Y + 1, r.cz)).toBe(B.WAYSTONE);
      expect(at(r.cx, PLAZA_Y + 2, r.cz)).toBe(B.WAYSTONE);
      expect(at(r.cx + 4, PLAZA_Y, r.cz)).not.toBe(B.AIR);
      expect(at(r.cx + 4, PLAZA_Y + 1, r.cz)).toBe(B.AIR);
    }
  });

  it('keeps structure blocks inside their structure footprint and height', () => {
    const s = buildStructures();
    for (const arr of s.values()) for (let i = 0; i < arr.length; i += 4) {
      const [x, y, z] = [arr[i], arr[i + 1], arr[i + 2]];
      expect(y).toBeGreaterThanOrEqual(PLAZA_Y - 3);
      expect(y).toBeLessThan(PLAZA_Y + 16);
      const nearSpawn = Math.hypot(x, z) < 20;
      const nearRegion = REGIONS.some((r) => Math.hypot(x - r.cx, z - r.cz) < 46);
      const onPath = REGIONS.some((r) => { const t = (x * r.cx + z * r.cz) / (r.cx ** 2 + r.cz ** 2); const px = r.cx * t, pz = r.cz * t; return t >= 0 && t <= 1 && Math.hypot(x - px, z - pz) < 5; });
      expect(nearSpawn || nearRegion || onPath).toBe(true);
    }
  });
});

describe('physics & raycast', () => {
  const solidFloor = (_x: number, y: number) => y < 10;

  it('lands flush on the floor and stops against walls', () => {
    const b = boxAt(0.5, 12, 0.5, 0.3, 1.8);
    const moved = sweepAxis(b, 1, -5, solidFloor);
    expect(moved).toBeGreaterThan(-2.01);
    expect(b.minY).toBeCloseTo(10, 3);
    const wall = (x: number) => x >= 3;
    const bx = boxAt(0.5, 10, 0.5, 0.3, 1.8);
    sweepAxis(bx, 0, 10, wall);
    expect(bx.maxX).toBeCloseTo(3, 3);
    expect(bx.maxX).toBeLessThan(3);
  });

  it('cannot tunnel through a 1-block wall at high speed', () => {
    const wall = (x: number) => x === 2;
    const b = boxAt(0.5, 0, 0.5, 0.3, 1.8);
    sweepAxis(b, 0, 40, wall);
    expect(b.maxX).toBeLessThan(2);
  });

  it('DDA ray hits the right block and face', () => {
    const get = (x: number, y: number, z: number) => (x === 3 && y === 0 && z === 0 ? B.STONE : B.AIR);
    const hit = raycastVoxels(0.5, 0.5, 0.5, 1, 0, 0, 10, get, () => true)!;
    expect([hit.x, hit.y, hit.z]).toEqual([3, 0, 0]);
    expect([hit.nx, hit.ny, hit.nz]).toEqual([-1, 0, 0]);
    expect(hit.dist).toBeCloseTo(2.5, 5);
    expect(raycastVoxels(0.5, 0.5, 0.5, 1, 0, 0, 2, get, () => true)).toBeNull();
  });
});

describe('tools & inventory', () => {
  it('right tool is much faster; unbreakables stay unbreakable', () => {
    expect(breakTime(B.STONE, 'pickaxe')).toBeLessThan(breakTime(B.STONE, null) / 5);
    expect(breakTime(B.LOG, 'axe')).toBeLessThan(breakTime(B.LOG, 'pickaxe'));
    expect(breakTime(B.LEAVES, 'sword')).toBeLessThan(0.1);
    expect(breakTime(B.BEDROCK, 'pickaxe')).toBe(Infinity);
    expect(breakTime(B.CHEST, 'axe')).toBe(Infinity);
  });

  it('stacks items and always keeps the game seeker', () => {
    const inv = new Inventory([]);
    expect(inv.slots[0]?.id).toBe('tool:pickaxe');
    expect(inv.slots.some((s) => s?.id === 'tool:seeker')).toBe(true);
    const before = inv.slots[4]!.count;
    inv.select(4);
    inv.consumeHeld();
    expect(inv.slots[4]!.count).toBe(before - 1);
    expect(inv.add(`block:${B.PLANKS}`, 1)).toBe(0);
    expect(inv.slots[4]!.count).toBe(before);
    const noSeeker = new Inventory([{ id: 'tool:axe', count: 1 }]);
    expect(noSeeker.slots.some((s) => s?.id === 'tool:seeker')).toBe(true);
  });
});
