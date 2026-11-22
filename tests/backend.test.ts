import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { guessCategory } from '../src/shared/categorize';
import { parseEpicManifest } from '../src/main/discovery/epic';
import { parseGogKeys } from '../src/main/discovery/gog';
import { findBestExecutable, parseRegOutput, parseVdf } from '../src/main/discovery/util';
import { parseMicrosoftGameConfig } from '../src/main/discovery/xbox';
import { GameLauncher, parseArgs } from '../src/main/launcher';
import { GameLibrary } from '../src/main/library';
import { isAllowedUri, validatePatch, validateSettings, validateWorldSave } from '../src/main/validate';
import { DEFAULT_SETTINGS, type Game, type GameStatus } from '../src/shared/types';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'blockhold-test-'));

describe('VDF / registry parsing', () => {
  it('parses Steam libraryfolders + appmanifest', () => {
    const vdf = parseVdf(`"libraryfolders"\n{\n "0"\n {\n  "path"  "C:\\\\Program Files (x86)\\\\Steam"\n  "apps" { "570" "123" }\n }\n "1" { "path" "D:\\\\SteamLibrary" }\n}`);
    const lf = vdf.libraryfolders as Record<string, { path: string }>;
    expect(lf['0'].path).toBe('C:\\Program Files (x86)\\Steam');
    expect(lf['1'].path).toBe('D:\\SteamLibrary');
    const acf = parseVdf('"AppState"\n{\n\t"appid"\t\t"570"\n\t"name"\t\t"Dota 2"\n\t"installdir"\t\t"dota 2 beta"\n}');
    expect(acf.AppState).toMatchObject({ appid: '570', name: 'Dota 2', installdir: 'dota 2 beta' });
  });

  it('parses reg query output, including GOG game keys', () => {
    const out = [
      '',
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1207658924',
      '    gameName    REG_SZ    Some RPG',
      `    exe    REG_SZ    ${process.execPath}`,
      `    path    REG_SZ    ${path.dirname(process.execPath)}`,
      '    launchParam    REG_SZ    -fullscreen',
      '    gameID    REG_SZ    1207658924',
      '',
    ].join('\r\n');
    const keys = parseRegOutput(out);
    expect(keys).toHaveLength(1);
    expect(keys[0].values.gameName).toBe('Some RPG');
    const games = parseGogKeys(keys);
    expect(games[0]).toMatchObject({ title: 'Some RPG', source: 'gog', launchMethod: 'exe', args: '-fullscreen', sourceId: '1207658924' });
  });

  it('parses Epic manifests into store-URI launches', () => {
    const dir = tmp();
    const g = parseEpicManifest({ DisplayName: 'Cool Game', InstallLocation: dir, LaunchExecutable: 'cool.exe', AppName: 'Cool', CatalogNamespace: 'ns', CatalogItemId: 'item', AppCategories: ['public', 'games', 'applications'] });
    expect(g?.launchMethod).toBe('uri');
    expect(g?.launchUri).toBe('com.epicgames.launcher://apps/ns%3Aitem%3ACool?action=launch&silent=true');
    expect(parseEpicManifest({ DisplayName: 'DLC', InstallLocation: dir, AppCategories: ['addons'] })).toBeNull();
  });

  it('parses Xbox MicrosoftGame.config', () => {
    const cfg = parseMicrosoftGameConfig('<Game><Identity Name="Studio.Game" Publisher="CN=x"/><ExecutableList><Executable Name="Game.exe" Id="Game"/></ExecutableList><ShellVisuals DefaultDisplayName="My Xbox Game"/></Game>');
    expect(cfg).toEqual({ identityName: 'Studio.Game', exeName: 'Game.exe', appId: 'Game', displayName: 'My Xbox Game' });
  });

  it('picks the main game executable over helpers', () => {
    const dir = tmp();
    const big = Buffer.alloc(600 * 1024);
    fs.writeFileSync(path.join(dir, 'unins000.exe'), Buffer.alloc(2 * 1024 * 1024));
    fs.writeFileSync(path.join(dir, 'CrashReporter.exe'), Buffer.alloc(3 * 1024 * 1024));
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin', 'SpaceGame.exe'), big);
    expect(findBestExecutable(dir, 'Space Game')).toBe(path.join(dir, 'bin', 'SpaceGame.exe'));
  });
});

