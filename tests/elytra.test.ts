import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { validateSettings, validateWorldSave } from '../src/main/validate';
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

  describe('full 3D flight', () => {
    const mouse = (dx: number, dy: number, down: string[] = []) =>
      ({ ...input(down), isDown: (a: string) => down.includes(a), wasPressed: () => false, mouseDX: dx, mouseDY: dy }) as unknown as Input;
    const glide3d = (pitch = -0.1) => {
      const p = new Player(world);
      p.flight3d = true;
      p.teleport(0.5, 1, 0.5);
      p.update(1 / 60, input()); // touch the ground so the setting takes effect
      p.teleport(0.5, 120, 0.5);
      p.canGlide = true;
      for (let i = 0; i < 20; i++) p.update(1 / 60, input());
      p.pitch = pitch;
      p.update(1 / 60, input([], ['jump']));
      expect(p.flight3dActive).toBe(true);
      return p;
    };
    const fly = (p: Player, frames: number, dx = 0, dy = 0, down: string[] = []) => {
      for (let i = 0; i < frames; i++) { const m = mouse(dx, dy, down); p.look(m); p.update(1 / 60, m); }
    };
    const up = (p: Player) => new THREE.Vector3(0, 1, 0).applyQuaternion(p.flightQuat);

    it('stays off unless the setting is on', () => {
      const p = falling();
      p.update(1 / 60, input([], ['jump']));
      expect(p.gliding).toBe(true);
      expect(p.flight3dActive).toBe(false);
    });

    it('a setting change only applies after touching the ground', () => {
      const p = falling();
      p.flight3d = true; // switched on in mid-air
      p.update(1 / 60, input([], ['jump']));
      expect(p.gliding).toBe(true);
      expect(p.flight3dActive).toBe(false);

      const q = glide3d();
      q.flight3d = false; // switched off mid-glide: this flight stays 3D
      q.update(1 / 60, input());
      expect(q.flight3dActive).toBe(true);
      q.update(1 / 60, input([], ['jump'])); // fold
      for (let i = 0; i < 5; i++) q.update(1 / 60, input());
      q.update(1 / 60, input([], ['jump'])); // reopen, still airborne
      expect(q.gliding).toBe(true);
      expect(q.flight3dActive).toBe(true);
    });

    it('wings-level flight tracks the standard glide', () => {
      const a = falling(); a.pitch = -0.15; a.update(1 / 60, input([], ['jump']));
      const b = glide3d(-0.15);
      for (let i = 0; i < 180; i++) { a.update(1 / 60, input()); b.update(1 / 60, input()); }
      expect(b.vel.distanceTo(a.vel)).toBeLessThan(0.5);
      expect(b.pos.distanceTo(a.pos)).toBeLessThan(1);
    });

    it('rolls without limit and a full turn returns to level', () => {
      const p = glide3d();
      const dx = (Math.PI * 2) / (0.0022 * 1.5) / 120;
      fly(p, 60, dx);
      expect(up(p).y).toBeLessThan(-0.8); // halfway round: upside down
      fly(p, 60, dx);
      fly(p, 30); // let the smoothing settle
      expect(up(p).y).toBeGreaterThan(0.9);
    });

    it('mouse right banks right and the heading follows', () => {
      const p = glide3d();
      const yaw0 = p.yaw;
      fly(p, 30, 12);
      fly(p, 60);
      const turned = Math.atan2(Math.sin(p.yaw - yaw0), Math.cos(p.yaw - yaw0));
      expect(turned).toBeLessThan(-0.2); // yaw decreases when turning right
    });

    it('a banked turn rotates the view smoothly every frame', () => {
      const p = glide3d();
      p.flightQuat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 4));
      p.vel.set(0, -2, -20);
      const steps: number[] = [];
      let q = p.viewQuat();
      for (let i = 0; i < 288; i++) {
        p.update(1 / 144, input());
        const next = p.viewQuat();
        steps.push(q.angleTo(next));
        q = next;
      }
      const sorted = [...steps].sort((a, b) => a - b);
      expect(sorted[0]).toBeGreaterThan(0);
      expect(sorted[sorted.length - 1] / sorted[sorted.length >> 1]).toBeLessThan(1.5);
    });

    it('a banked turn moves the camera without 20 Hz steps', () => {
      const p = glide3d();
      p.flightQuat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 4));
      p.vel.set(0, -2, -20);
      for (let i = 0; i < 144; i++) p.update(1 / 144, input());
      let last = p.pos.clone(), step: THREE.Vector3 | null = null, worst = 0;
      for (let i = 0; i < 288; i++) {
        p.update(1 / 144, input());
        const next = p.pos.clone().sub(last);
        if (step) worst = Math.max(worst, next.distanceTo(step));
        step = next;
        last = p.pos.clone();
      }
      expect(worst).toBeLessThan(0.002);
    });

    it('A/D yaw the nose', () => {
      const p = glide3d();
      const yaw0 = p.yaw;
      fly(p, 60, 0, 0, ['left']);
      expect(Math.atan2(Math.sin(p.yaw - yaw0), Math.cos(p.yaw - yaw0))).toBeGreaterThan(0.3);
    });

    it('flies a loop through vertical with a valid orientation', () => {
      const p = glide3d(0);
      p.boost();
      let wentInverted = false;
      for (let i = 0; i < 240; i++) {
        p.boostTime = 1;
        fly(p, 1, 0, -12);
        if (up(p).y < -0.5) wentInverted = true;
        expect(Number.isFinite(p.pos.y)).toBe(true);
        expect(p.flightQuat.length()).toBeCloseTo(1);
      }
      expect(wentInverted).toBe(true);
    });

    it('inverted wings push you down', () => {
      const a = glide3d(0), b = glide3d(0);
      b.flightQuat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
      for (let i = 0; i < 60; i++) { a.update(1 / 60, null as unknown as Input); b.update(1 / 60, null as unknown as Input); }
      expect(b.vel.y).toBeLessThan(a.vel.y);
    });

    it('folding the wings restores level look and eases the view back', () => {
      const p = glide3d();
      fly(p, 40, 25, -5);
      p.update(1 / 60, input([], ['jump']));
      expect(p.gliding).toBe(false);
      expect(p.flight3dActive).toBe(false);
      expect(Math.abs(p.pitch)).toBeLessThan(Math.PI / 2);
      const during = new THREE.Vector3(1, 0, 0).applyQuaternion(p.viewQuat());
      expect(Math.abs(during.y)).toBeGreaterThan(0.01);
      for (let i = 0; i < 30; i++) p.update(1 / 60, input());
      expect(new THREE.Vector3(1, 0, 0).applyQuaternion(p.viewQuat()).y).toBeCloseTo(0);
    });

    it('teleporting ends 3D flight immediately', () => {
      const p = glide3d();
      fly(p, 20, 20);
      p.teleport(0.5, 50, 0.5);
      expect(p.flight3dActive).toBe(false);
      expect(new THREE.Vector3(1, 0, 0).applyQuaternion(p.viewQuat()).y).toBeCloseTo(0);
    });

    it('validates the settings', () => {
      expect(validateSettings({}).elytra3dFlight).toBe(false);
      expect(validateSettings({ elytra3dFlight: true, elytraRollSensitivity: 99 })).toMatchObject({ elytra3dFlight: true, elytraRollSensitivity: 3 });
    });
  });

  it('world saves keep the worn elytra and reject junk', () => {
    const base = { seed: 1, mods: [], player: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, timeOfDay: 0.2 };
    expect(validateWorldSave({ ...base, inventory: { slots: [], selected: 0, back: { id: ELYTRA_ID, count: 1 } } }).inventory.back).toEqual({ id: ELYTRA_ID, count: 1 });
    expect(validateWorldSave({ ...base, inventory: { slots: [], selected: 0, back: 'x' } }).inventory.back).toBeNull();
    expect(validateWorldSave({ ...base, inventory: { slots: [], selected: 0 } }).inventory.back).toBeNull();
  });
});
