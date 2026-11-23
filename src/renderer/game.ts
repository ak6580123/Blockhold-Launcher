import * as THREE from 'three';
import type { AppInfo, LauncherAPI } from '../shared/api';
import { REGION_NAMES, type ChestPos, type Game as GameRecord, type GameStatus, type RegionId, type Settings, type WorldSave } from '../shared/types';
import { AudioManager } from './audio/audio';
import { ChestManager } from './chests/chestManager';
import { B, SOLID, blockDef } from './engine/blocks';
import { Fireworks } from './engine/fireworks';
import { Particles } from './engine/particles';
import { Sky } from './engine/sky';
import { waystones } from './engine/structures';
import { PLAZA_Y, REGIONS, SEA_LEVEL } from './engine/terrain';
import { World } from './engine/world';
import { BlockInteraction, REACH, SEEKER_REACH } from './interaction/blockInteraction';
import { HOTBAR_SIZE, Inventory } from './inventory/inventory';
import { FIREWORK_ID, itemDef } from './inventory/items';
import { Hand } from './player/hand';
import { Input } from './player/input';
import { Player } from './player/player';
import { PlayerModel } from './player/playerModel';
import { raycastVoxels } from './player/raycast';
import { PlayerSkin } from './player/skin';
import { SaveSystem } from './systems/saveSystem';
import { SettingsManager } from './systems/settingsManager';
import { ChestScreen, cleanIpcError } from './ui/chestScreen';
import { h } from './ui/dom';
import { Hud } from './ui/hud';
import { InventoryScreen } from './ui/inventoryScreen';
import { LibraryScreen } from './ui/libraryScreen';
import { ClickToPlay, PauseMenu, TitleScreen, WaystoneScreen, type WaystoneDest } from './ui/menus';
import { SettingsScreen } from './ui/settingsScreen';
import { Toasts } from './ui/toast';

type Mode = 'title' | 'play' | 'pause' | 'inventory' | 'chest' | 'library' | 'settings' | 'waystone';

const DIR_NAMES = ['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE'];

export interface GameInit {
  api: LauncherAPI;
  info: AppInfo;
  settings: Settings;
  save: WorldSave | null;
  games: GameRecord[];
  canvas: HTMLCanvasElement;
  ui: HTMLElement;
}

/** Top-level orchestrator: owns every subsystem and the UI state machine. */
export class Game {
  private api: LauncherAPI;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private sky: Sky;
  private player: Player;
  private hand = new Hand();
  private input: Input;
  private inv: Inventory;
  private chests: ChestManager;
  private interaction: BlockInteraction;
  private particles: Particles;
  private fireworks: Fireworks;
  private audio = new AudioManager();
  private settings: SettingsManager;
  private saves: SaveSystem;
  private hud: Hud;
  private toasts: Toasts;
  private ui: HTMLElement;

  private mode: Mode = 'title';
  /** where Esc/close returns to from settings/library */
  private returnMode: Mode = 'pause';
  private screenEl: HTMLElement | null = null;
  private title: TitleScreen;
  private pause: PauseMenu;
  private invScreen: InventoryScreen;
  private chestScreen: ChestScreen;
  private libScreen: LibraryScreen;
  private setScreen: SettingsScreen;
  private wayScreen: WaystoneScreen;
  private clickToPlay: ClickToPlay;

  private last = performance.now();
  private fpsFrames = 0;
  private fpsTime = 0;
  private fpsText = '';
  private debugOn = false;
  private currentRegion: RegionId | 'spawn' | null = null;
  private openChestId: string | null = null;
  private carryFrom: ChestPos | null = null;
  private seed: number;
  private covers = new Map<string, Promise<string | null>>();
  private seenRunning = new Set<string>();
  private suppressPauseUntil = 0;
  /** 0 = first person, 1 = third person (behind), 2 = third person (front) */
  private cameraView = 0;
  private skin = new PlayerSkin();
  private playerModel: PlayerModel;
  private camDir = new THREE.Vector3();
  /** extra field of view while gliding fast (degrees, eased) */
  private fovKick = 0;
  private trailPos = new THREE.Vector3();
  private wasBoosting = false;
  private elytraHintShown = false;

