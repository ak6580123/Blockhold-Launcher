import { BLOCKS, B, PALETTE_BLOCKS, type ToolKind } from '../engine/blocks';
import { getAtlas } from '../engine/textures';

export type ItemKind = 'tool' | 'block' | 'seeker' | 'elytra' | 'firework';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  tool?: ToolKind;
  blockId?: number;
  maxStack: number;
  description: string;
  /** 16x16 pixel art (tools only) */
  pixels?: string[];
}

// Original 16x16 pixel art. Palette keys below.
const PAL: Record<string, string> = {
  s: '#e2e4e8', S: '#6f747c', h: '#a0703c', H: '#5e3f1e', G: '#e8c33a', g: '#a8831a',
  y: '#fff1a0', Y: '#ffc02a', o: '#ff7a1a', c: '#6ff5ec', C: '#1aa39c', w: '#ffffff', p: '#9b59ff',
  e: '#9a95b8', E: '#4d4870', d: '#cbc6e6', r: '#d8402e', R: '#7f1d14', q: '#f3e8cc',
};

const PICKAXE = [
  '................',
  '.....SSSSSS.....',
  '...SSssssssSS...',
  '..Sss..hh..ssS..',
  '..Ss...hh...sS..',
  '..S....hh....S..',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hH.......',
  '.......hH.......',
  '.......hH.......',
  '.......hH.......',
  '.......HH.......',
  '................',
  '................',
];
const AXE = [
  '................',
  '.......hhSSS....',
  '.......hhSssS...',
  '.......hhSsssS..',
  '.......hhSsssS..',
  '.......hhSssS...',
  '.......hhSSS....',
  '.......hh.......',
  '.......hh.......',
  '.......hH.......',
  '.......hH.......',
  '.......hH.......',
  '.......hH.......',
  '.......HH.......',
  '................',
  '................',
];
const SHOVEL = [
  '................',
  '......SSSS......',
  '.....SssssS.....',
  '.....SssssS.....',
  '.....SssssS.....',
  '......SssS......',
  '.......SS.......',
  '.......hh.......',
  '.......hh.......',
  '.......hH.......',
  '.......hH.......',
  '.......hH.......',
  '......HhhH......',
  '......H..H......',
  '......HHHH......',
  '................',
];
const SWORD = [
  '.......Ss.......',
  '......SssS......',
  '......SssS......',
  '......SssS......',
  '......SssS......',
  '......SssS......',
  '......SssS......',
  '......SssS......',
  '......SssS......',
  '....gGGGGGGg....',
  '.......hH.......',
  '.......hH.......',
  '.......hH.......',
  '......gGGg......',
  '................',
  '................',
];
const SEEKER = [
  '......CccC......',
  '.....CcwwcC.....',
  '....CcwwcccC....',
  '....CccccccC....',
  '.....CcccpC.....',
  '......CCCC......',
  '.......GG.......',
  '.......hh.......',
  '.......hh.......',
  '.......hH.......',
  '.......hH.......',
  '.......hH.......',
  '......gGGg......',
  '.......HH.......',
  '................',
  '................',
];

const ELYTRA = [
  '................',
  '..EEE......EEE..',
  '.EddeE....EeddE.',
  '.EdeeE....EeedE.',
  '.EdeeeE..EeeedE.',
  '.EdeeeE..EeeedE.',
  '..EdeeE..EeedE..',
  '..EdeeeEEeeedE..',
  '..EdeeeEEeeedE..',
  '...EdeeEEeedE...',
  '...EdeeEEeedE...',
  '...EdeE..EedE...',
  '....EeE..EeE....',
  '....EE....EE....',
  '................',
  '................',
];
const FIREWORK = [
  '................',
  '.......RR.......',
  '......RrrR......',
  '......rqqr......',
  '......rrrr......',
  '......rqqr......',
  '......rrrr......',
  '......rqqr......',
  '......RrrR......',
  '.......hH.......',
  '.......hH.......',
  '.......hH.......',
  '.......hH.......',
  '.......GG.......',
  '.......G........',
  '................',
];

const defs = new Map<string, ItemDef>();
function add(d: ItemDef): void { defs.set(d.id, d); }

