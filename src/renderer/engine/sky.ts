import * as THREE from 'three';
import { mulberry32 } from './noise';
import { worldUniforms } from './world';

const DAY_SKY = new THREE.Color('#86b6ff');
const DUSK_SKY = new THREE.Color('#f29a5e');
const NIGHT_SKY = new THREE.Color('#0b1026');

/**
 * Day/night cycle. timeOfDay: 0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight.
 */
export class Sky {
  readonly sun = new THREE.DirectionalLight(0xfff3dd, 1.6);
  readonly hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6b5a40, 1.1);
  readonly ambient = new THREE.AmbientLight(0xffffff, 0.25);
  private sunMesh: THREE.Mesh;
  private moonMesh: THREE.Mesh;
  private stars: THREE.Points;
  private clouds: THREE.Mesh;
  private cloudTex: THREE.CanvasTexture;
  private skyGroup = new THREE.Group();
  timeOfDay = 0.1;
  cycle = true;
  dayLengthSec = 1200;
  /** 0 night .. 1 full day */
  daylight = 1;

  constructor(private scene: THREE.Scene) {
    scene.background = DAY_SKY.clone();
    scene.fog = new THREE.Fog(DAY_SKY.clone(), 40, 120);
    this.sun.position.set(50, 100, 30);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target, this.hemi, this.ambient, this.skyGroup);

    const sq = new THREE.PlaneGeometry(1, 1);
    this.sunMesh = new THREE.Mesh(sq, new THREE.MeshBasicMaterial({ color: 0xfff6c0, fog: false, depthWrite: false }));
    this.sunMesh.scale.setScalar(22);
    this.moonMesh = new THREE.Mesh(sq, new THREE.MeshBasicMaterial({ color: 0xdfe6ff, fog: false, depthWrite: false, transparent: true }));
    this.moonMesh.scale.setScalar(14);
    this.skyGroup.add(this.sunMesh, this.moonMesh);

    const rnd = mulberry32(42);
    const pts: number[] = [];
    for (let i = 0; i < 700; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pts.push(r * Math.cos(th) * 300, Math.abs(u) * 300, r * Math.sin(th) * 300);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, depthWrite: false }));
    this.skyGroup.add(this.stars);

    // blocky cloud layer from a tiny random bitmap scaled up with nearest filtering
    const cc = document.createElement('canvas');
    cc.width = cc.height = 64;
    const ctx = cc.getContext('2d')!;
    const r2 = mulberry32(7);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const v = Math.sin(x * 0.35 + r2() * 0.6) + Math.cos(y * 0.28 + r2() * 0.6) + r2() * 0.9;
      if (v > 1.05) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x, y, 1, 1); }
    }
    this.cloudTex = new THREE.CanvasTexture(cc);
    this.cloudTex.magFilter = THREE.NearestFilter;
    this.cloudTex.minFilter = THREE.NearestFilter;
    this.cloudTex.wrapS = this.cloudTex.wrapT = THREE.RepeatWrapping;
    this.cloudTex.repeat.set(3, 3);
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 1200),
      new THREE.MeshBasicMaterial({ map: this.cloudTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, opacity: 0.8 }),
    );
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.position.y = 108;
    scene.add(this.clouds);
  }

  setShadowQuality(q: 'low' | 'medium' | 'high'): void {
    this.sun.castShadow = q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    const ext = q === 'high' ? 56 : 36;
    this.sun.shadow.mapSize.set(size, size);
    const cam = this.sun.shadow.camera;
    cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext;
    cam.near = 1; cam.far = 260;
    cam.updateProjectionMatrix();
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  setFogDistance(renderDistanceChunks: number): void {
    const far = renderDistanceChunks * 16;
    const fog = this.scene.fog as THREE.Fog;
    fog.near = far * 0.55;
    fog.far = far * 0.95;
  }

  update(dt: number, center: THREE.Vector3): void {
    if (this.cycle) this.timeOfDay = (this.timeOfDay + dt / this.dayLengthSec) % 1;
    const ang = this.timeOfDay * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.25).normalize();
    const elev = sunDir.y;
    this.daylight = THREE.MathUtils.smoothstep(elev, -0.12, 0.25);
    const dusk = Math.max(0, 1 - Math.abs(elev) / 0.25) * (elev > -0.2 ? 1 : 0);

    const sky = NIGHT_SKY.clone().lerp(DAY_SKY, this.daylight);
    sky.lerp(DUSK_SKY, dusk * 0.45);
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);

    this.sun.intensity = 1.5 * this.daylight + 0.06;
    this.sun.color.setHSL(0.1, 0.6, 0.6 + 0.35 * this.daylight);
    this.hemi.intensity = 0.25 + 0.95 * this.daylight;
    this.ambient.intensity = 0.12 + 0.2 * this.daylight;
    worldUniforms.uDay.value = this.daylight;

    // shadow camera follows the player, snapped to texels to avoid shimmering
    const lightDir = elev > 0 ? sunDir : sunDir.clone().negate(); // moonlight at night
    const snap = 2;
    const cx = Math.round(center.x / snap) * snap, cz = Math.round(center.z / snap) * snap;
    this.sun.target.position.set(cx, center.y, cz);
    this.sun.position.set(cx + lightDir.x * 120, center.y + Math.abs(lightDir.y) * 120 + 10, cz + lightDir.z * 120);
    this.sun.target.updateMatrixWorld();

    this.skyGroup.position.copy(center);
    this.sunMesh.position.copy(sunDir).multiplyScalar(250);
    this.sunMesh.lookAt(center);
    this.moonMesh.position.copy(sunDir).multiplyScalar(-250);
    this.moonMesh.lookAt(center);
    (this.stars.material as THREE.PointsMaterial).opacity = 1 - this.daylight;
    this.stars.rotation.y = ang * 0.1;

    this.clouds.position.x = center.x;
    this.clouds.position.z = center.z;
    this.cloudTex.offset.x = (center.x / 400 + performance.now() / 400000) % 1;
    this.cloudTex.offset.y = (-center.z / 400) % 1;
    (this.clouds.material as THREE.MeshBasicMaterial).color.setScalar(0.35 + 0.65 * this.daylight);
  }
}
