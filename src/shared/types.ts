// Types shared by the main process, preload bridge and renderer.

export type RegionId = 'survival' | 'adventure' | 'rpg' | 'fps' | 'indie' | 'sandbox';
export const REGION_IDS: readonly RegionId[] = ['survival', 'adventure', 'rpg', 'fps', 'indie', 'sandbox'];
export const REGION_NAMES: Record<RegionId, string> = {
  survival: 'Survival Zone',
  adventure: 'Adventure Zone',
  rpg: 'RPG Kingdom',
  fps: 'FPS Arena',
  indie: 'Indie Village',
  sandbox: 'Sandbox District',
};

export type GameSource = 'steam' | 'epic' | 'gog' | 'xbox' | 'folder' | 'manual';
/**
 * exe   – spawn the executable directly (args + working dir supported)
 * uri   – hand a whitelisted store URI (steam://, com.epicgames.launcher://, ...) to the OS
 * shell – open a .lnk/.url/.bat shortcut with the OS shell
 * appx  – launch a packaged (Microsoft Store / Xbox) app by its AUMID
 */
export type LaunchMethod = 'exe' | 'uri' | 'shell' | 'appx';
export const LAUNCH_METHODS: readonly LaunchMethod[] = ['exe', 'uri', 'shell', 'appx'];

export type ChestStyle = 'oak' | 'spruce' | 'iron' | 'gold' | 'obsidian' | 'crimson' | 'emerald';
export const CHEST_STYLES: readonly ChestStyle[] = ['oak', 'spruce', 'iron', 'gold', 'obsidian', 'crimson', 'emerald'];

export interface ChestPos {
  x: number;
  y: number;
  z: number;
  /** 0..3, quarter turns; 0 = front faces +Z */
  facing: number;
}

export interface LaunchConfig {
  id: string;
  name: string;
  args: string;
  workingDir: string;
}

export interface Game {
  id: string;
  title: string;
  source: GameSource;
  /** store id (steam appid, epic AppName, gog gameID, appx AUMID) */
  sourceId?: string;
  installDir: string;
  exePath: string;
  args: string;
  workingDir: string;
  launchMethod: LaunchMethod;
  launchUri?: string;
  aumid?: string;
  description: string;
  category: RegionId;
  chestStyle: ChestStyle;
  chest?: ChestPos;
  coverPath?: string;
  playtimeSeconds: number;
  lastPlayed?: number;
  addedAt: number;
  launchConfigs: LaunchConfig[];
}

/** A game found by discovery that is not in the library yet. */
export type DiscoveredGame = Omit<Game, 'id' | 'playtimeSeconds' | 'lastPlayed' | 'addedAt' | 'chest' | 'chestStyle' | 'launchConfigs'>;

/** Fields the renderer may change through library:update. */
export type GamePatch = Partial<
  Pick<
    Game,
    | 'title' | 'description' | 'category' | 'chestStyle' | 'exePath' | 'args' | 'workingDir'
    | 'launchMethod' | 'launchUri' | 'installDir' | 'launchConfigs'
  >
> & { chest?: ChestPos | null };

export interface LaunchResult {
  ok: boolean;
  alreadyRunning?: boolean;
  error?: string;
}

export interface GameStatus {
  id: string;
  running: boolean;
  playtimeSeconds: number;
  lastPlayed?: number;
  error?: string;
}

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'crouch'
  | 'interact' | 'special' | 'camera' | 'debug';
export const ACTIONS: readonly Action[] = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'crouch', 'interact', 'special', 'camera', 'debug'];
export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Walk forward', back: 'Walk backward', left: 'Strafe left', right: 'Strafe right',
  jump: 'Jump / swim', sprint: 'Sprint', crouch: 'Crouch', interact: 'Open chest / Inventory',
  special: 'Special interact / Quick play', camera: 'Switch camera view', debug: 'Debug overlay',
};

export type GraphicsQuality = 'low' | 'medium' | 'high';
export type DiscoverySource = 'steam' | 'epic' | 'gog' | 'xbox';
/** classic = 4px-wide arms, slim = 3px-wide arms (same skin file layout) */
export type SkinModel = 'classic' | 'slim';

export interface Settings {
  mouseSensitivity: number; // 0.1 .. 3
  invertY: boolean;
  fov: number; // 50 .. 110
  graphics: GraphicsQuality;
  renderScale: number; // 0.5 .. 1
  windowSize: string; // e.g. "1600x900"
  renderDistance: number; // chunks, 2 .. 12
  masterVolume: number; // 0..1
  sfxVolume: number;
  ambientVolume: number;
  fullscreen: boolean;
  showFps: boolean;
  keyBindings: Record<Action, string>; // KeyboardEvent.code
  dayNightCycle: boolean;
  dayLengthMinutes: number;
  defaultChestStyle: ChestStyle;
  scanDirectories: string[];
  enabledSources: Record<DiscoverySource, boolean>;
  autoScanOnStartup: boolean;
  skinModel: SkinModel;
}

export const DEFAULT_SETTINGS: Settings = {
  mouseSensitivity: 1,
  invertY: false,
  fov: 75,
  graphics: 'medium',
  renderScale: 1,
  windowSize: '1600x900',
  renderDistance: 6,
  masterVolume: 0.8,
  sfxVolume: 0.8,
  ambientVolume: 0.5,
  fullscreen: false,
  showFps: false,
  keyBindings: {
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space',
    sprint: 'ShiftLeft', crouch: 'ControlLeft', interact: 'KeyE', special: 'KeyF', camera: 'F5', debug: 'F3',
  },
  dayNightCycle: true,
  dayLengthMinutes: 20,
  defaultChestStyle: 'oak',
  scanDirectories: [],
  enabledSources: { steam: true, epic: true, gog: true, xbox: true },
  autoScanOnStartup: true,
  skinModel: 'classic',
};

export interface ItemStack {
  id: string;
  count: number;
}

export interface WorldSave {
  version: 1;
  seed: number;
  /** "x,y,z" -> block id for every block the player changed */
  mods: [string, number][];
  player: { x: number; y: number; z: number; yaw: number; pitch: number };
  inventory: { slots: (ItemStack | null)[]; selected: number; /** worn on the back (elytra) */ back?: ItemStack | null };
  timeOfDay: number; // 0..1, 0.25 = noon-ish sunrise offset handled in sky
}

export interface ScanReport {
  found: DiscoveredGame[];
  errors: string[];
}

export interface PickedExecutable {
  exePath: string;
  installDir: string;
  title: string;
}
