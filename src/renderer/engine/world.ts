import * as THREE from 'three';
import { B, LIGHT, OPAQUE, SOLID } from './blocks';
import { Chunk, generateChunk, idx } from './chunk';
import { LPAD, PAD, meshChunk, padIdx, type MeshBuffers } from './mesher';
import { buildStructures, chunkKey, type StructureMap } from './structures';
import { CHUNK, HEIGHT, TerrainGen } from './terrain';
import { getAtlas } from './textures';

/** Shared uniforms so the sky can dim torch light by day. */
export const worldUniforms = {
  uDay: { value: 1 },
  uBlockLightColor: { value: new THREE.Color(1.0, 0.78, 0.5) },
};

function patchBlockLight(mat: THREE.Material): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDay = worldUniforms.uDay;
    shader.uniforms.uBlockLightColor = worldUniforms.uBlockLightColor;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLight;\nvarying float vLight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLight = aLight;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLight;\nuniform float uDay;\nuniform vec3 uBlockLightColor;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  float bl = pow(clamp(vLight, 0.0, 1.0), 1.7);\n  totalEmissiveRadiance += diffuseColor.rgb * uBlockLightColor * bl * mix(1.05, 0.35, uDay);');
  };
}

export function createWorldMaterials(): { solid: THREE.MeshLambertMaterial; cross: THREE.MeshLambertMaterial; water: THREE.MeshLambertMaterial } {
  const map = getAtlas().texture;
  const solid = new THREE.MeshLambertMaterial({ map, vertexColors: true, alphaTest: 0.5 });
  const cross = new THREE.MeshLambertMaterial({ map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
  const water = new THREE.MeshLambertMaterial({ map, vertexColors: true, transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide });
  for (const m of [solid, cross, water]) patchBlockLight(m);
  return { solid, cross, water };
}

const posKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

export interface WorldStats { loaded: number; meshed: number; pendingMesh: number; triangles: number }

export class World {
  readonly gen: TerrainGen;
  readonly structures: StructureMap;
  readonly chunks = new Map<string, Chunk>();
  /** player edits: chunkKey -> (local index -> id) */
  private mods = new Map<string, Map<number, number>>();
  readonly group = new THREE.Group();
  private mats = createWorldMaterials();
  private offsets: [number, number][] = [];
  private rd = 0;
  private shadows = false;
  private padBuf = new Uint8Array(PAD * PAD * HEIGHT);
  /** called after a chunk's terrain is generated (chest overlays hook in here) */
  onChunkGenerated: ((c: Chunk) => void) | null = null;
  dirtyMods = false;

  constructor(scene: THREE.Scene, readonly seed: number, mods: [string, number][]) {
    this.gen = new TerrainGen(seed);
    this.structures = buildStructures();
    scene.add(this.group);
    for (const [k, id] of mods) {
      const [x, y, z] = k.split(',').map(Number);
      if ([x, y, z].some((n) => !Number.isFinite(n))) continue;
      this.recordMod(x, y, z, id);
    }
    this.setRenderDistance(6);
  }

  setRenderDistance(rd: number): void {
    this.rd = rd;
    this.offsets = [];
    const R = rd + 1;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dz * dz <= R * R + 1) this.offsets.push([dx, dz]);
    this.offsets.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  }

  setShadows(on: boolean): void {
    this.shadows = on;
    for (const c of this.chunks.values()) for (const m of c.meshes) { m.castShadow = on; m.receiveShadow = on; }
  }

  private recordMod(x: number, y: number, z: number, id: number): void {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const k = chunkKey(cx, cz);
    let m = this.mods.get(k);
    if (!m) { m = new Map(); this.mods.set(k, m); }
    m.set(idx(x - cx * CHUNK, y, z - cz * CHUNK), id);
  }

  serializeMods(): [string, number][] {
    const out: [string, number][] = [];
    for (const [k, m] of this.mods) {
      const [cx, cz] = k.split(',').map(Number);
      for (const [i, id] of m) {
        const x = i % CHUNK, z = Math.floor(i / CHUNK) % CHUNK, y = Math.floor(i / (CHUNK * CHUNK));
        out.push([posKey(cx * CHUNK + x, y, cz * CHUNK + z), id]);
      }
    }
    return out;
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return B.AIR;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return B.AIR;
    return c.data[idx(x - cx * CHUNK, y, z - cz * CHUNK)];
  }

  isSolid(x: number, y: number, z: number): boolean {
    return SOLID[this.getBlock(x, y, z)] === 1;
  }

  isLoaded(x: number, z: number): boolean {
    return this.chunks.has(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
  }

  /** Change a block. record=false is used for runtime overlays (game chests) that aren't world edits. */
  setBlock(x: number, y: number, z: number, id: number, record = true): void {
    if (y < 0 || y >= HEIGHT) return;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(chunkKey(cx, cz));
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    if (record) { this.recordMod(x, y, z, id); this.dirtyMods = true; }
    if (!c) return;
    const prev = c.get(lx, y, lz);
    if (prev === id) return;
    c.set(lx, y, lz, id);
    c.dirty = true;
    // neighbours need remeshing for border faces/AO, and for light when emitters or occluders change near lights
    const lightRelevant = LIGHT[prev] || LIGHT[id] || OPAQUE[prev] !== OPAQUE[id];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const n = this.chunks.get(chunkKey(cx + dx, cz + dz));
      if (!n) continue;
      const border = (dx === -1 ? lx === 0 : dx === 1 ? lx === CHUNK - 1 : true) && (dz === -1 ? lz === 0 : dz === 1 ? lz === CHUNK - 1 : true);
      const nearLight = lightRelevant && (LIGHT[prev] || LIGHT[id] || n.lights.size > 0 || c.lights.size > 0);
      if (border || nearLight) n.dirty = true;
    }
  }

  /** y of the highest solid block in a column, or -1. */
  surfaceY(x: number, z: number): number {
    for (let y = HEIGHT - 1; y >= 0; y--) if (SOLID[this.getBlock(x, y, z)]) return y;
    return -1;
  }

  ensureGenerated(cx: number, cz: number): Chunk {
    const k = chunkKey(cx, cz);
    let c = this.chunks.get(k);
    if (c) return c;
    c = new Chunk(cx, cz);
    generateChunk(c, this.gen, this.structures);
    const m = this.mods.get(k);
    if (m) for (const [i, id] of m) {
      c.data[i] = id;
      if (LIGHT[id]) c.lights.add(i); else c.lights.delete(i);
      const y = Math.floor(i / (CHUNK * CHUNK));
      if (id !== B.AIR && y > c.maxY) c.maxY = y;
    }
    this.chunks.set(k, c);
    this.onChunkGenerated?.(c);
    // neighbours that were already meshed may now have hidden border faces
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.chunks.get(chunkKey(cx + dx, cz + dz));
      if (n?.meshed) n.dirty = true;
    }
    return c;
  }

  private neighboursReady(cx: number, cz: number): boolean {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunks.has(chunkKey(cx + dx, cz + dz))) return false;
    return true;
  }

  private buildMesh(c: Chunk): void {
    const pad = this.padBuf;
    pad.fill(0);
    const sources: number[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = this.chunks.get(chunkKey(c.cx + dx, c.cz + dz));
      if (!n) continue;
      // copy the slice of the neighbour that falls into the padded window
      const x0 = dx === -1 ? CHUNK - 1 : 0, x1 = dx === 1 ? 0 : CHUNK - 1;
      const z0 = dz === -1 ? CHUNK - 1 : 0, z1 = dz === 1 ? 0 : CHUNK - 1;
      const top = Math.min(HEIGHT - 1, n.maxY + 1);
      for (let y = 0; y <= top; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        pad[padIdx(x + dx * CHUNK, y, z + dz * CHUNK)] = n.data[idx(x, y, z)];
      }
      for (const li of n.lights) {
        const lx = li % CHUNK, lz = Math.floor(li / CHUNK) % CHUNK, ly = Math.floor(li / (CHUNK * CHUNK));
        const wx = (c.cx + dx) * CHUNK + lx, wz = (c.cz + dz) * CHUNK + lz;
        const ox = wx - c.cx * CHUNK, oz = wz - c.cz * CHUNK;
        if (ox < -LPAD || oz < -LPAD || ox >= CHUNK + LPAD || oz >= CHUNK + LPAD) continue;
        sources.push(wx, ly, wz, LIGHT[n.data[li]]);
      }
    }
    const out = meshChunk({
      blocks: pad, maxY: Math.min(HEIGHT - 1, c.maxY + 1), sources, ox: c.cx * CHUNK, oz: c.cz * CHUNK,
      getWorld: (x, y, z) => this.getBlock(x, y, z),
    });
    this.disposeMeshes(c);
    const add = (buf: MeshBuffers | null, mat: THREE.Material, shadow: boolean, order: number) => {
      if (!buf) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(buf.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(buf.normals, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(buf.uvs, 2));
      g.setAttribute('color', new THREE.BufferAttribute(buf.colors, 3));
      g.setAttribute('aLight', new THREE.BufferAttribute(buf.lights, 1));
      g.setIndex(new THREE.BufferAttribute(buf.indices, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = shadow && this.shadows;
      m.receiveShadow = this.shadows;
      m.renderOrder = order;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      c.meshes.push(m);
      this.group.add(m);
    };
    add(out.solid, this.mats.solid, true, 0);
    add(out.cross, this.mats.cross, false, 1);
    add(out.water, this.mats.water, false, 2);
    c.dirty = false;
    c.meshed = true;
  }

  private disposeMeshes(c: Chunk): void {
    for (const m of c.meshes) { this.group.remove(m); m.geometry.dispose(); }
    c.meshes = [];
  }

  /** Stream chunks around the player within a per-frame time budget. */
  update(px: number, pz: number, budgetMs = 6): void {
    const t0 = performance.now();
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    // 1) remesh edited chunks near the player first so edits feel instant
    for (const [dx, dz] of this.offsets) {
      if (dx * dx + dz * dz > 4) break;
      const c = this.chunks.get(chunkKey(pcx + dx, pcz + dz));
      if (c && c.dirty && c.meshed && this.neighboursReady(c.cx, c.cz)) this.buildMesh(c);
    }
    // 2) generate + mesh outward from the player
    for (const [dx, dz] of this.offsets) {
      if (performance.now() - t0 > budgetMs) break;
      const cx = pcx + dx, cz = pcz + dz;
      const inMeshRange = dx * dx + dz * dz <= this.rd * this.rd + 1;
      const c = this.ensureGenerated(cx, cz);
      if (inMeshRange && c.dirty && this.neighboursReady(cx, cz)) {
        // neighbours must exist for correct borders; ensure them (cheap-ish) then mesh
        this.buildMesh(c);
      } else if (inMeshRange && c.dirty) {
        for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) this.ensureGenerated(cx + ox, cz + oz);
      }
    }
    // 3) unload far chunks
    const far = (this.rd + 3) * (this.rd + 3);
    for (const [k, c] of this.chunks) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > far) { this.disposeMeshes(c); this.chunks.delete(k); }
    }
  }

  stats(): WorldStats {
    let meshed = 0, pending = 0, tris = 0;
    for (const c of this.chunks.values()) {
      if (c.meshed) meshed++;
      if (c.dirty) pending++;
      for (const m of c.meshes) tris += (m.geometry.index?.count ?? 0) / 3;
    }
    return { loaded: this.chunks.size, meshed, pendingMesh: pending, triangles: tris };
  }

  /** Synchronously prepare the area around a point (used at spawn/teleport). */
  prepareArea(x: number, z: number, radiusChunks = 2): void {
    const pcx = Math.floor(x / CHUNK), pcz = Math.floor(z / CHUNK);
    for (let dz = -radiusChunks - 1; dz <= radiusChunks + 1; dz++) for (let dx = -radiusChunks - 1; dx <= radiusChunks + 1; dx++) this.ensureGenerated(pcx + dx, pcz + dz);
    for (let dz = -radiusChunks; dz <= radiusChunks; dz++) for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
      const c = this.getChunk(pcx + dx, pcz + dz)!;
      if (c.dirty) this.buildMesh(c);
    }
  }

  dispose(): void {
    for (const c of this.chunks.values()) this.disposeMeshes(c);
    this.chunks.clear();
    this.group.parent?.remove(this.group);
  }
}
