import * as THREE from 'three';
import { mulberry32 } from './noise';

// Every texture is painted procedurally at startup: original pixel art, no external assets.

export const TILE = 16;
export const ATLAS_COLS = 16;
export const ATLAS_SIZE = TILE * ATLAS_COLS;

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

class Painter {
  constructor(private img: ImageData, private ox: number, private oy: number, public rnd: () => number) {}
  set(x: number, y: number, c: RGB, a = 255): void {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const i = ((this.oy + y) * ATLAS_SIZE + this.ox + x) * 4;
    const d = this.img.data;
    d[i] = Math.max(0, Math.min(255, c[0])); d[i + 1] = Math.max(0, Math.min(255, c[1])); d[i + 2] = Math.max(0, Math.min(255, c[2])); d[i + 3] = a;
  }
  get(x: number, y: number): RGB {
    const i = ((this.oy + y) * ATLAS_SIZE + this.ox + x) * 4;
    return [this.img.data[i], this.img.data[i + 1], this.img.data[i + 2]];
  }
  alpha(x: number, y: number): number {
    return this.img.data[((this.oy + y) * ATLAS_SIZE + this.ox + x) * 4 + 3];
  }
  jit(c: RGB, amt: number): RGB {
    const k = (this.rnd() - 0.5) * 2 * amt;
    return [c[0] + k, c[1] + k, c[2] + k];
  }
  shade(c: RGB, f: number): RGB { return [c[0] * f, c[1] * f, c[2] * f]; }
  fill(c: RGB, amt = 12): void {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) this.set(x, y, this.jit(c, amt));
  }
  clear(): void { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) this.set(x, y, [0, 0, 0], 0); }
  specks(c: RGB, n: number, amt = 10): void {
    for (let i = 0; i < n; i++) this.set(Math.floor(this.rnd() * TILE), Math.floor(this.rnd() * TILE), this.jit(c, amt));
  }
}

const GRASS: RGB = hex('#5fa83a');
const DIRT: RGB = hex('#86603f');
const STONE: RGB = hex('#8a8a8a');

function stoneCells(p: Painter, base: RGB, mortar: RGB, cell = 5): void {
  // irregular cobble pattern from jittered grid cells
  const pts: [number, number, RGB][] = [];
  for (let gy = -1; gy <= 4; gy++) for (let gx = -1; gx <= 4; gx++) {
    pts.push([gx * cell + p.rnd() * cell, gy * cell + p.rnd() * cell, p.jit(base, 26)]);
  }
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    let d1 = 1e9, d2 = 1e9, c: RGB = base;
    for (const [px, py, pc] of pts) {
      const dx = Math.min(Math.abs(x - px), TILE - Math.abs(x - px));
      const dy = Math.min(Math.abs(y - py), TILE - Math.abs(y - py));
      const d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; d1 = d; c = pc; } else if (d < d2) d2 = d;
    }
    const edge = Math.sqrt(d2) - Math.sqrt(d1) < 0.9;
    p.set(x, y, edge ? p.jit(mortar, 6) : p.jit(c, 7));
  }
}

function bricks(p: Painter, brick: RGB, mortar: RGB, bw: number, bh: number, amt = 14): void {
  for (let y = 0; y < TILE; y++) {
    const row = Math.floor(y / bh);
    const off = row % 2 ? bw / 2 : 0;
    for (let x = 0; x < TILE; x++) {
      const isM = y % bh === bh - 1 || (x + off) % bw === 0;
      p.set(x, y, isM ? p.jit(mortar, 5) : p.jit(brick, amt));
    }
  }
}

function planks(p: Painter, c: RGB): void {
  for (let y = 0; y < TILE; y++) {
    const board = Math.floor(y / 4);
    const seamX = (board * 7 + 3) % TILE;
    for (let x = 0; x < TILE; x++) {
      let col = p.jit(p.shade(c, 1 + ((board % 2) - 0.5) * 0.06), 8);
      if (y % 4 === 3) col = p.shade(c, 0.62);
      else if (x === seamX) col = p.shade(c, 0.7);
      else if (p.rnd() < 0.08) col = p.shade(c, 0.85);
      p.set(x, y, col);
    }
  }
}

