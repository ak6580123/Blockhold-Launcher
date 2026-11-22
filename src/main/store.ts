import fs from 'node:fs';
import path from 'node:path';

/** Small JSON file store with atomic writes (write temp file, then rename). */
export class JsonStore<T> {
  private readonly file: string;

  constructor(dir: string, name: string, private readonly defaults: () => T) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, name);
  }

  exists(): boolean {
    return fs.existsSync(this.file);
  }

  read(): T {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      return JSON.parse(raw) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Corrupt file: keep a copy so the user's data is not silently lost.
        try { fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch { /* ignore */ }
        console.error(`[store] failed to read ${this.file}:`, err);
      }
      return this.defaults();
    }
  }

  write(data: T): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  delete(): void {
    try { fs.unlinkSync(this.file); } catch { /* ignore */ }
  }
}
