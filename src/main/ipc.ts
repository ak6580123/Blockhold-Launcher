import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { IPC, type AppInfo } from '../shared/api';
import { guessCategory } from '../shared/categorize';
import type { DiscoveredGame, Game, Settings, WorldSave } from '../shared/types';
import { COVER_EXTS, CoverCache } from './covers';
import { scanAll } from './discovery';
import { prettifyFolderName } from './discovery/util';
import type { GameLauncher } from './launcher';
import type { GameLibrary } from './library';
import { SkinStore } from './skin';
import type { JsonStore } from './store';
import { EXECUTABLE_EXTS, validateExecutablePath, validatePatch, validateSettings, validateWorldSave, isAllowedUri, validateDirectory } from './validate';

export interface IpcContext {
  getWindow(): BrowserWindow | null;
  library: GameLibrary;
  launcher: GameLauncher;
  settingsStore: JsonStore<Settings>;
  worldStore: JsonStore<WorldSave | null>;
  appInfo: AppInfo;
  appDir: string;
  onQuit(): void;
  onSaveDone(): void;
  getSettings(): Settings;
  setSettings(s: Settings): void;
}

export const APP_ORIGIN = 'app://launcher';

/** Reject IPC from anything other than our own bundled UI. */
function assertSender(e: IpcMainInvokeEvent): void {
  const url = e.senderFrame?.url ?? '';
  if (!url.startsWith(`${APP_ORIGIN}/`)) throw new Error(`Blocked IPC from untrusted origin: ${url}`);
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, async (e, ...args) => {
    assertSender(e);
    return fn(...(args as A));
  });
}

const id = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[\w-]{1,64}$/.test(v)) throw new Error('Invalid id');
  return v;
};

