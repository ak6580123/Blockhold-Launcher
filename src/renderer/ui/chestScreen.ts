import {
  CHEST_STYLES, LAUNCH_METHODS, REGION_IDS, REGION_NAMES,
  type Game, type GamePatch, type GameStatus, type LaunchConfig, type LaunchResult,
} from '../../shared/types';
import { button, clear, fmtDate, fmtPlaytime, h } from './dom';

export interface ChestDeps {
  launch(id: string, configId: string | undefined, force: boolean): Promise<LaunchResult>;
  update(id: string, patch: GamePatch): Promise<Game>;
  remove(id: string): Promise<void>;
  move(id: string): void;
  openFolder(id: string): Promise<string | null>;
  pickCover(id: string): Promise<Game | null>;
  pickExecutable(): Promise<{ exePath: string; installDir: string; title: string } | null>;
  pickDirectory(): Promise<string | null>;
  cover(id: string): Promise<string | null>;
  isRunning(id: string): boolean;
  close(): void;
  click(): void;
}

const SOURCE_NAMES: Record<Game['source'], string> = {
  steam: 'Steam', epic: 'Epic Games', gog: 'GOG', xbox: 'Xbox / Microsoft Store', folder: 'Folder scan', manual: 'Added manually',
};
const METHOD_NAMES: Record<Game['launchMethod'], string> = {
  exe: 'Run executable directly', uri: 'Through store client (URI)', shell: 'Open shortcut (.lnk/.url/.bat)', appx: 'Packaged app (AUMID)',
};

/** The UI shown when a game chest is opened. */
export class ChestScreen {
  readonly el: HTMLElement;
  private panel: HTMLElement;
  private game: Game | null = null;
  private status: HTMLElement;
  private configId = '';
  private editing = false;
  private busy = false;

  constructor(private deps: ChestDeps) {
    this.panel = h('div', { class: 'panel chest-panel' });
    this.status = h('div', { class: 'status-line' });
    this.el = h('div', { class: 'screen dim-light' }, this.panel);
  }

  get gameId(): string | null {
    return this.game?.id ?? null;
  }

  get isEditing(): boolean {
    return this.editing;
  }

  open(game: Game, edit = false): void {
    this.game = game;
    this.editing = edit;
    this.configId = '';
    this.status.textContent = '';
    this.status.className = 'status-line';
    this.render();
  }

  setGame(game: Game): void {
    if (this.game?.id !== game.id) return;
    this.game = game;
    if (!this.editing) this.render();
  }

  onStatus(s: GameStatus): void {
    if (!this.game || s.id !== this.game.id) return;
    this.game = { ...this.game, playtimeSeconds: s.playtimeSeconds, lastPlayed: s.lastPlayed ?? this.game.lastPlayed };
    if (s.error) this.setStatus(s.error, 'err');
    if (!this.editing) this.render();
  }

  private setStatus(text: string, kind: 'ok' | 'err' | '' = ''): void {
    this.status.textContent = text;
    this.status.className = `status-line ${kind}`;
  }

  private render(): void {
    clear(this.panel);
    if (!this.game) return;
    if (this.editing) this.renderEdit(this.game); else this.renderView(this.game);
  }

