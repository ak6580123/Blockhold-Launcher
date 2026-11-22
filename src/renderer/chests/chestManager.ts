import * as THREE from 'three';
import { REGION_NAMES, type ChestPos, type Game, type GameStatus, type RegionId } from '../../shared/types';
import { B, SOLID } from '../engine/blocks';
import type { Chunk } from '../engine/chunk';
import { CHUNK, PLAZA_Y, REGIONS, regionById } from '../engine/terrain';
import type { World } from '../engine/world';
import { createChestMesh, disposeSprite, makeLabel, type ChestMesh } from './chestModel';

interface ChestEntity {
  game: Game;
  pos: ChestPos;
  mesh: ChestMesh;
  label: THREE.Sprite;
  labelKey: string;
  cover: THREE.Sprite | null;
  coverRequested: boolean;
  openness: number;
  open: boolean;
  running: boolean;
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const RING_RADII = [4, 7, 10, 12.5];

/** Region whose waystone is closest to a position. */
const nearestRegion = (p: ChestPos): RegionId => {
  let best = REGIONS[0], bestD = Infinity;
  for (const r of REGIONS) {
    const d = (r.cx - p.x) ** 2 + (r.cz - p.z) ** 2;
    if (d < bestD) { bestD = d; best = r; }
  }
  return best.id;
};

/** Every game in the library is a physical chest. This keeps meshes, collision blocks and positions in sync. */
export class ChestManager {
  private ents = new Map<string, ChestEntity>();
  private byPos = new Map<string, string>();
  readonly group = new THREE.Group();
  private running = new Set<string>();
  /** games whose chest is being carried by the player (move mode) */
  carrying: string | null = null;

  constructor(scene: THREE.Scene, private world: World, private loadCover: (id: string) => Promise<string | null>) {
    scene.add(this.group);
  }

  get count(): number {
    return this.ents.size;
  }

  games(): Game[] {
    return [...this.ents.values()].map((e) => e.game);
  }

  get(id: string): Game | undefined {
    return this.ents.get(id)?.game;
  }

  position(id: string): ChestPos | undefined {
    return this.ents.get(id)?.pos;
  }

