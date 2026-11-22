// Block registry. Ids are stored in chunk Uint8Arrays and in world saves, so never renumber.

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLE: 4, SAND: 5, WATER: 6, LOG: 7, LEAVES: 8, PLANKS: 9,
  GLASS: 10, BRICKS: 11, STONE_BRICKS: 12, SANDSTONE: 13, SNOW: 14, GRAVEL: 15, TORCH: 16, TALL_GRASS: 17,
  FLOWER_RED: 18, FLOWER_YELLOW: 19, WOOL_RED: 20, WOOL_BLUE: 21, WOOL_YELLOW: 22, WOOL_GREEN: 23,
  WOOL_WHITE: 24, WOOL_BLACK: 25, WOOL_ORANGE: 26, WOOL_PURPLE: 27, OBSIDIAN: 28, DARK_STONE: 29,
  ARENA_PLATE: 30, LAMP: 31, WAYSTONE: 32, CHEST: 33, BEDROCK: 34, CACTUS: 35, PATH: 36,
  SPRUCE_LOG: 37, SPRUCE_LEAVES: 38, SPRUCE_PLANKS: 39, CRATE: 40, MOSSY_COBBLE: 41,
} as const;
export type BlockId = number;

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'sword';
export type RenderKind = 'cube' | 'cross' | 'torch' | 'liquid' | 'none';
export type SoundKind = 'stone' | 'wood' | 'grass' | 'sand' | 'glass' | 'cloth' | 'none';

export interface BlockDef {
  id: BlockId;
  name: string;
  /** atlas tile names: [top, bottom, side] */
  tiles: [string, string, string];
  render: RenderKind;
  solid: boolean; // collides with player
  opaque: boolean; // hides neighbour faces / blocks light / casts AO
  hardness: number; // seconds to break by hand; Infinity = unbreakable
  tool: ToolKind | null;
  sound: SoundKind;
  light: number; // 0..15 block-light emission
  drops?: BlockId | null; // undefined = itself, null = nothing
  placeable: boolean; // shows in the creative palette
}

const defs: BlockDef[] = [];
function def(id: number, name: string, tiles: string | [string, string, string], o: Partial<BlockDef> = {}): void {
  const t: [string, string, string] = typeof tiles === 'string' ? [tiles, tiles, tiles] : tiles;
  defs[id] = {
    id, name, tiles: t, render: 'cube', solid: true, opaque: true, hardness: 1, tool: null, sound: 'stone', light: 0, placeable: true, ...o,
  };
}

