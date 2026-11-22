import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { Game, GameStatus, LaunchResult } from '../shared/types';
import { execText } from './discovery/util';
import { isAllowedUri } from './validate';

/** Split a command-line string into arguments, honouring double quotes. */
export function parseArgs(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let has = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '\\' && input[i + 1] === '"') { cur += '"'; i++; has = true; continue; }
    if (c === '"') { quoted = !quoted; has = true; continue; }
    if (!quoted && /\s/.test(c)) {
      if (has) { out.push(cur); cur = ''; has = false; }
      continue;
    }
    cur += c; has = true;
  }
  if (has) out.push(cur);
  return out;
}

export interface ShellAdapter {
  openExternal(uri: string): Promise<void>;
  /** resolves to an error message, or '' on success (Electron's shell.openPath contract) */
  openPath(p: string): Promise<string>;
}

interface Tracked {
  child?: ChildProcess;
  startedAt: number;
  /** once the process (or a matching image name) was observed running */
  seenRunning: boolean;
  lastTick: number;
}

export interface LauncherDeps {
  shell: ShellAdapter;
  getGame(id: string): Game | undefined;
  allGames(): Game[];
  recordLaunch(id: string): void;
  addPlaytime(id: string, seconds: number, persist: boolean): Game | undefined;
  /** image names currently running (lower-case "game.exe"). Overridable for tests. */
  listProcesses?(): Promise<Set<string>>;
}

export async function listWindowsProcesses(): Promise<Set<string>> {
  const out = await execText('tasklist', ['/fo', 'csv', '/nh'], 10000);
  const set = new Set<string>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^"([^"]+)"/.exec(line);
    if (m) set.add(m[1].toLowerCase());
  }
  return set;
}

/**
 * Launches games and keeps track of which are running.
 * Running detection = child-process liveness for games we spawned directly,
 * plus a periodic process-list poll matched against each game's executable name
 * (needed for games started through Steam/Epic/Xbox URIs).
 * Emits 'status' (GameStatus) whenever a game's running state or playtime changes.
 */
export class GameLauncher extends EventEmitter {
  private tracked = new Map<string, Tracked>();
  private running = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private persistCounter = 0;

  constructor(private deps: LauncherDeps, private pollMs = 5000) {
    super();
  }

