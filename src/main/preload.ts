import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type LauncherAPI } from '../shared/api';
import type { GameStatus } from '../shared/types';

// The only surface the renderer gets. No raw ipcRenderer, no Node APIs.
const invoke = (ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args);

const api: LauncherAPI = {
  library: {
    list: () => invoke(IPC.libraryList),
    add: (input) => invoke(IPC.libraryAdd, input),
    update: (id, patch) => invoke(IPC.libraryUpdate, id, patch),
    remove: (id) => invoke(IPC.libraryRemove, id),
    scan: () => invoke(IPC.libraryScan),
    import: (games) => invoke(IPC.libraryImport, games),
    cover: (id) => invoke(IPC.libraryCover, id),
    pickCover: (id) => invoke(IPC.libraryPickCover, id),
    openFolder: (id) => invoke(IPC.libraryOpenFolder, id),
  },
  dialog: {
    pickExecutable: () => invoke(IPC.pickExecutable),
    pickDirectory: () => invoke(IPC.pickDirectory),
  },
  launcher: {
    launch: (id, configId, force) => invoke(IPC.launch, id, configId, force),
    running: () => invoke(IPC.running),
    onStatus: (cb) => {
      const fn = (_e: unknown, s: GameStatus) => cb(s);
      ipcRenderer.on(IPC.gameStatus, fn);
      return () => ipcRenderer.removeListener(IPC.gameStatus, fn);
    },
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    set: (s) => invoke(IPC.settingsSet, s),
  },
  world: {
    load: () => invoke(IPC.worldLoad),
    save: (w) => invoke(IPC.worldSave, w),
    reset: () => invoke(IPC.worldReset),
  },
  window: {
    setFullscreen: (on) => invoke(IPC.windowFullscreen, on),
    setSize: (w, h) => invoke(IPC.windowSize, w, h),
  },
  skin: {
    get: () => invoke(IPC.skinGet),
    pick: () => invoke(IPC.skinPick),
    reset: () => invoke(IPC.skinReset),
    fetchByName: (name) => invoke(IPC.skinFetch, name),
  },
  app: {
    info: () => invoke(IPC.appInfo),
    quit: () => invoke(IPC.appQuit),
    onRequestSave: (cb) => {
      ipcRenderer.on(IPC.appRequestSave, async () => {
        try { await cb(); } finally { ipcRenderer.send(IPC.appSaveDone); }
      });
    },
  },
};

contextBridge.exposeInMainWorld('launcher', api);