  /** Game id of the chest occupying a block cell. */
  at(x: number, y: number, z: number): string | undefined {
    return this.byPos.get(key(x, y, z));
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  /**
   * Sync with the library. Returns games that were just given a chest position
   * (the caller persists those through the backend).
   */
  setGames(games: Game[]): Game[] {
    const assigned: Game[] = [];
    const ids = new Set(games.map((g) => g.id));
    for (const id of [...this.ents.keys()]) if (!ids.has(id)) this.removeEntity(id);
    for (const g of games) {
      const e = this.ents.get(g.id);
      if (e) {
        const styleChanged = e.game.chestStyle !== g.chestStyle;
        const regionChanged = e.game.category !== g.category;
        e.game = g;
        if (regionChanged) {
          // region changed: carry the chest over to a free slot in the new region
          const pos = this.findSlot(g.category);
          this.place(g.id, pos);
          assigned.push({ ...g, chest: pos });
        } else if (g.chest &&(g.chest.x !== e.pos.x || g.chest.y !== e.pos.y || g.chest.z !== e.pos.z || g.chest.facing !== e.pos.facing)) this.place(g.id, g.chest);
        if (styleChanged) this.rebuildMesh(e);
        this.refreshLabel(e);
        continue;
      }
      let pos = g.chest;
      if (!pos || this.byPos.has(key(pos.x, pos.y, pos.z)) || nearestRegion(pos) !== g.category) {
        pos = this.findSlot(g.category);
        assigned.push({ ...g, chest: pos });
      }
      this.createEntity({ ...g, chest: pos }, pos);
    }
    return assigned;
  }

  private createEntity(g: Game, pos: ChestPos): void {
    const mesh = createChestMesh(g.chestStyle);
    const label = makeLabel(g.title, '');
    const e: ChestEntity = { game: g, pos, mesh, label, labelKey: '', cover: null, coverRequested: false, openness: 0, open: false, running: this.running.has(g.id) };
    this.ents.set(g.id, e);
    this.group.add(mesh.group, label);
    this.place(g.id, pos);
    this.refreshLabel(e);
  }

  private rebuildMesh(e: ChestEntity): void {
    this.group.remove(e.mesh.group);
    e.mesh = createChestMesh(e.game.chestStyle);
    this.group.add(e.mesh.group);
    this.place(e.game.id, e.pos);
  }

  private removeEntity(id: string): void {
    const e = this.ents.get(id);
    if (!e) return;
    this.clearCell(e.pos);
    this.group.remove(e.mesh.group, e.label);
    disposeSprite(e.label);
    if (e.cover) { this.group.remove(e.cover); disposeSprite(e.cover); }
    this.ents.delete(id);
  }

  private clearCell(p: ChestPos): void {
    const k = key(p.x, p.y, p.z);
    this.byPos.delete(k);
    if (this.world.getBlock(p.x, p.y, p.z) === B.CHEST) this.world.setBlock(p.x, p.y, p.z, B.AIR, false);
  }

  /** Put (or move) a chest at a position. */
  place(id: string, pos: ChestPos): void {
    const e = this.ents.get(id);
    if (!e) return;
    if (this.byPos.get(key(e.pos.x, e.pos.y, e.pos.z)) === id) this.clearCell(e.pos);
    e.pos = { ...pos };
    e.game = { ...e.game, chest: e.pos };
    this.byPos.set(key(pos.x, pos.y, pos.z), id);
    if (this.world.isLoaded(pos.x, pos.z)) this.world.setBlock(pos.x, pos.y, pos.z, B.CHEST, false);
    e.mesh.group.position.set(pos.x + 0.5, pos.y, pos.z + 0.5);
    e.mesh.group.rotation.y = pos.facing * Math.PI / 2;
    e.mesh.group.visible = this.carrying !== id;
    e.label.position.set(pos.x + 0.5, pos.y + 1.35, pos.z + 0.5);
    e.cover?.position.set(pos.x + 0.5, pos.y + 2.15, pos.z + 0.5);
  }

  /** Re-apply chest collision blocks when a chunk (re)generates. */
  applyToChunk(c: Chunk): void {
    for (const e of this.ents.values()) {
      const p = e.pos;
      if (Math.floor(p.x / CHUNK) === c.cx && Math.floor(p.z / CHUNK) === c.cz && this.carrying !== e.game.id) {
        c.set(p.x - c.cx * CHUNK, p.y, p.z - c.cz * CHUNK, B.CHEST);
      }
    }
  }

  /** Next free slot on the rings around a region's waystone; spills outward if full. */
  findSlot(region: RegionId): ChestPos {
    const r = regionById(region);
    const toSpawn = Math.atan2(-r.cz, -r.cx);
    const tryPos = (x: number, z: number, y: number): ChestPos | null => {
      if (this.byPos.has(key(x, y, z))) return null;
      if (this.world.isLoaded(x, z)) {
        const here = this.world.getBlock(x, y, z);
        if (SOLID[here] || here === B.WATER) return null;
        if (!SOLID[this.world.getBlock(x, y - 1, z)]) return null;
      }
      // face the waystone
      const dx = r.cx - x, dz = r.cz - z;
      const facing = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 0 : 2);
      return { x, y, z, facing };
    };
    for (const radius of RING_RADII) {
      const n = Math.floor((2 * Math.PI * radius) / 2.2);
      for (let i = 0; i < n; i++) {
        const a = toSpawn + Math.PI + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (2 * Math.PI / n);
        // keep an aisle free from the gate to the waystone
        if (Math.abs(Math.atan2(Math.sin(a - toSpawn), Math.cos(a - toSpawn))) < 0.3) continue;
        const p = tryPos(Math.round(r.cx + Math.cos(a) * radius), Math.round(r.cz + Math.sin(a) * radius), PLAZA_Y + 1);
        if (p) return p;
      }
    }
    // overflow: spiral outwards onto natural terrain
    for (let radius = 22; radius < 200; radius += 2.5) {
      const n = Math.floor((2 * Math.PI * radius) / 2.5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = Math.round(r.cx + Math.cos(a) * radius), z = Math.round(r.cz + Math.sin(a) * radius);
        const col = this.world.gen.column(x, z);
        const y = this.world.isLoaded(x, z) ? this.world.surfaceY(x, z) + 1 : col.height + 1;
        const p = tryPos(x, z, y);
        if (p) return p;
      }
    }
    return { x: r.cx + 2, y: PLAZA_Y + 1, z: r.cz + 2, facing: 0 };
  }