  constructor(private init: GameInit) {
    this.api = init.api;
    this.ui = init.ui;
    this.seed = init.save?.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.settings = new SettingsManager(this.api, init.settings);
    const s = init.settings;

    this.renderer = new THREE.WebGLRenderer({ canvas: init.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.PerspectiveCamera(s.fov, 1, 0.05, 1000);

    this.world = new World(this.scene, this.seed, init.save?.mods ?? []);
    this.sky = new Sky(this.scene);
    this.particles = new Particles(this.scene);
    const distTo = (x: number, y: number, z: number) => this.player.eye().distanceTo(this.trailPos.set(x, y, z));
    this.fireworks = new Fireworks(this.scene, {
      launch: (x, y, z) => this.audio.fireworkLaunch(distTo(x, y, z)),
      bang: (x, y, z, big) => this.audio.fireworkBang(distTo(x, y, z), big),
      crackle: (x, y, z) => this.audio.fireworkCrackle(distTo(x, y, z)),
    });
    this.inv = new Inventory(init.save?.inventory.slots, init.save?.inventory.selected ?? 0, init.save?.inventory.back ?? null);
    this.input = new Input(init.canvas, s.keyBindings);
    this.player = new Player(this.world, {
      onStep: (b) => this.audio.step(blockDef(b).sound),
      onLand: () => this.audio.land(),
      onVoid: () => this.teleportSpawn(),
      onBonk: () => this.audio.land(),
      onGlideStart: () => this.audio.wingsOpen(),
    });
    this.playerModel = new PlayerModel(this.scene, this.skin);
    this.skin.onChange(() => this.hand.setSkin(this.skin.texture, this.skin.model === 'slim'));
    this.hand.setSkin(this.skin.texture, false);
    this.chests = new ChestManager(this.scene, this.world, (id) => this.cover(id));
    this.world.onChunkGenerated = (c) => this.chests.applyToChunk(c);
    this.interaction = new BlockInteraction(this.scene, this.world, this.player, this.inv, this.audio, this.particles);

    this.hud = new Hud(this.ui, this.inv);
    this.toasts = new Toasts(this.ui);
    this.inv.onChange(() => this.hand.setItem(this.inv.held?.id ?? null));
    this.hand.setItem(this.inv.held?.id ?? null);

    this.title = new TitleScreen(() => this.enterWorld(), () => this.openLibrary('title'), () => this.openSettings('title'));
    this.pause = new PauseMenu({
      resume: () => this.resume(),
      library: () => this.openLibrary('pause'),
      settings: () => this.openSettings('pause'),
      spawn: () => { this.teleportSpawn(); this.resume(); },
      quit: () => void this.quit(),
    });
    this.invScreen = new InventoryScreen(this.inv, () => this.audio.click());
    this.chestScreen = new ChestScreen({
      launch: (id, cfg, force) => this.launch(id, cfg, force),
      update: async (id, patch) => { const g = await this.api.library.update(id, patch); this.covers.delete(id); this.chests.invalidateCover(id); await this.reloadLibrary(); return g; },
      remove: async (id) => { await this.api.library.remove(id); await this.reloadLibrary(); this.toasts.show('Chest removed', 'The game is still installed on your PC.'); },
      move: (id) => this.startCarry(id),
      openFolder: (id) => this.api.library.openFolder(id),
      pickCover: async (id) => { const g = await this.api.library.pickCover(id); if (g) { this.covers.delete(id); this.chests.invalidateCover(id); await this.reloadLibrary(); } return g; },
      pickExecutable: () => this.api.dialog.pickExecutable(),
      pickDirectory: () => this.api.dialog.pickDirectory(),
      cover: (id) => this.cover(id),
      isRunning: (id) => this.chests.isRunning(id),
      close: () => this.resume(),
      click: () => this.audio.click(),
    });
    this.libScreen = new LibraryScreen({
      games: () => this.chests.games(),
      distanceTo: (id) => { const p = this.chests.position(id); return p ? Math.hypot(p.x - this.player.pos.x, p.z - this.player.pos.z) : 0; },
      cover: (id) => this.cover(id),
      teleportTo: (id) => { this.teleportToChest(id); this.resume(); },
      openChest: (id, edit) => this.openChest(id, edit, false),
      remove: async (id) => { await this.api.library.remove(id); await this.reloadLibrary(); },
      scan: () => this.api.library.scan(),
      import: async (list) => {
        const added = await this.api.library.import(list);
        await this.reloadLibrary();
        this.toasts.show(`${added.length} game${added.length === 1 ? '' : 's'} imported`, 'New chests have appeared in their regions.', 'success');
        return added;
      },
      pickExecutable: () => this.api.dialog.pickExecutable(),
      add: async (input) => {
        const g = await this.api.library.add(input);
        await this.reloadLibrary();
        this.toasts.show(`${g.title} added`, `Its chest is in the ${REGION_NAMES[g.category]}. Use Travel to go there.`, 'success');
        return g;
      },
      click: () => this.audio.click(),
      close: () => this.back(),
    });
    this.setScreen = new SettingsScreen({
      get: () => this.settings.current,
      apply: (n) => this.settings.apply(n),
      setTime: (t) => { this.sky.timeOfDay = t; },
      resetWorld: async () => this.resetWorld(),
      applyChestStyleToAll: async (style) => {
        for (const g of this.chests.games()) if (g.chestStyle !== style) await this.api.library.update(g.id, { chestStyle: style });
        await this.reloadLibrary();
        this.toasts.show('Chests restyled', `All chests now use the ${style} style.`, 'success');
      },
      pickDirectory: () => this.api.dialog.pickDirectory(),
      skin: {
        canvas: () => this.skin.canvas,
        isDefault: () => this.skin.isDefault,
        pick: async () => {
          const url = await this.api.skin.pick();
          if (url) { await this.skin.set(url); this.toasts.show('Skin equipped', 'Press F5 to see yourself.', 'success'); }
          return !!url;
        },
        fetchByName: async (name) => {
          const r = await this.api.skin.fetchByName(name);
          await this.skin.set(r.dataUrl);
          const s = this.settings.current;
          this.settings.apply({ ...s, skinModel: r.slim ? 'slim' : 'classic' });
          this.toasts.show(`Now wearing ${name}'s skin`, 'Press F5 to see yourself.', 'success');
        },
        reset: async () => { await this.api.skin.reset(); await this.skin.set(null); },
        onChange: (fn) => this.skin.onChange(fn),
      },
      click: () => this.audio.click(),
      close: () => this.back(),
    });
    this.wayScreen = new WaystoneScreen((d) => this.travelTo(d), () => this.resume());
    this.clickToPlay = new ClickToPlay(() => this.resume());

    this.saves = new SaveSystem(this.api, () => this.collectSave());
    this.settings.onChange((n, p) => this.applySettings(n, p));
    this.applySettings(s, null);
    this.sky.timeOfDay = init.save?.timeOfDay ?? 0.08;

    this.bindEvents();
    void this.api.skin.get().then((url) => (url ? this.skin.set(url) : undefined)).catch((e) => console.error('skin load failed', e));
    this.placePlayer(init.save);
    this.syncChests(init.games);
    this.saves.start();
    this.showScreen(this.title.el, 'title');
    this.hud.setVisible(false);
    if (init.info.smoke) (window as unknown as Record<string, unknown>).__blockhold = this.debugApi();
  }

  // ---------------------------------------------------------------- setup

  private bindEvents(): void {
    window.addEventListener('resize', () => this.resize());
    this.resize();
    document.addEventListener('pointerlockchange', () => {
      if (!this.input.locked && this.mode === 'play') {
        // lock lost right after closing a screen with Esc: that's the same key press, not a pause request
        if (performance.now() < this.suppressPauseUntil) this.ui.append(this.clickToPlay.el);
        else this.openPause();
      }
      if (this.input.locked) this.clickToPlay.el.remove();
    });
    this.input.onKey((code, e) => this.onKey(code, e));
    this.api.launcher.onStatus((st) => this.onGameStatus(st));
    void this.api.launcher.running().then((list) => list.forEach((st) => this.onGameStatus(st, true)));
    window.addEventListener('mousedown', () => this.audio.resume(), { once: true });
    window.addEventListener('keydown', () => this.audio.resume(), { once: true });
  }

  private resize(): void {
    const w = window.innerWidth, hgt = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio) * this.settings.current.renderScale);
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
    this.hand.setAspect(w / hgt);
  }

