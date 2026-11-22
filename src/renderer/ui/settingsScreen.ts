import { ACTIONS, ACTION_LABELS, CHEST_STYLES, DEFAULT_SETTINGS, type Action, type ChestStyle, type Settings } from '../../shared/types';
import { drawSkinPreview } from '../player/skin';
import { button, clear, h, keyLabel } from './dom';

/** Strip Electron's "Error invoking remote method ..." wrapper from IPC errors. */
function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export interface SettingsDeps {
  get(): Settings;
  apply(s: Settings): void;
  setTime(t: number): void;
  resetWorld(): Promise<void>;
  applyChestStyleToAll(style: ChestStyle): Promise<void>;
  pickDirectory(): Promise<string | null>;
  skin: {
    canvas(): HTMLCanvasElement;
    isDefault(): boolean;
    /** file picker; resolves true when a skin was equipped */
    pick(): Promise<boolean>;
    fetchByName(name: string): Promise<void>;
    reset(): Promise<void>;
    onChange(fn: () => void): void;
  };
  click(): void;
  close(): void;
}

type Tab = 'controls' | 'video' | 'audio' | 'world' | 'skin' | 'library';
const WINDOW_SIZES = ['1280x720', '1366x768', '1600x900', '1920x1080', '2560x1440'];

export class SettingsScreen {
  readonly el: HTMLElement;
  private panel: HTMLElement;
  private tab: Tab = 'controls';
  private listening: Action | null = null;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);

  private skinStatus = '';
  private skinName = '';
  private skinBusy = false;

  constructor(private deps: SettingsDeps) {
    this.panel = h('div', { class: 'panel settings-panel' });
    this.el = h('div', { class: 'screen' }, this.panel);
    // the skin finishes loading asynchronously; refresh the preview if it's on screen
    deps.skin.onChange(() => { if (this.el.isConnected && this.tab === 'skin') this.render(); });
  }

  private renderSkinTab(): void {
    const s = this.deps.get();
    const preview = h('canvas', { class: 'skin-preview', width: 160, height: 340 });
    drawSkinPreview(preview, this.deps.skin.canvas(), s.skinModel);

    const status = h('p', { class: `muted skin-status${this.skinStatus.startsWith('!') ? ' error' : ''}` }, this.skinStatus.replace(/^!/, ''));
    const run = async (label: string, fn: () => Promise<string | null>) => {
      if (this.skinBusy) return;
      this.skinBusy = true;
      this.skinStatus = label;
      this.render();
      try {
        const msg = await fn();
        if (msg !== null) this.skinStatus = msg;
      } catch (e) {
        this.skinStatus = '!' + cleanError(e);
      } finally {
        this.skinBusy = false;
        if (this.el.isConnected && this.tab === 'skin') this.render();
      }
    };

    const nameInput = h('input', { class: 'mc-input', type: 'text', placeholder: 'Minecraft username', maxlength: 16, value: this.skinName, spellcheck: false });
    nameInput.addEventListener('input', () => { this.skinName = nameInput.value; });
    const fetchIt = () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      this.deps.click();
      void run(`Looking up ${name}…`, async () => { await this.deps.skin.fetchByName(name); return `Wearing ${name}'s skin.`; });
    };
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fetchIt(); } });

    const grid = h('div', { class: 'set-grid' });
    grid.append(...this.select('Arm style', 'skinModel', [['classic', 'Classic (wide arms)'], ['slim', 'Slim (thin arms)']], (v) => { this.set('skinModel', v as Settings['skinModel']); this.render(); }));

    this.panel.append(
      h('div', { class: 'skin-tab' },
        h('div', { class: 'skin-preview-wrap' }, preview, h('div', { class: 'muted' }, this.deps.skin.isDefault() ? 'Built-in skin' : 'Custom skin')),
        h('div', { class: 'skin-controls' },
          h('h3', {}, 'Get a skin by username'),
          h('p', { class: 'muted' }, 'Type any Minecraft player\'s name to wear their current skin. Skin sites list the username a skin belongs to.'),
          h('div', { class: 'btn-row' }, nameInput, button(this.skinBusy ? 'Working…' : 'Get skin', fetchIt, 'small')),
          h('h3', {}, 'Upload a skin file'),
          h('p', { class: 'muted' }, 'Any 64×64 (or old 64×32) skin PNG.'),
          h('div', { class: 'btn-row' },
            button('Choose PNG…', () => void run('Opening…', async () => (await this.deps.skin.pick()) ? 'Skin equipped.' : '' ), 'small'),
            button('Use built-in skin', () => void run('Resetting…', async () => { await this.deps.skin.reset(); return 'Back to the built-in skin.'; }), 'small')),
          grid,
          status,
          h('p', { class: 'muted' }, `Press ${keyLabel(s.keyBindings.camera)} in game to switch between first person, third person and front view.`))));
  }

  open(): void {
    window.addEventListener('keydown', this.keyHandler, true);
    this.render();
  }

  close(): void {
    window.removeEventListener('keydown', this.keyHandler, true);
    this.listening = null;
  }

  /** true while waiting for a key to bind (so Esc doesn't close the screen) */
  get capturing(): boolean {
    return this.listening !== null;
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.listening) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code !== 'Escape') {
      const s = this.deps.get();
      this.deps.apply({ ...s, keyBindings: { ...s.keyBindings, [this.listening]: e.code } });
    }
    this.listening = null;
    this.render();
  }

  private set<K extends keyof Settings>(k: K, v: Settings[K]): void {
    this.deps.apply({ ...this.deps.get(), [k]: v });
  }

  private slider(label: string, k: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string): HTMLElement[] {
    const s = this.deps.get();
    const val = h('div', { class: 'v' }, fmt(s[k] as number));
    const r = h('input', { type: 'range', min, max, step, value: String(s[k]) });
    r.addEventListener('input', () => { val.textContent = fmt(Number(r.value)); this.set(k, Number(r.value) as never); });
    return [h('div', {}, label), r, val];
  }

  private check(label: string, k: keyof Settings): HTMLElement[] {
    const c = h('input', { type: 'checkbox', checked: !!this.deps.get()[k] });
    c.addEventListener('change', () => this.set(k, c.checked as never));
    return [h('div', {}, label), h('div', {}, c), h('div', {})];
  }

  private select(label: string, k: keyof Settings, options: [string, string][], onChange?: (v: string) => void): HTMLElement[] {
    const cur = String(this.deps.get()[k]);
    const sel = h('select', { class: 'mc-input' }, ...options.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)));
    sel.addEventListener('change', () => { if (onChange) onChange(sel.value); else this.set(k, sel.value as never); });
    return [h('div', {}, label), sel, h('div', {})];
  }

  private render(): void {
    clear(this.panel);
    const tabBtn = (t: Tab, label: string) => h('button', { class: `tab${this.tab === t ? ' active' : ''}`, onclick: () => { this.deps.click(); this.tab = t; this.render(); } }, label);
    this.panel.append(h('h2', {}, 'Settings'),
      h('div', { class: 'tabs' }, tabBtn('controls', 'Controls'), tabBtn('video', 'Video'), tabBtn('audio', 'Audio'), tabBtn('world', 'World & Chests'), tabBtn('skin', 'Skin'), tabBtn('library', 'Library')));
    const grid = h('div', { class: 'set-grid' });
    const s = this.deps.get();
    switch (this.tab) {
      case 'controls': {
        grid.append(...this.slider('Mouse sensitivity', 'mouseSensitivity', 0.1, 3, 0.05, (v) => `${Math.round(v * 100)}%`));
        grid.append(...this.check('Invert mouse Y', 'invertY'));
        for (const a of ACTIONS) {
          const b = h('button', { class: `mc-btn small keybind${this.listening === a ? ' listening' : ''}` }, this.listening === a ? 'Press a key…' : keyLabel(s.keyBindings[a]));
          b.addEventListener('click', () => { this.deps.click(); this.listening = a; this.render(); });
          grid.append(h('div', {}, ACTION_LABELS[a]), h('div', {}, b), h('div', {}));
        }
        this.panel.append(grid,
          h('p', { class: 'muted' }, 'Fixed keys: 1–9 / mouse wheel select hotbar slots · Left click break · Right click place / use · Double-tap Jump to fly · Esc pause'),
          button('Reset key bindings', () => { this.set('keyBindings', { ...DEFAULT_SETTINGS.keyBindings }); this.render(); }, 'small'));
        break;
      }
      case 'video': {
        grid.append(...this.slider('Field of view', 'fov', 50, 110, 1, (v) => `${v}°`));
        grid.append(...this.select('Graphics quality', 'graphics', [['low', 'Low (no shadows)'], ['medium', 'Medium'], ['high', 'High (sharp shadows)']]));
        grid.append(...this.slider('Render distance', 'renderDistance', 2, 12, 1, (v) => `${v} chunks`));
        grid.append(...this.slider('Render scale', 'renderScale', 0.4, 1, 0.05, (v) => `${Math.round(v * 100)}%`));
        grid.append(...this.select('Window size', 'windowSize', WINDOW_SIZES.map((w) => [w, w.replace('x', ' × ')])));
        grid.append(...this.check('Fullscreen', 'fullscreen'));
        grid.append(...this.check('Show FPS counter', 'showFps'));
        this.panel.append(grid);
        break;
      }
      case 'audio':
        grid.append(...this.slider('Master volume', 'masterVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`));
        grid.append(...this.slider('Effects', 'sfxVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`));
        grid.append(...this.slider('Ambience', 'ambientVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`));
        this.panel.append(grid);
        break;
      case 'world': {
        grid.append(...this.check('Day / night cycle', 'dayNightCycle'));
        grid.append(...this.slider('Day length', 'dayLengthMinutes', 2, 120, 1, (v) => `${v} min`));
        grid.append(...this.select('Default chest style', 'defaultChestStyle', CHEST_STYLES.map((c) => [c, c[0].toUpperCase() + c.slice(1)])));
        this.panel.append(grid,
          h('h3', {}, 'Time of day'),
          h('div', { class: 'btn-row' },
            button('Sunrise', () => this.deps.setTime(0.02), 'small'), button('Noon', () => this.deps.setTime(0.25), 'small'),
            button('Sunset', () => this.deps.setTime(0.48), 'small'), button('Midnight', () => this.deps.setTime(0.75), 'small')),
          h('h3', {}, 'Chests'),
          h('div', { class: 'btn-row' }, button(`Apply "${s.defaultChestStyle}" style to every chest`, () => void this.deps.applyChestStyleToAll(this.deps.get().defaultChestStyle), 'small')),
          h('p', { class: 'muted' }, 'Individual chests can be restyled, moved or assigned to another region from their Edit screen.'),
          h('h3', {}, 'Reset world'),
          button('Undo all block edits (keeps games & chests)', async () => {
            if (confirm('Restore the world to its original state? Your games and chest positions are kept.')) await this.deps.resetWorld();
          }, 'small danger'));
        break;
      }
      case 'skin':
        this.renderSkinTab();
        break;
      case 'library': {
        const dirs = h('div', { class: 'dir-list' });
        if (!s.scanDirectories.length) dirs.append(h('div', { class: 'dir-item' }, 'No extra folders. Common folders like C:\\Games are checked automatically.'));
        for (const d of s.scanDirectories) {
          dirs.append(h('div', { class: 'dir-item' }, d, button('Remove', () => { this.set('scanDirectories', s.scanDirectories.filter((x) => x !== d)); this.render(); }, 'small danger')));
        }
        const src = (k: keyof Settings['enabledSources'], label: string) => {
          const c = h('input', { type: 'checkbox', checked: s.enabledSources[k] });
          c.addEventListener('change', () => this.set('enabledSources', { ...this.deps.get().enabledSources, [k]: c.checked }));
          return [h('div', {}, label), h('div', {}, c), h('div', {})];
        };
        grid.append(...src('steam', 'Scan Steam'), ...src('epic', 'Scan Epic Games'), ...src('gog', 'Scan GOG Galaxy'), ...src('xbox', 'Scan Xbox / Microsoft Store'));
        grid.append(...this.check('Scan for new games on startup', 'autoScanOnStartup'));
        this.panel.append(
          h('h3', {}, 'Extra game folders (each sub-folder = one game)'),
          dirs,
          button('+ Add folder', async () => {
            const d = await this.deps.pickDirectory();
            if (d && !this.deps.get().scanDirectories.includes(d)) { this.set('scanDirectories', [...this.deps.get().scanDirectories, d]); this.render(); }
          }, 'small'),
          h('h3', {}, 'Sources'), grid);
        break;
      }
    }
    this.panel.append(h('div', { class: 'btn-row', style: 'margin-top:12px;justify-content:flex-end' }, button('Done', () => this.deps.close())));
  }
}
