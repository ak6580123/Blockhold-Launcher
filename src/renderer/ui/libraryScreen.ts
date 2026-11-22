import { REGION_IDS, REGION_NAMES, type DiscoveredGame, type Game, type RegionId, type ScanReport } from '../../shared/types';
import { cleanIpcError } from './chestScreen';
import { button, clear, fmtDate, h } from './dom';

export interface LibraryDeps {
  games(): Game[];
  distanceTo(id: string): number;
  cover(id: string): Promise<string | null>;
  teleportTo(id: string): void;
  openChest(id: string, edit: boolean): void;
  remove(id: string): Promise<void>;
  scan(): Promise<ScanReport>;
  import(list: DiscoveredGame[]): Promise<Game[]>;
  pickExecutable(): Promise<{ exePath: string; installDir: string; title: string } | null>;
  add(input: { exePath: string; title: string; category: RegionId; args: string }): Promise<Game>;
  click(): void;
  close(): void;
}

type Tab = 'games' | 'scan' | 'add';
const SOURCE_SHORT: Record<string, string> = { steam: 'Steam', epic: 'Epic', gog: 'GOG', xbox: 'Xbox', folder: 'Folder', manual: 'Manual' };

/** Game library manager + "Game Seeker" finder. */
export class LibraryScreen {
  readonly el: HTMLElement;
  private panel: HTMLElement;
  private tab: Tab = 'games';
  private filter = '';
  private scanResult: ScanReport | null = null;
  private scanning = false;
  private selected = new Set<number>();
  private finderMode = false;

  constructor(private deps: LibraryDeps) {
    this.panel = h('div', { class: 'panel lib-panel' });
    this.el = h('div', { class: 'screen' }, this.panel);
  }

  open(opts: { finder?: boolean; tab?: Tab } = {}): void {
    this.finderMode = !!opts.finder;
    this.tab = opts.tab ?? 'games';
    this.render();
  }

  refresh(): void {
    if (this.el.isConnected) this.render();
  }

  private render(): void {
    clear(this.panel);
    const tabBtn = (t: Tab, label: string) => h('button', { class: `tab${this.tab === t ? ' active' : ''}`, onclick: () => { this.deps.click(); this.tab = t; this.render(); } }, label);
    this.panel.append(h('h2', {}, this.finderMode ? 'Game Seeker: travel to a game chest' : 'Game Library'));
    if (!this.finderMode) this.panel.append(
      h('div', { class: 'tabs' }, tabBtn('games', `My games (${this.deps.games().length})`), tabBtn('scan', 'Scan for games'), tabBtn('add', 'Add a game manually')),
    );
    if (this.tab === 'games') this.renderGames();
    else if (this.tab === 'scan') this.renderScan();
    else this.renderAdd();
    this.panel.append(h('div', { class: 'btn-row', style: 'margin-top:10px;justify-content:flex-end' }, button('Close', () => this.deps.close())));
  }

  private renderGames(): void {
    const search = h('input', { class: 'mc-input', placeholder: 'Search games…', value: this.filter });
    const list = h('div', { class: 'lib-list' });
    const fill = () => {
      clear(list);
      const q = this.filter.toLowerCase();
      let games = this.deps.games().filter((g) => !q || g.title.toLowerCase().includes(q));
      games = this.finderMode ? games.sort((a, b) => this.deps.distanceTo(a.id) - this.deps.distanceTo(b.id)) : games.sort((a, b) => a.title.localeCompare(b.title));
      if (!games.length) {
        list.append(h('div', { style: 'padding:16px;color:#222' }, this.deps.games().length ? 'No games match your search.' : 'No games yet. Use "Scan for games" or "Add a game manually" to fill your world with chests.'));
        return;
      }
      for (const g of games) {
        const img = h('img', { alt: '' });
        void this.deps.cover(g.id).then((u) => { if (u) img.src = u; });
        const d = Math.round(this.deps.distanceTo(g.id));
        list.append(h('div', { class: 'lib-row' },
          img,
          h('div', {}, h('div', { class: 't' }, g.title), h('div', { class: 's' }, `${SOURCE_SHORT[g.source]} · last played ${fmtDate(g.lastPlayed).toLowerCase()}`)),
          h('div', { class: 'reg' }, REGION_NAMES[g.category], h('br'), `${d} blocks away`),
          h('div', { class: 'btn-row' },
            button('Travel', () => this.deps.teleportTo(g.id), 'small'),
            button('Open', () => this.deps.openChest(g.id, false), 'small'),
            this.finderMode ? null : button('Edit', () => this.deps.openChest(g.id, true), 'small'),
            this.finderMode ? null : button('Remove', async () => { await this.deps.remove(g.id); this.render(); }, 'small danger'),
          )));
      }
    };
    search.addEventListener('input', () => { this.filter = search.value; fill(); });
    fill();
    this.panel.append(h('div', { class: 'field' }, search), list);
    setTimeout(() => search.focus(), 0);
  }

