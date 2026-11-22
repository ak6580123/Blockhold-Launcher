import { BLOCKS, B, LIGHT, OPAQUE } from './blocks';
import { CHUNK, HEIGHT } from './terrain';
import { getAtlas } from './textures';

// Builds merged geometry buffers for one chunk:
//  - hidden faces culled against opaque neighbours
//  - per-vertex ambient occlusion
//  - per-vertex block light (flood fill from torches/lamps, including neighbouring chunks)

export interface MeshBuffers {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  lights: Float32Array;
  indices: Uint32Array;
}

class Buf {
  p: number[] = []; n: number[] = []; uv: number[] = []; c: number[] = []; l: number[] = []; i: number[] = [];
  vcount = 0;
  build(): MeshBuffers | null {
    if (!this.vcount) return null;
    return {
      positions: new Float32Array(this.p), normals: new Float32Array(this.n), uvs: new Float32Array(this.uv),
      colors: new Float32Array(this.c), lights: new Float32Array(this.l), indices: new Uint32Array(this.i),
    };
  }
}

// Face table: normal, origin corner, u axis, v axis (u x v = normal), shade
interface Face { n: [number, number, number]; o: [number, number, number]; u: [number, number, number]; v: [number, number, number]; shade: number; tile: 0 | 1 | 2 }
const FACES: Face[] = [
  { n: [1, 0, 0], o: [1, 0, 1], u: [0, 0, -1], v: [0, 1, 0], shade: 0.8, tile: 2 },
  { n: [-1, 0, 0], o: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.8, tile: 2 },
  { n: [0, 1, 0], o: [0, 1, 1], u: [1, 0, 0], v: [0, 0, -1], shade: 1.0, tile: 0 },
  { n: [0, -1, 0], o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 0.55, tile: 1 },
  { n: [0, 0, 1], o: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], shade: 0.7, tile: 2 },
  { n: [0, 0, -1], o: [1, 0, 0], u: [-1, 0, 0], v: [0, 1, 0], shade: 0.7, tile: 2 },
];
const CORNER_UV: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
const AO_LEVELS = [0.45, 0.65, 0.83, 1.0];

let TILES: Int16Array | null = null;
function tiles(): Int16Array {
  if (TILES) return TILES;
  const atlas = getAtlas();
  TILES = new Int16Array(256 * 3).fill(0);
  for (const d of BLOCKS) {
    if (!d) continue;
    for (let k = 0; k < 3; k++) TILES[d.id * 3 + k] = atlas.index.get(d.tiles[k]) ?? 0;
  }
  return TILES;
}

const RENDER = new Uint8Array(256); // 0 none, 1 cube, 2 cross, 3 torch, 4 liquid
for (const d of BLOCKS) if (d) RENDER[d.id] = ({ none: 0, cube: 1, cross: 2, torch: 3, liquid: 4 } as const)[d.render];

/** Padded block window: chunk plus 1 block of each neighbour (18 x H x 18). */
export const PAD = CHUNK + 2;
export const padIdx = (x: number, y: number, z: number): number => (x + 1) + (z + 1) * PAD + y * PAD * PAD;

/** Light window: chunk plus 15 blocks each side, so neighbouring torches reach in. */
export const LPAD = 15;
export const LW = CHUNK + LPAD * 2;
const lightVol = new Uint8Array(LW * LW * HEIGHT);
const lIdx = (x: number, y: number, z: number): number => (x + LPAD) + (z + LPAD) * LW + y * LW * LW;

export interface MeshInput {
  blocks: Uint8Array; // padded window (PAD x HEIGHT x PAD)
  maxY: number;
  /** world-space block getter, used only for light propagation outside the padded window */
  getWorld(x: number, y: number, z: number): number;
  /** light sources in world coords [x,y,z,level,...] within reach of this chunk */
  sources: number[];
  ox: number;
  oz: number;
}

