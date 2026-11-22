import { app, BrowserWindow, Menu, net, protocol, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPC } from '../shared/api';
import { DEFAULT_SETTINGS, type Settings, type WorldSave } from '../shared/types';
import { APP_ORIGIN, registerIpc } from './ipc';
import { GameLauncher } from './launcher';
import { GameLibrary } from './library';
import { JsonStore } from './store';
import { validateSettings } from './validate';

const SMOKE = process.argv.includes('--smoke');
if (process.env.BLOCKHOLD_USER_DATA) app.setPath('userData', process.env.BLOCKHOLD_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
let win: BrowserWindow | null = null;
let allowClose = false;
let saveTimeout: NodeJS.Timeout | null = null;

if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();

function serveRenderer(): void {
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    if (url.host !== 'launcher') return new Response('Not found', { status: 404 });
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(RENDERER_DIR, rel));
    // Block path traversal out of the bundled renderer directory.
    if (!file.startsWith(RENDERER_DIR + path.sep) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow(settings: Settings): BrowserWindow {
  const [w, h] = settings.windowSize.split('x').map(Number);
  const w0 = new BrowserWindow({
    width: w || 1600,
    height: h || 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#7fb2ff',
    title: 'Blockhold Launcher',
    fullscreen: settings.fullscreen && !SMOKE,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  w0.once('ready-to-show', () => w0.show());
  w0.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w0.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`${APP_ORIGIN}/`)) e.preventDefault(); });
  w0.webContents.on('console-message', (e) => {
    if (SMOKE || e.level === 'error') console.log(`[renderer:${e.level}] ${e.message}`);
  });
  w0.webContents.on('render-process-gone', (_e, d) => console.error('[renderer] gone:', d.reason));

  // Ask the renderer to save the world before closing.
  w0.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    w0.webContents.send(IPC.appRequestSave);
    saveTimeout = setTimeout(() => { allowClose = true; w0.close(); }, 3000);
  });
  w0.on('closed', () => { win = null; });
  void w0.loadURL(`${APP_ORIGIN}/index.html`);
  return w0;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const userData = app.getPath('userData');
  const settingsStore = new JsonStore<Settings>(userData, 'settings.json', () => DEFAULT_SETTINGS);
  const firstRun = !settingsStore.exists();
  let settings = validateSettings(settingsStore.read());
  if (firstRun) settingsStore.write(settings);
  const worldStore = new JsonStore<WorldSave | null>(userData, 'world.json', () => null);
  const library = new GameLibrary(userData);
  const launcher = new GameLauncher({
    shell: { openExternal: (u) => shell.openExternal(u), openPath: (p) => shell.openPath(p) },
    getGame: (id) => library.get(id),
    allGames: () => library.list(),
    recordLaunch: (id) => library.recordLaunch(id),
    addPlaytime: (id, s, persist) => library.addPlaytime(id, s, persist),
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'pointerLock' || permission === 'fullscreen'));
  serveRenderer();
  registerIpc({
    getWindow: () => win,
    library,
    launcher,
    settingsStore,
    worldStore,
    appDir: app.getAppPath(),
    appInfo: { version: app.getVersion(), firstRun, smoke: SMOKE, userDataDir: userData },
    getSettings: () => settings,
    setSettings: (s) => { settings = s; settingsStore.write(s); },
    onQuit: () => win?.close(),
    onSaveDone: () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      allowClose = true;
      win?.close();
    },
  });
  launcher.start();
  win = createWindow(settings);

  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('window-all-closed', () => { launcher.stop(); library.save(); app.quit(); });
});

// Smoke-test hook: scripts/smoke.mjs passes a CommonJS driver module that controls the window.
if (SMOKE) {
  app.whenReady().then(() => {
    const script = process.env.BLOCKHOLD_SMOKE_SCRIPT;
    if (!script) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const run = require(script) as (ctx: { getWindow: () => BrowserWindow | null; app: typeof app }) => Promise<void>;
    setTimeout(() => {
      run({ getWindow: () => win, app }).catch((e) => { console.error('[smoke] failed', e); process.exitCode = 1; }).finally(() => { allowClose = true; app.quit(); });
    }, 500);
  });
}
