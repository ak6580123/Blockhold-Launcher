import { REGION_NAMES, type RegionId } from '../../shared/types';
import { button, clear, h } from './dom';

export class PauseMenu {
  readonly el: HTMLElement;
  constructor(actions: { resume(): void; library(): void; settings(): void; spawn(): void; quit(): void }) {
    this.el = h('div', { class: 'screen' },
      h('div', { class: 'menu-col' },
        h('div', { class: 'title-logo' }, 'Game Menu'),
        h('div', { class: 'title-sub' }, 'Paused'),
        h('div', { class: 'btn-col' },
          button('Back to World', actions.resume, 'wide'),
          button('Game Library', actions.library, 'wide'),
          button('Settings', actions.settings, 'wide'),
          button('Return to Spawn', actions.spawn, 'wide'),
          button('Save & Quit Launcher', actions.quit, 'wide danger'),
        )));
  }
}

export class TitleScreen {
  readonly el: HTMLElement;
  private sub: HTMLElement;
  constructor(onEnter: () => void, onLibrary: () => void, onSettings: () => void) {
    this.sub = h('div', { class: 'title-sub' }, 'Your games are waiting in their chests.');
    this.el = h('div', { class: 'screen dim-light' },
      h('div', { class: 'menu-col' },
        h('div', { class: 'title-logo' }, 'BLOCKHOLD'),
        this.sub,
        h('div', { class: 'btn-col' },
          button('Enter World', onEnter, 'wide play'),
          button('Game Library', onLibrary, 'wide'),
          button('Settings', onSettings, 'wide'),
        ),
        h('p', { style: 'color:#ddd;text-shadow:1px 1px 0 #000;text-align:center;max-width:520px;line-height:1.5' },
          'WASD move · Mouse look · Space jump (double-tap to fly) · Shift sprint · Ctrl crouch · Left click break · Right click place / use · E chest or inventory · F quick play · F5 camera view · 1–9 hotbar · Esc menu')));
  }
  setSubtitle(t: string): void { this.sub.textContent = t; }
}

/** Shown when pointer lock could not be re-acquired automatically. */
export class ClickToPlay {
  readonly el: HTMLElement;
  constructor(onClick: () => void) {
    this.el = h('div', { class: 'click-to-play', onclick: onClick }, 'Click to return to the world');
  }
}

export interface WaystoneDest { id: RegionId | 'spawn'; x: number; z: number; games: number }

export class WaystoneScreen {
  readonly el: HTMLElement;
  private list: HTMLElement;
  constructor(private onTravel: (d: WaystoneDest) => void, onClose: () => void) {
    this.list = h('div', { class: 'btn-col' });
    this.el = h('div', { class: 'screen' },
      h('div', { class: 'panel', style: 'width:420px' },
        h('h2', {}, 'Waystone: fast travel'),
        h('p', { class: 'muted' }, 'Every region has a waystone at its centre.'),
        this.list,
        h('div', { class: 'btn-row', style: 'margin-top:10px;justify-content:flex-end' }, button('Close', onClose))));
  }
  open(dests: WaystoneDest[]): void {
    clear(this.list);
    for (const d of dests) {
      const name = d.id === 'spawn' ? 'Spawn' : REGION_NAMES[d.id];
      this.list.append(button(d.id === 'spawn' ? name : `${name} (${d.games} game${d.games === 1 ? '' : 's'})`, () => this.onTravel(d), 'wide'));
    }
  }
}

export class LoadingScreen {
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private msg: HTMLElement;
  constructor() {
    this.bar = h('div');
    this.msg = h('div', { class: 'msg' }, 'Loading…');
    this.el = h('div', { class: 'loading' }, h('div', { class: 'title-logo' }, 'BLOCKHOLD'), h('div', { class: 'bar' }, this.bar), this.msg);
    document.body.append(this.el);
  }
  set(p: number, msg: string): void {
    this.bar.style.width = `${Math.round(p * 100)}%`;
    this.msg.textContent = msg;
  }
  done(): void {
    this.el.remove();
  }
}