function computeLight(inp: MeshInput): boolean {
  if (!inp.sources.length) return false;
  let minY = HEIGHT, maxY = 0;
  for (let i = 1; i < inp.sources.length; i += 4) { minY = Math.min(minY, inp.sources[i]); maxY = Math.max(maxY, inp.sources[i]); }
  const y0 = Math.max(0, minY - 15), y1 = Math.min(HEIGHT - 1, maxY + 15);
  lightVol.fill(0, y0 * LW * LW, (y1 + 1) * LW * LW);
  const qx: number[] = [], qy: number[] = [], qz: number[] = [];
  for (let i = 0; i < inp.sources.length; i += 4) {
    const lx = inp.sources[i] - inp.ox, y = inp.sources[i + 1], lz = inp.sources[i + 2] - inp.oz;
    if (lx < -LPAD || lz < -LPAD || lx >= CHUNK + LPAD || lz >= CHUNK + LPAD) continue;
    const id = lIdx(lx, y, lz);
    if (lightVol[id] < inp.sources[i + 3]) { lightVol[id] = inp.sources[i + 3]; qx.push(lx); qy.push(y); qz.push(lz); }
  }
  const opaqueAt = (lx: number, y: number, lz: number): boolean => {
    if (lx >= -1 && lx <= CHUNK && lz >= -1 && lz <= CHUNK) return OPAQUE[inp.blocks[padIdx(lx, y, lz)]] === 1;
    return OPAQUE[inp.getWorld(lx + inp.ox, y, lz + inp.oz)] === 1;
  };
  const DIRS = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
  for (let h = 0; h < qx.length; h++) {
    const x = qx[h], y = qy[h], z = qz[h];
    const lv = lightVol[lIdx(x, y, z)];
    if (lv <= 1) continue;
    for (let d = 0; d < 18; d += 3) {
      const nx = x + DIRS[d], ny = y + DIRS[d + 1], nz = z + DIRS[d + 2];
      if (nx < -LPAD || nz < -LPAD || nx >= CHUNK + LPAD || nz >= CHUNK + LPAD || ny < y0 || ny > y1) continue;
      const ni = lIdx(nx, ny, nz);
      if (lightVol[ni] >= lv - 1) continue;
      if (opaqueAt(nx, ny, nz)) continue;
      lightVol[ni] = lv - 1;
      qx.push(nx); qy.push(ny); qz.push(nz);
    }
  }
  return true;
}