  private renderView(g: Game): void {
    const running = this.deps.isRunning(g.id);
    const cover = h('div', { class: 'cover-slot' }, h('div', { class: 'no-cover' }, '?'));
    void this.deps.cover(g.id).then((url) => {
      if (url && this.game?.id === g.id) { clear(cover); cover.append(h('img', { src: url, alt: '' })); }
    });
    const row = (k: string, v: string | HTMLElement, cls = '') => h('tr', {}, h('td', {}, k), h('td', { class: cls }, v));
    const method = g.launchMethod === 'uri' ? `${METHOD_NAMES.uri}` : METHOD_NAMES[g.launchMethod];

    const play = button(running ? '▶ Running…' : '▶ Play', () => void this.play(false), 'play');
    play.disabled = running || this.busy;
    const actions = h('div', { class: 'btn-row', style: 'align-items:center;margin-top:6px' }, play);
    if (running) actions.append(button('Launch another instance', () => void this.play(true), 'small'));
    let configSel: HTMLSelectElement | null = null;
    if (g.launchConfigs.length) {
      configSel = h('select', { class: 'mc-input', style: 'width:auto;min-width:200px' },
        h('option', { value: '' }, 'Default configuration'),
        ...g.launchConfigs.map((c) => h('option', { value: c.id, selected: c.id === this.configId }, c.name)));
      configSel.addEventListener('change', () => { this.configId = configSel!.value; });
      actions.append(configSel);
    }

    this.panel.append(
      h('div', { class: 'chest-head' },
        h('h2', {}, `Chest · ${g.title}`),
        running ? h('span', { class: 'running-badge' }, 'RUNNING') : null),
      h('div', { class: 'chest-body' },
        cover,
        h('div', {},
          g.description ? h('div', { class: 'game-desc' }, g.description) : h('div', { class: 'game-desc muted' }, 'No description. Use Edit to add one.'),
          h('table', { class: 'info-table' },
            row('Region', REGION_NAMES[g.category]),
            row('Source', SOURCE_NAMES[g.source]),
            row('Launch', method),
            row('Playtime', fmtPlaytime(g.playtimeSeconds)),
            row('Last played', fmtDate(g.lastPlayed)),
            row('Install folder', g.installDir || '—', 'path'),
            row('Executable', g.exePath || '—', 'path'),
            g.launchMethod === 'uri' ? row('Store URI', g.launchUri || '—', 'path') : null,
            g.launchMethod === 'appx' ? row('App id', g.aumid || '—', 'path') : null,
            row('Arguments', g.args || '(none)', 'path'),
            g.workingDir ? row('Working dir', g.workingDir, 'path') : null,
          ),
          actions,
          this.status,
          h('div', { class: 'btn-row' },
            button('Edit', () => { this.deps.click(); this.editing = true; this.render(); }, 'small'),
            button('Open folder', async () => { const err = await this.deps.openFolder(g.id); if (err) this.setStatus(err, 'err'); }, 'small'),
            button('Move chest', () => { this.deps.click(); this.deps.move(g.id); }, 'small'),
            button('Change cover', async () => {
              const upd = await this.deps.pickCover(g.id);
              if (upd) { this.game = upd; this.render(); }
            }, 'small'),
            button('Remove from launcher', () => void this.confirmRemove(g), 'small danger'),
            button('Close', () => this.deps.close(), 'small'),
          ),
        ),
      ),
    );
  }

  private async play(force: boolean): Promise<void> {
    if (!this.game || this.busy) return;
    this.busy = true;
    this.setStatus(`Launching ${this.game.title}…`);
    try {
      const res = await this.deps.launch(this.game.id, this.configId || undefined, force);
      if (res.ok) this.setStatus(`${this.game.title} is starting. Have fun!`, 'ok');
      else if (res.alreadyRunning) this.setStatus(`${this.game.title} is already running.`, 'err');
      else this.setStatus(res.error ?? 'Launch failed', 'err');
    } catch (e) {
      this.setStatus((e as Error).message, 'err');
    } finally {
      this.busy = false;
      if (!this.editing) {
        const s = this.status.textContent ?? '';
        const cls = this.status.className;
        this.render();
        this.status.textContent = s;
        this.status.className = cls;
      }
    }
  }

  private async confirmRemove(g: Game): Promise<void> {
    clear(this.panel);
    this.panel.append(
      h('h2', {}, `Remove ${g.title}?`),
      h('p', {}, 'The chest disappears from your world. The game itself stays installed on your computer, and you can import it again any time.'),
      h('div', { class: 'btn-row' },
        button('Remove chest', async () => { await this.deps.remove(g.id); this.deps.close(); }, 'danger'),
        button('Cancel', () => this.render())),
    );
  }

