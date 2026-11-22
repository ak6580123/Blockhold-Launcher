import fs from 'node:fs';
import path from 'node:path';
import { guessCategory } from '../../shared/categorize';
import type { DiscoveredGame } from '../../shared/types';
import { findBestExecutable } from './util';

export const EPIC_MANIFEST_DIR = path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');

interface EpicItem {
  DisplayName?: string;
  InstallLocation?: string;
  LaunchExecutable?: string;
  LaunchCommand?: string;
  AppName?: string;
  CatalogNamespace?: string;
  CatalogItemId?: string;
  bIsIncompleteInstall?: boolean;
  AppCategories?: string[];
}

export function parseEpicManifest(item: EpicItem): DiscoveredGame | null {
  if (!item.DisplayName || !item.InstallLocation || item.bIsIncompleteInstall) return null;
  if (item.AppCategories && !item.AppCategories.includes('games')) return null;
  if (item.AppCategories?.includes('addons')) return null;
  if (!fs.existsSync(item.InstallLocation)) return null;
  const exe = item.LaunchExecutable ? path.join(item.InstallLocation, item.LaunchExecutable) : '';
  const uri = item.CatalogNamespace && item.CatalogItemId && item.AppName
    ? `com.epicgames.launcher://apps/${encodeURIComponent(`${item.CatalogNamespace}:${item.CatalogItemId}:${item.AppName}`)}?action=launch&silent=true`
    : undefined;
  return {
    title: item.DisplayName,
    source: 'epic',
    sourceId: item.AppName,
    installDir: path.normalize(item.InstallLocation),
    exePath: exe && fs.existsSync(exe) ? path.normalize(exe) : findBestExecutable(item.InstallLocation, item.DisplayName) ?? '',
    args: item.LaunchCommand ?? '',
    workingDir: '',
    launchMethod: uri ? 'uri' : 'exe',
    launchUri: uri,
    description: '',
    category: guessCategory(item.DisplayName),
  };
}

export async function discoverEpic(dir = EPIC_MANIFEST_DIR): Promise<DiscoveredGame[]> {
  let files: string[];
  try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.item')); } catch { return []; }
  const out: DiscoveredGame[] = [];
  for (const f of files) {
    try {
      const g = parseEpicManifest(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as EpicItem);
      if (g) out.push(g);
    } catch { /* ignore malformed */ }
  }
  return out;
}
