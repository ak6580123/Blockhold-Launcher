import type { LauncherAPI } from '../../shared/api';
import type { Settings } from '../../shared/types';

/** Holds current settings, notifies listeners, and persists (debounced) through the backend. */
export class SettingsManager {
  private listeners: ((s: Settings, prev: Settings) => void)[] = [];
  private timer: number | null = null;

  constructor(private api: LauncherAPI, public current: Settings) {}

  onChange(fn: (s: Settings, prev: Settings) => void): void {
    this.listeners.push(fn);
  }

  apply(next: Settings): void {
    const prev = this.current;
    this.current = next;
    for (const l of this.listeners) l(next, prev);
    if (this.timer) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.api.settings.set(this.current).then((v) => { this.current = { ...v }; }).catch((e) => console.error('settings save failed', e));
    }, 350);
  }
}
