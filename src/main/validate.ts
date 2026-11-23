import fs from 'node:fs';
import path from 'node:path';
import {
  ACTIONS, CHEST_STYLES, DEFAULT_SETTINGS, LAUNCH_METHODS, REGION_IDS,
  type ChestPos, type GamePatch, type ItemStack, type LaunchConfig, type Settings, type WorldSave,
} from '../shared/types';

// Every payload coming from the renderer is treated as untrusted and checked here.

export const EXECUTABLE_EXTS = ['.exe', '.bat', '.cmd', '.lnk', '.url'];
export const ALLOWED_URI_SCHEMES = [
  'steam:', 'com.epicgames.launcher:', 'goggalaxy:', 'uplay:', 'origin2:', 'battlenet:', 'itch:', 'heroic:', 'eadesktop:', 'xbox:', 'ms-xbl-',
];

const str = (v: unknown, max = 4096): string | undefined =>
  typeof v === 'string' && v.length <= max ? v : undefined;
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function isAllowedUri(uri: string): boolean {
  const lower = uri.toLowerCase();
  return ALLOWED_URI_SCHEMES.some((s) => lower.startsWith(s));
}

export function validateExecutablePath(p: string): string {
  if (!path.isAbsolute(p)) throw new Error('Executable path must be absolute');
  const ext = path.extname(p).toLowerCase();
  if (!EXECUTABLE_EXTS.includes(ext)) throw new Error(`Unsupported executable type "${ext}" (allowed: ${EXECUTABLE_EXTS.join(', ')})`);
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  return path.normalize(p);
}

export function validateDirectory(p: string): string {
  if (p === '') return '';
  if (!path.isAbsolute(p)) throw new Error('Directory must be an absolute path');
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error(`Directory not found: ${p}`);
  return path.normalize(p);
}

export function validateChestPos(v: unknown): ChestPos | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const x = num(o.x), y = num(o.y), z = num(o.z), f = num(o.facing);
  if (x === undefined || y === undefined || z === undefined) return undefined;
  return { x: Math.round(x), y: clamp(Math.round(y), 1, 126), z: Math.round(z), facing: ((Math.round(f ?? 0) % 4) + 4) % 4 };
}

function validateConfigs(v: unknown): LaunchConfig[] {
  if (!Array.isArray(v)) throw new Error('launchConfigs must be an array');
  return v.slice(0, 20).map((c, i) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const wd = str(o.workingDir) ?? '';
    return {
      id: str(o.id, 64) ?? `cfg-${i}`,
      name: (str(o.name, 80) ?? `Config ${i + 1}`).trim() || `Config ${i + 1}`,
      args: str(o.args, 2000) ?? '',
      workingDir: wd ? validateDirectory(wd) : '',
    };
  });
}

export function validatePatch(v: unknown): GamePatch {
  if (!v || typeof v !== 'object') throw new Error('Invalid patch');
  const o = v as Record<string, unknown>;
  const out: GamePatch = {};
  if ('title' in o) { const t = str(o.title, 200)?.trim(); if (!t) throw new Error('Title cannot be empty'); out.title = t; }
  if ('description' in o) out.description = str(o.description, 4000) ?? '';
  if ('category' in o) { if (!REGION_IDS.includes(o.category as never)) throw new Error('Unknown region'); out.category = o.category as GamePatch['category']; }
  if ('chestStyle' in o) { if (!CHEST_STYLES.includes(o.chestStyle as never)) throw new Error('Unknown chest style'); out.chestStyle = o.chestStyle as GamePatch['chestStyle']; }
  if ('chest' in o) out.chest = o.chest === null ? null : validateChestPos(o.chest) ?? null;
  if ('exePath' in o) { const p = str(o.exePath) ?? ''; out.exePath = p ? validateExecutablePath(p) : ''; }
  if ('installDir' in o) out.installDir = validateDirectory(str(o.installDir) ?? '');
  if ('workingDir' in o) out.workingDir = validateDirectory(str(o.workingDir) ?? '');
  if ('args' in o) out.args = str(o.args, 2000) ?? '';
  if ('launchMethod' in o) { if (!LAUNCH_METHODS.includes(o.launchMethod as never)) throw new Error('Unknown launch method'); out.launchMethod = o.launchMethod as GamePatch['launchMethod']; }
  if ('launchUri' in o) {
    const u = (str(o.launchUri, 2000) ?? '').trim();
    if (u && !isAllowedUri(u)) throw new Error(`URI scheme not allowed. Allowed: ${ALLOWED_URI_SCHEMES.join(' ')}`);
    out.launchUri = u;
  }
  if ('launchConfigs' in o) out.launchConfigs = validateConfigs(o.launchConfigs);
  return out;
}