add({ id: 'tool:pickaxe', name: 'Iron Pickaxe', kind: 'tool', tool: 'pickaxe', maxStack: 1, pixels: PICKAXE, description: 'Mines stone, bricks and ores quickly.' });
add({ id: 'tool:axe', name: 'Iron Axe', kind: 'tool', tool: 'axe', maxStack: 1, pixels: AXE, description: 'Chops logs, planks and crates quickly.' });
add({ id: 'tool:shovel', name: 'Iron Shovel', kind: 'tool', tool: 'shovel', maxStack: 1, pixels: SHOVEL, description: 'Digs dirt, sand, gravel and snow quickly.' });
add({ id: 'tool:sword', name: 'Iron Sword', kind: 'tool', tool: 'sword', maxStack: 1, pixels: SWORD, description: 'Slices through leaves and plants instantly. Slow on everything else.' });
add({ id: 'tool:seeker', name: 'Game Seeker', kind: 'seeker', maxStack: 1, pixels: SEEKER, description: 'Right-click a game chest to open it from afar, or right-click the air to find and travel to any game.' });
add({ id: 'item:elytra', name: 'Elytra', kind: 'elytra', maxStack: 1, pixels: ELYTRA, description: 'Wings for your back. Right-click to wear (or drop it in the Back slot), then press Jump while falling to glide.' });
add({ id: 'item:firework', name: 'Firework Rocket', kind: 'firework', maxStack: 64, pixels: FIREWORK, description: 'Right-click while gliding for a burst of speed, or right-click a block to launch a firework show.' });
for (const id of PALETTE_BLOCKS) {
  const b = BLOCKS[id];
  add({ id: `block:${id}`, name: b.name, kind: 'block', blockId: id, maxStack: 64, description: id === B.TORCH ? 'Lights up the night.' : 'Building block. Right-click to place.' });
}

export const itemDef = (id: string): ItemDef | undefined => defs.get(id);
export const blockItemId = (blockId: number): string => `block:${blockId}`;
export const ALL_BLOCK_ITEMS = PALETTE_BLOCKS.map(blockItemId);
export const ELYTRA_ID = 'item:elytra';
export const FIREWORK_ID = 'item:firework';
/** Everything the inventory palette hands out: special items first, then building blocks. */
export const PALETTE_ITEMS = [ELYTRA_ID, FIREWORK_ID, ...ALL_BLOCK_ITEMS];
/** pixel art by item id, for tests */
export const ITEM_PIXELS = (): [string, string[]][] => [...defs.values()].filter((d) => d.pixels).map((d) => [d.id, d.pixels!]);

// ---------- icons ----------

const iconCache = new Map<string, string>();

export function drawPixelArt(ctx: CanvasRenderingContext2D, pixels: string[], scale = 1): void {
  for (let y = 0; y < pixels.length; y++) for (let x = 0; x < pixels[y].length; x++) {
    const c = PAL[pixels[y][x]];
    if (!c) continue;
    ctx.fillStyle = c;
    ctx.fillRect(x * scale, y * scale, scale, scale);
  }
}

export function pixelColor(key: string): string | undefined {
  return PAL[key];
}

/** Isometric block icon drawn from atlas tiles (top/left/right faces with shading). */
function blockIcon(blockId: number): string {
  const atlas = getAtlas();
  const d = BLOCKS[blockId];
  const S = 48;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const [top, , side] = d.tiles.map((t) => atlas.index.get(t) ?? 0);
  if (d.render === 'cross' || d.render === 'torch') {
    atlas.drawTile(ctx, side, 4, 4, S - 8, S - 8);
    return cv.toDataURL();
  }
  const w = S / 2 - 2, h = w / 2;
  const cx = S / 2, ty = 4;
  const face = (tile: number, m: [number, number, number, number, number, number], shade: number) => {
    ctx.save();
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    atlas.drawTile(ctx, tile, 0, 0, 16, 16);
    ctx.fillStyle = `rgba(0,0,0,${1 - shade})`;
    ctx.fillRect(0, 0, 16, 16);
    ctx.restore();
  };
  // top: rhombus
  face(top, [w / 16, h / 16, -w / 16, h / 16, cx, ty], 1);
  // left
  face(side, [w / 16, h / 16, 0, w / 16, cx - w, ty + h], 0.78);
  // right
  face(side, [w / 16, -h / 16, 0, w / 16, cx, ty + 2 * h], 0.62);
  return cv.toDataURL();
}

function toolIcon(pixels: string[]): string {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  drawPixelArt(cv.getContext('2d')!, pixels);
  return cv.toDataURL();
}

export function itemIcon(id: string): string {
  const hit = iconCache.get(id);
  if (hit) return hit;
  const d = itemDef(id);
  let url = '';
  if (d?.pixels) url = toolIcon(d.pixels);
  else if (d?.blockId !== undefined) url = blockIcon(d.blockId);
  iconCache.set(id, url);
  return url;
}
