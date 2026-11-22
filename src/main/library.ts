import crypto from 'node:crypto';
import path from 'node:path';
import { JsonStore } from './store';
import { guessCategory } from '../shared/categorize';
import type { ChestStyle, DiscoveredGame, Game, GamePatch } from '../shared/types';

interface LibraryFile {
  version: 1;
  games: Game[];
}

const normPath = (p: string) => (p ? path.normalize(p).toLowerCase() : '');

/** The persisted list of games. Owns all game metadata; nothing else writes it. */
export class GameLibrary {
  private store: JsonStore<LibraryFile>;
  private games: Game[];

  constructor(dir: string) {
    this.store = new JsonStore<LibraryFile>(dir, 'library.json', () => ({ version: 1, games: [] }));
    this.games = (this.store.read().games ?? []).map(normalizeGame);
  }

  list(): Game[] {
    return this.games.map((g) => ({ ...g }));
  }

  get(id: string): Game | undefined {
    return this.games.find((g) => g.id === id);
  }

  /** True if a candidate (by store id, exe or install dir) is already in the library. */
  has(c: Pick<DiscoveredGame, 'source' | 'sourceId' | 'exePath' | 'installDir'>): boolean {
    return this.games.some((g) =>
      (c.sourceId && g.source === c.source && g.sourceId === c.sourceId) ||
      (c.exePath && normPath(g.exePath) === normPath(c.exePath)) ||
      (c.installDir && c.source !== 'manual' && normPath(g.installDir) === normPath(c.installDir)));
  }

  add(d: DiscoveredGame, chestStyle: ChestStyle): Game {
    const game: Game = normalizeGame({
      ...d,
      id: crypto.randomUUID(),
      chestStyle,
      playtimeSeconds: 0,
      addedAt: Date.now(),
      launchConfigs: [],
    });
    this.games.push(game);
    this.save();
    return { ...game };
  }

  update(id: string, patch: GamePatch): Game {
    const g = this.get(id);
    if (!g) throw new Error('Game not found');
    const { chest, ...rest } = patch;
    Object.assign(g, rest);
    if (chest === null) delete g.chest;
    else if (chest) g.chest = chest;
    this.save();
    return { ...g };
  }

  setCover(id: string, coverPath: string): Game {
    const g = this.get(id);
    if (!g) throw new Error('Game not found');
    g.coverPath = coverPath;
    this.save();
    return { ...g };
  }

  remove(id: string): void {
    this.games = this.games.filter((g) => g.id !== id);
    this.save();
  }

  recordLaunch(id: string): void {
    const g = this.get(id);
    if (g) { g.lastPlayed = Date.now(); this.save(); }
  }

  addPlaytime(id: string, seconds: number, persist: boolean): Game | undefined {
    const g = this.get(id);
    if (!g) return undefined;
    g.playtimeSeconds += seconds;
    if (persist) this.save();
    return g;
  }

  save(): void {
    this.store.write({ version: 1, games: this.games });
  }
}

function normalizeGame(g: Partial<Game>): Game {
  const title = g.title?.trim() || (g.exePath ? path.basename(g.exePath, path.extname(g.exePath)) : 'Unknown game');
  return {
    id: g.id ?? crypto.randomUUID(),
    title,
    source: g.source ?? 'manual',
    sourceId: g.sourceId,
    installDir: g.installDir ?? (g.exePath ? path.dirname(g.exePath) : ''),
    exePath: g.exePath ?? '',
    args: g.args ?? '',
    workingDir: g.workingDir ?? '',
    launchMethod: g.launchMethod ?? 'exe',
    launchUri: g.launchUri,
    aumid: g.aumid,
    description: g.description ?? '',
    category: g.category ?? guessCategory(title),
    chestStyle: g.chestStyle ?? 'oak',
    chest: g.chest,
    coverPath: g.coverPath,
    playtimeSeconds: g.playtimeSeconds ?? 0,
    lastPlayed: g.lastPlayed,
    addedAt: g.addedAt ?? Date.now(),
    launchConfigs: g.launchConfigs ?? [],
  };
}
