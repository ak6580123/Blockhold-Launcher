import type {
  DiscoveredGame, Game, GamePatch, GameStatus, LaunchResult, PickedExecutable, ScanReport, Settings, WorldSave,
} from './types';

/** IPC channel names. Only these are bridged by the preload script. */
export const IPC = {
  libraryList: 'library:list',
  libraryAdd: 'library:add',
  libraryUpdate: 'library:update',
  libraryRemove: 'library:remove',
  libraryScan: 'library:scan',
  libraryImport: 'library:import',
  libraryCover: 'library:cover',
  libraryPickCover: 'library:pick-cover',
  libraryOpenFolder: 'library:open-folder',
  pickExecutable: 'dialog:pick-executable',
  pickDirectory: 'dialog:pick-directory',
  launch: 'launcher:launch',
  running: 'launcher:running',
  gameStatus: 'launcher:status', // main -> renderer event
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  worldLoad: 'world:load',
  worldSave: 'world:save',
  worldReset: 'world:reset',
  windowFullscreen: 'window:fullscreen',
  windowSize: 'window:size',
  appQuit: 'app:quit',
  appRequestSave: 'app:request-save', // main -> renderer event
  appSaveDone: 'app:save-done',
  appInfo: 'app:info',
  skinGet: 'skin:get',
  skinPick: 'skin:pick',
  skinReset: 'skin:reset',
  skinFetch: 'skin:fetch',
} as const;

export interface AppInfo {
  version: string;
  firstRun: boolean;
  smoke: boolean;
  userDataDir: string;
}

export interface LauncherAPI {
  library: {
    list(): Promise<Game[]>;
    add(input: Partial<Game> & { exePath: string }): Promise<Game>;
    update(id: string, patch: GamePatch): Promise<Game>;
    remove(id: string): Promise<void>;
    scan(): Promise<ScanReport>;
    import(games: DiscoveredGame[]): Promise<Game[]>;
    cover(id: string): Promise<string | null>;
    pickCover(id: string): Promise<Game | null>;
    openFolder(id: string): Promise<string | null>;
  };
  dialog: {
    pickExecutable(): Promise<PickedExecutable | null>;
    pickDirectory(): Promise<string | null>;
  };
  launcher: {
    launch(id: string, configId?: string, force?: boolean): Promise<LaunchResult>;
    running(): Promise<GameStatus[]>;
    onStatus(cb: (s: GameStatus) => void): () => void;
  };
  settings: {
    get(): Promise<Settings>;
    set(s: Settings): Promise<Settings>;
  };
  world: {
    load(): Promise<WorldSave | null>;
    save(w: WorldSave): Promise<void>;
    reset(): Promise<void>;
  };
  window: {
    setFullscreen(on: boolean): Promise<void>;
    setSize(w: number, h: number): Promise<void>;
  };
  skin: {
    /** the custom skin as a PNG data URL, or null when using the built-in one */
    get(): Promise<string | null>;
    /** let the user choose a 64x64 / 64x32 skin PNG; returns its data URL (null if cancelled) */
    pick(): Promise<string | null>;
    reset(): Promise<void>;
    /** download and equip a Minecraft player's skin by username */
    fetchByName(name: string): Promise<{ dataUrl: string; slim: boolean }>;
  };
  app: {
    info(): Promise<AppInfo>;
    quit(): Promise<void>;
    onRequestSave(cb: () => Promise<void> | void): void;
  };
}