  setOpen(id: string, open: boolean): void {
    const e = this.ents.get(id);
    if (e) e.open = open;
  }

  setCarrying(id: string | null): void {
    const prev = this.carrying;
    this.carrying = id;
    if (prev) { const e = this.ents.get(prev); if (e) { e.mesh.group.visible = true; e.label.visible = true; this.place(prev, e.pos); } }
    if (id) {
      const e = this.ents.get(id);
      if (e) { e.mesh.group.visible = false; e.label.visible = false; if (e.cover) e.cover.visible = false; this.clearCell(e.pos); }
    }
  }

  setStatus(s: GameStatus): void {
    if (s.running) this.running.add(s.id); else this.running.delete(s.id);
    const e = this.ents.get(s.id);
    if (e) {
      e.running = s.running;
      e.game = { ...e.game, playtimeSeconds: s.playtimeSeconds, lastPlayed: s.lastPlayed ?? e.game.lastPlayed };
      this.refreshLabel(e);
    }
  }

  private refreshLabel(e: ChestEntity): void {
    const sub = e.running ? '▶ Running' : '';
    const k = `${e.game.title}|${sub}`;
    if (k === e.labelKey) return;
    e.labelKey = k;
    const visible = e.label.visible;
    this.group.remove(e.label);
    disposeSprite(e.label);
    e.label = makeLabel(e.game.title, sub);
    e.label.visible = visible;
    e.label.position.set(e.pos.x + 0.5, e.pos.y + 1.35, e.pos.z + 0.5);
    this.group.add(e.label);
  }

  private requestCover(e: ChestEntity): void {
    e.coverRequested = true;
    void this.loadCover(e.game.id).then((url) => {
      if (!url || !this.ents.has(e.game.id)) return;
      new THREE.TextureLoader().load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        const img = tex.image as HTMLImageElement;
        const aspect = img.width && img.height ? img.width / img.height : 1;
        const h = aspect < 1 ? 1.1 : 0.75;
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
        s.scale.set(h * aspect, h, 1);
        s.position.set(e.pos.x + 0.5, e.pos.y + 1.55 + h / 2, e.pos.z + 0.5);
        if (e.cover) { this.group.remove(e.cover); disposeSprite(e.cover); }
        e.cover = s;
        this.group.add(s);
      });
    });
  }

  /** Re-fetch the cover after the user changed it. */
  invalidateCover(id: string): void {
    const e = this.ents.get(id);
    if (e) e.coverRequested = false;
  }

  update(dt: number, eye: THREE.Vector3): void {
    const t = performance.now() / 1000;
    for (const e of this.ents.values()) {
      const target = e.open ? 1 : 0;
      e.openness += (target - e.openness) * Math.min(1, dt * 9);
      e.mesh.lid.rotation.x = -e.openness * 1.45;
      const dx = e.pos.x + 0.5 - eye.x, dz = e.pos.z + 0.5 - eye.z, dy = e.pos.y - eye.y;
      const d2 = dx * dx + dz * dz + dy * dy;
      const carried = this.carrying === e.game.id;
      // labels & covers appear as you approach (lazy-loaded covers)
      e.label.visible = !carried && d2 < 22 * 22;
      if (d2 < 18 * 18 && !e.coverRequested) this.requestCover(e);
      if (e.cover) e.cover.visible = !carried && d2 < 26 * 26;
      if (e.running) {
        e.mesh.latchMat.emissive.set(0x5cff6e);
        e.mesh.latchMat.emissiveIntensity = 0.6 + Math.sin(t * 4) * 0.4;
      } else {
        e.mesh.latchMat.emissive.copy(e.mesh.baseEmissive);
        e.mesh.latchMat.emissiveIntensity = e.mesh.baseIntensity;
      }
    }
  }

  regionLabel(id: string): string {
    const g = this.get(id);
    return g ? REGION_NAMES[g.category] : '';
  }
}