  private applySettings(s: Settings, prev: Settings | null): void {
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.world.setRenderDistance(s.renderDistance);
    this.sky.setFogDistance(s.renderDistance);
    if (!prev || prev.graphics !== s.graphics) {
      this.renderer.shadowMap.enabled = s.graphics !== 'low';
      this.sky.setShadowQuality(s.graphics);
      this.world.setShadows(s.graphics !== 'low');
      this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
    }
    if (!prev || prev.renderScale !== s.renderScale) this.resize();
    this.audio.setVolumes(s.masterVolume, s.sfxVolume, s.ambientVolume);
    this.input.bindings = { ...s.keyBindings };
    this.player.sensitivity = s.mouseSensitivity;
    this.player.invertY = s.invertY;
    this.player.flight3d = s.elytra3dFlight;
    this.player.rollSensitivity = s.elytraRollSensitivity;
    this.sky.cycle = s.dayNightCycle;
    this.sky.dayLengthSec = s.dayLengthMinutes * 60;
    this.skin.setModel(s.skinModel);
    if (prev && prev.fullscreen !== s.fullscreen) void this.api.window.setFullscreen(s.fullscreen);
    if (prev && prev.windowSize !== s.windowSize) {
      const [w, hgt] = s.windowSize.split('x').map(Number);
      void this.api.window.setSize(w, hgt);
    }
    if (!s.showFps) this.hud.setFps(null);
  }

  private placePlayer(save: WorldSave | null): void {
    const p = save?.player;
    const x = p?.x ?? 0.5, z = p?.z ?? 7.5;
    this.world.prepareArea(x, z, 2);
    let y = p?.y ?? PLAZA_Y + 1;
    if (!p) y = this.findStandY(Math.floor(x), Math.floor(z), PLAZA_Y);
    this.player.teleport(x, y, z);
    this.player.yaw = p?.yaw ?? 0;
    this.player.pitch = p?.pitch ?? -0.1;
  }

  // ---------------------------------------------------------------- library

  private cover(id: string): Promise<string | null> {
    let p = this.covers.get(id);
    if (!p) {
      p = this.api.library.cover(id).catch(() => null);
      this.covers.set(id, p);
    }
    return p;
  }

  private syncChests(games: GameRecord[]): void {
    const assigned = this.chests.setGames(games);
    // persist newly assigned chest positions so they survive restarts
    for (const g of assigned) void this.api.library.update(g.id, { chest: g.chest }).catch((e) => console.error(e));
    this.libScreen.refresh();
  }

  async reloadLibrary(): Promise<void> {
    this.syncChests(await this.api.library.list());
  }

