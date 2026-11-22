import * as THREE from 'three';

interface Spark {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number; size: number;
  drag: number; gravity: number;
  c: THREE.Color;
  /** twinkles on and off as it fades */
  crackle: boolean;
}

interface Rocket {
  mesh: THREE.Mesh;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  fuse: number;
  colors: THREE.Color[];
  shape: 'ball' | 'big' | 'ring' | 'burst';
}

export interface FireworkSounds {
  launch(x: number, y: number, z: number): void;
  bang(x: number, y: number, z: number, big: boolean): void;
  crackle(x: number, y: number, z: number): void;
}

const PALETTES = [
  [0xff4b3e, 0xffd23f],
  [0x3fa7ff, 0xffffff],
  [0x7dff5a, 0x2ee6c8],
  [0xff5ad8, 0x9b59ff],
  [0xffa31a, 0xff4b3e, 0xfff1a0],
  [0x6ff5ec, 0x9b59ff, 0xffffff],
];

/**
 * Firework rockets and their glowing sparks. Sparks are unlit additive cubes (one draw call),
 * so they read well against the night sky and blend naturally by day.
 */
export class Fireworks {
  private sparks: Spark[] = [];
  private rockets: Rocket[] = [];
  private mesh: THREE.InstancedMesh;
  private rocketGeo = new THREE.BoxGeometry(0.12, 0.38, 0.12);
  private rocketMat = new THREE.MeshLambertMaterial({ color: 0xd8402e });
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private v = new THREE.Vector3();
  private col = new THREE.Color();
  private readonly max = 2400;
  /** where the player-attached rocket's exhaust should come from (null = none) */
  private trailFrom: THREE.Vector3 | null = null;
  private trailAcc = 0;

  constructor(private scene: THREE.Scene, private sounds: FireworkSounds) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, this.max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    scene.add(this.mesh);
  }

  /** Launch a decorative rocket from a point (e.g. the top face of a block). */
  launch(x: number, y: number, z: number): void {
    const pal = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    const shapes: Rocket['shape'][] = ['ball', 'big', 'ring', 'burst'];
    const mesh = new THREE.Mesh(this.rocketGeo, this.rocketMat);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.rockets.push({
      mesh, x, y, z,
      vx: (Math.random() - 0.5) * 1.2, vy: 17 + Math.random() * 4, vz: (Math.random() - 0.5) * 1.2,
      fuse: 1.1 + Math.random() * 0.5,
      colors: pal.map((c) => new THREE.Color(c)),
      shape: shapes[Math.floor(Math.random() * shapes.length)],
    });
    this.sounds.launch(x, y, z);
  }

  /** While gliding on a rocket: spew exhaust sparks behind this point every frame. */
  setTrail(from: THREE.Vector3 | null): void {
    this.trailFrom = from;
  }

  /** A small pop when a rocket strapped to the player burns out. */
  fizzle(x: number, y: number, z: number): void {
    for (let i = 0; i < 18; i++) {
      const d = randomDir(this.v).multiplyScalar(2 + Math.random() * 2);
      this.spark(x, y, z, d.x, d.y, d.z, 0.4 + Math.random() * 0.3, 0.09, this.col.set(0xffd28a), false, 2.5, 4);
    }
    this.sounds.bang(x, y, z, false);
  }

  private spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, c: THREE.Color, crackle: boolean, drag = 1.6, gravity = 3.5): void {
    if (this.sparks.length >= this.max) this.sparks.shift();
    this.sparks.push({ x, y, z, vx, vy, vz, life, max: life, size, drag, gravity, c: c.clone(), crackle });
  }

  private explode(r: Rocket): void {
    const big = r.shape === 'big';
    const n = big ? 260 : r.shape === 'ring' ? 120 : 160;
    const speed = big ? 13 : r.shape === 'burst' ? 6 : 9;
    const crackle = Math.random() < 0.4;
    // ring: random tilt so not every ring is flat
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 1.2 - 0.6, Math.random() * Math.PI, 0));
    for (let i = 0; i < n; i++) {
      let d: THREE.Vector3;
      if (r.shape === 'ring') {
        const a = (i / n) * Math.PI * 2;
        d = this.v.set(Math.cos(a), (Math.random() - 0.5) * 0.08, Math.sin(a)).applyQuaternion(tilt);
      } else if (r.shape === 'burst') {
        d = randomDir(this.v).multiplyScalar(0.3 + Math.random() * 0.9);
        d.y += 0.6;
      } else d = randomDir(this.v);
      const sp = speed * (0.85 + Math.random() * 0.3);
      const c = r.colors[i % r.colors.length];
      this.spark(r.x, r.y, r.z, d.x * sp, d.y * sp, d.z * sp, 1.3 + Math.random() * 0.9, big ? 0.2 : 0.16, c, crackle);
    }
    // bright flash core
    for (let i = 0; i < 12; i++) {
      const d = randomDir(this.v).multiplyScalar(1.5);
      this.spark(r.x, r.y, r.z, d.x, d.y, d.z, 0.25, 0.6, this.col.set(0xffffff), false, 4, 0);
    }
    this.sounds.bang(r.x, r.y, r.z, big);
    if (crackle) window.setTimeout(() => this.sounds.crackle(r.x, r.y, r.z), 900);
  }

  update(dt: number): void {
    // rockets
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.vy -= 4 * dt;
      r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
      r.mesh.position.set(r.x, r.y, r.z);
      r.mesh.rotation.set(r.vz * 0.05, 0, -r.vx * 0.05);
      if (Math.random() < 0.8) this.spark(r.x, r.y - 0.2, r.z, (Math.random() - 0.5) * 0.6, -1.5 - Math.random(), (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.3, 0.08, this.col.set(0xffc46a), false, 2, 2);
      r.fuse -= dt;
      if (r.fuse <= 0) {
        this.explode(r);
        this.scene.remove(r.mesh);
        this.rockets.splice(i, 1);
      }
    }

    // exhaust behind the player while boosting
    if (this.trailFrom) {
      this.trailAcc += dt * 90;
      while (this.trailAcc >= 1) {
        this.trailAcc -= 1;
        const t = this.trailFrom;
        const hot = Math.random() < 0.5;
        this.spark(t.x + (Math.random() - 0.5) * 0.2, t.y + (Math.random() - 0.5) * 0.2, t.z + (Math.random() - 0.5) * 0.2,
          (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5,
          0.35 + Math.random() * 0.35, hot ? 0.11 : 0.07, this.col.set(hot ? 0xffe08a : 0xff7a1a), false, 3, 1);
      }
    } else this.trailAcc = 0;

    // sparks
    let n = 0;
    this.sparks = this.sparks.filter((p) => (p.life -= dt) > 0);
    for (const p of this.sparks) {
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy *= k; p.vz *= k;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const fade = Math.min(1, (p.life / p.max) * 1.6);
      const on = !p.crackle || p.life / p.max > 0.45 || Math.random() < 0.5;
      this.s.setScalar(on ? p.size * (0.4 + 0.6 * fade) : 0.0001);
      this.v.set(p.x, p.y, p.z);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      this.col.copy(p.c).multiplyScalar(fade);
      this.mesh.setColorAt(n, this.col);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

function randomDir(out: THREE.Vector3): THREE.Vector3 {
  const u = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return out.set(r * Math.cos(a), u, r * Math.sin(a));
}
