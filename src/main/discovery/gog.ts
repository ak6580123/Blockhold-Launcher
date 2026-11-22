import fs from 'node:fs';
import path from 'node:path';
import { guessCategory } from '../../shared/categorize';
import type { DiscoveredGame } from '../../shared/types';
import { regQuery, type RegKey } from './util';

export function parseGogKeys(keys: RegKey[]): DiscoveredGame[] {
  const out: DiscoveredGame[] = [];
  for (const k of keys) {
    const v = k.values;
    const title = v.gameName ?? v.GAMENAME;
    const exe = v.exe ?? v.EXE;
    const dir = v.path ?? v.PATH;
    if (!title || !exe || !dir) continue;
    if (!fs.existsSync(exe)) continue;
    out.push({
      title,
      source: 'gog',
      sourceId: v.gameID ?? v.GAMEID,
      installDir: path.normalize(dir),
      exePath: path.normalize(exe),
      args: v.launchParam ?? '',
      workingDir: v.workingDir && fs.existsSync(v.workingDir) ? path.normalize(v.workingDir) : '',
      launchMethod: 'exe',
      description: '',
      category: guessCategory(title),
    });
  }
  return out;
}

export async function discoverGog(): Promise<DiscoveredGame[]> {
  const keys = [
    ...(await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', true)),
    ...(await regQuery('HKLM\\SOFTWARE\\GOG.com\\Games', true)),
  ];
  return parseGogKeys(keys);
}
