import * as THREE from 'three';
import type { Player } from './player';
import { PX, skinBox, type PlayerSkin } from './skin';

interface Limb {
  pivot: THREE.Group;
  base: THREE.Mesh;
  overlay: THREE.Mesh;
}

/**
 * Third-person body for the local player, built from the standard skin layout.
 * Model space faces +Z; the root is turned to the player's yaw each frame.
 */
export class PlayerModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group(); // everything above the hips (leans when crouching)
  private head!: Limb;
  private torso!: Limb;
  private armR!: Limb;
  private armL!: Limb;
  private legR!: Limb;
  private legL!: Limb;
  private baseMat: THREE.MeshLambertMaterial;
  private overlayMat: THREE.MeshLambertMaterial;
  private bodyYaw = 0;
  private builtFor = '';
  private wingR: THREE.Group;
  private wingL: THREE.Group;
  /** 0 = standing, 1 = fully horizontal glide pose (eased) */
  private glideBlend = 0;
  private lean = 0;
  /** set by the game: is an elytra being worn? */
  wearingElytra = false;
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene, private skin: PlayerSkin) {
    this.baseMat = new THREE.MeshLambertMaterial({ map: skin.texture });
    this.overlayMat = new THREE.MeshLambertMaterial({ map: skin.texture, alphaTest: 0.5, side: THREE.DoubleSide });
    this.root.add(this.body);
    this.root.visible = false;
    this.root.rotation.order = 'YXZ';
    scene.add(this.root);
    const wingMat = new THREE.MeshLambertMaterial({ map: elytraTexture(), side: THREE.DoubleSide });
    const wing = (side: 1 | -1) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(10 * PX, 20 * PX, 2 * PX), wingMat);
      m.position.set(side * 5 * PX, -10 * PX, 0);
      if (side < 0) m.scale.x = -1; // mirror the pattern
      m.castShadow = true;
      g.add(m);
      // hinge at the shoulder blades, just behind the back
      g.position.set(side * 0.5 * PX, 24 * PX - 12 * PX, -3 * PX);
      return g;
    };
    this.wingR = wing(-1);
    this.wingL = wing(1);
    this.body.add(this.wingR, this.wingL);
    this.build();
    skin.onChange(() => this.build());
  }

  private limb(w: number, h: number, d: number, u: number, v: number, ou: number, ov: number, inflate: number): Limb {
    const pivot = new THREE.Group();
    const base = new THREE.Mesh(skinBox(w, h, d, u, v), this.baseMat);
    const overlay = new THREE.Mesh(skinBox(w, h, d, ou, ov, inflate), this.overlayMat);
    for (const m of [base, overlay]) {
      m.position.y = (-h / 2) * PX; // hang below the joint
      m.castShadow = true;
      pivot.add(m);
    }
    return { pivot, base, overlay };
  }

  private build(): void {
    const key = this.skin.model;
    if (key === this.builtFor) return;
    this.builtFor = key;
    for (const l of [this.head, this.torso, this.armR, this.armL, this.legR, this.legL]) {
      if (!l) continue;
      l.pivot.removeFromParent();
      l.base.geometry.dispose();
      l.overlay.geometry.dispose();
    }
    const aw = key === 'slim' ? 3 : 4;
    this.legR = this.limb(4, 12, 4, 0, 16, 0, 32, 0.25);
    this.legL = this.limb(4, 12, 4, 16, 48, 0, 48, 0.25);
    this.torso = this.limb(8, 12, 4, 16, 16, 16, 32, 0.25);
    this.armR = this.limb(aw, 12, 4, 40, 16, 40, 32, 0.25);
    this.armL = this.limb(aw, 12, 4, 32, 48, 48, 48, 0.25);
    // the head pivots at the neck, so its box sits above the joint instead of below
    this.head = this.limb(8, 8, 8, 0, 0, 32, 0, 0.5);
    this.head.base.position.y = this.head.overlay.position.y = 4 * PX;

    // character's right is -X in model space
    this.legR.pivot.position.set(-2 * PX, 12 * PX, 0);
    this.legL.pivot.position.set(2 * PX, 12 * PX, 0);
    this.root.add(this.legR.pivot, this.legL.pivot);
    this.body.position.set(0, 12 * PX, 0);
    this.torso.pivot.position.set(0, 12 * PX, 0);
    this.armR.pivot.position.set(-(4 + aw / 2) * PX, 12 * PX - PX * 0.5, 0);
    this.armL.pivot.position.set((4 + aw / 2) * PX, 12 * PX - PX * 0.5, 0);
    this.head.pivot.position.set(0, 12 * PX, 0);
    this.body.add(this.torso.pivot, this.armR.pivot, this.armL.pivot, this.head.pivot);
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  /** `swing` is the first-person punch progress (1 → 0) so both views stay in sync. */
  update(dt: number, p: Player, swing: number, time: number): void {
    // body turns toward where the head looks: always while moving, and when the neck is twisted too far
    const diff = wrap(p.yaw - this.bodyYaw);
    const moving = p.speed > 0.4;
    const maxTwist = 0.85;
    if (moving) this.bodyYaw += diff * Math.min(1, dt * 10);
    else if (Math.abs(diff) > maxTwist) this.bodyYaw += diff - Math.sign(diff) * maxTwist;
    this.bodyYaw = wrap(this.bodyYaw);

    // gliding: body lies along the flight path, rotated around its middle
    this.glideBlend += ((p.gliding ? 1 : 0) - this.glideBlend) * Math.min(1, dt * 8);
    const hv = Math.hypot(p.vel.x, p.vel.z);
    const flightPitch = hv + Math.abs(p.vel.y) > 1 ? Math.atan2(p.vel.y, hv) : p.pitch;
    this.lean += ((Math.PI / 2 - flightPitch) - this.lean) * Math.min(1, dt * 10);
    if (p.gliding) this.bodyYaw = wrap(this.bodyYaw + wrap(p.yaw - this.bodyYaw) * Math.min(1, dt * 12));
    const lean = this.lean * this.glideBlend;
    this.root.rotation.set(lean, this.bodyYaw + Math.PI, 0);
    // pivot around the body's centre (0.9 up the standing model), which drops to the
    // middle of the short glide hitbox: position = feet + centre - R * centre
    const cy = 0.9 + (0.3 - 0.9) * this.glideBlend;
    this.tmp.set(0, 0.9, 0).applyEuler(this.root.rotation);
    this.root.position.set(p.pos.x - this.tmp.x, p.pos.y + cy - this.tmp.y, p.pos.z - this.tmp.z);
    this.head.pivot.rotation.set(-p.pitch - lean, wrap(p.yaw - this.bodyYaw), 0);

    // walk cycle: one leg forward per footstep (shares the phase with the head bob)
    const amt = p.onGround || p.inWater ? Math.min(1, p.speed / 4.3) : 0.25;
    const ph = Math.sin(p.bobPhase * Math.PI) * (p.sprinting ? 0.9 : 0.7) * amt;
    this.legR.pivot.rotation.x = ph;
    this.legL.pivot.rotation.x = -ph;
    const idle = Math.sin(time * 1.6) * 0.04;
    this.armR.pivot.rotation.set(-ph * 0.9, 0, 0.04 + idle);
    this.armL.pivot.rotation.set(ph * 0.9, 0, -0.04 - idle);

    // punch / mine: swing the right arm forward and across
    if (swing > 0) {
      const s = Math.sin((1 - swing) * Math.PI);
      this.armR.pivot.rotation.x -= s * 1.4 + Math.max(0, p.pitch) * s;
      this.armR.pivot.rotation.y = s * 0.45;
    }

    // crouch: lean the upper body forward and shift the legs back so the feet stay under you
    const crouch = p.crouching ? 1 : 0;
    this.body.rotation.x = crouch * 0.5;
    this.body.position.set(0, 12 * PX - crouch * 1.5 * PX, crouch * 1 * PX);
    this.legR.pivot.position.z = this.legL.pivot.position.z = crouch * -2.5 * PX;
    this.head.pivot.rotation.x -= crouch * 0.5; // keep looking where the camera looks despite the lean

    // flying: limbs trail a little
    if (p.flying) {
      this.legR.pivot.rotation.x = this.legL.pivot.rotation.x = 0.25;
    }

    // gliding: legs together and straight, arms held out a little from the sides
    const gb = this.glideBlend;
    if (gb > 0.01) {
      this.legR.pivot.rotation.x *= 1 - gb;
      this.legL.pivot.rotation.x *= 1 - gb;
      this.armR.pivot.rotation.x *= 1 - gb;
      this.armL.pivot.rotation.x *= 1 - gb;
      this.armR.pivot.rotation.z += -0.35 * gb;
      this.armL.pivot.rotation.z += 0.35 * gb;
    }

    // elytra: folded against the back, spread wide while gliding (flutter with speed)
    this.wingR.visible = this.wingL.visible = this.wearingElytra;
    if (this.wearingElytra) {
      const speed = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
      const flutter = gb * Math.sin(time * 18) * Math.min(0.06, speed * 0.002);
      const spread = 0.22 + gb * 1.0 + flutter + (p.crouching ? 0.2 : 0);
      const back = 0.2 + gb * 0.15 + (p.crouching ? 0.25 : 0);
      this.wingR.rotation.set(back, 0, -spread);
      this.wingL.rotation.set(back, 0, spread);
    }
  }
}

/** Original 16x32 membrane pattern for the wings: pale veins over a dusky violet. */
function elytraTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 32;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#8f8aae';
  ctx.fillRect(0, 0, 16, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) {
    const n = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
    if (Math.abs(n) < 0.18) { ctx.fillStyle = 'rgba(40,30,70,0.18)'; ctx.fillRect(x, y, 1, 1); }
  }
  ctx.fillStyle = '#d4cfee';
  for (let i = 0; i < 4; i++) {
    const x0 = 1 + i * 4;
    for (let y = 0; y < 32; y++) ctx.fillRect(Math.round(x0 + y * 0.12 * (i - 1.5) * 0.4), y, 1, 1);
  }
  ctx.fillStyle = '#4d4870';
  ctx.fillRect(0, 0, 16, 1);
  ctx.fillRect(0, 0, 1, 32);
  ctx.fillRect(15, 0, 1, 32);
  ctx.fillRect(0, 31, 16, 1);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
