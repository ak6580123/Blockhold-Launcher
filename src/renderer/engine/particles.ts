import * as THREE from 'three';

interface P { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; size: number; c: THREE.Color }

/** Instanced cube particles for block breaking. One draw call for all particles. */
export class Particles {
  private mesh: THREE.InstancedMesh;
  private ps: P[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private v = new THREE.Vector3();
  private readonly max = 400;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), this.max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    scene.add(this.mesh);
  }

  burst(x: number, y: number, z: number, color: THREE.Color, n = 14): void {
    for (let i = 0; i < n; i++) {
      if (this.ps.length >= this.max) this.ps.shift();
      const p: P = {
        x: x + 0.2 + Math.random() * 0.6, y: y + 0.2 + Math.random() * 0.6, z: z + 0.2 + Math.random() * 0.6,
        vx: (Math.random() - 0.5) * 3, vy: Math.random() * 3 + 1, vz: (Math.random() - 0.5) * 3,
        life: 0.5 + Math.random() * 0.5, size: 0.07 + Math.random() * 0.07,
        c: color.clone().multiplyScalar(0.8 + Math.random() * 0.4),
      };
      this.ps.push(p);
    }
  }

  update(dt: number, isSolid: (x: number, y: number, z: number) => boolean): void {
    let n = 0;
    this.ps = this.ps.filter((p) => (p.life -= dt) > 0);
    for (const p of this.ps) {
      p.vy -= 18 * dt;
      const ny = p.y + p.vy * dt;
      if (isSolid(Math.floor(p.x), Math.floor(ny), Math.floor(p.z))) { p.vy = 0; p.vx *= 0.6; p.vz *= 0.6; } else p.y = ny;
      p.x += p.vx * dt; p.z += p.vz * dt;
      this.s.setScalar(p.size * Math.min(1, p.life * 3));
      this.v.set(p.x, p.y, p.z);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, p.c);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