export function meshChunk(inp: MeshInput): { solid: MeshBuffers | null; cross: MeshBuffers | null; water: MeshBuffers | null } {
  const T = tiles();
  const atlas = getAtlas();
  const blk = inp.blocks;
  const hasLight = computeLight(inp);
  const light = (x: number, y: number, z: number): number => (hasLight && y >= 0 && y < HEIGHT ? lightVol[lIdx(x, y, z)] : 0);
  const at = (x: number, y: number, z: number): number => (y < 0 ? B.BEDROCK : y >= HEIGHT ? B.AIR : blk[padIdx(x, y, z)]);

  const solid = new Buf(), cross = new Buf(), water = new Buf();
  const yMax = Math.min(HEIGHT - 1, inp.maxY);

  const pushQuad = (b: Buf, verts: number[], nrm: [number, number, number], uvq: [number, number, number, number], cornerUv: [number, number][], ao: number[], lt: number[], shade: number) => {
    const base = b.vcount;
    for (let k = 0; k < 4; k++) {
      b.p.push(verts[k * 3], verts[k * 3 + 1], verts[k * 3 + 2]);
      b.n.push(nrm[0], nrm[1], nrm[2]);
      b.uv.push(uvq[0] + (uvq[2] - uvq[0]) * cornerUv[k][0], uvq[1] + (uvq[3] - uvq[1]) * cornerUv[k][1]);
      const c = ao[k] * shade;
      b.c.push(c, c, c);
      b.l.push(lt[k] / 15);
    }
    // flip the diagonal so AO gradients don't look anisotropic
    if (ao[0] + ao[2] < ao[1] + ao[3]) b.i.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    else b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    b.vcount += 4;
  };

  const verts: number[] = new Array(12);
  const ao = [1, 1, 1, 1];
  const lt = [0, 0, 0, 0];

  for (let y = 0; y <= yMax; y++) {
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const id = blk[padIdx(x, y, z)];
        const r = RENDER[id];
        if (r === 0) continue;
        const wx = x + inp.ox, wz = z + inp.oz;

        if (r === 1 || r === 4) {
          const isWater = r === 4;
          for (const f of FACES) {
            const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
            const nb = at(nx, ny, nz);
            if (isWater) {
              if (nb === B.WATER || OPAQUE[nb]) continue;
              if (f.n[1] === -1) continue;
            } else {
              if (OPAQUE[nb]) continue;
              if (nb === id && id !== B.LEAVES && id !== B.SPRUCE_LEAVES) continue; // glass-glass etc.
            }
            const tile = T[id * 3 + f.tile];
            const uvq = atlas.uv(tile);
            const topDrop = isWater && at(x, y + 1, z) !== B.WATER ? 0.12 : 0;
            for (let k = 0; k < 4; k++) {
              const cu = CORNER_UV[k][0], cv = CORNER_UV[k][1];
              const vx = f.o[0] + f.u[0] * cu + f.v[0] * cv;
              let vy = f.o[1] + f.u[1] * cu + f.v[1] * cv;
              const vz = f.o[2] + f.u[2] * cu + f.v[2] * cv;
              if (topDrop && vy === 1) vy = 1 - topDrop;
              verts[k * 3] = wx + vx; verts[k * 3 + 1] = y + vy; verts[k * 3 + 2] = wz + vz;
              // AO & smooth light from the 3 cells around this vertex on the face's outer side
              const su = cu ? 1 : -1, sv = cv ? 1 : -1;
              const ax = nx + f.u[0] * su, ay = ny + f.u[1] * su, az = nz + f.u[2] * su;
              const bx = nx + f.v[0] * sv, by = ny + f.v[1] * sv, bz = nz + f.v[2] * sv;
              const cx2 = nx + f.u[0] * su + f.v[0] * sv, cy2 = ny + f.u[1] * su + f.v[1] * sv, cz2 = nz + f.u[2] * su + f.v[2] * sv;
              if (isWater) { ao[k] = 1; lt[k] = light(nx, ny, nz); continue; }
              const s1 = OPAQUE[at(ax, ay, az)], s2 = OPAQUE[at(bx, by, bz)], c3 = OPAQUE[at(cx2, cy2, cz2)];
              ao[k] = AO_LEVELS[s1 && s2 ? 0 : 3 - (s1 + s2 + c3)];
              if (hasLight) {
                let sum = light(nx, ny, nz), cnt = 1;
                if (!s1) { sum += light(ax, ay, az); cnt++; }
                if (!s2) { sum += light(bx, by, bz); cnt++; }
                if (!c3 && !(s1 && s2)) { sum += light(cx2, cy2, cz2); cnt++; }
                lt[k] = sum / cnt;
              } else lt[k] = 0;
            }
            // self-luminous blocks glow fully
            if (LIGHT[id]) for (let k = 0; k < 4; k++) lt[k] = Math.max(lt[k], LIGHT[id]);
            pushQuad(isWater ? water : solid, verts, f.n, uvq, CORNER_UV, ao, lt, isWater ? 1 : f.shade);
          }
        } else if (r === 2) {
          const uvq = atlas.uv(T[id * 3 + 2]);
          const l = light(x, y, z);
          const lts = [l, l, l, l];
          const ones = [1, 1, 1, 1];
          const o = 0.15, e = 0.85;
          const quads = [
            [wx + o, y, wz + o, wx + e, y, wz + e, wx + e, y + 1, wz + e, wx + o, y + 1, wz + o],
            [wx + o, y, wz + e, wx + e, y, wz + o, wx + e, y + 1, wz + o, wx + o, y + 1, wz + e],
          ];
          for (const q of quads) pushQuad(cross, q, [0, 1, 0], uvq, CORNER_UV, ones, lts, 0.9);
        } else if (r === 3) {
          // torch: thin box showing the centre columns of the torch tile
          const tile = atlas.uv(T[id * 3 + 2]);
          const tw = (tile[2] - tile[0]);
          const th = (tile[3] - tile[1]);
          const sideUv: [number, number, number, number] = [tile[0] + tw * 7 / 16, tile[1], tile[0] + tw * 9 / 16, tile[1] + th * 13 / 16];
          const topUv: [number, number, number, number] = [tile[0] + tw * 7 / 16, tile[1] + th * 10 / 16, tile[0] + tw * 9 / 16, tile[1] + th * 12 / 16];
          const x0 = 7 / 16, x1 = 9 / 16, h = 13 / 16;
          const L = [15, 15, 15, 15];
          const ones = [1, 1, 1, 1];
          for (const f of FACES) {
            if (f.n[1] === -1) continue;
            for (let k = 0; k < 4; k++) {
              const cu = CORNER_UV[k][0], cv = CORNER_UV[k][1];
              const px = f.o[0] + f.u[0] * cu + f.v[0] * cv;
              const py = f.o[1] + f.u[1] * cu + f.v[1] * cv;
              const pz = f.o[2] + f.u[2] * cu + f.v[2] * cv;
              verts[k * 3] = wx + x0 + px * (x1 - x0);
              verts[k * 3 + 1] = y + py * h;
              verts[k * 3 + 2] = wz + x0 + pz * (x1 - x0);
            }
            pushQuad(solid, verts, f.n, f.n[1] === 1 ? topUv : sideUv, CORNER_UV, ones, L, 1);
          }
        }
      }
    }
  }
  return { solid: solid.build(), cross: cross.build(), water: water.build() };
}