describe('validation', () => {
  it('only allows whitelisted URI schemes', () => {
    expect(isAllowedUri('steam://rungameid/10')).toBe(true);
    expect(isAllowedUri('com.epicgames.launcher://apps/x')).toBe(true);
    expect(isAllowedUri('file:///C:/Windows/System32/cmd.exe')).toBe(false);
    expect(isAllowedUri('javascript:alert(1)')).toBe(false);
    expect(() => validatePatch({ launchUri: 'http://evil.example' })).toThrow();
  });

  it('rejects missing or non-executable paths', () => {
    expect(() => validatePatch({ exePath: 'C:\\nope\\missing.exe' })).toThrow(/not found/);
    expect(() => validatePatch({ exePath: path.join(tmp(), 'x.txt') })).toThrow(/Unsupported/);
    expect(() => validatePatch({ category: 'moon' })).toThrow();
    expect(validatePatch({ title: '  Hi  ', chest: { x: 1.4, y: 33, z: -2, facing: 5 } })).toEqual({ title: 'Hi', chest: { x: 1, y: 33, z: -2, facing: 1 } });
  });

  it('clamps settings and keeps defaults for junk', () => {
    const s = validateSettings({ fov: 999, renderDistance: 'x', graphics: 'ultra', keyBindings: { jump: 'KeyJ' } });
    expect(s.fov).toBe(110);
    expect(s.renderDistance).toBe(DEFAULT_SETTINGS.renderDistance);
    expect(s.graphics).toBe(DEFAULT_SETTINGS.graphics);
    expect(s.keyBindings.jump).toBe('KeyJ');
    expect(s.keyBindings.forward).toBe('KeyW');
  });

  it('sanitises world saves', () => {
    const w = validateWorldSave({ seed: 5, mods: [['1,2,3', 4], ['bad'], 7], player: { x: 1, y: 2, z: 3, yaw: 0, pitch: 0 }, inventory: { slots: [{ id: 'tool:axe', count: 1 }, null, { id: 3 }], selected: 20 }, timeOfDay: 4 });
    expect(w.mods).toEqual([['1,2,3', 4]]);
    expect(w.inventory.slots).toEqual([{ id: 'tool:axe', count: 1 }, null, null]);
    expect(w.inventory.selected).toBe(8);
    expect(w.timeOfDay).toBe(1);
  });
});

describe('library', () => {
  it('persists games, edits and removal across instances', () => {
    const dir = tmp();
    const lib = new GameLibrary(dir);
    const g = lib.add({ title: 'Valheim', source: 'steam', sourceId: '892970', installDir: dir, exePath: '', args: '', workingDir: '', launchMethod: 'uri', launchUri: 'steam://rungameid/892970', description: '', category: guessCategory('Valheim') }, 'oak');
    expect(g.category).toBe('survival');
    lib.update(g.id, { chest: { x: 5, y: 33, z: 6, facing: 2 }, description: 'Vikings' });
    lib.addPlaytime(g.id, 120, true);
    const again = new GameLibrary(dir);
    expect(again.get(g.id)).toMatchObject({ description: 'Vikings', chest: { x: 5, y: 33, z: 6, facing: 2 }, playtimeSeconds: 120 });
    expect(again.has({ source: 'steam', sourceId: '892970', exePath: '', installDir: '' })).toBe(true);
    again.update(g.id, { chest: null });
    expect(again.get(g.id)?.chest).toBeUndefined();
    again.remove(g.id);
    expect(new GameLibrary(dir).list()).toHaveLength(0);
  });
});