export function registerIpc(ctx: IpcContext): void {
  const covers = new CoverCache();
  const { library, launcher } = ctx;

  handle(IPC.libraryList, () => library.list());

  handle(IPC.libraryAdd, (input: unknown) => {
    const o = (input ?? {}) as Partial<Game>;
    const exePath = validateExecutablePath(String(o.exePath ?? ''));
    const title = (typeof o.title === 'string' && o.title.trim()) || prettifyFolderName(path.basename(exePath, path.extname(exePath)));
    const ext = path.extname(exePath).toLowerCase();
    const d: DiscoveredGame = {
      title,
      source: 'manual',
      installDir: path.dirname(exePath),
      exePath,
      args: typeof o.args === 'string' ? o.args.slice(0, 2000) : '',
      workingDir: '',
      launchMethod: ext === '.lnk' || ext === '.url' ? 'shell' : 'exe',
      description: typeof o.description === 'string' ? o.description.slice(0, 4000) : '',
      category: guessCategory(title),
    };
    if (o.category) Object.assign(d, validatePatch({ category: o.category }));
    return library.add(d, ctx.getSettings().defaultChestStyle);
  });

  handle(IPC.libraryUpdate, (gid: unknown, patch: unknown) => {
    const g = library.update(id(gid), validatePatch(patch));
    covers.invalidate(g.id);
    return g;
  });

  handle(IPC.libraryRemove, (gid: unknown) => library.remove(id(gid)));

  handle(IPC.libraryScan, () => scanAll(ctx.getSettings(), (g) => library.has(g), [ctx.appDir]));

  handle(IPC.libraryImport, (list: unknown) => {
    if (!Array.isArray(list)) throw new Error('Expected a list of games');
    const style = ctx.getSettings().defaultChestStyle;
    const added: Game[] = [];
    for (const raw of list.slice(0, 500)) {
      const r = (raw ?? {}) as DiscoveredGame;
      // Re-validate everything the renderer echoes back from a scan.
      const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 200) : null;
      if (!title) continue;
      const d: DiscoveredGame = {
        title,
        source: ['steam', 'epic', 'gog', 'xbox', 'folder'].includes(r.source) ? r.source : 'folder',
        sourceId: typeof r.sourceId === 'string' ? r.sourceId.slice(0, 200) : undefined,
        installDir: '', exePath: '', args: typeof r.args === 'string' ? r.args.slice(0, 2000) : '', workingDir: '',
        launchMethod: 'exe', description: '', category: guessCategory(title),
      };
      try {
        if (r.installDir) d.installDir = validateDirectory(r.installDir);
        if (r.exePath) d.exePath = validateExecutablePath(r.exePath);
        if (r.workingDir) d.workingDir = validateDirectory(r.workingDir);
      } catch { continue; }
      const p = validatePatch({ launchMethod: r.launchMethod, category: r.category });
      d.launchMethod = p.launchMethod ?? 'exe';
      d.category = p.category ?? d.category;
      if (r.launchUri && isAllowedUri(r.launchUri)) d.launchUri = r.launchUri;
      if (typeof r.aumid === 'string' && /^[\w.\-]+_[a-z0-9]+![\w.\-]+$/i.test(r.aumid)) d.aumid = r.aumid;
      if (typeof r.coverPath === 'string' && COVER_EXTS.includes(path.extname(r.coverPath).toLowerCase()) && fs.existsSync(r.coverPath)) d.coverPath = r.coverPath;
      if (d.launchMethod === 'uri' && !d.launchUri) d.launchMethod = 'exe';
      if (d.launchMethod === 'exe' && !d.exePath) continue;
      if (library.has(d)) continue;
      added.push(library.add(d, style));
    }
    return added;
  });

  handle(IPC.libraryCover, async (gid: unknown) => {
    const g = library.get(id(gid));
    return g ? covers.get(g) : null;
  });

  handle(IPC.libraryPickCover, async (gid: unknown) => {
    const g = library.get(id(gid));
    if (!g) throw new Error('Game not found');
    const win = ctx.getWindow();
    const res = await dialog.showOpenDialog(win!, {
      title: `Choose cover art for ${g.title}`,
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: COVER_EXTS.map((e) => e.slice(1)) }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    covers.invalidate(g.id);
    return library.setCover(g.id, res.filePaths[0]);
  });

  handle(IPC.libraryOpenFolder, async (gid: unknown) => {
    const g = library.get(id(gid));
    const dir = g?.installDir || (g?.exePath ? path.dirname(g.exePath) : '');
    if (!dir || !fs.existsSync(dir)) return 'Install folder not found';
    const err = await shell.openPath(dir);
    return err || null;
  });

  handle(IPC.pickExecutable, async () => {
    const res = await dialog.showOpenDialog(ctx.getWindow()!, {
      title: 'Choose a game executable',
      properties: ['openFile'],
      filters: [{ name: 'Games and shortcuts', extensions: EXECUTABLE_EXTS.map((e) => e.slice(1)) }],
    });
    const p = res.filePaths[0];
    if (res.canceled || !p) return null;
    return { exePath: p, installDir: path.dirname(p), title: prettifyFolderName(path.basename(p, path.extname(p))) };
  });

  handle(IPC.pickDirectory, async () => {
    const res = await dialog.showOpenDialog(ctx.getWindow()!, { properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0] ?? null;
  });

  handle(IPC.launch, (gid: unknown, configId: unknown, force: unknown) =>
    launcher.launch(id(gid), typeof configId === 'string' && configId ? configId : undefined, force === true));
  handle(IPC.running, () => launcher.statuses());

  handle(IPC.settingsGet, () => ctx.getSettings());
  handle(IPC.settingsSet, (s: unknown) => {
    const v = validateSettings(s);
    ctx.setSettings(v);
    return v;
  });

  handle(IPC.worldLoad, () => {
    const w = ctx.worldStore.read();
    try { return w ? validateWorldSave(w) : null; } catch { return null; }
  });
  handle(IPC.worldSave, (w: unknown) => { ctx.worldStore.write(validateWorldSave(w)); });
  handle(IPC.worldReset, () => { ctx.worldStore.delete(); });

  handle(IPC.windowFullscreen, (on: unknown) => { ctx.getWindow()?.setFullScreen(on === true); });
  handle(IPC.windowSize, (w: unknown, h: unknown) => {
    const win = ctx.getWindow();
    if (!win || typeof w !== 'number' || typeof h !== 'number') return;
    if (win.isFullScreen()) return;
    win.setSize(Math.max(800, Math.min(7680, Math.round(w))), Math.max(600, Math.min(4320, Math.round(h))));
    win.center();
  });

  const skins = new SkinStore(ctx.appInfo.userDataDir);
  handle(IPC.skinGet, () => skins.get());
  handle(IPC.skinPick, async () => {
    const res = await dialog.showOpenDialog(ctx.getWindow()!, {
      title: 'Choose a skin (64×64 PNG)',
      properties: ['openFile'],
      filters: [{ name: 'Skin images', extensions: ['png'] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return skins.set(res.filePaths[0]);
  });
  handle(IPC.skinReset, () => skins.reset());
  handle(IPC.skinFetch, (name: unknown) => skins.fetchByName(typeof name === 'string' ? name.trim() : ''));

  handle(IPC.appInfo, () => ctx.appInfo);
  handle(IPC.appQuit, () => ctx.onQuit());
  ipcMain.on(IPC.appSaveDone, (e) => {
    if ((e.senderFrame?.url ?? '').startsWith(`${APP_ORIGIN}/`)) ctx.onSaveDone();
  });

  launcher.on('status', (s) => ctx.getWindow()?.webContents.send(IPC.gameStatus, s));
}
