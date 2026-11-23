import * as THREE from 'three';

const RADIUS = 280;
const POOL = 4;
/** Average shooting stars per second at full darkness (~one every 2.5s). */
const NIGHT_RATE = 0.4;

interface Streak {
  mesh: THREE.Mesh;
  pos: THREE.BufferAttribute;
  col: THREE.BufferAttribute;
  active: boolean;
  start: THREE.Vector3; // unit vector on the sky sphere
  dir: THREE.Vector3; // unit tangent the streak travels along
  arc: number; // total radians travelled
  tail: number; // tail length in radians
  width: number;
  life: number; // seconds elapsed
  duration: number;
}

const _h = new THREE.Vector3();
const _t = new THREE.Vector3();
const _side = new THREE.Vector3();

function onSphere(s: Streak, theta: number, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(s.start).multiplyScalar(Math.cos(theta)).addScaledVector(s.dir, Math.sin(theta)).multiplyScalar(RADIUS);
}

/**
 * Bright streaks that zip across the night sky. Each streak is a tapered quad moving along a
 * great circle of the sky dome, additively blended so the black tail fades into the sky.
 */
export class ShootingStars {
  private streaks: Streak[] = [];

  constructor(parent: THREE.Object3D) {
    for (let i = 0; i < POOL; i++) {
      const geo = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array(4 * 3), 3);
      const col = new THREE.BufferAttribute(new Float32Array(4 * 3), 3);
      pos.setUsage(THREE.DynamicDrawUsage);
      col.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', pos);
      geo.setAttribute('color', col);
      geo.setIndex([0, 1, 2, 2, 1, 3]);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, depthWrite: false, fog: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      mesh.frustumCulled = false;
      mesh.visible = false;
      parent.add(mesh);
      this.streaks.push({
        mesh, pos, col, active: false, start: new THREE.Vector3(), dir: new THREE.Vector3(),
        arc: 0, tail: 0, width: 0, life: 0, duration: 1,
      });
    }
  }

  /** darkness: 0 = full day, 1 = full night. */
  update(dt: number, darkness: number): void {
    const rate = NIGHT_RATE * THREE.MathUtils.smoothstep(darkness, 0.6, 1);
    if (rate > 0 && Math.random() < rate * dt) this.spawn();

    for (const s of this.streaks) {
      if (!s.active) continue;
      s.life += dt;
      const t = s.life / s.duration;
      if (t >= 1) { s.active = false; s.mesh.visible = false; continue; }

      // ease-out travel so it decelerates slightly as it burns up
      const headA = s.arc * (1 - (1 - t) * (1 - t));
      const tailA = Math.max(0, headA - s.tail);
      onSphere(s, headA, _h);
      onSphere(s, tailA, _t);

      // widen perpendicular to both the travel direction and the line of sight
      _side.subVectors(_h, _t).cross(_h).normalize().multiplyScalar(s.width);
      const p = s.pos.array as Float32Array;
      p[0] = _t.x; p[1] = _t.y; p[2] = _t.z;
      p[3] = _t.x; p[4] = _t.y; p[5] = _t.z;
      p[6] = _h.x + _side.x; p[7] = _h.y + _side.y; p[8] = _h.z + _side.z;
      p[9] = _h.x - _side.x; p[10] = _h.y - _side.y; p[11] = _h.z - _side.z;
      s.pos.needsUpdate = true;

      // quick flare in, longer fade out, dimmed if dawn is creeping in
      const fade = Math.min(1, t / 0.12) * Math.min(1, (1 - t) / 0.45) * darkness;
      const c = s.col.array as Float32Array;
      c.fill(0, 0, 6); // tail: black == invisible under additive blending
      c[6] = c[9] = 1.0 * fade;
      c[7] = c[10] = 0.97 * fade;
      c[8] = c[11] = 0.88 * fade;
      s.col.needsUpdate = true;
    }
  }

  private spawn(): void {
    const s = this.streaks.find((x) => !x.active);
    if (!s) return;
    // start somewhere between 30° and 75° above the horizon
    const elev = THREE.MathUtils.degToRad(30 + Math.random() * 45);
    const az = Math.random() * Math.PI * 2;
    s.start.set(Math.cos(elev) * Math.cos(az), Math.sin(elev), Math.cos(elev) * Math.sin(az));

    // random tangent, biased downward so most fall toward the horizon
    const rnd = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    rnd.addScaledVector(s.start, -rnd.dot(s.start)).normalize();
    const down = new THREE.Vector3(0, -1, 0);
    down.addScaledVector(s.start, -down.dot(s.start)).normalize();
    s.dir.copy(rnd).lerp(down, 0.55).normalize();

    s.arc = THREE.MathUtils.degToRad(14 + Math.random() * 22);
    s.tail = THREE.MathUtils.degToRad(5 + Math.random() * 6);
    s.width = 0.45 + Math.random() * 0.4;
    s.duration = 0.7 + Math.random() * 0.7;
    s.life = 0;
    s.active = true;
    s.mesh.visible = true;
  }
}
