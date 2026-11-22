import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BLOCKS } from '../engine/blocks';
import { ATLAS_COLS, TILE, getAtlas } from '../engine/textures';
import { itemDef, pixelColor } from '../inventory/items';
import { skinBox } from './skin';

/** Extrude 16x16 pixels into a voxel mesh (1 voxel per opaque pixel, vertex coloured). */
function extrude(get: (x: number, y: number) => [number, number, number, number] | null): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const s = 1 / 16;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const c = get(x, y);
    if (!c) continue;
    const g = new THREE.BoxGeometry(s, s, s);
    g.translate((x - 7.5) * s, (7.5 - y) * s, 0);
    const col = new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
    col.convertSRGBToLinear();
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  }
  const merged = parts.length ? mergeGeometries(parts) : new THREE.BoxGeometry(0.1, 0.1, 0.1);
  for (const p of parts) p.dispose();
  return merged;
}

function pixelsGeometry(pixels: string[]): THREE.BufferGeometry {
  return extrude((x, y) => {
    const hex = pixelColor(pixels[y]?.[x] ?? '.');
    if (!hex) return null;
    const c = new THREE.Color(hex);
    return [c.r * 255, c.g * 255, c.b * 255, 255];
  });
}

function tileGeometry(tile: number): THREE.BufferGeometry {
  const atlas = getAtlas();
  const ctx = atlas.canvas.getContext('2d')!;
  const ox = (tile % ATLAS_COLS) * TILE, oy = Math.floor(tile / ATLAS_COLS) * TILE;
  const data = ctx.getImageData(ox, oy, TILE, TILE).data;
  return extrude((x, y) => {
    const i = (y * TILE + x) * 4;
    return data[i + 3] > 100 ? [data[i], data[i + 1], data[i + 2], 255] : null;
  });
}

function blockGeometry(blockId: number): THREE.BufferGeometry {
  const atlas = getAtlas();
  const d = BLOCKS[blockId];
  const g = new THREE.BoxGeometry(1, 1, 1);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z ; 4 verts each
  const faceTile = [2, 2, 0, 1, 2, 2].map((k) => atlas.index.get(d.tiles[k]) ?? 0);
  for (let f = 0; f < 6; f++) {
    const [u0, v0, u1, v1] = atlas.uv(faceTile[f]);
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
  }
  return g;
}

/**
 * The view model: player's arm + held item, drawn in a separate scene on top of the world
 * (so it never clips into blocks).
 */
export class Hand {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
  private root = new THREE.Group();
  private arm: THREE.Mesh;
  private item: THREE.Object3D | null = null;
  private itemId: string | null = null;
  private cache = new Map<string, THREE.Object3D>();
  private swing = 0;
  private swinging = false;
  private equip = 0;
  private light = new THREE.DirectionalLight(0xffffff, 1.4);
  private amb = new THREE.AmbientLight(0xffffff, 0.7);
  private voxelMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private blockMat = new THREE.MeshLambertMaterial({ map: getAtlas().texture, alphaTest: 0.5 });

  constructor() {
    this.light.position.set(1, 2, 2);
    this.scene.add(this.light, this.amb, this.root);
    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.75), new THREE.MeshLambertMaterial({ color: 0xd9a77e }));
    this.arm.position.set(0.42, -0.42, -0.45);
    this.arm.rotation.set(0.25, 0.25, 0);
    this.root.add(this.arm);
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  private build(id: string): THREE.Object3D {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const d = itemDef(id);
    let obj: THREE.Object3D;
    if (d?.pixels) {
      const m = new THREE.Mesh(pixelsGeometry(d.pixels), this.voxelMat);
      m.scale.setScalar(0.62);
      m.rotation.set(0.1, -1.25, 0.55);
      m.position.set(0.5, -0.32, -0.62);
      obj = m;
    } else if (d?.blockId !== undefined) {
      const b = BLOCKS[d.blockId];
      if (b.render === 'cross' || b.render === 'torch') {
        const m = new THREE.Mesh(tileGeometry(getAtlas().index.get(b.tiles[2]) ?? 0), this.voxelMat);
        m.scale.setScalar(0.5);
        m.rotation.set(0, -0.6, 0.1);
        m.position.set(0.48, -0.3, -0.6);
        obj = m;
      } else {
        const m = new THREE.Mesh(blockGeometry(d.blockId), this.blockMat);
        m.scale.setScalar(0.3);
        m.rotation.set(0.15, 0.75, 0);
        m.position.set(0.46, -0.38, -0.6);
        obj = m;
      }
    } else obj = new THREE.Group();
    this.cache.set(id, obj);
    return obj;
  }

  setItem(id: string | null): void {
    if (id === this.itemId) return;
    this.itemId = id;
    if (this.item) this.root.remove(this.item);
    this.item = id ? this.build(id) : null;
    if (this.item) this.root.add(this.item);
    this.arm.visible = !this.item;
    this.equip = 1;
  }

  /** Re-skin the bare arm with the player's skin (right arm, first-person). */
  setSkin(texture: THREE.Texture, slim: boolean): void {
    const aw = slim ? 3 : 4;
    const g = skinBox(aw, 12, 4, 40, 16, 0, 1 / 16);
    g.rotateX(Math.PI / 2); // shoulder toward the camera, hand pointing into the screen
    this.arm.geometry.dispose();
    this.arm.geometry = g;
    const m = this.arm.material as THREE.MeshLambertMaterial;
    m.map = texture;
    m.color.set(0xffffff);
    m.needsUpdate = true;
  }

  /** Current swing progress, 1 → 0 (0 when idle). */
  get swingAmount(): number {
    return this.swing;
  }

  /** Trigger a single swing (click), or keep swinging while `held`. */
  punch(): void {
    if (this.swing <= 0) this.swing = 1;
  }
  setSwinging(on: boolean): void {
    this.swinging = on;
  }

  update(dt: number, bob: number, bobPhase: number, brightness: number): void {
    if (this.swinging && this.swing <= 0) this.swing = 1;
    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt * 4);
    this.equip = Math.max(0, this.equip - dt * 5);
    const s = Math.sin((1 - this.swing) * Math.PI);
    const bx = Math.sin(bobPhase * Math.PI) * 0.025 * bob;
    const by = -Math.abs(Math.cos(bobPhase * Math.PI)) * 0.03 * bob;
    this.root.position.set(bx - s * 0.12, by - this.equip * 0.4 - s * 0.08, -s * 0.12);
    this.root.rotation.set(-s * 0.9, s * 0.35, s * 0.2);
    this.light.intensity = 0.4 + 1.1 * brightness;
    this.amb.intensity = 0.35 + 0.5 * brightness;
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