  /** First run: import everything found. Later runs: just tell the user about new games. */
  async autoScan(): Promise<void> {
    if (!this.settings.current.autoScanOnStartup && !this.init.info.firstRun) return;
    try {
      const report = await this.api.library.scan();
      if (!report.found.length) {
        if (!this.chests.count) this.toasts.show('No games found automatically', 'Open the Game Library (Esc → Game Library) to add games manually.', 'info', 8000);
        return;
      }
      if (!this.chests.count) {
        const added = await this.api.library.import(report.found);
        await this.reloadLibrary();
        this.toasts.show(`Found ${added.length} installed game${added.length === 1 ? '' : 's'}!`, 'Each one now has its own chest. Follow the paths from spawn to the regions.', 'success', 9000);
      } else {
        this.toasts.show(`${report.found.length} new game${report.found.length === 1 ? '' : 's'} detected`, 'Open Game Library → Scan for games to import them.', 'info', 8000);
      }
    } catch (e) {
      this.toasts.show('Game scan failed', cleanIpcError(e), 'error');
    }
  }

  private async launch(id: string, configId?: string, force = false) {
    const g = this.chests.get(id);
    const res = await this.api.launcher.launch(id, configId, force);
    if (res.ok) { this.audio.launch(); this.toasts.show(`Launching ${g?.title ?? 'game'}`, 'The launcher keeps running in the background.', 'success'); }
    else { this.audio.error(); if (!res.alreadyRunning) this.toasts.show('Launch failed', res.error ?? '', 'error', 8000); }
    return res;
  }

  private onGameStatus(st: GameStatus, initial = false): void {
    this.chests.setStatus(st);
    this.chestScreen.onStatus(st);
    if (st.error) this.toasts.show('Game problem', st.error, 'error', 9000);
    const g = this.chests.get(st.id);
    if (!g || initial) { if (st.running) this.seenRunning.add(st.id); return; }
    if (st.running && !this.seenRunning.has(st.id)) this.seenRunning.add(st.id);
    else if (!st.running && this.seenRunning.has(st.id)) {
      this.seenRunning.delete(st.id);
      this.toasts.show(`${g.title} closed`, 'Welcome back!');
    }
  }

  // ---------------------------------------------------------------- screens

  private showScreen(el: HTMLElement | null, mode: Mode): void {
    if (this.screenEl && this.screenEl !== el) this.screenEl.remove();
    this.screenEl = el;
    if (el && !el.isConnected) this.ui.append(el);
    this.mode = mode;
    if (mode !== 'play') {
      this.input.unlock();
      this.input.releaseAll();
      this.interaction.hide();
      this.hand.setSwinging(false);
    }
  }

  private closeScreenSideEffects(): void {
    if (this.mode === 'inventory') this.invScreen.close();
    if (this.mode === 'settings') this.setScreen.close();
    if (this.mode === 'chest' && this.openChestId) {
      this.chests.setOpen(this.openChestId, false);
      this.audio.chestClose();
      this.openChestId = null;
    }
  }

  private enterWorld(): void {
    this.hud.setVisible(true);
    this.audio.resume();
    this.resume();
    if (!this.currentRegion) this.hud.showBanner('Spawn', `${this.chests.count} games in this world`);
  }

  /** Close any screen and go back to playing (re-acquires the pointer). */
  private resume(): void {
    this.closeScreenSideEffects();
    this.showScreen(null, 'play');
    this.hud.setVisible(true);
    void this.input.lock().then(() => {
      if (!this.input.locked && this.mode === 'play') this.ui.append(this.clickToPlay.el);
    });
  }

  /**
   * Close a screen with Esc. Chromium also treats that Esc press as "exit pointer lock", so
   * grabbing the mouse during the keydown would be undone immediately and drop us into the
   * pause menu. Close the screen now, but only re-lock once Esc has been released.
   */
  private resumeFromEscape(): void {
    this.closeScreenSideEffects();
    this.showScreen(null, 'play');
    this.hud.setVisible(true);
    this.suppressPauseUntil = performance.now() + 1500;
    let done = false;
    const relock = () => {
      if (done) return;
      done = true;
      window.removeEventListener('keyup', onUp, true);
      if (this.mode !== 'play') return;
      this.suppressPauseUntil = performance.now() + 400;
      void this.input.lock().then(() => {
        if (!this.input.locked && this.mode === 'play') this.ui.append(this.clickToPlay.el);
      });
    };
    const onUp = (ev: KeyboardEvent) => { if (ev.code === 'Escape') relock(); };
    window.addEventListener('keyup', onUp, true);
    window.setTimeout(relock, 600); // key-up lost (e.g. window blur): fall back to click-to-play
  }

  private back(): void {
    if (this.returnMode === 'title') { this.closeScreenSideEffects(); this.showScreen(this.title.el, 'title'); }
    else if (this.returnMode === 'pause') { this.closeScreenSideEffects(); this.showScreen(this.pause.el, 'pause'); }
    else this.resume();
  }

  private openPause(): void {
    this.showScreen(this.pause.el, 'pause');
  }

  private openInventory(): void {
    this.invScreen.open();
    this.showScreen(this.invScreen.el, 'inventory');
  }

  private openLibrary(from: Mode, finder = false): void {
    this.closeScreenSideEffects();
    this.returnMode = from;
    this.libScreen.open({ finder });
    this.showScreen(this.libScreen.el, 'library');
  }

