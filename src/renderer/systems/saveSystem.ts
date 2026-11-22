import type { LauncherAPI } from '../../shared/api';
import type { WorldSave } from '../../shared/types';

/** Periodic + on-exit persistence of world edits, player state, inventory and time of day. */
export class SaveSystem {
  private timer: number | null = null;
  private saving: Promise<void> | null = null;
  lastSaved = 0;

  constructor(private api: LauncherAPI, private collect: () => WorldSave) {}

  start(intervalMs = 20000): void {
    this.timer = window.setInterval(() => void this.save(), intervalMs);
    document.addEventListener('visibilitychange', () => { if (document.hidden) void this.save(); });
    this.api.app.onRequestSave(() => this.save());
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async save(): Promise<void> {
    if (this.saving) return this.saving;
    this.saving = (async () => {
      try {
        await this.api.world.save(this.collect());
        this.lastSaved = Date.now();
      } catch (e) {
        console.error('world save failed', e);
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }
}
