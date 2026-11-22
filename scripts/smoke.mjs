// End-to-end smoke test: starts the real Electron app with a throw-away profile,
// drives it through scripts/smoke-driver.cjs and writes screenshots to smoke-out/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'smoke-out');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'userdata'), { recursive: true });
const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron, [root, '--smoke'], {
  stdio: 'inherit',
  env: { ...process.env, BLOCKHOLD_USER_DATA: path.join(out, 'userdata'), BLOCKHOLD_SMOKE_SCRIPT: path.join(root, 'scripts', 'smoke-driver.cjs'), BLOCKHOLD_SMOKE_OUT: out },
});
child.on('exit', (code) => { console.log(`[smoke] electron exited with ${code}`); process.exit(code ?? 1); });
