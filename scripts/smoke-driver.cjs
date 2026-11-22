// Loaded by the main process in --smoke mode. Drives the renderer via its __blockhold debug hook.
const fs = require('node:fs');
const path = require('node:path');

const OUT = process.env.BLOCKHOLD_SMOKE_OUT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function run({ getWindow }) {
  const win = getWindow();
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
    console.log(`[smoke] screenshot ${name}.png`);
  };
  const check = (cond, msg) => { console.log(`[smoke] ${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };

  for (let i = 0; i < 100; i++) { if (await js('!!window.__blockhold').catch(() => false)) break; await sleep(200); }
  check(await js('!!window.__blockhold'), 'renderer booted');
  await sleep(2500);
  await shot('01-title');

  // ---- milestone 1: world + movement + collision
  await js('__blockhold.enter()');
  await sleep(1500);
  let st = await js('__blockhold.state()');
  console.log('[smoke] state', JSON.stringify({ mode: st.mode, pos: st.pos, stats: st.stats, chests: st.chests }));
  check(st.stats.meshed > 20, `chunks meshed (${st.stats.meshed})`);
  await js('__blockhold.look(0, 0)');
  const p0 = st.pos;
  const p1 = await js(`__blockhold.simulate(['forward'], 1)`);
  check(p0[2] - p1[2] > 3, `walked forward ~4 blocks (dz=${(p0[2] - p1[2]).toFixed(2)})`);
  await js('__blockhold.teleport(0.5, 7.5)');
  await js('__blockhold.look(Math.PI, 0)'); // face +z, away from the waystone
  const s0 = await js('__blockhold.state().pos');
  const s1 = await js(`__blockhold.simulate(['forward','sprint'], 1)`);
  check(s1[2] - s0[2] > (p0[2] - p1[2]) + 0.5, `sprint is faster than walking (${(s1[2] - s0[2]).toFixed(2)} vs ${(p0[2] - p1[2]).toFixed(2)})`);
  const ground = await js('__blockhold.state().pos[1]');
  await js(`__blockhold.simulate(['jump'], 0.25)`);
  const airY = await js('__blockhold.state().pos[1]');
  check(airY - ground > 0.6, `jump lifts player (${(airY - ground).toFixed(2)})`);
  await js(`__blockhold.simulate([], 1.2)`);
  st = await js('__blockhold.state()');
  check(st.onGround && Math.abs(st.pos[1] - ground) < 0.01, 'lands back on the ground (collision)');
  // walk into the spawn waystone (solid) -> must stop before it
  await js('__blockhold.teleport(0.5, 6.5)');
  await js('__blockhold.look(0, 0)');
  const pw = await js(`__blockhold.simulate(['forward'], 3)`);
  check(pw[2] > 1.2, `blocked by the waystone at z=1 (z=${pw[2].toFixed(2)})`);
  await shot('02-spawn');

  // ---- block breaking & placing
  await js('__blockhold.teleport(4.5, 4.5)');
  await js('__blockhold.look(0, -0.75)'); // a floor block ~2 ahead (not the one we stand on)
  const tgt = await js('__blockhold.target()');
  check(!!tgt, `looking at a block below (${tgt && tgt.id})`);
  await js('__blockhold.select(0)'); // pickaxe
  const broke = await js('__blockhold.breakTarget()');
  check(broke, 'broke the block with the pickaxe');
  await js('__blockhold.select(5)'); // stone bricks
  const placed = await js('__blockhold.placeTarget()');
  check(placed, 'placed a block');

  // ---- inventory
  await js('__blockhold.openInventory()');
  await sleep(300);
  await shot('03-inventory');
  check((await js('__blockhold.state().mode')) === 'inventory', 'inventory opened');
  await js('__blockhold.resume()');

  // ---- milestone 3/4: add a real game, chest appears, open it, launch it
  // PING.EXE stands in for a game: a real executable that runs ~5s with arguments, then exits
  const exe = 'C:\\Windows\\System32\\PING.EXE';
  const added = await js(`window.launcher.library.add({ exePath: ${JSON.stringify(exe)}, title: 'Smoke Test Game', args: '-n 6 127.0.0.1' })`);
  await js('__blockhold.reload()');
  await sleep(300);
  st = await js('__blockhold.state()');
  const g = st.games.find((x) => x.id === added.id);
  check(!!g && !!g.chest, `game got a physical chest at ${g && JSON.stringify(g.chest)}`);
  await js(`__blockhold.teleportToChest(${JSON.stringify(added.id)})`);
  await sleep(1200);
  const look = await js('__blockhold.target()');
  check(look && look.id === 33, 'standing in front of the chest, looking at it');
  await shot('04-chest-world');
  await js(`__blockhold.openChest(${JSON.stringify(added.id)})`);
  await sleep(900);
  await shot('05-chest-ui');
  const clicked = await js(`__blockhold.clickButton('▶ Play')`);
  check(clicked, 'clicked Play');
  await sleep(1500);
  const running = await js('window.launcher.launcher.running()');
  check(running.some((r) => r.id === added.id && r.running), 'launched game is detected as running');
  const chestText = await js('__blockhold.ui()');
  check(/is starting|RUNNING/.test(chestText), 'chest UI shows launch feedback');
  await shot('06-launched');
  await js('__blockhold.resume()');

  // ---- library + settings screens
  await js('__blockhold.openLibrary()');
  await sleep(400);
  await shot('07-library');
  await js('__blockhold.openSettings()');
  await sleep(300);
  await shot('08-settings');
  await js('__blockhold.resume()');

  // ---- regions at night
  const names = ['survival', 'adventure', 'rpg', 'fps', 'indie', 'sandbox'];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + Math.PI / 6;
    const cx = Math.round(Math.cos(a) * 78), cz = Math.round(Math.sin(a) * 78);
    // stand inside the plaza near its gate, looking at the waystone
    const px = cx + 0.5 - Math.cos(a) * 11, pz = cz + 0.5 - Math.sin(a) * 11;
    await js(`__blockhold.teleport(${px}, ${pz})`);
    await js(`__blockhold.look(${Math.atan2(-(cx + 0.5 - px), -(cz + 0.5 - pz))}, -0.12)`);
    await sleep(2200);
    await shot(`09-region-${names[i]}`);
  }
  // ---- third-person camera views + skin settings
  await js('__blockhold.setTime(0.25)');
  await js('__blockhold.teleport(6.5, 10.5)');
  await js('__blockhold.look(0.6, -0.2)');
  await js('__blockhold.setCameraView(1)');
  await js(`__blockhold.simulate(['forward'], 0.3)`);
  await sleep(600);
  await shot('11-third-person-back');
  await js('__blockhold.setCameraView(2)');
  await sleep(400);
  await shot('12-third-person-front');
  await js('__blockhold.setCameraView(0)');
  await js('__blockhold.openSettings()');
  await js("__blockhold.clickButton('Skin')");
  await sleep(300);
  await shot('13-settings-skin');
  await js('__blockhold.resume()');

  await js('__blockhold.setTime(0.78)');
  await sleep(1200);
  await shot('10-night');
  st = await js('__blockhold.state()');
  console.log('[smoke] final', JSON.stringify({ fps: st.fps, stats: st.stats, chests: st.chests }));

  // ---- persistence
  await js('__blockhold.save()');
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.BLOCKHOLD_USER_DATA, 'world.json'), 'utf8'));
  check(saved.mods.length >= 1 && saved.mods.some(([, id]) => id === 12), `world edits saved (${JSON.stringify(saved.mods)})`);
  const lib = JSON.parse(fs.readFileSync(path.join(process.env.BLOCKHOLD_USER_DATA, 'library.json'), 'utf8'));
  check(lib.games.some((x) => x.id === added.id && x.chest && x.lastPlayed), 'library saved with chest position + last played');
  check(fs.existsSync(path.join(process.env.BLOCKHOLD_USER_DATA, 'settings.json')), 'settings saved');
  console.log(`[smoke] library has ${lib.games.length} games (auto-discovered + test)`);
};
