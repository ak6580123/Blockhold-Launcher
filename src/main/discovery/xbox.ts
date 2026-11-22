import fs from 'node:fs';
import path from 'node:path';
import { guessCategory } from '../../shared/categorize';
import type { DiscoveredGame } from '../../shared/types';
import { execText, fixedDrives } from './util';

interface XboxConfig {
  identityName: string;
  exeName: string;
  appId: string;
  displayName: string;
}

export function parseMicrosoftGameConfig(xml: string): XboxConfig | null {
  const identity = /<Identity[^>]*\bName="([^"]+)"/i.exec(xml)?.[1];
  const tag = /<Executable\b[^>]*>/i.exec(xml)?.[0] ?? '';
  const exeName = /\bName="([^"]+)"/i.exec(tag)?.[1];
  const appId = /\bId="([^"]+)"/i.exec(tag)?.[1];
  const display = /DefaultDisplayName="([^"]+)"/i.exec(xml)?.[1];
  if (!identity) return null;
  if (!exeName || !appId) return null;
  return { identityName: identity, exeName, appId, displayName: display ?? identity };
}

/** Map package Name -> PackageFamilyName via PowerShell (only run if Xbox games were found). */
async function packageFamilies(): Promise<Map<string, string>> {
  const out = await execText('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    'Get-AppxPackage | Select-Object Name,PackageFamilyName | ConvertTo-Json -Compress',
  ], 30000);
  const map = new Map<string, string>();
  try {
    const arr = JSON.parse(out) as { Name: string; PackageFamilyName: string }[] | { Name: string; PackageFamilyName: string };
    for (const p of Array.isArray(arr) ? arr : [arr]) map.set(p.Name, p.PackageFamilyName);
  } catch { /* powershell unavailable */ }
  return map;
}

export async function discoverXbox(): Promise<DiscoveredGame[]> {
  const found: { cfg: XboxConfig; dir: string }[] = [];
  for (const drive of fixedDrives()) {
    const root = path.join(drive, 'XboxGames');
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const content = path.join(root, e.name, 'Content');
      const cfgPath = path.join(content, 'MicrosoftGame.config');
      try {
        const cfg = parseMicrosoftGameConfig(fs.readFileSync(cfgPath, 'utf8'));
        if (cfg) found.push({ cfg, dir: content });
      } catch { /* not a game folder */ }
    }
  }
  if (!found.length) return [];
  const families = await packageFamilies();
  const out: DiscoveredGame[] = [];
  for (const { cfg, dir } of found) {
    const pfn = families.get(cfg.identityName);
    const title = cfg.displayName.startsWith('ms-resource') ? path.basename(path.dirname(dir)) : cfg.displayName;
    out.push({
      title,
      source: 'xbox',
      sourceId: cfg.identityName,
      installDir: dir,
      exePath: path.join(dir, cfg.exeName),
      args: '',
      workingDir: '',
      launchMethod: pfn ? 'appx' : 'exe',
      aumid: pfn ? `${pfn}!${cfg.appId}` : undefined,
      description: '',
      category: guessCategory(title),
    });
  }
  return out;
}
