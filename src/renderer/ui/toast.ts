import { h } from './dom';

export type ToastKind = 'info' | 'success' | 'error';

/** Stacked notifications in the top-right corner. */
export class Toasts {
  private root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = h('div', { class: 'toasts' });
    parent.append(this.root);
  }

  show(title: string, body = '', kind: ToastKind = 'info', ms = 4500): void {
    const el = h('div', { class: `toast toast-${kind}` }, h('div', { class: 'toast-title' }, title), body ? h('div', { class: 'toast-body' }, body) : null);
    this.root.append(el);
    while (this.root.children.length > 5) this.root.firstElementChild?.remove();
    setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 400); }, ms);
  }
}
