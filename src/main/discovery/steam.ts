import fs from 'node:fs';
import path from 'node:path';
import { guessCategory } from '../../shared/categorize';
import type { DiscoveredGame } from '../../shared/types';
import { findBestExecutable, parseVdf, regQuery } from './util';

const SKIP = /(redistributable|steamworks|proton|steam linux runtime|soundtrack|dedicated server|\bsdk\b|steamvr|wallpaper engine|benchmark)/i;
const SKIP_IDS = new Set(['228980', '1070560', '1391110', '1628350', '250820']);

export async function findSteamRoot(): Promise<string | null> {
  for (const k of ['HKCU\\Software\\Valve\\Steam', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam']) {
    const keys = await regQuery(k);
    const v = keys[0]?.values.SteamPath ?? keys[0]?.values.InstallPath;
    if (v && fs.existsSync(v)) return path.normalize(v);
  }
  const fallback = 'C:\\Program Files (x86)\\Steam';
  return fs.existsSync(fallback) ? fallback : null;
}

export function steamLibraries(root: string): string[] {
  const libs = new Set<string>([path.normalize(root)]);
  const vdfPath = path.join(root, 'steamapps', 'libraryfolders.vdf');
  try {
    const vdf = parseVdf(fs.readFileSync(vdfPath, 'utf8'));
    const lf = (vdf.libraryfolders ?? vdf.LibraryFolders ?? {}) as Record<string, unknown>;
    for (const v of Object.values(lf)) {
      const p = typeof v === 'string' ? v : (v as Record<string, unknown>)?.path;
      if (typeof p === 'string' && fs.existsSync(p)) libs.add(path.normalize(p));
    }
  } catch { /* no extra libraries */ }
  return [...libs];
}

export function steamCoverPath(root: string, appid: string): string | undefined {
  const cache = path.join(root, 'appcache', 'librarycache');
  const flat = [`${appid}_library_600x900.jpg`, `${appid}_header.jpg`].map((f) => path.join(cache, f));
  for (const f of flat) if (fs.existsSync(f)) return f;
  // Newer Steam clients: librarycache/<appid>/[hash/]library_600x900.jpg
  const dir = path.join(cache, appid);
  const search = (d: string, depth: number): string | undefined => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return undefined; }
    const pick = entries.find((e) => e.isFile() && /^library_600x900/i.test(e.name)) ?? entries.find((e) => e.isFile() && /^header/i.test(e.name));
    if (pick) return path.join(d, pick.name);
    if (depth > 0) for (const e of entries) if (e.isDirectory()) { const r = search(path.join(d, e.name), depth - 1); if (r) return r; }
    return undefined;
  };
  return search(dir, 2);
}

export async function discoverSteam(): Promise<DiscoveredGame[]> {
  const root = await findSteamRoot();
  if (!root) return [];
  const out: DiscoveredGame[] = [];
  for (const lib of steamLibraries(root)) {
    const apps = path.join(lib, 'steamapps');
    let files: string[] = [];
    try { files = fs.readdirSync(apps).filter((f) => /^appmanifest_\d+\.acf$/i.test(f)); } catch { continue; }
    for (const f of files) {
      try {
        const acf = parseVdf(fs.readFileSync(path.join(apps, f), 'utf8'));
        const st = (acf.AppState ?? acf.appstate) as Record<string, string> | undefined;
        if (!st?.appid || !st.name || SKIP.test(st.name) || SKIP_IDS.has(st.appid)) continue;
        const installDir = path.join(apps, 'common', st.installdir ?? '');
        if (!st.installdir || !fs.existsSync(installDir)) continue;
        out.push({
          title: st.name,
          source: 'steam',
          sourceId: st.appid,
          installDir,
          exePath: findBestExecutable(installDir, st.name) ?? '',
          args: '',
          workingDir: '',
          launchMethod: 'uri',
          launchUri: `steam://rungameid/${st.appid}`,
          description: '',
          category: guessCategory(st.name),
          coverPath: steamCoverPath(root, st.appid),
        });
      } catch { /* skip unreadable manifest */ }
    }
  }
  return out;
}