describe('launcher', () => {
  it('splits arguments with quotes', () => {
    expect(parseArgs('-windowed -name "Big Player" --x=1')).toEqual(['-windowed', '-name', 'Big Player', '--x=1']);
    expect(parseArgs('  ')).toEqual([]);
    expect(parseArgs('"" a')).toEqual(['', 'a']);
  });

  const mkGame = (over: Partial<Game>): Game => ({
    id: 'g1', title: 'Test Game', source: 'manual', installDir: path.dirname(process.execPath), exePath: process.execPath,
    args: '', workingDir: '', launchMethod: 'exe', description: '', category: 'indie', chestStyle: 'oak',
    playtimeSeconds: 0, addedAt: 0, launchConfigs: [], ...over,
  });

  function harness(game: Game) {
    const events: GameStatus[] = [];
    let launched = 0;
    const opened: string[] = [];
    const l = new GameLauncher({
      shell: { openExternal: async (u) => { opened.push(u); }, openPath: async () => '' },
      getGame: (id) => (id === game.id ? game : undefined),
      allGames: () => [game],
      recordLaunch: () => { launched++; game.lastPlayed = Date.now(); },
      addPlaytime: (_id, s) => { game.playtimeSeconds += s; return game; },
      listProcesses: async () => new Set<string>(),
    }, 100000);
    l.on('status', (s) => events.push(s));
    return { l, events, opened, launched: () => launched };
  }

  it('really spawns an executable with args and tracks it as running', async () => {
    // node itself is our "game": it runs for 1.5s then exits
    const game = mkGame({ args: '-e "setTimeout(()=>{},1500)"', launchConfigs: [{ id: 'c1', name: 'quick', args: '-e "process.exit(0)"', workingDir: '' }] });
    const h = harness(game);
    const res = await h.l.launch('g1');
    expect(res).toEqual({ ok: true });
    expect(h.launched()).toBe(1);
    expect(h.l.isRunning('g1')).toBe(true);
    const again = await h.l.launch('g1');
    expect(again.alreadyRunning).toBe(true);
    await new Promise((r) => setTimeout(r, 2200));
    await h.l.poll();
    expect(h.l.isRunning('g1')).toBe(false);
    expect(h.events.some((e) => e.running)).toBe(true);
    expect(h.events.at(-1)?.running).toBe(false);
  });

  it('reports a clear error for a missing executable', async () => {
    const h = harness(mkGame({ exePath: 'C:\\definitely\\missing\\game.exe' }));
    const res = await h.l.launch('g1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it('reports games that crash immediately', async () => {
    const h = harness(mkGame({ args: '-e "process.exit(3)"' }));
    expect((await h.l.launch('g1')).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 1200));
    expect(h.events.some((e) => /exit code 3/.test(e.error ?? ''))).toBe(true);
  });

  it('launches store games via whitelisted URI only', async () => {
    const ok = harness(mkGame({ launchMethod: 'uri', launchUri: 'steam://rungameid/570' }));
    expect((await ok.l.launch('g1')).ok).toBe(true);
    expect(ok.opened).toEqual(['steam://rungameid/570']);
    const bad = harness(mkGame({ launchMethod: 'uri', launchUri: 'file:///C:/Windows/notepad.exe' }));
    expect((await bad.l.launch('g1')).ok).toBe(false);
    expect(bad.opened).toEqual([]);
  });
});

describe('skin validation', () => {
  const png = (w: number, h: number) => {
    const b = Buffer.alloc(40);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write('IHDR', 12, 'ascii');
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  it('accepts 64x64, legacy 64x32 and HD skins', async () => {
    const { validateSkinPng } = await import('../src/main/skin');
    expect(validateSkinPng(png(64, 64))).toEqual({ width: 64, height: 64 });
    expect(validateSkinPng(png(64, 32))).toEqual({ width: 64, height: 32 });
    expect(validateSkinPng(png(128, 128))).toEqual({ width: 128, height: 128 });
  });
  it('rejects non-PNGs and wrong sizes', async () => {
    const { validateSkinPng } = await import('../src/main/skin');
    expect(() => validateSkinPng(Buffer.from('not a png at all, definitely not a png'))).toThrow(/not a PNG/);
    expect(() => validateSkinPng(png(100, 100))).toThrow(/64×64/);
    expect(() => validateSkinPng(png(64, 48))).toThrow(/64×64/);
  });
  it('stores and resets a skin file', async () => {
    const { SkinStore } = await import('../src/main/skin');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-'));
    const src = path.join(dir, 'in.png');
    fs.writeFileSync(src, png(64, 64));
    const store = new SkinStore(dir);
    expect(store.get()).toBeNull();
    expect(store.set(src)).toMatch(/^data:image\/png;base64,/);
    expect(store.get()).toMatch(/^data:image\/png;base64,/);
    store.reset();
    expect(store.get()).toBeNull();
    await expect(store.fetchByName('bad name!')).rejects.toThrow(/usernames/);
  });
});

describe('settings: camera key + skin model', () => {
  it('defaults camera to F5 and sanitises skinModel', () => {
    expect(validateSettings({}).keyBindings.camera).toBe('F5');
    expect(validateSettings({ skinModel: 'slim' }).skinModel).toBe('slim');
    expect(validateSettings({ skinModel: 'huge' }).skinModel).toBe('classic');
  });
});
