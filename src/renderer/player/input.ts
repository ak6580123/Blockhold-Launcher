import type { Action, Settings } from '../../shared/types';

type Listener = (code: string, e: KeyboardEvent) => void;

/** Keyboard/mouse state with rebindable actions. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  buttons = new Set<number>();
  private clicked = new Set<number>();
  private keyListeners: Listener[] = [];
  bindings: Settings['keyBindings'];

  constructor(private canvas: HTMLCanvasElement, bindings: Settings['keyBindings']) {
    this.bindings = { ...bindings };
    window.addEventListener('keydown', (e) => {
      if (isTypingTarget(e.target)) return;
      if (!e.repeat) { this.pressed.add(e.code); for (const l of this.keyListeners) l(e.code, e); }
      this.down.add(e.code);
      // keep browser shortcuts (Ctrl+W, Tab focus, F-keys) from interfering with gameplay
      if (this.locked && (e.code === 'Tab' || e.ctrlKey || e.code === 'Space' || e.code.startsWith('F'))) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => { this.down.clear(); this.buttons.clear(); });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Chromium occasionally reports huge spikes on lock/unlock; ignore them
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button);
      this.clicked.add(e.button);
    });
    document.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    document.addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  async lock(): Promise<void> {
    if (this.locked) return;
    try {
      await this.canvas.requestPointerLock({ unadjustedMovement: true } as PointerLockOptions);
    } catch {
      try { await this.canvas.requestPointerLock(); } catch { /* user gesture/cooldown; caller shows a "click to play" prompt */ }
    }
  }

  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    this.buttons.clear();
  }

  onKey(l: Listener): void {
    this.keyListeners.push(l);
  }

  isDown(a: Action): boolean {
    const code = this.bindings[a];
    if (a === 'sprint' && this.down.has('ShiftRight')) return true;
    if (a === 'crouch' && this.down.has('ControlRight')) return true;
    return this.down.has(code);
  }

  wasPressed(a: Action): boolean {
    return this.pressed.has(this.bindings[a]);
  }

  /** Mark a key press as handled so gameplay doesn't also react to it this frame. */
  consume(code: string): void {
    this.pressed.delete(code);
  }

  codeDown(code: string): boolean {
    return this.down.has(code);
  }

  wasClicked(button: number): boolean {
    return this.clicked.has(button);
  }

  /** Clear per-frame state; call at the end of each frame. */
  endFrame(): void {
    this.pressed.clear();
    this.clicked.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  releaseAll(): void {
    this.down.clear();
    this.buttons.clear();
  }
}

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}
