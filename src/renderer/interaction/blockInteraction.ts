import * as THREE from 'three';
import { BLOCKS, B, blockDef, type ToolKind } from '../engine/blocks';
import type { Particles } from '../engine/particles';
import { getAtlas } from '../engine/textures';
import type { World } from '../engine/world';
import type { AudioManager } from '../audio/audio';
import type { Inventory } from '../inventory/inventory';
import { blockItemId, itemDef } from '../inventory/items';
import type { Player } from '../player/player';
import { raycastVoxels, type RayHit } from '../player/raycast';

export const REACH = 5.5;
export const SEEKER_REACH = 48;

/** Seconds needed to break a block with the given tool. */
export function breakTime(blockId: number, tool: ToolKind | null): number {
  const d = blockDef(blockId);
  if (!Number.isFinite(d.hardness)) return Infinity;
  if (d.hardness === 0) return 0;
  let t = d.hardness;
  if (tool && d.tool === tool) t /= 6;
  else if (tool === 'sword') t = d.tool === 'sword' || d.render === 'cross' ? 0.05 : t * 1.5;
  if (tool === 'sword' && (blockId === B.LEAVES || blockId === B.SPRUCE_LEAVES)) t = 0.05;
  return Math.max(0.05, t);
}

/** Raycast targeting, the selection outline, timed breaking with crack overlay, and placing. */
export class BlockInteraction {
  target: RayHit | null = null;
  private outline: THREE.LineSegments;
  private crack: THREE.Mesh;
  private crackTex: THREE.Texture[] = [];
  private progress = 0;
  private breakingKey = '';
  private hitSoundTimer = 0;
  breaking = false;
  /** blocks placed/broken since last save */
  onWorldEdit: (() => void) | null = null;

  constructor(scene: THREE.Scene, private world: World, private player: Player, private inv: Inventory, private audio: AudioManager, private particles: Particles) {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6 }));
    this.outline.visible = false;
    scene.add(this.outline);

    const atlas = getAtlas();
    for (let s = 0; s < 10; s++) {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      atlas.drawTile(c.getContext('2d')!, atlas.index.get(`crack_${s}`)!, 0, 0, 16, 16);
      const t = new THREE.CanvasTexture(c);
      t.magFilter = t.minFilter = THREE.NearestFilter;
      this.crackTex.push(t);
    }
    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.006, 1.006, 1.006),
      new THREE.MeshBasicMaterial({ map: this.crackTex[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
    );
    this.crack.visible = false;
    scene.add(this.crack);
  }

  /** Update the block under the crosshair. */
  updateTarget(maxDist = REACH): void {
    const eye = this.player.eye();
    const dir = this.player.lookDir();
    this.target = raycastVoxels(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, maxDist, (x, y, z) => this.world.getBlock(x, y, z), (id) => id !== B.WATER);
    if (this.target && this.target.dist <= REACH) {
      const d = BLOCKS[this.target.id];
      this.outline.visible = true;
      const small = d.render === 'cross' || d.render === 'torch';
      this.outline.scale.setScalar(small ? 0.6 : d.id === B.CHEST ? 0.9 : 1);
      this.outline.position.set(this.target.x + 0.5, this.target.y + (small ? 0.3 : d.id === B.CHEST ? 0.45 : 0.5), this.target.z + 0.5);
    } else this.outline.visible = false;
  }

  /** Held left mouse: accumulate break progress; break when done. */
  tickBreaking(dt: number, holding: boolean): void {
    const t = this.target;
    const tool = itemDef(this.inv.held?.id ?? '')?.tool ?? null;
    if (!holding || !t || t.dist > REACH || t.id === B.CHEST) { this.resetBreak(); return; }
    const k = `${t.x},${t.y},${t.z}`;
    if (k !== this.breakingKey) { this.breakingKey = k; this.progress = 0; }
    const need = breakTime(t.id, tool);
    this.breaking = true;
    if (!Number.isFinite(need)) { this.crack.visible = false; return; }
    this.progress += dt / need;
    this.hitSoundTimer -= dt;
    if (this.hitSoundTimer <= 0) { this.audio.hit(blockDef(t.id).sound); this.hitSoundTimer = 0.25; }
    if (this.progress >= 1) {
      this.breakBlock(t);
      this.resetBreak();
      return;
    }
    this.crack.visible = true;
    this.crack.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
    (this.crack.material as THREE.MeshBasicMaterial).map = this.crackTex[Math.min(9, Math.floor(this.progress * 10))];
  }

  private resetBreak(): void {
    this.progress = 0;
    this.breakingKey = '';
    this.crack.visible = false;
    this.breaking = false;
  }

  private breakBlock(t: RayHit): void {
    const d = blockDef(t.id);
    this.world.setBlock(t.x, t.y, t.z, B.AIR);
    // plants and torches standing on the broken block pop off too
    const above = this.world.getBlock(t.x, t.y + 1, t.z);
    const ad = blockDef(above);
    if (ad.render === 'cross' || ad.render === 'torch') this.world.setBlock(t.x, t.y + 1, t.z, B.AIR);
    this.audio.breakBlock(d.sound);
    this.particles.burst(t.x, t.y, t.z, getAtlas().avgColor(getAtlas().index.get(d.tiles[2]) ?? 0));
    const drop = d.drops === undefined ? t.id : d.drops;
    if (drop !== null && blockDef(drop).placeable) this.inv.add(blockItemId(drop), 1);
    this.onWorldEdit?.();
  }

  /** Right-click with a block in hand: place it against the targeted face. */
  tryPlace(): boolean {
    const t = this.target;
    const held = this.inv.held;
    const def = itemDef(held?.id ?? '');
    if (!t || t.dist > REACH || !def || def.kind !== 'block' || def.blockId === undefined) return false;
    let x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
    // clicking a plant replaces it
    const tdef = blockDef(t.id);
    if (tdef.render === 'cross') { x = t.x; y = t.y; z = t.z; }
    const cur = this.world.getBlock(x, y, z);
    const curDef = blockDef(cur);
    if (cur !== B.AIR && cur !== B.WATER && curDef.render !== 'cross') return false;
    if (y <= 0 || y >= 127) return false;
    const placing = blockDef(def.blockId);
    if (placing.solid && this.player.overlapsCell(x, y, z)) return false;
    if (placing.render === 'torch' || placing.render === 'cross') {
      // needs something to stand on
      if (!blockDef(this.world.getBlock(x, y - 1, z)).solid) return false;
    }
    this.world.setBlock(x, y, z, def.blockId);
    this.inv.consumeHeld();
    this.audio.place(placing.sound);
    this.onWorldEdit?.();
    return true;
  }

  hide(): void {
    this.outline.visible = false;
    this.resetBreak();
  }
}
