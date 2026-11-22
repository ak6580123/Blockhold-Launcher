import '@fontsource/pixelify-sans/400.css';
import './styles.css';
import type { LauncherAPI } from '../shared/api';
import { DEFAULT_SETTINGS } from '../shared/types';
import { Game } from './game';
import { getAtlas } from './engine/textures';
import { LoadingScreen } from './ui/menus';

declare global {
  interface Window {
    launcher: LauncherAPI;
  }
}

async function boot(): Promise<void> {
  const loading = new LoadingScreen();
  const api = window.launcher;
  if (!api) {
    loading.set(0, 'Blockhold must be started as a desktop app (npm start).');
    return;
  }
  try {
    loading.set(0.1, 'Reading settings…');
    const [info, settings, save, games] = await Promise.all([
      api.app.info(), api.settings.get().catch(() => DEFAULT_SETTINGS), api.world.load().catch(() => null), api.library.list(),
    ]);
    loading.set(0.3, 'Painting textures…');
    await document.fonts.ready;
    getAtlas();
    loading.set(0.5, 'Generating terrain…');
    await new Promise((r) => setTimeout(r, 30));
    const game = new Game({
      api, info, settings, save, games,
      canvas: document.getElementById('game') as HTMLCanvasElement,
      ui: document.getElementById('ui')!,
    });
    loading.set(1, 'Ready');
    game.start();
    loading.done();
    void game.autoScan();
  } catch (e) {
    console.error(e);
    loading.set(1, `Failed to start: ${(e as Error).message}`);
  }
}

void boot();
