import * as THREE from 'three';
import type { ChestStyle } from '../../shared/types';
import { mulberry32 } from '../engine/noise';

interface StylePalette { body: string; dark: string; trim: string; latch: string; glow?: boolean }
export const CHEST_PALETTES: Record<ChestStyle, StylePalette> = {
  oak: { body: '#a8743a', dark: '#7d5426', trim: '#3b2611', latch: '#cfd3d8' },
  spruce: { body: '#6e4c2a', dark: '#523720', trim: '#24170b', latch: '#cfd3d8' },
  iron: { body: '#a3a9b1', dark: '#7d838b', trim: '#4a4f56', latch: '#e8c33a' },
  gold: { body: '#e8b93c', dark: '#c4952a', trim: '#7a5a10', latch: '#fff6d0' },
  obsidian: { body: '#2c2140', dark: '#1d152c', trim: '#0c0812', latch: '#b07bff', glow: true },
  crimson: { body: '#962f2f', dark: '#732020', trim: '#3c0c0c', latch: '#e8c33a' },
  emerald: { body: '#33a061', dark: '#257a49', trim: '#0f4527', latch: '#f0f0f0', glow: true },
};

function chestTexture(p: StylePalette, kind: 'side' | 'top'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  const r = mulberry32(kind === 'side' ? 11 : 23);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const plankSeam = kind === 'side' ? y % 5 === 4 : x % 5 === 4;
    ctx.fillStyle = plankSeam ? p.dark : r() < 0.12 ? p.dark : p.body;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.fillStyle = p.trim;
  ctx.fillRect(0, 0, 16, 1); ctx.fillRect(0, 15, 16, 1); ctx.fillRect(0, 0, 1, 16); ctx.fillRect(15, 0, 1, 16);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface StyleAssets { side: THREE.Material; top: THREE.Material; latch: THREE.MeshLambertMaterial }
const styleCache = new Map<ChestStyle, StyleAssets>();
function styleAssets(style: ChestStyle): StyleAssets {
  let s = styleCache.get(style);
  if (s) return s;
  const p = CHEST_PALETTES[style];
  const latch = new THREE.MeshLambertMaterial({ color: p.latch, emissive: p.glow ? new THREE.Color(p.latch) : new THREE.Color(0), emissiveIntensity: p.glow ? 0.6 : 0 });
  s = {
    side: new THREE.MeshLambertMaterial({ map: chestTexture(p, 'side') }),
    top: new THREE.MeshLambertMaterial({ map: chestTexture(p, 'top') }),
    latch,
  };
  styleCache.set(style, s);
  return s;
}

const U = 1 / 16;
const baseGeo = new THREE.BoxGeometry(14 * U, 10 * U, 14 * U).translate(0, 5 * U, 0);
// lid hinges on its back-top edge: geometry extends forward (+z) from the pivot
const lidGeo = new THREE.BoxGeometry(14 * U, 5 * U, 14 * U).translate(0, 2.5 * U, 7 * U);
const latchGeo = new THREE.BoxGeometry(2 * U, 4 * U, 1 * U).translate(0, 1 * U, 14.5 * U);

export interface ChestMesh {
  group: THREE.Group;
  lid: THREE.Group;
  latchMat: THREE.MeshLambertMaterial;
  baseEmissive: THREE.Color;
  baseIntensity: number;
}

export function createChestMesh(style: ChestStyle): ChestMesh {
  const a = styleAssets(style);
  const mats = [a.side, a.side, a.top, a.top, a.side, a.side];
  const group = new THREE.Group();
  const base = new THREE.Mesh(baseGeo, mats);
  base.castShadow = base.receiveShadow = true;
  const lid = new THREE.Group();
  lid.position.set(0, 10 * U, -7 * U);
  const lidMesh = new THREE.Mesh(lidGeo, mats);
  lidMesh.castShadow = true;
  const latchMat = a.latch.clone();
  const latch = new THREE.Mesh(latchGeo, latchMat);
  lid.add(lidMesh, latch);
  group.add(base, lid);
  return { group, lid, latchMat, baseEmissive: latchMat.emissive.clone(), baseIntensity: latchMat.emissiveIntensity };
}

/** Floating name tag drawn to a canvas sprite. */
export function makeLabel(text: string, sub: string, color = '#ffffff'): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = '28px "Pixelify Sans", monospace';
  ctx.font = font;
  const w = Math.min(900, Math.max(ctx.measureText(text).width, sub ? ctx.measureText(sub).width * 0.8 : 0) + 28);
  c.width = Math.ceil(w);
  c.height = sub ? 70 : 44;
  ctx.font = font;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  ctx.fillText(text, c.width / 2, 7, c.width - 12);
  if (sub) {
    ctx.font = '20px "Pixelify Sans", monospace';
    ctx.fillStyle = '#9ef28f';
    ctx.fillText(sub, c.width / 2, 42, c.width - 12);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  const scale = 0.0085;
  sprite.scale.set(c.width * scale, c.height * scale, 1);
  return sprite;
}

export function disposeSprite(s: THREE.Sprite): void {
  s.material.map?.dispose();
  s.material.dispose();
}