export function validateSettings(v: unknown): Settings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const n = (k: keyof Settings, lo: number, hi: number) => clamp(num(o[k]) ?? (d[k] as number), lo, hi);
  const b = (k: keyof Settings) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : (d[k] as boolean));
  const kb = { ...d.keyBindings };
  if (o.keyBindings && typeof o.keyBindings === 'object') {
    for (const a of ACTIONS) {
      const code = str((o.keyBindings as Record<string, unknown>)[a], 40);
      if (code) kb[a] = code;
    }
  }
  const es = { ...d.enabledSources };
  if (o.enabledSources && typeof o.enabledSources === 'object') {
    for (const k of Object.keys(es) as (keyof typeof es)[]) {
      const val = (o.enabledSources as Record<string, unknown>)[k];
      if (typeof val === 'boolean') es[k] = val;
    }
  }
  const dirs = Array.isArray(o.scanDirectories)
    ? o.scanDirectories.filter((x): x is string => typeof x === 'string' && path.isAbsolute(x)).slice(0, 50)
    : d.scanDirectories;
  const ws = str(o.windowSize, 20);
  return {
    mouseSensitivity: n('mouseSensitivity', 0.1, 3),
    invertY: b('invertY'),
    elytra3dFlight: b('elytra3dFlight'),
    elytraRollSensitivity: n('elytraRollSensitivity', 0.1, 3),
    fov: n('fov', 50, 110),
    graphics: (['low', 'medium', 'high'] as const).includes(o.graphics as never) ? (o.graphics as Settings['graphics']) : d.graphics,
    renderScale: n('renderScale', 0.4, 1),
    windowSize: ws && /^\d{3,4}x\d{3,4}$/.test(ws) ? ws : d.windowSize,
    renderDistance: Math.round(n('renderDistance', 2, 12)),
    masterVolume: n('masterVolume', 0, 1),
    sfxVolume: n('sfxVolume', 0, 1),
    ambientVolume: n('ambientVolume', 0, 1),
    fullscreen: b('fullscreen'),
    showFps: b('showFps'),
    keyBindings: kb,
    dayNightCycle: b('dayNightCycle'),
    dayLengthMinutes: n('dayLengthMinutes', 2, 120),
    defaultChestStyle: CHEST_STYLES.includes(o.defaultChestStyle as never) ? (o.defaultChestStyle as Settings['defaultChestStyle']) : d.defaultChestStyle,
    scanDirectories: dirs,
    enabledSources: es,
    autoScanOnStartup: b('autoScanOnStartup'),
    skinModel: o.skinModel === 'slim' ? 'slim' : 'classic',
  };
}

function stack(s: unknown): ItemStack | null {
  const so = s as Record<string, unknown> | null;
  return so && typeof so === 'object' && typeof so.id === 'string' && typeof so.count === 'number' ? { id: so.id.slice(0, 64), count: clamp(Math.trunc(so.count), 1, 999) } : null;
}

export function validateWorldSave(v: unknown): WorldSave {
  if (!v || typeof v !== 'object') throw new Error('Invalid world save');
  const o = v as Record<string, unknown>;
  const p = (o.player ?? {}) as Record<string, unknown>;
  const inv = (o.inventory ?? {}) as Record<string, unknown>;
  const mods = Array.isArray(o.mods) ? o.mods : [];
  if (mods.length > 2_000_000) throw new Error('World save too large');
  return {
    version: 1,
    seed: Math.trunc(num(o.seed) ?? 1337),
    mods: mods.filter((m): m is [string, number] => Array.isArray(m) && typeof m[0] === 'string' && m[0].length < 40 && typeof m[1] === 'number'),
    player: { x: num(p.x) ?? 0, y: num(p.y) ?? 40, z: num(p.z) ?? 0, yaw: num(p.yaw) ?? 0, pitch: num(p.pitch) ?? 0 },
    inventory: {
      slots: Array.isArray(inv.slots)
        ? inv.slots.slice(0, 36).map((s) => {
          return stack(s);
        })
        : [],
      selected: clamp(Math.trunc(num(inv.selected) ?? 0), 0, 8),
      back: stack(inv.back),
    },
    timeOfDay: clamp(num(o.timeOfDay) ?? 0.3, 0, 1),
  };
}
