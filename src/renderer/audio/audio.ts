import type { SoundKind } from '../engine/blocks';

/**
 * All sounds are synthesized with WebAudio at runtime (no audio assets to license).
 * Buses: master -> sfx / ambient.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ambient!: GainNode;
  private noiseBuf!: AudioBuffer;
  private wind: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private glide: { filter: BiquadFilterNode; gain: GainNode } | null = null;
  private nextBird = 0;
  private nextCricket = 0;
  private vols = { master: 0.8, sfx: 0.8, ambient: 0.5 };

  /** Must be called from a user gesture (browsers block autoplay). */
  resume(): void {
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  private init(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.ambient = ctx.createGain();
    this.sfx.connect(this.master);
    this.ambient.connect(this.master);
    this.master.connect(ctx.destination);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startWind();
    this.startGlideWind();
  }

  setVolumes(master: number, sfx: number, ambient: number): void {
    this.vols = { master, sfx, ambient };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.vols.master;
    this.sfx.gain.value = this.vols.sfx;
    this.ambient.gain.value = this.vols.ambient;
  }

  private noise(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass', when = 0, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random(), dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo?: number, when = 0, bus?: GainNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private material(kind: SoundKind): { freq: number; q: number; dur: number } {
    switch (kind) {
      case 'stone': return { freq: 900, q: 1.2, dur: 0.12 };
      case 'wood': return { freq: 450, q: 2.5, dur: 0.14 };
      case 'grass': return { freq: 2200, q: 0.7, dur: 0.12 };
      case 'sand': return { freq: 3200, q: 0.5, dur: 0.14 };
      case 'glass': return { freq: 3800, q: 6, dur: 0.2 };
      case 'cloth': return { freq: 1300, q: 0.6, dur: 0.1 };
      default: return { freq: 1000, q: 1, dur: 0.1 };
    }
  }

  hit(kind: SoundKind): void {
    const m = this.material(kind);
    this.noise(m.dur * 0.6, m.freq, m.q, 0.25);
  }

  breakBlock(kind: SoundKind): void {
    const m = this.material(kind);
    this.noise(m.dur * 2, m.freq * 0.8, m.q, 0.6);
    this.noise(m.dur * 1.4, m.freq * 1.3, m.q, 0.3, 'bandpass', 0.03);
    if (kind === 'glass') for (let i = 0; i < 4; i++) this.tone(2500 + Math.random() * 2500, 0.15, 0.06, 'triangle', undefined, i * 0.03);
  }

  place(kind: SoundKind): void {
    const m = this.material(kind);
    this.noise(m.dur * 1.2, m.freq * 0.6, m.q, 0.5);
  }

  step(kind: SoundKind): void {
    const m = this.material(kind);
    this.noise(0.08, m.freq * 0.7, m.q, 0.12, 'bandpass');
  }

  land(): void {
    this.noise(0.2, 300, 0.8, 0.4, 'lowpass');
  }

  chestOpen(): void {
    // creaky wooden hinge + thunk
    this.tone(180, 0.35, 0.12, 'sawtooth', 120);
    this.tone(260, 0.25, 0.05, 'square', 190, 0.05);
    this.noise(0.15, 500, 2, 0.35, 'bandpass', 0.18);
  }

  chestClose(): void {
    this.tone(150, 0.2, 0.08, 'sawtooth', 110);
    this.noise(0.18, 350, 1.5, 0.5, 'bandpass', 0.12);
  }

  click(): void {
    this.tone(1200, 0.05, 0.08, 'square', 900);
  }

  launch(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, 0.12, 'triangle', undefined, i * 0.08));
  }

  error(): void {
    this.tone(220, 0.25, 0.15, 'square', 140);
  }

  teleport(): void {
    this.tone(300, 0.6, 0.12, 'sine', 1400);
    this.tone(450, 0.6, 0.08, 'triangle', 1800, 0.05);
  }

  swish(): void {
    this.noise(0.12, 1800, 0.5, 0.12, 'highpass');
  }

  // ---- elytra & fireworks

  /** Loudness falloff for sounds that happen out in the world. */
  private falloff(dist: number): number {
    return 1 / (1 + (dist / 24) ** 2);
  }

  wingsOpen(): void {
    this.noise(0.25, 700, 0.8, 0.35, 'bandpass', 0, 250);
    this.noise(0.18, 1400, 0.6, 0.15, 'bandpass', 0.06, 500);
  }

  /** A rocket strapped to you: hissing thrust. */
  boost(): void {
    this.noise(0.9, 600, 0.7, 0.45, 'bandpass', 0, 3500);
    this.noise(0.25, 200, 1, 0.4, 'lowpass');
  }

  fireworkLaunch(dist: number): void {
    const v = this.falloff(dist);
    if (v < 0.02) return;
    this.noise(1.1, 900, 1.5, 0.35 * v, 'bandpass', 0, 4200);
    this.tone(900, 1.0, 0.03 * v, 'sine', 2600);
  }

  fireworkBang(dist: number, big: boolean): void {
    const v = this.falloff(dist);
    if (v < 0.01) return;
    // sound travels: far bursts are heard a beat after they're seen
    const delay = Math.min(1.2, dist / 340);
    this.noise(big ? 1.4 : 0.9, big ? 160 : 260, 0.7, (big ? 1.0 : 0.7) * v, 'lowpass', delay);
    this.noise(0.25, 1800, 0.5, 0.25 * v, 'highpass', delay);
    this.tone(big ? 70 : 95, 0.5, 0.25 * v, 'sine', 40, delay);
  }

  fireworkCrackle(dist: number): void {
    const v = this.falloff(dist);
    if (v < 0.02) return;
    for (let i = 0; i < 26; i++) this.noise(0.03, 2500 + Math.random() * 3000, 2, (0.08 + Math.random() * 0.1) * v, 'bandpass', i * 0.035 + Math.random() * 0.03);
  }

  private startGlideWind(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 300;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.sfx);
    src.start();
    this.glide = { filter, gain };
  }

  /** Rushing air while gliding; `speed` in m/s, 0 when not gliding. */
  setGlideWind(speed: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.glide) return;
    const k = Math.min(1, speed / 35);
    const t = ctx.currentTime;
    this.glide.gain.gain.setTargetAtTime(speed > 0 ? 0.04 + 0.4 * k * k : 0, t, 0.15);
    this.glide.filter.frequency.setTargetAtTime(250 + 1500 * k, t, 0.15);
  }

  private startWind(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    const gain = ctx.createGain();
    gain.gain.value = 0.06;
    src.connect(filter).connect(gain).connect(this.ambient);
    src.start();
    this.wind = { src, filter, gain };
  }

  /** Ambience: gusting wind (stronger up high), birds by day, crickets at night, water nearby. */
  updateAmbient(daylight: number, altitude: number, nearWater: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.wind) return;
    const t = ctx.currentTime;
    const gust = 0.5 + 0.5 * Math.sin(t * 0.23) * Math.sin(t * 0.07 + 1);
    const high = Math.min(1, Math.max(0, (altitude - 40) / 40));
    this.wind.gain.gain.setTargetAtTime(0.03 + 0.07 * gust + 0.12 * high, t, 0.5);
    this.wind.filter.frequency.setTargetAtTime(250 + 500 * gust + 400 * high, t, 0.5);
    if (daylight > 0.5 && t > this.nextBird) {
      this.nextBird = t + 2 + Math.random() * 7;
      const base = 2200 + Math.random() * 1800;
      const n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) this.tone(base * (1 + Math.random() * 0.2), 0.09, 0.025, 'sine', base * 1.4, i * 0.12, this.ambient);
    }
    if (daylight < 0.3 && t > this.nextCricket) {
      this.nextCricket = t + 0.6 + Math.random() * 2;
      for (let i = 0; i < 3; i++) this.tone(4300, 0.03, 0.012, 'square', undefined, i * 0.05, this.ambient);
    }
    if (nearWater && Math.random() < 0.02) this.noise(0.6, 600, 0.4, 0.04, 'lowpass');
  }
}
