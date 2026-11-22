import type { ItemStack } from '../../shared/types';
import { B } from '../engine/blocks';
import { ELYTRA_ID, FIREWORK_ID, blockItemId, itemDef } from './items';

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36; // 0..8 hotbar, 9..35 storage

export function defaultSlots(): (ItemStack | null)[] {
  const s: (ItemStack | null)[] = new Array(INVENTORY_SIZE).fill(null);
  const put = (i: number, id: string, count = 1) => { s[i] = { id, count }; };
  put(0, 'tool:pickaxe');
  put(1, 'tool:axe');
  put(2, 'tool:shovel');
  put(3, 'tool:sword');
  put(4, blockItemId(B.PLANKS), 64);
  put(5, blockItemId(B.STONE_BRICKS), 64);
  put(6, blockItemId(B.GLASS), 64);
  put(7, blockItemId(B.TORCH), 64);
  put(8, 'tool:seeker');
  [B.GRASS, B.DIRT, B.COBBLE, B.BRICKS, B.SAND, B.LAMP, B.LOG, B.WOOL_RED, B.WOOL_BLUE, B.WOOL_YELLOW]
    .forEach((b, i) => put(9 + i, blockItemId(b), 64));
  put(19, ELYTRA_ID);
  put(20, FIREWORK_ID, 64);
  return s;
}

/** Hotbar + storage inventory with stacking. */
export class Inventory {
  slots: (ItemStack | null)[];
  selected = 0;
  /** equipment worn on the back (only an elytra fits) */
  back: ItemStack | null = null;
  private listeners: (() => void)[] = [];

  constructor(slots?: (ItemStack | null)[], selected = 0, back: ItemStack | null = null) {
    this.back = back && back.id === ELYTRA_ID ? { id: ELYTRA_ID, count: 1 } : null;
    this.slots = new Array(INVENTORY_SIZE).fill(null);
    const src = slots && slots.length ? slots : defaultSlots();
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const st = src[i];
      this.slots[i] = st && itemDef(st.id) ? { id: st.id, count: Math.min(st.count, itemDef(st.id)!.maxStack) } : null;
    }
    // Never lose the game seeker tool: it's how you reach chests from afar.
    if (!this.slots.some((s) => s?.id === 'tool:seeker')) this.add('tool:seeker', 1);
    this.selected = Math.max(0, Math.min(HOTBAR_SIZE - 1, selected));
  }

  onChange(fn: () => void): void { this.listeners.push(fn); }
  changed(): void { for (const l of this.listeners) l(); }

  get held(): ItemStack | null {
    return this.slots[this.selected];
  }

  select(i: number): void {
    const n = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    if (n !== this.selected) { this.selected = n; this.changed(); }
  }

  /** Add items, stacking into existing stacks first (hotbar priority). Returns the count that didn't fit. */
  add(id: string, count: number): number {
    const def = itemDef(id);
    if (!def) return count;
    for (let i = 0; i < INVENTORY_SIZE && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < def.maxStack) {
        const n = Math.min(count, def.maxStack - s.count);
        s.count += n; count -= n;
      }
    }
    for (let i = 0; i < INVENTORY_SIZE && count > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(count, def.maxStack);
        this.slots[i] = { id, count: n }; count -= n;
      }
    }
    this.changed();
    return count;
  }

  /** Remove one item from the selected slot (placing a block). */
  consumeHeld(): void {
    const s = this.held;
    if (!s) return;
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.changed();
  }

  get wearingElytra(): boolean {
    return this.back?.id === ELYTRA_ID;
  }

  /** Right-click with an elytra in hand: put it on, swapping with whatever was worn. */
  equipHeld(): boolean {
    const s = this.held;
    if (!s || s.id !== ELYTRA_ID) return false;
    this.slots[this.selected] = this.back;
    this.back = s;
    this.changed();
    return true;
  }

  serialize(): { slots: (ItemStack | null)[]; selected: number; back: ItemStack | null } {
    return { slots: this.slots.map((s) => (s ? { ...s } : null)), selected: this.selected, back: this.back ? { ...this.back } : null };
  }
}