  private renderEdit(g: Game): void {
    const inp = (value: string, placeholder = '') => h('input', { class: 'mc-input', value, placeholder });
    const title = inp(g.title);
    const desc = h('textarea', { class: 'mc-input', placeholder: 'Optional description' });
    desc.value = g.description;
    const region = h('select', { class: 'mc-input' }, ...REGION_IDS.map((r) => h('option', { value: r, selected: r === g.category }, REGION_NAMES[r])));
    const style = h('select', { class: 'mc-input' }, ...CHEST_STYLES.map((s) => h('option', { value: s, selected: s === g.chestStyle }, s[0].toUpperCase() + s.slice(1))));
    const method = h('select', { class: 'mc-input' }, ...LAUNCH_METHODS.map((m) => h('option', { value: m, selected: m === g.launchMethod }, METHOD_NAMES[m])));
    const exe = inp(g.exePath, 'C:\\Games\\MyGame\\Game.exe');
    const args = inp(g.args, 'e.g. -windowed -novid');
    const wd = inp(g.workingDir, 'Defaults to the executable folder');
    const uri = inp(g.launchUri ?? '', 'steam://rungameid/12345');
    const configs: LaunchConfig[] = g.launchConfigs.map((c) => ({ ...c }));
    const cfgBox = h('div', {});
    const renderConfigs = () => {
      clear(cfgBox);
      configs.forEach((c, i) => {
        const n = inp(c.name, 'Name');
        const a = inp(c.args, 'Arguments');
        const w = inp(c.workingDir, 'Working dir (optional)');
        n.addEventListener('input', () => { c.name = n.value; });
        a.addEventListener('input', () => { c.args = a.value; });
        w.addEventListener('input', () => { c.workingDir = w.value; });
        cfgBox.append(h('div', { class: 'field-row', style: 'margin-bottom:4px' }, n, a, w,
          button('✕', () => { configs.splice(i, 1); renderConfigs(); }, 'small danger')));
      });
    };
    renderConfigs();
    const field = (label: string, ...el: HTMLElement[]) => h('div', { class: 'field' }, h('label', {}, label), el.length > 1 ? h('div', { class: 'field-row' }, ...el) : el[0]);

    this.panel.append(
      h('h2', {}, `Edit · ${g.title}`),
      h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:0 16px' },
        h('div', {},
          field('Title', title),
          field('Description', desc),
          field('Region (where the chest lives)', region),
          field('Chest appearance', style),
        ),
        h('div', {},
          field('Launch method', method),
          field('Executable', exe, button('Browse…', async () => {
            const p = await this.deps.pickExecutable();
            if (p) { exe.value = p.exePath; if (!wd.value) wd.placeholder = p.installDir; }
          }, 'small')),
          field('Launch arguments', args),
          field('Working directory', wd, button('Browse…', async () => { const d = await this.deps.pickDirectory(); if (d) wd.value = d; }, 'small')),
          field('Store URI (for "Through store client")', uri),
        ),
      ),
      h('h3', {}, 'Custom launch configurations'),
      cfgBox,
      button('+ Add configuration', () => { configs.push({ id: `cfg-${Date.now().toString(36)}`, name: `Config ${configs.length + 1}`, args: '', workingDir: '' }); renderConfigs(); }, 'small'),
      this.status,
      h('div', { class: 'btn-row' },
        button('Save', async () => {
          const patch: GamePatch = {
            title: title.value.trim(), description: desc.value, category: region.value as Game['category'], chestStyle: style.value as Game['chestStyle'],
            launchMethod: method.value as Game['launchMethod'], exePath: exe.value.trim(), args: args.value, workingDir: wd.value.trim(),
            launchUri: uri.value.trim(), launchConfigs: configs,
          };
          try {
            const updated = await this.deps.update(g.id, patch);
            this.game = updated;
            this.editing = false;
            this.render();
            this.setStatus('Saved.', 'ok');
          } catch (e) {
            this.setStatus(cleanIpcError(e), 'err');
          }
        }, 'play'),
        button('Cancel', () => { this.editing = false; this.render(); }),
      ),
    );
  }
}

/** Electron prefixes errors thrown in main handlers; show only the useful part. */
export function cleanIpcError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