function logSide(p: Painter, c: RGB): void {
  for (let x = 0; x < TILE; x++) {
    const stripe = (Math.sin(x * 1.7) + 1) * 0.08;
    for (let y = 0; y < TILE; y++) p.set(x, y, p.jit(p.shade(c, 0.85 + stripe + (p.rnd() < 0.15 ? -0.15 : 0)), 6));
  }
}

function logTop(p: Painter, bark: RGB, wood: RGB): void {
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const dx = x - 7.5, dy = y - 7.5;
    const r = Math.max(Math.abs(dx), Math.abs(dy));
    if (r > 6.6) p.set(x, y, p.jit(bark, 8));
    else p.set(x, y, p.jit(p.shade(wood, Math.floor(r) % 2 ? 0.86 : 1), 6));
  }
}

function leaves(p: Painter, c: RGB): void {
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const r = p.rnd();
    if (r < 0.16) p.set(x, y, [0, 0, 0], 0);
    else p.set(x, y, p.jit(p.shade(c, r < 0.35 ? 0.75 : r > 0.9 ? 1.2 : 1), 10));
  }
}

function wool(p: Painter, c: RGB): void {
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const f = 1 + (((x + y * 3) % 4 === 0) ? -0.08 : 0) + ((x * 7 + y) % 5 === 0 ? 0.05 : 0);
    p.set(x, y, p.jit(p.shade(c, f), 6));
  }
}

function cross(p: Painter, draw: (p: Painter) => void): void { p.clear(); draw(p); }

