import * as THREE from 'three';
import type { SkinModel } from '../../shared/types';

/** One skin pixel in world units: the player is 32 skin-pixels (1.8 m) tall. */
export const PX = 1.8 / 32;

/**
 * Box geometry textured with the standard player-skin layout (64x64 grid, Java-edition style).
 * `w,h,d` are the box size in skin pixels and `u,v` the top-left of its net in the texture.
 * The box faces +Z (front), so the character's right side is -X.
 */
export function skinBox(w: number, h: number, d: number, u: number, v: number, inflate = 0, scale = PX): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry((w + inflate * 2) * scale, (h + inflate * 2) * scale, (d + inflate * 2) * scale);
  const T = 64;
  // rect corners in the texture -> [BL, BR, TR, TL] uv pairs (texture has flipY, so v = 1 - y)
  const rect = (x1: number, y1: number, x2: number, y2: number) => [
    [x1 / T, 1 - y2 / T], [x2 / T, 1 - y2 / T], [x2 / T, 1 - y1 / T], [x1 / T, 1 - y1 / T],
  ];
  const top = rect(u + d, v, u + d + w, v + d);
  const bottom = rect(u + d + w, v, u + d + w * 2, v + d);
  const right = rect(u, v + d, u + d, v + d + h); // character's right side (-X)
  const front = rect(u + d, v + d, u + d + w, v + d + h);
  const left = rect(u + d + w, v + d, u + d * 2 + w, v + d + h); // character's left side (+X)
  const back = rect(u + d * 2 + w, v + d, u + d * 2 + w * 2, v + d + h);
  // BoxGeometry vertex order per face is TL, TR, BL, BR; face order +x, -x, +y, -y, +z, -z
  const std = (f: number[][]) => [f[3], f[2], f[0], f[1]];
  const faces = [std(left), std(right), std(top), [bottom[0], bottom[1], bottom[3], bottom[2]], std(front), std(back)];
  const uv = g.attributes.uv as THREE.BufferAttribute;
  let i = 0;
  for (const f of faces) for (const [a, b] of f) uv.setXY(i++, a, b);
  uv.needsUpdate = true;
  return g;
}

// ---------------------------------------------------------------- texture preparation

/**
 * Turn any accepted skin image (64x64, legacy 64x32, or HD multiples) into a 64x64-layout canvas:
 * legacy skins get mirrored left limbs, and the base layer is forced opaque like the real game does.
 */
export function normalizeSkin(img: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const s = Math.max(1, Math.round(img.width / 64));
  const c = document.createElement('canvas');
  c.width = c.height = 64 * s;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  const legacy = img.height * 2 === img.width;
  if (legacy) {
    // legacy skins: a hat layer with no transparency at all is treated as "no hat"
    const hat = ctx.getImageData(32 * s, 0, 32 * s, 16 * s).data;
    let anyClear = false;
    for (let i = 3; i < hat.length; i += 4) if (hat[i] < 128) { anyClear = true; break; }
    if (!anyClear) ctx.clearRect(32 * s, 0, 32 * s, 16 * s);
    mirrorLimb(ctx, s, 0, 16, 16, 48); // right leg -> left leg
    mirrorLimb(ctx, s, 40, 16, 32, 48); // right arm -> left arm
  }
  // base layer must be opaque
  for (const [x, y, w, h] of [[0, 0, 32, 16], [0, 16, 64, 16], [16, 48, 32, 16]]) {
    const id = ctx.getImageData(x * s, y * s, w * s, h * s);
    for (let i = 3; i < id.data.length; i += 4) id.data[i] = 255;
    ctx.putImageData(id, x * s, y * s);
  }
  return c;
}

/** Copy a 4x12x4 limb net, mirrored, so the left limb isn't a carbon copy of the right one. */
function mirrorLimb(ctx: CanvasRenderingContext2D, s: number, su: number, sv: number, du: number, dv: number): void {
  const w = 4, h = 12, d = 4;
  // [source rect, dest rect] in net-local pixels; sides swap places
  const parts: [number, number, number, number, number, number][] = [
    [d, 0, w, d, d, 0], // top
    [d + w, 0, w, d, d + w, 0], // bottom
    [0, d, d, h, d + w, d], // right side -> left side
    [d, d, w, h, d, d], // front
    [d + w, d, d, h, 0, d], // left side -> right side
    [d * 2 + w, d, w, h, d * 2 + w, d], // back
  ];
  for (const [x, y, pw, ph, dx, dy] of parts) {
    const src = ctx.getImageData((su + x) * s, (sv + y) * s, pw * s, ph * s);
    const out = ctx.createImageData(src.width, src.height);
    for (let yy = 0; yy < src.height; yy++) for (let xx = 0; xx < src.width; xx++) {
      const a = (yy * src.width + xx) * 4, b = (yy * src.width + (src.width - 1 - xx)) * 4;
      for (let k = 0; k < 4; k++) out.data[b + k] = src.data[a + k];
    }
    ctx.putImageData(out, (du + dx) * s, (dv + dy) * s);
  }
}

