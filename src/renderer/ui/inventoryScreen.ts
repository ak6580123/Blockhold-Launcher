import type { ItemStack } from '../../shared/types';
import { HOTBAR_SIZE, INVENTORY_SIZE, type Inventory } from '../inventory/inventory';
import { ELYTRA_ID, PALETTE_ITEMS, itemDef, itemIcon } from '../inventory/items';
import { clear, h } from './dom';
import { slotContent } from './hud';

/** Pixel-style inventory: drag stacks between slots, split stacks, take blocks from the palette. */
export class InventoryScreen {
  readonly el: HTMLElement;
  private cursor: ItemStack | null = null;
  private cursorEl: HTMLElement;
  private tooltip: HTMLElement;
  private storage: HTMLElement;
  private hotbar: HTMLElement;
  private backSlot: HTMLElement;
  private onMove = (e: MouseEvent) => this.moveCursor(e);

  constructor(private inv: Inventory, private onClick: () => void) {
    this.cursorEl = h('div', { class: 'cursor-stack', style: 'display:none' });
    this.tooltip = h('div', { class: 'tooltip', style: 'display:none' });
    this.storage = h('div', { class: 'slot-grid' });
    this.hotbar = h('div', { class: 'slot-grid' });
    this.backSlot = h('div', { class: 'slot', title: 'Back: wear an elytra here' });
    this.backSlot.addEventListener('mousedown', (e) => this.clickBack(e));
    this.hover(this.backSlot, () => this.inv.back, 'Back slot · wear an Elytra here, then press Jump while falling to glide');
    const palette = h('div', { class: 'palette-grid' });
    for (const id of PALETTE_ITEMS) {
      const s = h('div', { class: 'slot' }, ...slotContent({ id, count: 1 }));
      s.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const def = itemDef(id)!;
        this.cursor = { id, count: e.button === 2 ? 1 : def.maxStack };
        this.onClick();
        this.render();
      });
      this.hover(s, () => ({ id, count: 1 }), 'Click: take a stack · Right-click: take one');
      palette.append(s);
    }
    const trash = h('div', { class: 'slot', title: 'Destroy held item', style: 'background:#6b2a2a' }, h('div', { class: 'item-icon', style: 'inset:14px;font-size:22px;color:#fff;text-align:center' }, '✕'));
    trash.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (this.cursor && this.cursor.id !== 'tool:seeker') this.cursor = null;
      this.onClick();
      this.render();
    });
    this.el = h('div', { class: 'screen dim-light' },
      h('div', { class: 'panel inv-panel' },
        h('h2', {}, 'Inventory'),
        h('div', { class: 'inv-section' }, h('h3', {}, 'Item palette'), palette),
        h('div', { class: 'inv-section' }, h('h3', {}, 'Storage'), this.storage),
        h('div', { class: 'inv-section', style: 'display:flex;gap:16px;align-items:flex-end' },
          h('div', {}, h('h3', {}, 'Hotbar'), this.hotbar),
          h('div', {}, h('h3', {}, 'Back'), this.backSlot),
          h('div', {}, h('h3', {}, 'Trash'), trash)),
        h('div', { class: 'muted' }, 'Left-click: pick up / place / swap · Right-click: split or place one · Shift-click: move between hotbar and storage · E or Esc: close'),
      ),
      this.cursorEl, this.tooltip,
    );
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  open(): void {
    document.addEventListener('mousemove', this.onMove);
    this.render();
  }

  close(): void {
    document.removeEventListener('mousemove', this.onMove);
    if (this.cursor) {
      const left = this.inv.add(this.cursor.id, this.cursor.count);
      if (left && this.cursor.id === 'tool:seeker') this.inv.slots[INVENTORY_SIZE - 1] = { id: 'tool:seeker', count: 1 };
      this.cursor = null;
    }
    this.tooltip.style.display = 'none';
    this.inv.changed();
  }

  private moveCursor(e: MouseEvent): void {
    this.cursorEl.style.left = `${e.clientX - 27}px`;
    this.cursorEl.style.top = `${e.clientY - 27}px`;
    this.tooltip.style.left = `${e.clientX + 16}px`;
    this.tooltip.style.top = `${e.clientY + 12}px`;
  }

  private hover(el: HTMLElement, get: () => ItemStack | null, sub = ''): void {
    el.addEventListener('mouseenter', () => {
      const s = get();
      const d = s ? itemDef(s.id) : undefined;
      if (!d || this.cursor) { this.tooltip.style.display = 'none'; return; }
      clear(this.tooltip);
      this.tooltip.append(h('div', {}, d.name), h('div', { class: 'tt-sub' }, sub || d.description));
      this.tooltip.style.display = '';
    });
    el.addEventListener('mouseleave', () => { this.tooltip.style.display = 'none'; });
  }

  private clickSlot(i: number, e: MouseEvent): void {
    e.preventDefault();
    const slots = this.inv.slots;
    const cur = slots[i];
    if (e.shiftKey && cur && !this.cursor) {
      // quick-move between hotbar and storage
      const range = i < HOTBAR_SIZE ? [HOTBAR_SIZE, INVENTORY_SIZE] : [0, HOTBAR_SIZE];
      slots[i] = null;
      let rest = cur.count;
      const max = itemDef(cur.id)?.maxStack ?? 64;
      for (let k = range[0]; k < range[1] && rest > 0; k++) {
        const s = slots[k];
        if (s && s.id === cur.id && s.count < max) { const n = Math.min(rest, max - s.count); s.count += n; rest -= n; }
      }
      for (let k = range[0]; k < range[1] && rest > 0; k++) if (!slots[k]) { slots[k] = { id: cur.id, count: rest }; rest = 0; }
      if (rest > 0) slots[i] = { id: cur.id, count: rest };
    } else if (e.button === 2) {
      if (!this.cursor && cur) {
        const half = Math.ceil(cur.count / 2);
        this.cursor = { id: cur.id, count: half };
        cur.count -= half;
        if (cur.count <= 0) slots[i] = null;
      } else if (this.cursor) {
        const max = itemDef(this.cursor.id)?.maxStack ?? 64;
        if (!cur) { slots[i] = { id: this.cursor.id, count: 1 }; this.cursor.count--; }
        else if (cur.id === this.cursor.id && cur.count < max) { cur.count++; this.cursor.count--; }
        if (this.cursor.count <= 0) this.cursor = null;
      }
    } else {
      if (this.cursor && cur && cur.id === this.cursor.id) {
        const max = itemDef(cur.id)?.maxStack ?? 64;
        const n = Math.min(this.cursor.count, max - cur.count);
        cur.count += n;
        this.cursor.count -= n;
        if (this.cursor.count <= 0) this.cursor = null;
      } else {
        slots[i] = this.cursor;
        this.cursor = cur;
      }
    }
    this.onClick();
    this.render();
  }

  /** The back slot only accepts an elytra; clicking swaps it with the cursor. */
  private clickBack(e: MouseEvent): void {
    e.preventDefault();
    if (this.cursor && this.cursor.id !== ELYTRA_ID) return;
    const worn = this.inv.back;
    this.inv.back = this.cursor;
    this.cursor = worn;
    this.onClick();
    this.render();
  }

  private slotEl(i: number): HTMLElement {
    const el = h('div', { class: 'slot' }, ...slotContent(this.inv.slots[i]));
    el.addEventListener('mousedown', (e) => this.clickSlot(i, e));
    this.hover(el, () => this.inv.slots[i]);
    return el;
  }

  private render(): void {
    clear(this.storage);
    clear(this.hotbar);
    for (let i = HOTBAR_SIZE; i < INVENTORY_SIZE; i++) this.storage.append(this.slotEl(i));
    for (let i = 0; i < HOTBAR_SIZE; i++) this.hotbar.append(this.slotEl(i));
    clear(this.backSlot);
    this.backSlot.append(...slotContent(this.inv.back));
    if (!this.inv.back) this.backSlot.append(h('div', { class: 'item-icon', style: `background-image:url(${itemIcon(ELYTRA_ID)});opacity:0.22;filter:grayscale(1)` }));
    clear(this.cursorEl);
    if (this.cursor) {
      this.cursorEl.append(...slotContent(this.cursor));
      this.cursorEl.style.display = '';
      this.tooltip.style.display = 'none';
    } else this.cursorEl.style.display = 'none';
  }
}