const PAINTERS: Record<string, (p: Painter) => void> = {
  grass_top: (p) => { p.fill(GRASS, 14); p.specks(p.shade(GRASS, 0.8), 30); p.specks(p.shade(GRASS, 1.15), 18); },
  grass_side: (p) => {
    p.fill(DIRT, 12); p.specks(p.shade(DIRT, 0.75), 20);
    for (let x = 0; x < TILE; x++) {
      const depth = 3 + Math.floor(p.rnd() * 2.4);
      for (let y = 0; y < depth; y++) p.set(x, y, p.jit(GRASS, 12));
    }
  },
  dirt: (p) => { p.fill(DIRT, 12); p.specks(p.shade(DIRT, 0.72), 26); p.specks(p.shade(DIRT, 1.2), 10); },
  stone: (p) => {
    p.fill(STONE, 9);
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(p.rnd() * 14), y = Math.floor(p.rnd() * 15), len = 2 + Math.floor(p.rnd() * 3);
      for (let k = 0; k < len; k++) p.set(x + k, y, p.shade(STONE, 0.78));
    }
  },
  cobble: (p) => stoneCells(p, hex('#8d8d8d'), hex('#5a5a5a')),
  mossy_cobble: (p) => { stoneCells(p, hex('#8d8d8d'), hex('#5a5a5a')); for (let i = 0; i < 50; i++) p.set(Math.floor(p.rnd() * 16), Math.floor(p.rnd() * 16), p.jit(hex('#5c8a3a'), 14)); },
  sand: (p) => { p.fill(hex('#dccf96'), 10); p.specks(hex('#c7b67a'), 26); },
  sandstone: (p) => {
    for (let y = 0; y < TILE; y++) {
      const band = y < 3 ? 1.05 : y > 12 ? 0.85 : y % 4 === 0 ? 0.92 : 1;
      for (let x = 0; x < TILE; x++) p.set(x, y, p.jit(p.shade(hex('#d6c486'), band), 7));
    }
  },
  sandstone_top: (p) => { p.fill(hex('#dccb8e'), 6); },
  water: (p) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const wave = Math.sin((x + y * 0.5) * 0.8) > 0.85 ? 1.25 : 1;
      p.set(x, y, p.jit(p.shade(hex('#3a6fd8'), wave), 8), 190);
    }
  },
  log_side: (p) => logSide(p, hex('#6b5132')),
  log_top: (p) => logTop(p, hex('#5d4529'), hex('#b8915a')),
  spruce_log_side: (p) => logSide(p, hex('#3e2c1a')),
  spruce_log_top: (p) => logTop(p, hex('#3a2a19'), hex('#8a6a42')),
  leaves: (p) => leaves(p, hex('#3f8a2c')),
  spruce_leaves: (p) => leaves(p, hex('#2d5a3a')),
  planks: (p) => planks(p, hex('#b38a55')),
  spruce_planks: (p) => planks(p, hex('#7a5a36')),
  glass: (p) => {
    p.clear();
    const edge = hex('#d6eef5');
    for (let i = 0; i < TILE; i++) { p.set(i, 0, edge, 230); p.set(i, 15, edge, 230); p.set(0, i, edge, 230); p.set(15, i, edge, 230); }
    for (let i = 0; i < 4; i++) { p.set(3 + i, 3 + i, [255, 255, 255], 170); p.set(9 + i, 3 + i, [255, 255, 255], 120); }
    for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) if (p.alpha(x, y) === 0) p.set(x, y, [200, 235, 245], 28);
  },
  bricks: (p) => bricks(p, hex('#a2503a'), hex('#c9bfb0'), 8, 4),
  stone_bricks: (p) => {
    bricks(p, hex('#7d7d7d'), hex('#4f4f4f'), 8, 8, 8);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) if (y % 8 === 0 && x % 8 !== 0) p.set(x, y, p.shade(p.get(x, y), 1.15));
  },
  snow: (p) => { p.fill(hex('#f2f6fa'), 6); p.specks(hex('#dfe8f0'), 16, 4); },
  gravel: (p) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const r = p.rnd();
      p.set(x, y, p.jit(r < 0.3 ? hex('#6e6762') : r < 0.6 ? hex('#8f8783') : r < 0.85 ? hex('#a59d97') : hex('#5d5550'), 10));
    }
  },
  torch: (p) => cross(p, () => {
    for (let y = 6; y < 16; y++) { p.set(7, y, hex('#7a5530')); p.set(8, y, hex('#5c3e22')); }
    p.set(7, 5, hex('#ffd24a')); p.set(8, 5, hex('#ffb020')); p.set(7, 4, hex('#fff2a0')); p.set(8, 4, hex('#ffd24a'));
    p.set(7, 3, hex('#fff6c8')); p.set(8, 6, hex('#ff8a20'));
  }),
  tall_grass: (p) => cross(p, () => {
    for (let b = 0; b < 7; b++) {
      const x0 = 1 + Math.floor(p.rnd() * 14), h = 5 + Math.floor(p.rnd() * 9), lean = p.rnd() < 0.5 ? -1 : 1;
      for (let y = 0; y < h; y++) p.set(x0 + (y > h * 0.6 ? lean : 0), 15 - y, p.jit(GRASS, 18));
    }
  }),
  flower_red: (p) => cross(p, () => {
    for (let y = 8; y < 16; y++) p.set(8, y, hex('#3f8a2c'));
    p.set(7, 11, hex('#3f8a2c')); p.set(6, 10, hex('#3f8a2c'));
    for (const [x, y] of [[7, 5], [8, 5], [9, 5], [7, 6], [9, 6], [7, 7], [8, 7], [9, 7], [8, 4], [10, 6], [6, 6]]) p.set(x, y, p.jit(hex('#d8282e'), 14));
    p.set(8, 6, hex('#f4d03f'));
  }),
  flower_yellow: (p) => cross(p, () => {
    for (let y = 9; y < 16; y++) p.set(7, y, hex('#3f8a2c'));
    p.set(8, 12, hex('#3f8a2c')); p.set(9, 11, hex('#3f8a2c'));
    for (const [x, y] of [[6, 7], [7, 6], [8, 7], [7, 8], [6, 6], [8, 6], [6, 8], [8, 8]]) p.set(x, y, p.jit(hex('#f2d22e'), 14));
    p.set(7, 7, hex('#c47a12'));
  }),
  wool_red: (p) => wool(p, hex('#b8342e')),
  wool_blue: (p) => wool(p, hex('#3446a6')),
  wool_yellow: (p) => wool(p, hex('#e5c22c')),
  wool_green: (p) => wool(p, hex('#5c8f2a')),
  wool_white: (p) => wool(p, hex('#e8e8e8')),
  wool_black: (p) => wool(p, hex('#27272c')),
  wool_orange: (p) => wool(p, hex('#e0782a')),
  wool_purple: (p) => wool(p, hex('#7d3aa8')),
  obsidian: (p) => { p.fill(hex('#16111f'), 5); p.specks(hex('#3d2a5c'), 22, 8); p.specks(hex('#5a3f86'), 6, 6); },
  dark_stone: (p) => { stoneCells(p, hex('#3c4048'), hex('#25272c'), 8); },
  arena_plate: (p) => {
    p.fill(hex('#5b5f66'), 6);
    for (let i = 0; i < TILE; i++) { p.set(i, 0, hex('#7a7f88')); p.set(0, i, hex('#7a7f88')); p.set(i, 15, hex('#34373c')); p.set(15, i, hex('#34373c')); }
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) { p.set(x, y, hex('#a8adb5')); p.set(x + 1, y + 1, hex('#2b2d31')); }
    for (let i = 4; i < 12; i++) p.set(i, 7, hex('#c23a2e')), p.set(i, 8, hex('#9a2b22'));
  },
  lamp: (p) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      const grid = x % 5 === 0 || y % 5 === 0;
      p.set(x, y, edge ? hex('#6b4a2a') : grid ? p.jit(hex('#e0a040'), 8) : p.jit(hex('#ffe9a0'), 12));
    }
  },
  waystone_side: (p) => {
    bricks(p, hex('#6f6f78'), hex('#45454c'), 16, 8, 8);
    const glyph = hex('#5ff0e6');
    for (const [x, y] of [[7, 2], [8, 2], [6, 3], [9, 3], [7, 4], [8, 4], [7, 5], [8, 5], [5, 6], [10, 6], [7, 9], [8, 9], [6, 10], [9, 10], [7, 11], [8, 11], [7, 12], [8, 13]]) p.set(x, y, glyph);
  },
  waystone_top: (p) => {
    p.fill(hex('#55555e'), 6);
    for (let i = 3; i < 13; i++) { p.set(i, 3, hex('#5ff0e6')); p.set(i, 12, hex('#5ff0e6')); p.set(3, i, hex('#5ff0e6')); p.set(12, i, hex('#5ff0e6')); }
    p.set(7, 7, hex('#c8fff9')); p.set(8, 8, hex('#c8fff9')); p.set(7, 8, hex('#5ff0e6')); p.set(8, 7, hex('#5ff0e6'));
  },
  bedrock: (p) => { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) p.set(x, y, p.jit(p.rnd() < 0.5 ? hex('#3a3a3a') : hex('#6a6a6a'), 12)); },
  cactus_side: (p) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const rib = x % 4 === 1;
      p.set(x, y, p.jit(rib ? hex('#2f6e2a') : hex('#4e9a3a'), 8));
    }
    for (let i = 0; i < 10; i++) p.set(Math.floor(p.rnd() * 16), Math.floor(p.rnd() * 16), hex('#e8e0b0'));
  },
  cactus_top: (p) => { p.fill(hex('#5aa646'), 8); for (let i = 2; i < 14; i++) { p.set(i, 2, hex('#2f6e2a')); p.set(i, 13, hex('#2f6e2a')); p.set(2, i, hex('#2f6e2a')); p.set(13, i, hex('#2f6e2a')); } },
  path_top: (p) => { p.fill(hex('#9a7b4c'), 9); p.specks(hex('#7f6440'), 24); p.specks(hex('#b0935e'), 14); },
  path_side: (p) => {
    p.fill(DIRT, 12); p.specks(p.shade(DIRT, 0.75), 18);
    for (let x = 0; x < TILE; x++) for (let y = 0; y < 2; y++) p.set(x, y, p.jit(hex('#9a7b4c'), 8));
  },
  crate_side: (p) => {
    planks(p, hex('#8f6a3c'));
    for (let i = 0; i < TILE; i++) {
      p.set(i, 0, hex('#4a3520')); p.set(i, 15, hex('#4a3520')); p.set(0, i, hex('#4a3520')); p.set(15, i, hex('#4a3520'));
      p.set(i, i, hex('#5e4428')); p.set(15 - i, i, hex('#5e4428'));
    }
  },
  crate_top: (p) => {
    planks(p, hex('#8f6a3c'));
    for (let i = 0; i < TILE; i++) { p.set(i, 0, hex('#4a3520')); p.set(i, 15, hex('#4a3520')); p.set(0, i, hex('#4a3520')); p.set(15, i, hex('#4a3520')); }
  },
};