  private openSettings(from: Mode): void {
    this.closeScreenSideEffects();
    this.returnMode = from;
    this.setScreen.open();
    this.showScreen(this.setScreen.el, 'settings');
  }

  private openChest(id: string, edit: boolean, animate = true): void {
    const g = this.chests.get(id);
    if (!g) return;
    this.closeScreenSideEffects();
    this.openChestId = id;
    if (animate) { this.chests.setOpen(id, true); this.audio.chestOpen(); }
    this.chestScreen.open(g, edit);
    this.showScreen(this.chestScreen.el, 'chest');
  }

  private openWaystone(): void {
    const counts = new Map<string, number>();
    for (const g of this.chests.games()) counts.set(g.category, (counts.get(g.category) ?? 0) + 1);
    this.wayScreen.open(waystones().map((w) => ({ ...w, games: counts.get(w.id) ?? 0 })));
    this.showScreen(this.wayScreen.el, 'waystone');
  }

  private onKey(code: string, e: KeyboardEvent): void {
    if (code === 'Escape') {
      if (this.mode === 'settings' && this.setScreen.capturing) return;
      if (this.mode === 'chest' && this.chestScreen.isEditing) return; // let the form keep focus; use Cancel
      if (this.mode === 'inventory' || this.mode === 'chest' || this.mode === 'waystone' || this.mode === 'pause') this.resumeFromEscape();
      else if (this.mode === 'library' || this.mode === 'settings') this.back();
      return;
    }
    if (code === this.settings.current.keyBindings.camera && this.mode === 'play') {
      e.preventDefault();
      this.cycleCamera();
      return;
    }
    if (code === 'F11') {
      e.preventDefault();
      const s = this.settings.current;
      this.settings.apply({ ...s, fullscreen: !s.fullscreen });
      return;
    }
    const b = this.settings.current.keyBindings;
    if (code === b.interact && !e.ctrlKey) {
      if (this.mode === 'inventory' || (this.mode === 'chest' && !this.chestScreen.isEditing)) {
        this.input.consume(code);
        this.resume();
      }
    }
    if (code === b.debug && this.mode === 'play') this.debugOn = !this.debugOn;
  }

  // ---------------------------------------------------------------- world actions

  private findStandY(x: number, z: number, startY: number): number {
    for (let y = Math.max(1, startY - 4); y < 126; y++) {
      if (SOLID[this.world.getBlock(x, y - 1, z)] && !SOLID[this.world.getBlock(x, y, z)] && !SOLID[this.world.getBlock(x, y + 1, z)]) return y;
    }
    return this.world.surfaceY(x, z) + 1;
  }

  private teleport(x: number, z: number, lookAt?: { x: number; z: number }, y?: number): void {
    this.world.prepareArea(x, z, 1);
    const py = this.findStandY(Math.floor(x), Math.floor(z), y ?? this.world.surfaceY(Math.floor(x), Math.floor(z)) + 1);
    this.player.teleport(x, py, z);
    this.player.flying = false;
    if (lookAt) {
      this.player.yaw = Math.atan2(-(lookAt.x - x), -(lookAt.z - z));
      this.player.pitch = -0.25;
    }
    this.audio.teleport();
  }

  private teleportSpawn(): void {
    this.teleport(0.5, 7.5, { x: 0.5, z: 0.5 }, PLAZA_Y + 1);
  }

  private teleportToChest(id: string): void {
    const p = this.chests.position(id);
    if (!p) return;
    const fx = [0, 1, 0, -1][p.facing], fz = [1, 0, -1, 0][p.facing];
    this.teleport(p.x + 0.5 + fx * 2.5, p.z + 0.5 + fz * 2.5, { x: p.x + 0.5, z: p.z + 0.5 }, p.y);
  }

  private travelTo(d: WaystoneDest): void {
    // arrive just in front of the destination waystone, facing it
    const ang = d.id === 'spawn' ? Math.PI / 2 : Math.atan2(-d.z, -d.x);
    const tx = d.x + 0.5 + Math.cos(ang) * 2.5, tz = d.z + 0.5 + Math.sin(ang) * 2.5;
    this.teleport(tx, tz, { x: d.x + 0.5, z: d.z + 0.5 }, PLAZA_Y + 1);
    this.resume();
  }

  private startCarry(id: string): void {
    const p = this.chests.position(id);
    if (!p) return;
    this.carryFrom = { ...p };
    this.chests.setOpen(id, false);
    this.openChestId = null;
    this.chests.setCarrying(id);
    this.resume();
    this.hud.setCarryHint(`Carrying "${this.chests.get(id)?.title}": right-click a block to place it · ${this.settings.current.keyBindings.interact.replace('Key', '')} to cancel`);
  }

  private cancelCarry(): void {
    const id = this.chests.carrying;
    if (!id) return;
    this.chests.setCarrying(null);
    if (this.carryFrom) this.chests.place(id, this.carryFrom);
    this.carryFrom = null;
    this.hud.setCarryHint(null);
  }

