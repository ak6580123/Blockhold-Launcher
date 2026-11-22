import fs from 'node:fs';
import path from 'node:path';
import { guessCategory } from '../../shared/categorize';
import type { DiscoveredGame } from '../../shared/types';
import { findBestExecutable, fixedDrives, prettifyFolderName } from './util';

/** Common standalone game folders that exist on this machine. */
export function defaultGameFolders(): string[] {
  const out: string[] = [];
  for (const d of fixedDrives()) {
    for (const name of ['Games', 'My Games', 'GOG Games', 'Epic Games', 'itch']) {
      const p = path.join(d, name);
      try { if (fs.statSync(p).isDirectory()) out.push(p); } catch { /* missing */ }
    }
  }
  return out;
}

/** Each sub-folder of a scan directory with a plausible executable counts as one game. */
export function discoverFolders(dirs: string[], excludeDirs: string[]): DiscoveredGame[] {
  const excl = excludeDirs.map((d) => path.normalize(d).toLowerCase());
  const out: DiscoveredGame[] = [];
  for (const dir of dirs) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('$')) continue;
      const full = path.normalize(path.join(dir, e.name));
      if (excl.some((x) => x === full.toLowerCase() || x.startsWith(full.toLowerCase() + path.sep))) continue;
      const exe = findBestExecutable(full, e.name, 3);
      if (!exe) continue;
      const title = prettifyFolderName(e.name);
      out.push({
        title,
        source: 'folder',
        installDir: full,
        exePath: exe,
        args: '',
        workingDir: '',
        launchMethod: 'exe',
        description: '',
        category: guessCategory(title),
      });
    }
  }
  return out;
}