  private renderScan(): void {
    const box = h('div', {});
    this.panel.append(
      h('p', { class: 'muted' }, 'Looks for installed games in Steam, Epic Games, GOG Galaxy, Xbox app (XboxGames folders), common game folders, and the extra folders you add in Settings → Library. Nothing is imported until you choose.'),
      h('div', { class: 'btn-row', style: 'margin-bottom:8px' },
        button(this.scanning ? 'Scanning…' : 'Scan now', () => void this.runScan(), 'play')),
      box,
    );
    if (this.scanning) { box.append(h('div', {}, 'Scanning your drives… this can take a little while.')); return; }
    if (!this.scanResult) return;
    const { found, errors } = this.scanResult;
    for (const e of errors) box.append(h('div', { class: 'status-line err' }, e));
    if (!found.length) { box.append(h('div', { style: 'color:#222' }, 'No new games found. Everything detected is already in your world, or add a game manually.')); return; }
    const list = h('div', { class: 'lib-list' });
    found.forEach((g, i) => {
      const cb = h('input', { type: 'checkbox', checked: this.selected.has(i) });
      cb.addEventListener('change', () => { if (cb.checked) this.selected.add(i); else this.selected.delete(i); });
      const regionSel = h('select', { class: 'mc-input', style: 'width:150px' }, ...REGION_IDS.map((r) => h('option', { value: r, selected: r === g.category }, REGION_NAMES[r])));
      regionSel.addEventListener('change', () => { g.category = regionSel.value as RegionId; });
      list.append(h('div', { class: 'lib-row' }, cb,
        h('div', {}, h('div', { class: 't' }, g.title), h('div', { class: 's' }, `${SOURCE_SHORT[g.source]} · ${g.exePath || g.launchUri || g.installDir}`)),
        regionSel, h('div', {})));
    });
    box.append(
      h('div', { class: 'btn-row', style: 'margin-bottom:6px' },
        button('Select all', () => { found.forEach((_, i) => this.selected.add(i)); this.render(); }, 'small'),
        button('Select none', () => { this.selected.clear(); this.render(); }, 'small')),
      list,
      h('div', { class: 'btn-row', style: 'margin-top:8px' },
        button(`Import ${this.selected.size || ''} selected`.replace('  ', ' '), async () => {
          const pick = found.filter((_, i) => this.selected.has(i));
          if (!pick.length) return;
          await this.deps.import(pick);
          this.scanResult = { found: found.filter((_, i) => !this.selected.has(i)), errors: [] };
          this.selected.clear();
          this.tab = 'games';
          this.render();
        }, 'play')),
    );
  }

  private async runScan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    this.render();
    try {
      this.scanResult = await this.deps.scan();
      this.selected = new Set(this.scanResult.found.map((_, i) => i));
    } catch (e) {
      this.scanResult = { found: [], errors: [cleanIpcError(e)] };
    } finally {
      this.scanning = false;
      if (this.tab === 'scan') this.render();
    }
  }

  private renderAdd(): void {
    const exe = h('input', { class: 'mc-input', placeholder: 'Path to the game executable (.exe, .lnk, .url, .bat)' });
    const title = h('input', { class: 'mc-input', placeholder: 'Game title' });
    const args = h('input', { class: 'mc-input', placeholder: 'Launch arguments (optional)' });
    const region = h('select', { class: 'mc-input' }, h('option', { value: '' }, 'Auto-detect from title'), ...REGION_IDS.map((r) => h('option', { value: r }, REGION_NAMES[r])));
    const status = h('div', { class: 'status-line' });
    this.panel.append(
      h('p', { class: 'muted' }, 'Any game works, wherever it is installed. A new chest appears in the region you choose.'),
      h('div', { class: 'field' }, h('label', {}, 'Executable'), h('div', { class: 'field-row' }, exe, button('Browse…', async () => {
        const p = await this.deps.pickExecutable();
        if (p) { exe.value = p.exePath; if (!title.value) title.value = p.title; }
      }, 'small'))),
      h('div', { class: 'field' }, h('label', {}, 'Title'), title),
      h('div', { class: 'field' }, h('label', {}, 'Arguments'), args),
      h('div', { class: 'field' }, h('label', {}, 'Region'), region),
      status,
      button('Add game', async () => {
        if (!exe.value.trim()) { status.textContent = 'Choose an executable first.'; status.className = 'status-line err'; return; }
        try {
          const g = await this.deps.add({ exePath: exe.value.trim(), title: title.value.trim(), category: region.value as RegionId, args: args.value });
          status.textContent = `${g.title} added to ${REGION_NAMES[g.category]}.`;
          status.className = 'status-line ok';
          exe.value = ''; title.value = ''; args.value = '';
        } catch (e) {
          status.textContent = cleanIpcError(e);
          status.className = 'status-line err';
        }
      }, 'play'),
    );
  }
}