// Crack overlay stages for block breaking.
for (let s = 0; s < 10; s++) {
  PAINTERS[`crack_${s}`] = (p) => {
    p.clear();
    const r = mulberry32(999);
    const lines = 2 + s * 2;
    for (let l = 0; l < lines; l++) {
      let x = 8 + Math.floor((r() - 0.5) * 6), y = 8 + Math.floor((r() - 0.5) * 6);
      const steps = 3 + Math.floor(r() * (2 + s));
      for (let k = 0; k < steps; k++) {
        p.set(x, y, [20, 20, 20], 200);
        x += Math.round((r() - 0.5) * 2.4); y += Math.round((r() - 0.5) * 2.4);
      }
    }
  };
}

export interface Atlas {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  /** tile name -> atlas index */
  index: Map<string, number>;
  /** atlas index -> [u0, v0, u1, v1] */
  uv(i: number): [number, number, number, number];
  /** average opaque colour of a tile (for particles) */
  avgColor(i: number): THREE.Color;
  /** draws tile i into a 2D context */
  drawTile(ctx: CanvasRenderingContext2D, i: number, dx: number, dy: number, dw: number, dh: number): void;
}

let atlasSingleton: Atlas | null = null;

export function getAtlas(): Atlas {
  if (atlasSingleton) return atlasSingleton;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.createImageData(ATLAS_SIZE, ATLAS_SIZE);
  const index = new Map<string, number>();
  const avg: THREE.Color[] = [];
  let i = 0;
  for (const [name, paint] of Object.entries(PAINTERS)) {
    const ox = (i % ATLAS_COLS) * TILE, oy = Math.floor(i / ATLAS_COLS) * TILE;
    const p = new Painter(img, ox, oy, mulberry32(i * 7919 + 17));
    paint(p);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) if (p.alpha(x, y) > 100) { const c = p.get(x, y); r += c[0]; g += c[1]; b += c[2]; n++; }
    avg[i] = n ? new THREE.Color(r / n / 255, g / n / 255, b / n / 255) : new THREE.Color(1, 1, 1);
    index.set(name, i++);
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  const inset = 0.0005;
  atlasSingleton = {
    texture,
    canvas,
    index,
    uv(t) {
      const u0 = (t % ATLAS_COLS) / ATLAS_COLS + inset;
      const v1 = 1 - Math.floor(t / ATLAS_COLS) / ATLAS_COLS - inset;
      return [u0, v1 - 1 / ATLAS_COLS + 2 * inset, u0 + 1 / ATLAS_COLS - 2 * inset, v1];
    },
    avgColor: (t) => avg[t] ?? new THREE.Color(1, 1, 1),
    drawTile(c2, t, dx, dy, dw, dh) {
      c2.drawImage(canvas, (t % ATLAS_COLS) * TILE, Math.floor(t / ATLAS_COLS) * TILE, TILE, TILE, dx, dy, dw, dh);
    },
  };
  return atlasSingleton;
}

export function tileIndex(name: string): number {
  const i = getAtlas().index.get(name);
  if (i === undefined) throw new Error(`Unknown tile ${name}`);
  return i;
}