  start(): void {
    if (!this.timer) this.timer = setInterval(() => void this.poll(), this.pollMs);
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  statuses(): GameStatus[] {
    return this.deps.allGames().map((g) => ({ id: g.id, running: this.running.has(g.id), playtimeSeconds: g.playtimeSeconds, lastPlayed: g.lastPlayed }));
  }

  async launch(id: string, configId?: string, force = false): Promise<LaunchResult> {
    const game = this.deps.getGame(id);
    if (!game) return { ok: false, error: 'Game not found in library' };
    if (!force && this.running.has(id)) return { ok: false, alreadyRunning: true, error: `${game.title} is already running` };

    const cfg = configId ? game.launchConfigs.find((c) => c.id === configId) : undefined;
    const argStr = cfg ? cfg.args : game.args;
    const cwdCandidate = cfg?.workingDir || game.workingDir || (game.exePath ? path.dirname(game.exePath) : '') || game.installDir;

    try {
      switch (game.launchMethod) {
        case 'uri': {
          const uri = game.launchUri ?? '';
          if (!uri) throw new Error('No launch URI configured for this game');
          if (!isAllowedUri(uri)) throw new Error('Launch URI scheme is not allowed');
          // A custom launch configuration with args needs a direct launch; otherwise use the store URI.
          if (cfg && cfg.args && game.exePath) await this.spawnExe(game, argStr, cwdCandidate);
          else await this.deps.shell.openExternal(uri);
          break;
        }
        case 'appx': {
          if (!game.aumid || !/^[\w.\-]+_[a-z0-9]+![\w.\-]+$/i.test(game.aumid)) throw new Error('Invalid or missing app id (AUMID) for this game');
          const child = spawn('explorer.exe', [`shell:AppsFolder\\${game.aumid}`], { detached: true, stdio: 'ignore', windowsHide: false });
          child.unref();
          break;
        }
        case 'shell': {
          if (!game.exePath || !fs.existsSync(game.exePath)) throw new Error(`Shortcut not found: ${game.exePath || '(none set)'}`);
          const err = await this.deps.shell.openPath(game.exePath);
          if (err) throw new Error(err);
          break;
        }
        case 'exe':
        default:
          await this.spawnExe(game, argStr, cwdCandidate);
      }
    } catch (e) {
      const msg = (e as Error).message || String(e);
      this.emit('status', { ...this.statusOf(game), error: `Failed to launch ${game.title}: ${msg}` } satisfies GameStatus);
      return { ok: false, error: msg };
    }

    this.deps.recordLaunch(id);
    const t = this.tracked.get(id);
    if (!t || !t.child) this.tracked.set(id, { ...(t ?? {}), startedAt: Date.now(), seenRunning: false, lastTick: Date.now(), child: t?.child });
    this.markRunning(id, true);
    // Re-check soon so URI launches that never start get corrected.
    setTimeout(() => void this.poll(), 2500);
    return { ok: true };
  }

  private spawnExe(game: Game, argStr: string, cwdCandidate: string): Promise<void> {
    const exe = game.exePath;
    if (!exe) return Promise.reject(new Error('No executable set for this game'));
    if (!fs.existsSync(exe)) return Promise.reject(new Error(`Executable not found: ${exe}`));
    const cwd = cwdCandidate && fs.existsSync(cwdCandidate) ? cwdCandidate : path.dirname(exe);
    const args = parseArgs(argStr);
    const ext = path.extname(exe).toLowerCase();
    if (ext === '.lnk' || ext === '.url') {
      return this.deps.shell.openPath(exe).then((err) => { if (err) throw new Error(err); });
    }
    const [cmd, cmdArgs] = ext === '.bat' || ext === '.cmd'
      ? ['cmd.exe', ['/d', '/c', exe, ...args]]
      : [exe, args];

    return new Promise((resolve, reject) => {
      let settled = false;
      const child = spawn(cmd, cmdArgs as string[], { cwd, detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', (err) => {
        const code = (err as NodeJS.ErrnoException).code;
        const friendly = code === 'ENOENT' ? `Executable not found: ${exe}`
          : code === 'EACCES' || code === 'EPERM' ? `Permission denied (the game may need to run as administrator): ${exe}`
            : err.message;
        if (!settled) { settled = true; reject(new Error(friendly)); }
        else this.emit('status', { ...this.statusOf(game), error: friendly });
      });
      child.once('spawn', () => {
        if (settled) return;
        settled = true;
        child.unref();
        const t: Tracked = { child, startedAt: Date.now(), seenRunning: true, lastTick: Date.now() };
        this.tracked.set(game.id, t);
        child.once('exit', (code) => {
          const quick = Date.now() - t.startedAt < 5000;
          if (this.tracked.get(game.id) === t) t.child = undefined;
          if (quick && code !== 0 && code !== null) {
            this.emit('status', { ...this.statusOf(game), error: `${game.title} exited immediately (exit code ${code}). Check the executable, arguments and working directory.` });
          }
          void this.poll();
        });
        resolve();
      });
    });
  }

  private statusOf(game: Game): GameStatus {
    return { id: game.id, running: this.running.has(game.id), playtimeSeconds: game.playtimeSeconds, lastPlayed: game.lastPlayed };
  }

  private markRunning(id: string, on: boolean): void {
    const was = this.running.has(id);
    if (on) this.running.add(id); else this.running.delete(id);
    if (was !== on) {
      const g = this.deps.getGame(id);
      if (g) this.emit('status', this.statusOf(g));
    }
  }

  /** One detection + playtime accounting pass. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const procs = await (this.deps.listProcesses ?? listWindowsProcesses)();
      const now = Date.now();
      this.persistCounter++;
      const persist = this.persistCounter % 12 === 0; // ~ once a minute
      for (const g of this.deps.allGames()) {
        const t = this.tracked.get(g.id);
        const childAlive = !!t?.child && t.child.exitCode === null && !t.child.killed;
        const exeName = g.exePath ? path.basename(g.exePath).toLowerCase() : '';
        const byName = !!exeName && procs.has(exeName);
        const pending = !!t && !t.seenRunning && now - t.startedAt < 45000; // URI launch still starting
        const isRunning = childAlive || byName || pending;

        if (isRunning) {
          if (!t) this.tracked.set(g.id, { startedAt: now, seenRunning: true, lastTick: now });
          else {
            if (childAlive || byName) {
              if (t.seenRunning) {
                const delta = Math.min(60, (now - t.lastTick) / 1000);
                const updated = this.deps.addPlaytime(g.id, delta, persist);
                if (updated) this.emit('status', this.statusOf(updated));
              }
              t.seenRunning = true;
            }
            t.lastTick = now;
          }
        } else if (t) {
          this.tracked.delete(g.id);
          this.deps.addPlaytime(g.id, 0, true);
        }
        this.markRunning(g.id, isRunning);
      }
    } catch (e) {
      console.error('[launcher] poll failed', e);
    } finally {
      this.polling = false;
    }
  }
}
