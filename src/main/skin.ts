import fs from 'node:fs';
import path from 'node:path';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BYTES = 512 * 1024;

/**
 * Check that a buffer is a PNG laid out like a player skin: 64x64 (modern) or 64x32 (legacy).
 * HD skins (128x128 etc.) are accepted too as long as they keep the 1:1 / 2:1 shape.
 */
export function validateSkinPng(buf: Buffer): { width: number; height: number } {
  if (buf.length > MAX_BYTES) throw new Error('Skin file is too large (max 512 KB)');
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG) || buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('That file is not a PNG image');
  }
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  const okWidth = width >= 64 && width <= 1024 && (width & (width - 1)) === 0;
  if (!okWidth || (height !== width && height !== width / 2)) {
    throw new Error(`Skins must be 64×64 or 64×32 pixels (this image is ${width}×${height})`);
  }
  return { width, height };
}

/** The player's custom skin, stored as skin.png in the app's data folder. */
export class SkinStore {
  private file: string;
  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'skin.png');
  }

  get(): string | null {
    try {
      const buf = fs.readFileSync(this.file);
      validateSkinPng(buf);
      return toDataUrl(buf);
    } catch {
      return null;
    }
  }

  /** Validate and copy a user-chosen file in; returns its data URL. */
  set(sourcePath: string): string {
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile()) throw new Error('Not a file');
    if (stat.size > MAX_BYTES) throw new Error('Skin file is too large (max 512 KB)');
    const buf = fs.readFileSync(sourcePath);
    validateSkinPng(buf);
    fs.writeFileSync(this.file, buf);
    return toDataUrl(buf);
  }

  /** Download a player's current skin by Minecraft username (Mojang's public profile API). */
  async fetchByName(name: string): Promise<{ dataUrl: string; slim: boolean }> {
    if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) throw new Error('Minecraft usernames are 1–16 letters, numbers or _');
    const get = async (url: string) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'BlockholdLauncher' } });
      return res;
    };
    let res: Response;
    try {
      res = await get(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`);
    } catch {
      throw new Error('Could not reach the Minecraft skin service. Check your internet connection.');
    }
    if (res.status === 404 || res.status === 204) throw new Error(`No Minecraft player named "${name}"`);
    if (!res.ok) throw new Error(`Skin lookup failed (HTTP ${res.status})`);
    const { id } = (await res.json()) as { id?: string };
    if (!id || !/^[0-9a-f]{32}$/i.test(id)) throw new Error('Unexpected reply from the skin service');

    res = await get(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`);
    if (!res.ok) throw new Error(`Skin lookup failed (HTTP ${res.status})`);
    const profile = (await res.json()) as { properties?: { name: string; value: string }[] };
    const prop = profile.properties?.find((p) => p.name === 'textures');
    if (!prop) throw new Error(`"${name}" has no skin`);
    const tex = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')) as {
      textures?: { SKIN?: { url?: string; metadata?: { model?: string } } };
    };
    const skin = tex.textures?.SKIN;
    if (!skin?.url) throw new Error(`"${name}" uses the default skin`);
    // only ever download from Mojang's texture host
    const u = new URL(skin.url);
    if (u.hostname !== 'textures.minecraft.net') throw new Error('Unexpected skin location');
    u.protocol = 'https:';
    res = await get(u.toString());
    if (!res.ok) throw new Error(`Skin download failed (HTTP ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    validateSkinPng(buf);
    fs.writeFileSync(this.file, buf);
    return { dataUrl: toDataUrl(buf), slim: skin.metadata?.model === 'slim' };
  }

  reset(): void {
    fs.rmSync(this.file, { force: true });
  }
}

const toDataUrl = (buf: Buffer) => `data:image/png;base64,${buf.toString('base64')}`;
