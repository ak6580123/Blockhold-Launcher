import path from 'node:path';
import type { DiscoveredGame, ScanReport, Settings } from '../../shared/types';
import { discoverEpic } from './epic';
import { defaultGameFolders, discoverFolders } from './folders';
import { discoverGog } from './gog';
import { discoverSteam } from './steam';
import { discoverXbox } from './xbox';

const norm = (p: string) => path.normalize(p).toLowerCase();

/**
 * Run every enabled discovery source. Results are de-duplicated against each other
 * (store sources win over plain folder matches) and against `isKnown` (the library).
 */
export async function scanAll(settings: Settings, isKnown: (g: DiscoveredGame) => boolean, excludeDirs: string[]): Promise<ScanReport> {
  const errors: string[] = [];
  const run = async (name: string, enabled: boolean, fn: () => Promise<DiscoveredGame[]>) => {
    if (!enabled) return [];
    try { return await fn(); } catch (e) { errors.push(`${name}: ${(e as Error).message}`); return []; }
  };
  const store = (await Promise.all([
    run('Steam', settings.enabledSources.steam, discoverSteam),
    run('Epic Games', settings.enabledSources.epic, discoverEpic),
    run('GOG', settings.enabledSources.gog, discoverGog),
    run('Xbox', settings.enabledSources.xbox, discoverXbox),
  ])).flat();

  const storeDirs = store.map((g) => norm(g.installDir));
  const folderDirs = [...new Set([...defaultGameFolders(), ...settings.scanDirectories])];
  const folders = (await run('Folders', true, async () => discoverFolders(folderDirs, excludeDirs)))
    .filter((g) => !storeDirs.some((d) => d === norm(g.installDir) || norm(g.installDir).startsWith(d + path.sep) || d.startsWith(norm(g.installDir) + path.sep)));

  const seen = new Set<string>();
  const found: DiscoveredGame[] = [];
  for (const g of [...store, ...folders]) {
    const key = g.sourceId ? `${g.source}:${g.sourceId}` : norm(g.installDir);
    if (seen.has(key) || isKnown(g)) continue;
    seen.add(key);
    found.push(g);
  }
  found.sort((a, b) => a.title.localeCompare(b.title));
  return { found, errors };
}