  private placeCarried(): void {
    const id = this.chests.carrying;
    const t = this.interaction.target;
    if (!id || !t || t.dist > REACH) return;
    const x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
    const here = this.world.getBlock(x, y, z);
    if ((here !== B.AIR && blockDef(here).render !== 'cross') || !SOLID[this.world.getBlock(x, y - 1, z)] || this.player.overlapsCell(x, y, z) || this.chests.at(x, y, z)) {
      this.audio.error();
      return;
    }
    if (here !== B.AIR) this.world.setBlock(x, y, z, B.AIR);
    const dx = this.player.pos.x - (x + 0.5), dz = this.player.pos.z - (z + 0.5);
    const facing = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 0 : 2);
    const pos: ChestPos = { x, y, z, facing };
    this.chests.setCarrying(null);
    this.chests.place(id, pos);
    this.carryFrom = null;
    this.hud.setCarryHint(null);
    this.audio.place('wood');
    void this.api.library.update(id, { chest: pos }).then(() => this.reloadLibrary()).catch((e) => this.toasts.show('Could not save chest position', cleanIpcError(e), 'error'));
  }

  private async resetWorld(): Promise<void> {
    this.saves.stop();
    await this.api.world.save({ ...this.collectSave(), mods: [] });
    location.reload();
  }

  private collectSave(): WorldSave {
    return {
      version: 1,
      seed: this.seed,
      mods: this.world.serializeMods(),
      player: { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z, yaw: this.player.yaw, pitch: this.player.pitch },
      inventory: this.inv.serialize(),
      timeOfDay: this.sky.timeOfDay,
    };
  }

  private async quit(): Promise<void> {
    await this.saves.save();
    await this.api.app.quit();
  }

  // ---------------------------------------------------------------- frame

  start(): void {
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    requestAnimationFrame(loop);
  }

  private frame(dt: number): void {
    const playing = this.mode === 'play' && this.input.locked;
    if (playing) this.player.look(this.input);
    this.player.canGlide = this.inv.wearingElytra;
    this.player.update(dt, playing ? this.input : null);
    this.updateFlightEffects(dt);
    this.world.update(this.player.pos.x, this.player.pos.z, this.mode === 'title' ? 12 : 6);

    if (playing) this.gameplay(dt);
    else this.hud.setPrompt('', []);

    const eye = this.player.eye();
    this.sky.update(dt, eye);
    this.chests.update(dt, eye);
    this.particles.update(dt, (x, y, z) => this.world.isSolid(x, y, z));
    this.fireworks.update(dt);
    this.hand.update(dt, this.player.bob, this.player.bobPhase, Math.max(this.sky.daylight, 0.35));
    this.hud.update(dt);
    this.updateRegion();
    const nearWater = this.world.getBlock(Math.floor(eye.x), SEA_LEVEL, Math.floor(eye.z)) === B.WATER;
    this.audio.updateAmbient(this.sky.daylight, eye.y, nearWater);

    // title screen: slowly orbit the camera above spawn for a living backdrop
    if (this.mode === 'title') {
      const t = performance.now() / 20000;
      this.camera.position.set(Math.sin(t) * 26, PLAZA_Y + 14, Math.cos(t) * 26);
      this.camera.lookAt(0, PLAZA_Y + 2, 0);
    } else {
      this.player.applyCamera(this.camera);
      if (this.cameraView !== 0) this.placeThirdPersonCamera();
    }
    const thirdPerson = this.mode !== 'title' && this.cameraView !== 0;
    this.playerModel.visible = thirdPerson;
    this.playerModel.wearingElytra = this.inv.wearingElytra;
    if (thirdPerson) this.playerModel.update(dt, this.player, this.hand.swingAmount, performance.now() / 1000);

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.mode !== 'title' && !thirdPerson) this.hand.render(this.renderer);
    this.input.endFrame();
    this.stats(dt);
  }

  /** Rocket exhaust, the burn-out pop, rushing wind and a speed-based FOV kick while gliding. */
  private updateFlightEffects(dt: number): void {
    const p = this.player;
    const boosting = p.gliding && p.boostTime > 0;
    if (boosting) {
      const look = p.lookDir(this.camDir);
      this.trailPos.set(p.pos.x - look.x * 0.9, p.pos.y + 0.3 - look.y * 0.9, p.pos.z - look.z * 0.9);
      this.fireworks.setTrail(this.trailPos);
    } else this.fireworks.setTrail(null);
    if (this.wasBoosting && !boosting) this.fireworks.fizzle(p.pos.x, p.pos.y + 0.3, p.pos.z);
    this.wasBoosting = boosting;

    const speed = p.gliding ? p.vel.length() : 0;
    this.audio.setGlideWind(speed);
    const want = p.gliding ? Math.min(14, Math.max(0, speed - 8) * 0.5) : 0;
    this.fovKick += (want - this.fovKick) * Math.min(1, dt * 4);
    const fov = this.settings.current.fov + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Right-click with a firework: boost while gliding, otherwise launch it off a block. */
  private useFirework(): boolean {
    if (this.player.boost()) {
      this.inv.consumeHeld();
      this.audio.boost();
      return true;
    }
    const t = this.interaction.target;
    if (!t || t.dist > REACH) return false;
    this.fireworks.launch(t.x + 0.5 + t.nx * 0.6, t.y + 0.5 + t.ny * 0.6, t.z + 0.5 + t.nz * 0.6);
    this.inv.consumeHeld();
    return true;
  }

  private equipElytra(): void {
    if (!this.inv.equipHeld()) return;
    this.audio.wingsOpen();
    this.hud.showHeldName();
    if (!this.elytraHintShown) {
      this.elytraHintShown = true;
      const jump = this.settings.current.keyBindings.jump.replace('Key', '');
      this.toasts.show('Elytra equipped', `Jump off something high, then press ${jump} while falling to glide. Fireworks give you a boost.`, 'success', 7000);
    }
  }

  /** F5: first person → third person (behind) → third person (front) → first person. */
  private cycleCamera(): void {
    this.cameraView = (this.cameraView + 1) % 3;
  }

  /**
   * Pull the camera back from the eye (or out in front of the face), stopping short of any
   * block in the way so walls never hide the player.
   */
  private placeThirdPersonCamera(): void {
    const eye = this.player.eye();
    const dir = this.player.lookDir(this.camDir);
    if (this.cameraView === 1) dir.negate();
    const want = 4;
    const margin = 0.3;
    // cast a few rays (centre + offsets) so the near plane doesn't clip into a block corner
    let dist = want;
    for (const [ox, oy] of [[0, 0], [0.15, 0.15], [-0.15, 0.15], [0.15, -0.15], [-0.15, -0.15]]) {
      const hit = raycastVoxels(eye.x + ox, eye.y + oy, eye.z, dir.x, dir.y, dir.z, want + margin,
        (x, y, z) => this.world.getBlock(x, y, z), (id) => SOLID[id] === 1);
      if (hit) dist = Math.min(dist, Math.max(0.2, hit.dist - margin));
    }
    this.camera.position.set(eye.x + dir.x * dist, eye.y + dir.y * dist, eye.z + dir.z * dist);
    if (this.cameraView === 2) this.camera.rotateY(Math.PI); // face back at the player, keeping any roll
  }

  private gameplay(dt: number): void {
    const inp = this.input;
    // hotbar
    for (let i = 0; i < HOTBAR_SIZE; i++) if (inp.codeDown(`Digit${i + 1}`) && this.inv.selected !== i) { this.inv.select(i); this.hud.showHeldName(); }
    if (inp.wheel) { this.inv.select(this.inv.selected + inp.wheel); this.hud.showHeldName(); }

    const held = itemDef(this.inv.held?.id ?? '');
    const seeker = held?.kind === 'seeker';
    this.interaction.updateTarget(seeker ? SEEKER_REACH : REACH);
    const t = this.interaction.target;
    const chestId = t && t.id === B.CHEST ? this.chests.at(t.x, t.y, t.z) : undefined;
    const chestInReach = chestId && t && (t.dist <= REACH || seeker) ? chestId : undefined;
    const waystone = t && t.id === B.WAYSTONE && t.dist <= REACH;
    const b = this.settings.current.keyBindings;

    // prompts
    if (this.chests.carrying) this.hud.setPrompt('', []);
    else if (chestInReach) {
      const g = this.chests.get(chestInReach)!;
      this.hud.setPrompt(g.title + (this.chests.isRunning(g.id) ? ' (running)' : ''), [[b.interact, 'Open chest'], [b.special, 'Quick play']]);
    } else if (waystone) this.hud.setPrompt('Waystone', [[b.special, 'Fast travel'], ['Right-click', 'Use']]);
    else if (this.player.gliding) {
      const steer: [string, string][] = this.player.flight3dActive ? [['Mouse', 'Roll / pitch'], [b.left, 'Yaw left'], [b.right, 'Yaw right']] : [];
      this.hud.setPrompt('', [...steer, ...(held?.id === FIREWORK_ID ? [['Right-click', 'Boost'] as [string, string]] : []), [b.jump, 'Fold wings']]);
    }
    else if (this.inv.wearingElytra && !this.player.onGround && !this.player.flying && !this.player.inWater && this.player.vel.y < -3) this.hud.setPrompt('', [[b.jump, 'Glide']]);
    else this.hud.setPrompt('', []);

    // left mouse: break (hold) / swing
    if (inp.wasClicked(0)) { this.hand.punch(); this.audio.swish(); }
    if (!this.chests.carrying) this.interaction.tickBreaking(dt, inp.buttons.has(0));
    this.hand.setSwinging(this.interaction.breaking);

    // right mouse: place / use
    if (inp.wasClicked(2)) {
      this.hand.punch();
      if (this.chests.carrying) this.placeCarried();
      else if (chestInReach) this.openChest(chestInReach, false);
      else if (waystone) this.openWaystone();
      else if (held?.kind === 'firework') this.useFirework();
      else if (held?.kind === 'elytra') this.equipElytra();
      else if (seeker) this.openLibrary('play', true);
      else this.interaction.tryPlace();
    }

    if (inp.wasPressed('interact')) {
      if (this.chests.carrying) this.cancelCarry();
      else if (chestInReach && t && t.dist <= REACH) this.openChest(chestInReach, false);
      else this.openInventory();
    }
    if (inp.wasPressed('special')) {
      if (chestInReach) void this.launch(chestInReach);
      else if (waystone) this.openWaystone();
    }
  }

  private updateRegion(): void {
    const p = this.player.pos;
    let region: RegionId | 'spawn' | null = null;
    if (Math.hypot(p.x, p.z) < 18) region = 'spawn';
    else for (const r of REGIONS) if (Math.hypot(p.x - r.cx, p.z - r.cz) < 26) region = r.id;
    if (region && region !== this.currentRegion && this.mode !== 'title') {
      const count = region === 'spawn' ? this.chests.count : this.chests.games().filter((g) => g.category === region).length;
      this.hud.showBanner(region === 'spawn' ? 'Spawn' : REGION_NAMES[region], region === 'spawn' ? `${count} games in this world` : `${count} game chest${count === 1 ? '' : 's'}`);
    }
    if (region) this.currentRegion = region;
    const dirIdx = Math.round(((this.player.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 4)) % 8;
    const area = region === 'spawn' ? 'Spawn' : region ? REGION_NAMES[region] : 'Wilderness';
    this.hud.setCompass(`${area} · ${DIR_NAMES[dirIdx]} · ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`);
  }

  private stats(dt: number): void {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fpsText = `${Math.round(this.fpsFrames / this.fpsTime)} FPS`;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      if (this.settings.current.showFps) this.hud.setFps(this.fpsText);
      if (this.debugOn) {
        const s = this.world.stats();
        const info = this.renderer.info;
        const p = this.player.pos;
        this.hud.setDebug([
          `Blockhold ${this.init.info.version}  ${this.fpsText}`,
          `XYZ ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}  ${this.player.gliding ? `gliding ${this.player.vel.length().toFixed(1)} m/s` : this.player.flying ? 'flying' : this.player.onGround ? 'ground' : 'air'}`,
          `Chunks loaded ${s.loaded}  meshed ${s.meshed}  pending ${s.pendingMesh}`,
          `Draw calls ${info.render.calls}  triangles ${Math.round(info.render.triangles / 1000)}k`,
          `Time ${(this.sky.timeOfDay * 24).toFixed(1)}h  daylight ${this.sky.daylight.toFixed(2)}`,
          `Chests ${this.chests.count}  seed ${this.seed}`,
        ].join('\n'));
      } else this.hud.setDebug(null);
    }
  }

  // ---------------------------------------------------------------- smoke-test hooks

  private debugApi() {
    return {
      state: () => ({
        mode: this.mode, pos: this.player.pos.toArray(), onGround: this.player.onGround, chests: this.chests.count,
        stats: this.world.stats(), fps: this.fpsText, held: this.inv.held, selected: this.inv.selected,
        target: this.interaction.target, games: this.chests.games().map((g) => ({ id: g.id, title: g.title, chest: g.chest })),
      }),
      enter: () => { this.hud.setVisible(true); this.showScreen(null, 'play'); },
      setMode: (m: Mode) => { this.mode = m; },
      /** simulate one physics step with given input; used to test movement/collision */
      simulate: (keys: string[], seconds: number) => {
        const fake = {
          isDown: (a: string) => keys.includes(a), wasPressed: () => false, mouseDX: 0, mouseDY: 0,
        } as unknown as Input;
        const steps = Math.round(seconds * 60);
        for (let i = 0; i < steps; i++) { this.player.update(1 / 60, fake); this.world.update(this.player.pos.x, this.player.pos.z, 50); }
        return this.player.pos.toArray();
      },
      setCameraView: (v: number) => { this.cameraView = v; },
      look: (yaw: number, pitch: number) => { this.player.yaw = yaw; this.player.pitch = pitch; },
      teleport: (x: number, z: number) => this.teleport(x, z),
      teleportToChest: (id: string) => this.teleportToChest(id),
      target: () => { this.interaction.updateTarget(REACH); return this.interaction.target; },
      breakTarget: () => { this.interaction.updateTarget(REACH); for (let i = 0; i < 400 && this.interaction.target; i++) { const k = this.interaction.target; this.interaction.tickBreaking(0.05, true); if (this.world.getBlock(k.x, k.y, k.z) !== k.id) return true; } return false; },
      placeTarget: () => { this.interaction.updateTarget(REACH); return this.interaction.tryPlace(); },
      select: (i: number) => this.inv.select(i),
      getBlock: (x: number, y: number, z: number) => this.world.getBlock(x, y, z),
      openChest: (id: string) => this.openChest(id, false),
      openInventory: () => this.openInventory(),
      openLibrary: () => this.openLibrary('pause'),
      openSettings: () => this.openSettings('pause'),
      openPause: () => this.openPause(),
      resume: () => { this.closeScreenSideEffects(); this.showScreen(null, 'play'); },
      setTime: (t: number) => { this.sky.timeOfDay = t; this.sky.update(0, this.player.eye()); },
      reload: () => this.reloadLibrary(),
      save: () => this.saves.save(),
      ui: () => document.getElementById('ui')?.innerText ?? '',
      clickButton: (text: string) => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text));
        btn?.click();
        return !!btn;
      },
      h,
    };
  }
}
