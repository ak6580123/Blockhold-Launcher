import { HOTBAR_SIZE, type Inventory } from '../inventory/inventory';
import { itemDef, itemIcon } from '../inventory/items';
import { clear, h, keyLabel } from './dom';

export function slotContent(stack: { id: string; count: number } | null): HTMLElement[] {
  if (!stack) return [];
  const out: HTMLElement[] = [h('div', { class: 'item-icon', style: `background-image:url(${itemIcon(stack.id)})` })];
  if (stack.count > 1) out.push(h('div', { class: 'item-count' }, String(stack.count)));
  return out;
}

/** In-game overlay: crosshair, hotbar, prompts, region banner, debug info. */
export class Hud {
  readonly root: HTMLElement;
  private hotbar: HTMLElement;
  private heldName: HTMLElement;
  private prompt: HTMLElement;
  private banner: HTMLElement;
  private debug: HTMLElement;
  private fps: HTMLElement;
  private carry: HTMLElement;
  private compass: HTMLElement;
  private heldTimer = 0;
  private bannerTimer = 0;
  private promptKey = '';

  constructor(parent: HTMLElement, private inv: Inventory) {
    this.hotbar = h('div', { class: 'hotbar' });
    this.heldName = h('div', { class: 'held-name' });
    this.prompt = h('div', { class: 'prompt' });
    this.banner = h('div', { class: 'region-banner' });
    this.debug = h('div', { class: 'debug', style: 'display:none' });
    this.fps = h('div', { class: 'fps', style: 'display:none' });
    this.carry = h('div', { class: 'carry-hint', style: 'display:none' });
    this.compass = h('div', { class: 'compass' });
    this.root = h('div', { class: 'hud' }, h('div', { class: 'crosshair' }), this.compass, this.banner, this.prompt, this.carry, this.heldName, this.hotbar, this.debug, this.fps);
    parent.append(this.root);
    inv.onChange(() => this.renderHotbar());
    this.renderHotbar();
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  renderHotbar(): void {
    clear(this.hotbar);
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const s = this.inv.slots[i];
      this.hotbar.append(h('div', { class: `hslot${i === this.inv.selected ? ' sel' : ''}` }, h('div', { class: 'key' }, String(i + 1)), ...slotContent(s)));
    }
  }

  showHeldName(): void {
    const s = this.inv.held;
    this.heldName.textContent = s ? itemDef(s.id)?.name ?? '' : '';
    this.heldName.style.opacity = '1';
    this.heldTimer = 2;
  }

  /** title + key hints shown under the crosshair (e.g. looking at a chest) */
  setPrompt(title: string, keys: [string, string][]): void {
    const k = title + keys.map((x) => x.join(':')).join('|');
    if (k === this.promptKey) return;
    this.promptKey = k;
    clear(this.prompt);
    if (!title) return;
    this.prompt.append(
      h('div', { class: 'p-title' }, title),
      h('div', { class: 'p-keys' }, ...keys.flatMap(([code, label]) => [h('kbd', {}, keyLabel(code)), ` ${label}  `])),
    );
  }

  showBanner(name: string, sub: string): void {
    clear(this.banner);
    this.banner.append(h('div', { class: 'r-name' }, name), h('div', { class: 'r-sub' }, sub));
    this.banner.classList.add('show');
    this.bannerTimer = 3.5;
  }

  setCarryHint(text: string | null): void {
    this.carry.style.display = text ? '' : 'none';
    this.carry.textContent = text ?? '';
  }

  setCompass(text: string): void {
    if (this.compass.textContent !== text) this.compass.textContent = text;
  }

  setDebug(text: string | null): void {
    this.debug.style.display = text ? '' : 'none';
    if (text) this.debug.textContent = text;
  }

  setFps(text: string | null): void {
    this.fps.style.display = text ? '' : 'none';
    if (text) this.fps.textContent = text;
  }

  update(dt: number): void {
    if (this.heldTimer > 0) { this.heldTimer -= dt; if (this.heldTimer <= 0) this.heldName.style.opacity = '0'; }
    if (this.bannerTimer > 0) { this.bannerTimer -= dt; if (this.bannerTimer <= 0) this.banner.classList.remove('show'); }
  }
}
