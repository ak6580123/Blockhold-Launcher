import { describe, expect, it } from 'vitest';
import { validateWorldSave } from '../src/main/validate';
import { B } from '../src/renderer/engine/blocks';
import type { World } from '../src/renderer/engine/world';
import { Inventory } from '../src/renderer/inventory/inventory';
import { ELYTRA_ID, FIREWORK_ID, ITEM_PIXELS, PALETTE_ITEMS } from '../src/renderer/inventory/items';
import type { Input } from '../src/renderer/player/input';
import { Player } from '../src/renderer/player/player';

/** Flat open world: stone floor at y < 1, air everywhere else. */
const world = {
  getBlock: (_x: number, y: number) => (y < 1 ? B.STONE : B.AIR),
  isSolid: (_x: number, y: number) => y < 1,
  isLoaded: () => true,
} as unknown as World;

const input = (down: string[] = [], pressed: string[] = []) =>
  ({ isDown: (a: string) => down.includes(a), wasPressed: (a: string) => pressed.includes(a) }) as unknown as Input;

function falling(): Player {
  const p = new Player(world);
  p.teleport(0.5, 120, 0.5);
  p.canGlide = true;
  for (let i = 0; i < 20; i++) p.update(1 / 60, input()); // start falling
  return p;
}

describe('elytra', () => {
  it('opens only while falling with an elytra worn', () => {
    const p = falling();
    p.canGlide = false;
    p.update(1 / 60, input([], ['jump']));
    expect(p.gliding).toBe(false);

    const q = falling();
    q.update(1 / 60, input([], ['jump']));
    expect(q.gliding).toBe(true);
    expect(q.height).toBeLessThan(1);
  });

  it('glides forward far further than it falls, and diving gains speed', () => {
    const p = falling();
    p.pitch = -0.15; // gentle descent
    p.update(1 / 60, input([], ['jump']));
    const y0 = p.pos.y, z0 = p.pos.z;
    for (let i = 0; i < 60 * 4; i++) p.update(1 / 60, input());
    const dropped = y0 - p.pos.y, travelled = Math.abs(p.pos.z - z0);
    expect(travelled).toBeGreaterThan(dropped * 3);

    const d = falling();
    d.update(1 / 60, input([], ['jump']));
    d.pitch = -1.2; // steep dive
    for (let i = 0; i < 60 * 2; i++) d.update(1 / 60, input());
    expect(d.vel.length()).toBeGreaterThan(p.vel.length());
  });

  it('a firework only boosts while gliding, and pushes toward ~33 m/s', () => {
    const p = falling();
    expect(p.boost()).toBe(false);
    p.update(1 / 60, input([], ['jump']));
    p.pitch = 0.3;
    expect(p.boost()).toBe(true);
    for (let i = 0; i < 60; i++) p.update(1 / 60, input());
    expect(p.vel.length()).toBeGreaterThan(25);
    expect(p.vel.length()).toBeLessThan(40);
  });

  it('lands on the ground and stops gliding; tapping jump folds the wings', () => {
    const p = falling();
    p.update(1 / 60, input([], ['jump']));
    p.update(1 / 60, input([], ['jump']));
    expect(p.gliding).toBe(false);

    const q = new Player(world);
    q.teleport(0.5, 8, 0.5);
    q.canGlide = true;
    for (let i = 0; i < 10; i++) q.update(1 / 60, input());
    q.update(1 / 60, input([], ['jump']));
    q.pitch = -0.6;
    for (let i = 0; i < 60 * 10 && q.gliding; i++) q.update(1 / 60, input());
    expect(q.gliding).toBe(false);
    expect(q.onGround).toBe(true);
  });

  it('wears the elytra from the hotbar and saves it', () => {
    const inv = new Inventory([{ id: ELYTRA_ID, count: 1 }]);
    expect(inv.wearingElytra).toBe(false);
    inv.select(0);
    expect(inv.equipHeld()).toBe(true);
    expect(inv.wearingElytra).toBe(true);
    expect(inv.slots[0]).toBeNull();
    const saved = inv.serialize();
    expect(new Inventory(saved.slots, saved.selected, saved.back).wearingElytra).toBe(true);
    // only an elytra can be worn
    expect(new Inventory([], 0, { id: FIREWORK_ID, count: 3 }).back).toBeNull();
  });

  it('new worlds start with an elytra and fireworks; both are in the palette', () => {
    const inv = new Inventory([]);
    expect(inv.slots.some((s) => s?.id === ELYTRA_ID)).toBe(true);
    expect(inv.slots.find((s) => s?.id === FIREWORK_ID)?.count).toBe(64);
    expect(PALETTE_ITEMS.slice(0, 2)).toEqual([ELYTRA_ID, FIREWORK_ID]);
  });

  it('all pixel art is 16x16', () => {
    for (const [, px] of ITEM_PIXELS()) {
      expect(px).toHaveLength(16);
      for (const row of px) expect(row).toHaveLength(16);
    }
  });

  it('world saves keep the worn elytra and reject junk', () => {
    const base = { seed: 1, mods: [], player: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, timeOfDay: 0.2 };
    expect(validateWorldSave({ ...base, inventory: { slots: [], selected: 0, back: { id: ELYTRA_ID, count: 1 } } }).inventory.back).toEqual({ id: ELYTRA_ID, count: 1 });
    expect(validateWorldSave({ ...base, inventory: { slots: [], selected: 0, back: 'x' } }).inventory.back).toBeNull();
    expect(validateWorldSave({ ...base, inventory: { slots: [], selected: 0 } }).inventory.back).toBeNull();
  });
});