/** Blockhold's own built-in skin (a green-tunic explorer), drawn procedurally. */
export function defaultSkin(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const fill = (col: string, x: number, y: number, w: number, h: number) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
  // paint a whole box net in one colour, with an optional darker bottom band
  const net = (u: number, v: number, w: number, h: number, d: number, col: string) => {
    fill(col, u + d, v, w * 2, d);
    fill(col, u, v + d, d * 2 + w * 2, h);
  };
  const noise = (x: number, y: number, w: number, h: number, amt: number) => {
    const id = ctx.getImageData(x, y, w, h);
    for (let i = 0; i < id.data.length; i += 4) {
      const n = ((Math.sin((i + x * 7 + y * 13) * 12.9898) * 43758.5453) % 1) * amt;
      for (let k = 0; k < 3; k++) id.data[i + k] = Math.max(0, Math.min(255, id.data[i + k] + n));
    }
    ctx.putImageData(id, x, y);
  };
  const skin = '#c98f69', hair = '#3b2a1e', tunic = '#3f7d3a', tunicDark = '#2f5f2c', trousers = '#5a4632', boots = '#2e2a26', belt = '#7a5a2e';
  // head
  net(0, 0, 8, 8, 8, skin);
  fill(hair, 8, 0, 8, 8); // top of head
  fill(hair, 0, 8, 32, 2); // hairline all round
  fill(hair, 24, 8, 8, 6); // back of head
  fill(hair, 6, 10, 2, 3); fill(hair, 16, 10, 2, 3); // sideburns (side-face edges next to the face)
  // face (front = 8..16, 8..16)
  fill('#ffffff', 9, 12, 2, 1); fill('#ffffff', 13, 12, 2, 1);
  fill('#2b4f7a', 10, 12, 1, 1); fill('#2b4f7a', 13, 12, 1, 1);
  fill(hair, 9, 11, 2, 1); fill(hair, 13, 11, 2, 1); // brows
  fill('#a86f52', 11, 13, 2, 1); // nose shadow
  fill('#8a4b3b', 11, 14, 2, 1); // mouth
  // body / arms / legs
  net(16, 16, 8, 12, 4, tunic);
  fill(tunicDark, 16, 20 + 8, 24, 1);
  fill(belt, 16, 20 + 7, 24, 1);
  net(40, 16, 4, 12, 4, tunic); fill(skin, 40, 20 + 8, 16, 4); fill(skin, 48, 16, 4, 4); // right arm, bare hands
  net(32, 48, 4, 12, 4, tunic); fill(skin, 32, 52 + 8, 16, 4); fill(skin, 40, 48, 4, 4); // left arm
  net(0, 16, 4, 12, 4, trousers); fill(boots, 0, 20 + 9, 16, 3); fill(boots, 8, 16, 4, 4);
  net(16, 48, 4, 12, 4, trousers); fill(boots, 16, 52 + 9, 16, 3); fill(boots, 24, 48, 4, 4);
  noise(0, 16, 56, 16, 10); noise(16, 48, 32, 16, 10);
  return c;
}

/** The current skin texture, shared by the third-person model and the first-person arm. */
export class PlayerSkin {
  readonly texture: THREE.CanvasTexture;
  model: SkinModel = 'classic';
  /** true when the built-in skin is in use */
  isDefault = true;
  private listeners: (() => void)[] = [];

  constructor() {
    this.texture = new THREE.CanvasTexture(defaultSkin());
    this.texture.magFilter = this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  get canvas(): HTMLCanvasElement {
    return this.texture.image as HTMLCanvasElement;
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  /** Load a skin from a data URL, or go back to the built-in skin with null. */
  async set(dataUrl: string | null): Promise<void> {
    let canvas: HTMLCanvasElement;
    if (dataUrl) {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      canvas = normalizeSkin(img);
    } else canvas = defaultSkin();
    this.isDefault = !dataUrl;
    this.texture.image = canvas;
    this.texture.needsUpdate = true;
    this.emit();
  }

  setModel(m: SkinModel): void {
    if (m === this.model) return;
    this.model = m;
    this.emit();
  }
}

/** Flat front view of a skin (both layers) for the settings preview. */
export function drawSkinPreview(target: HTMLCanvasElement, skin: HTMLCanvasElement, model: SkinModel): void {
  const s = skin.width / 64;
  const aw = model === 'slim' ? 3 : 4;
  const ctx = target.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, target.width, target.height);
  const k = target.height / 34; // 32px figure + margin
  const ox = (target.width - 16 * k) / 2, oy = k;
  // [src x, src y, w, h, dest x, dest y] in skin pixels, figure front view (character's right on viewer's left)
  const parts: number[][] = [
    [8, 8, 8, 8, 4, 0], [40, 8, 8, 8, 4, 0], // head + hat
    [20, 20, 8, 12, 4, 8], [20, 36, 8, 12, 4, 8], // body + jacket
    [44, 20, aw, 12, 4 - aw, 8], [44, 36, aw, 12, 4 - aw, 8], // right arm + sleeve
    [36, 52, aw, 12, 12, 8], [52, 52, aw, 12, 12, 8], // left arm + sleeve
    [4, 20, 4, 12, 4, 20], [4, 36, 4, 12, 4, 20], // right leg + pants
    [20, 52, 4, 12, 8, 20], [4, 52, 4, 12, 8, 20], // left leg + pants
  ];
  for (const [sx, sy, w, h, dx, dy] of parts) {
    ctx.drawImage(skin, sx * s, sy * s, w * s, h * s, ox + dx * k, oy + dy * k, w * k, h * k);
  }
}
