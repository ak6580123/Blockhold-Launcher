import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function execText(cmd: string, args: string[], timeoutMs = 15000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      resolve(err && !stdout ? '' : String(stdout));
    });
  });
}

export interface RegKey {
  key: string;
  values: Record<string, string>;
}

/** Parse `reg query` output into keys with their values. */
export function parseRegOutput(out: string): RegKey[] {
  const keys: RegKey[] = [];
  let cur: RegKey | null = null;
  for (const line of out.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) {
      cur = { key: line.trim(), values: {} };
      keys.push(cur);
    } else if (cur) {
      const m = /^\s{2,}(.+?)\s{2,}(REG_\w+)\s{2,}(.*)$/.exec(line) ?? /^\s{2,}(.+?)\s{2,}(REG_\w+)\s*$/.exec(line);
      if (m) cur.values[m[1].trim()] = (m[3] ?? '').trim();
    }
  }
  return keys;
}

export async function regQuery(key: string, recursive = false): Promise<RegKey[]> {
  if (process.platform !== 'win32') return [];
  const args = ['query', key];
  if (recursive) args.push('/s');
  return parseRegOutput(await execText('reg', args));
}

/** Minimal Valve KeyValues (VDF/ACF) parser. */
export function parseVdf(text: string): Record<string, unknown> {
  const tokens: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|([{}])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) tokens.push(m[2] ?? `"${m[1].replace(/\\\\/g, '\\')}`);
  let i = 0;
  const parseObj = (): Record<string, unknown> => {
    const obj: Record<string, unknown> = {};
    while (i < tokens.length) {
      const t = tokens[i++];
      if (t === '}') return obj;
      const key = t.slice(1);
      const next = tokens[i++];
      if (next === '{') obj[key] = parseObj();
      else if (next !== undefined) obj[key] = next.slice(1);
    }
    return obj;
  };
  return parseObj();
}

const EXE_EXCLUDE = /(unins|uninstall|setup|install|redist|vc_?redist|vcredist|dxsetup|directx|crash|report|helper|prereq|dotnet|update|patch|7z|cef|easyanticheat|battleye|benchmark|config|settings|server|editor|sdk|tool|launcherpatcher|unitycrashhandler|ue4prereq|dxwebsetup|oalinst|physx|touchup|cleanup|notification|overlay|python|java|node|pythonw|elevate|register|activation|bugsplat)/i;
const DIR_EXCLUDE = /^(_commonredist|redist|redistributables?|__installer|directx|dotnetfx|vcredist|support|_support|prereqs?|installers?|engine|crashreport|tools|sdk|mono|monobleedingedge|python|jre|java|node_modules|\$recycle\.bin)$/i;

/**
 * Pick the most likely game executable in an install directory.
 * Heuristic: prefer files whose name resembles the folder/title, larger files,
 * shallower paths and typical binary folders (Binaries/Win64, bin, x64).
 */
export function findBestExecutable(dir: string, title?: string, maxDepth = 3): string | null {
  if (!dir || !fs.existsSync(dir)) return null;
  const want = (title ?? path.basename(dir)).toLowerCase().replace(/[^a-z0-9]/g, '');
  let best: { file: string; score: number } | null = null;
  let visited = 0;
  const walk = (d: string, depth: number) => {
    if (depth > maxDepth || visited > 3000) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      visited++;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!DIR_EXCLUDE.test(e.name)) walk(full, depth + 1);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.exe') && !EXE_EXCLUDE.test(e.name)) {
        let size = 0;
        try { size = fs.statSync(full).size; } catch { /* ignore */ }
        if (size < 100 * 1024) continue;
        const base = e.name.toLowerCase().replace(/\.exe$/, '').replace(/[^a-z0-9]/g, '');
        let score = Math.log2(size / 1024);
        if (want && base) {
          if (base === want) score += 12;
          else if (want.includes(base) || base.includes(want)) score += 7;
          else if (base.slice(0, 4) === want.slice(0, 4)) score += 3;
        }
        if (/launcher/i.test(e.name)) score -= 2;
        if (/(shipping|win64|game)/i.test(e.name)) score += 2;
        if (/binaries[\\/]win64|[\\/]bin(64)?[\\/]|x64/i.test(full)) score += 2;
        score -= depth * 1.5;
        if (!best || score > best.score) best = { file: full, score };
      }
    }
  };
  walk(dir, 0);
  return best ? (best as { file: string }).file : null;
}

export function prettifyFolderName(name: string): string {
  return name.replace(/[_.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
}

export function fixedDrives(): string[] {
  const drives: string[] = [];
  if (process.platform !== 'win32') return drives;
  for (let c = 67; c <= 90; c++) {
    const root = `${String.fromCharCode(c)}:\\`;
    try { if (fs.existsSync(root)) drives.push(root); } catch { /* ignore */ }
  }
  return drives;
}
