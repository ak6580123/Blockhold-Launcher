import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Game } from '../shared/types';

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
};
export const COVER_EXTS = Object.keys(MIME);
const MAX_COVER_BYTES = 8 * 1024 * 1024;

/** Lazily resolves and caches cover art as data URLs (cover file, else the exe's icon). */
export class CoverCache {
  private cache = new Map<string, string | null>();

  invalidate(id: string): void {
    this.cache.delete(id);
  }

  async get(game: Game): Promise<string | null> {
    const key = `${game.id}|${game.coverPath ?? ''}|${game.exePath}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    let url: string | null = null;
    if (game.coverPath) {
      try {
        const ext = path.extname(game.coverPath).toLowerCase();
        const st = fs.statSync(game.coverPath);
        if (MIME[ext] && st.size <= MAX_COVER_BYTES) {
          url = `data:${MIME[ext]};base64,${fs.readFileSync(game.coverPath).toString('base64')}`;
        }
      } catch { /* fall back to icon */ }
    }
    if (!url && game.exePath && fs.existsSync(game.exePath)) {
      try {
        const icon = await app.getFileIcon(game.exePath, { size: 'large' });
        if (!icon.isEmpty()) url = icon.toDataURL();
      } catch { /* no icon */ }
    }
    this.cache.set(key, url);
    return url;
  }
}