def(B.AIR, 'Air', 'none', { render: 'none', solid: false, opaque: false, hardness: 0, placeable: false, sound: 'none' });
def(B.GRASS, 'Grass Block', ['grass_top', 'dirt', 'grass_side'], { hardness: 0.9, tool: 'shovel', sound: 'grass', drops: B.DIRT });
def(B.DIRT, 'Dirt', 'dirt', { hardness: 0.75, tool: 'shovel', sound: 'grass' });
def(B.STONE, 'Stone', 'stone', { hardness: 2.5, tool: 'pickaxe', drops: B.COBBLE });
def(B.COBBLE, 'Cobblestone', 'cobble', { hardness: 3, tool: 'pickaxe' });
def(B.SAND, 'Sand', 'sand', { hardness: 0.75, tool: 'shovel', sound: 'sand' });
def(B.WATER, 'Water', 'water', { render: 'liquid', solid: false, opaque: false, hardness: Infinity, placeable: false, sound: 'none' });
def(B.LOG, 'Oak Log', ['log_top', 'log_top', 'log_side'], { hardness: 3, tool: 'axe', sound: 'wood' });
def(B.LEAVES, 'Oak Leaves', 'leaves', { opaque: false, hardness: 0.3, tool: 'sword', sound: 'grass', drops: null });
def(B.PLANKS, 'Oak Planks', 'planks', { hardness: 3, tool: 'axe', sound: 'wood' });
def(B.GLASS, 'Glass', 'glass', { opaque: false, hardness: 0.45, sound: 'glass' });
def(B.BRICKS, 'Bricks', 'bricks', { hardness: 3, tool: 'pickaxe' });
def(B.STONE_BRICKS, 'Stone Bricks', 'stone_bricks', { hardness: 3, tool: 'pickaxe' });
def(B.SANDSTONE, 'Sandstone', ['sandstone_top', 'sandstone_top', 'sandstone'], { hardness: 1.6, tool: 'pickaxe' });
def(B.SNOW, 'Snow', 'snow', { hardness: 0.6, tool: 'shovel', sound: 'cloth' });
def(B.GRAVEL, 'Gravel', 'gravel', { hardness: 0.9, tool: 'shovel', sound: 'sand' });
def(B.TORCH, 'Torch', 'torch', { render: 'torch', solid: false, opaque: false, hardness: 0, light: 14, sound: 'wood' });
def(B.TALL_GRASS, 'Tall Grass', 'tall_grass', { render: 'cross', solid: false, opaque: false, hardness: 0, sound: 'grass', drops: null, placeable: false });
def(B.FLOWER_RED, 'Red Flower', 'flower_red', { render: 'cross', solid: false, opaque: false, hardness: 0, sound: 'grass' });
def(B.FLOWER_YELLOW, 'Yellow Flower', 'flower_yellow', { render: 'cross', solid: false, opaque: false, hardness: 0, sound: 'grass' });
def(B.WOOL_RED, 'Red Wool', 'wool_red', { hardness: 1.2, sound: 'cloth' });
def(B.WOOL_BLUE, 'Blue Wool', 'wool_blue', { hardness: 1.2, sound: 'cloth' });
def(B.WOOL_YELLOW, 'Yellow Wool', 'wool_yellow', { hardness: 1.2, sound: 'cloth' });
def(B.WOOL_GREEN, 'Green Wool', 'wool_green', { hardness: 1.2, sound: 'cloth' });
def(B.WOOL_WHITE, 'White Wool', 'wool_white', { hardness: 1.2, sound: 'cloth' });
def(B.WOOL_BLACK, 'Black Wool', 'wool_black', { hardness: 1.2, sound: 'cloth' });
def(B.WOOL_ORANGE, 'Orange Wool', 'wool_orange', { hardness: 1.2, sound: 'cloth' });
def(B.WOOL_PURPLE, 'Purple Wool', 'wool_purple', { hardness: 1.2, sound: 'cloth' });
def(B.OBSIDIAN, 'Obsidian', 'obsidian', { hardness: 15, tool: 'pickaxe' });
def(B.DARK_STONE, 'Dark Stone', 'dark_stone', { hardness: 3, tool: 'pickaxe' });
def(B.ARENA_PLATE, 'Arena Plate', 'arena_plate', { hardness: 4, tool: 'pickaxe' });
def(B.LAMP, 'Glow Lamp', 'lamp', { hardness: 1, light: 15, sound: 'glass' });
def(B.WAYSTONE, 'Waystone', ['waystone_top', 'stone_bricks', 'waystone_side'], { hardness: Infinity, light: 10, placeable: false });
def(B.CHEST, 'Game Chest', 'none', { render: 'none', opaque: false, hardness: Infinity, placeable: false, sound: 'wood' });
def(B.BEDROCK, 'Bedrock', 'bedrock', { hardness: Infinity, placeable: false });
def(B.CACTUS, 'Cactus', ['cactus_top', 'cactus_top', 'cactus_side'], { hardness: 0.6, sound: 'cloth' });
def(B.PATH, 'Path', ['path_top', 'dirt', 'path_side'], { hardness: 0.9, tool: 'shovel', sound: 'sand', drops: B.DIRT });
def(B.SPRUCE_LOG, 'Spruce Log', ['spruce_log_top', 'spruce_log_top', 'spruce_log_side'], { hardness: 3, tool: 'axe', sound: 'wood' });
def(B.SPRUCE_LEAVES, 'Spruce Leaves', 'spruce_leaves', { opaque: false, hardness: 0.3, tool: 'sword', sound: 'grass', drops: null });
def(B.SPRUCE_PLANKS, 'Spruce Planks', 'spruce_planks', { hardness: 3, tool: 'axe', sound: 'wood' });
def(B.CRATE, 'Supply Crate', ['crate_top', 'crate_top', 'crate_side'], { hardness: 2, tool: 'axe', sound: 'wood' });
def(B.MOSSY_COBBLE, 'Mossy Cobblestone', 'mossy_cobble', { hardness: 3, tool: 'pickaxe' });

export const BLOCKS: readonly BlockDef[] = defs;
export const blockDef = (id: number): BlockDef => defs[id] ?? defs[0];

// Hot-path lookup tables.
export const SOLID = new Uint8Array(256);
export const OPAQUE = new Uint8Array(256);
export const LIGHT = new Uint8Array(256);
for (const d of defs) if (d) { SOLID[d.id] = d.solid ? 1 : 0; OPAQUE[d.id] = d.opaque ? 1 : 0; LIGHT[d.id] = d.light; }

export const PALETTE_BLOCKS: BlockId[] = defs.filter((d) => d && d.placeable).map((d) => d.id);
