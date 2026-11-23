import * as THREE from 'three';
import { B } from '../engine/blocks';
import type { World } from '../engine/world';
import type { Input } from './input';
import { boxAt, boxCollides, sweepAxis, type AABB } from './physics';

const HALF_W = 0.3;
const STAND_H = 1.8;
const CROUCH_H = 1.5;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.27;
const GRAVITY = 28;
const JUMP_V = 8.6;
const WALK = 4.3;
const SPRINT = 5.7;
const CROUCH = 1.4;
const SWIM = 2.4;
const FLY = 10;
const GLIDE_H = 0.6;
const EYE_GLIDE = 0.4;
/** elytra physics runs at a fixed 20 Hz in blocks/tick, then converts back to m/s */
const TICK = 0.05;
/** how long one firework rocket keeps pushing (seconds) */
export const BOOST_TIME = 1.1;
/** full 3D flight: roll is a bit quicker than pitch for the same mouse travel */
const ROLL_GAIN = 1.5;
/** rudder rate from the strafe keys (rad/s) */
const YAW_RATE = 0.9;
/** heading change at a 90° bank and full speed (rad/s) */
const BANK_TURN = 1.1;
/** speed (m/s) at which banking reaches full turning strength */
const BANK_FULL_SPEED = 12;
const INPUT_SMOOTHING = 25;
/** seconds for the camera to level out after a 3D glide */
const LEVEL_TIME = 0.3;
const PITCH_LIMIT = Math.PI / 2 - 0.01;
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

export interface PlayerEvents {
  onStep?(blockBelow: number): void;
  onLand?(fallSpeed: number, blockBelow: number): void;
  onVoid?(): void;
  /** gliding into a wall at speed */
  onBonk?(speed: number): void;
  onGlideStart?(): void;
}

/** First-person player: AABB physics against the voxel world plus mouse-look. */
export class Player {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;
  crouching = false;
  sprinting = false;
  inWater = false;
  flying = false;
  /** elytra gliding */
  gliding = false;
  /** set by the game each frame: is an elytra being worn? */
  canGlide = false;
  /** seconds of firework thrust left */
  boostTime = 0;
  private glideAcc = 0;
  private tmpLook = new THREE.Vector3();
  eyeHeight = EYE_STAND;
  /** 0..1 walk cycle intensity, used for head/hand bob */
  bob = 0;
  bobPhase = 0;
  /** current horizontal speed (m/s) */
  speed = 0;
  private stepDist = 0;
  private lastJumpTap = 0;
  sensitivity = 1;
  invertY = false;
  /** setting: full 3D orientation; picked up the next time the player is on the ground */
  flight3d = false;
  private flight3dArmed = false;
  rollSensitivity = 1;
  /** the current glide is using full 3D orientation */
  flight3dActive = false;
  /** body orientation during a 3D glide (-Z nose, +Y wing-up, +X right wing) */
  readonly flightQuat = new THREE.Quaternion();
  private pendingPitch = 0;
  private pendingRoll = 0;
  private rudder = 0;
  private levelFrom = new THREE.Quaternion();
  private levelTime = 0;
  private tmpQuat = new THREE.Quaternion();
  private tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private tmpAxis = new THREE.Vector3();
  /** velocity before the latest 20 Hz tick, so 3D flight can blend motion between ticks */
  private tickVelPrev = new THREE.Vector3();
  private tmpMove = new THREE.Vector3();

  constructor(private world: World, private events: PlayerEvents = {}) {}

  get height(): number {
    return this.gliding ? GLIDE_H : this.crouching ? CROUCH_H : STAND_H;
  }

  /** Fire a rocket while gliding. Returns false if not gliding. */
  boost(): boolean {
    if (!this.gliding) return false;
    this.boostTime = BOOST_TIME;
    return true;
  }

  private stopGliding(solid: (x: number, y: number, z: number) => boolean): void {
    if (!this.gliding) return;
    this.gliding = false;
    this.boostTime = 0;
    if (this.flight3dActive) {
      this.endFlight3d();
      this.levelFrom.copy(this.flightQuat);
      this.levelTime = LEVEL_TIME;
    }
    // the glide hitbox is short; if there's no room to stand, duck instead
    const stand = boxAt(this.pos.x, this.pos.y, this.pos.z, HALF_W, STAND_H);
    if (boxCollides(stand, solid)) this.crouching = true;
  }

  private startFlight3d(): void {
    this.flight3dActive = true;
    this.flightQuat.setFromEuler(this.tmpEuler.set(this.pitch, this.yaw, 0, 'YXZ'));
    this.pendingPitch = this.pendingRoll = this.rudder = 0;
    this.levelTime = 0;
    this.tickVelPrev.copy(this.vel);
  }

  private endFlight3d(): void {
    this.syncYawPitch();
    this.flight3dActive = false;
  }

  /** Keep yaw/pitch readers (saves, compass, HUD) pointed along the nose. */
  private syncYawPitch(): void {
    const nose = this.tmpAxis.set(0, 0, -1).applyQuaternion(this.flightQuat);
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Math.asin(Math.max(-1, Math.min(1, nose.y)))));
    // straight up or down has no meaningful heading, so hold the last one
    if (Math.hypot(nose.x, nose.z) > 0.05) {
      const tau = Math.PI * 2;
      this.yaw = ((Math.atan2(-nose.x, -nose.z) % tau) + tau) % tau;
    }
  }

  /** Apply smoothed mouse and rudder input around the body's own axes. */
  private steerFlight3d(dt: number, strafe: number): void {
    const a = 1 - Math.exp(-INPUT_SMOOTHING * dt);
    const pitch = this.pendingPitch * a, roll = this.pendingRoll * a;
    this.pendingPitch -= pitch;
    this.pendingRoll -= roll;
    this.rudder += (-strafe * YAW_RATE - this.rudder) * (1 - Math.exp(-8 * dt));
    this.flightQuat
      .multiply(this.tmpQuat.setFromAxisAngle(AXIS_X, pitch))
      .multiply(this.tmpQuat.setFromAxisAngle(AXIS_Z, roll))
      .multiply(this.tmpQuat.setFromAxisAngle(AXIS_Y, this.rudder * dt))
      .normalize();
  }

  /** A banked wing pulls the nose around: rotate the heading toward the lowered wing. */
  private bankTurn(dt: number): void {
    const right = this.tmpAxis.set(1, 0, 0).applyQuaternion(this.flightQuat);
    const bank = right.y;
    const nose = this.tmpAxis.set(0, 0, -1).applyQuaternion(this.flightQuat);
    const turn = bank * Math.hypot(nose.x, nose.z) * BANK_TURN * Math.min(1, this.vel.length() / BANK_FULL_SPEED) * dt;
    this.flightQuat.premultiply(this.tmpQuat.setFromAxisAngle(AXIS_Y, turn)).normalize();
  }

  /** How much of the wings' lift points up: 1 level, 0 knife-edge, -1 inverted. */
  private wingLift(hlook: number): number {
    if (!this.flight3dActive || hlook < 0.01) return 1;
    const up = this.tmpAxis.set(0, 1, 0).applyQuaternion(this.flightQuat);
    return Math.max(-1, Math.min(1, up.y / hlook));
  }

  /** The orientation the view should use right now, including the ease back to level. */
  viewQuat(out = new THREE.Quaternion()): THREE.Quaternion {
    if (this.flight3dActive) return out.copy(this.flightQuat);
    out.setFromEuler(this.tmpEuler.set(this.pitch, this.yaw, 0, 'YXZ'));
    if (this.levelTime > 0) {
      const t = 1 - this.levelTime / LEVEL_TIME;
      this.tmpQuat.copy(this.levelFrom).slerp(out, t * t * (3 - 2 * t));
      out.copy(this.tmpQuat);
    }
    return out;
  }

  /**
   * One 20 Hz elytra step (velocities in blocks/tick): gravity, lift from flying level,
   * diving converts height to speed, pulling up converts speed to height, and the
   * velocity slowly turns to follow where you look.
   */
  private glideTick(): void {
    const look = this.lookDir(this.tmpLook);
    let vx = this.vel.x * TICK, vy = this.vel.y * TICK, vz = this.vel.z * TICK;
    const hlook = Math.hypot(look.x, look.z);
    const hvel = Math.hypot(vx, vz);
    const lift = hlook * hlook;
    const wing = this.wingLift(hlook);
    vy += -0.08 + lift * 0.06 * wing;
    if (vy < 0 && hlook > 0) {
      const k = vy * -0.1 * lift * Math.abs(wing);
      vy += k; vx += (look.x / hlook) * k; vz += (look.z / hlook) * k;
    }
    if (look.y > 0 && hlook > 0) {
      const k = hvel * look.y * 0.04;
      vy += k * 3.2; vx -= (look.x / hlook) * k; vz -= (look.z / hlook) * k;
    }
    if (hlook > 0) {
      vx += ((look.x / hlook) * hvel - vx) * 0.1;
      vz += ((look.z / hlook) * hvel - vz) * 0.1;
    }
    vx *= 0.99; vy *= 0.98; vz *= 0.99;
    if (this.boostTime > 0) {
      vx += look.x * 0.1 + (look.x * 1.5 - vx) * 0.5;
      vy += look.y * 0.1 + (look.y * 1.5 - vy) * 0.5;
      vz += look.z * 0.1 + (look.z * 1.5 - vz) * 0.5;
    }
    this.vel.set(vx / TICK, vy / TICK, vz / TICK);
  }

  eye(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  lookDir(out = new THREE.Vector3()): THREE.Vector3 {
    if (this.flight3dActive) return out.set(0, 0, -1).applyQuaternion(this.flightQuat);
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  box(): AABB {
    return boxAt(this.pos.x, this.pos.y, this.pos.z, HALF_W, this.height);
  }

  /** Does the player's body overlap a block cell? (used to forbid placing inside yourself) */
  overlapsCell(x: number, y: number, z: number): boolean {
    const b = this.box();
    return b.maxX > x && b.minX < x + 1 && b.maxY > y && b.minY < y + 1 && b.maxZ > z && b.minZ < z + 1;
  }

  teleport(x: number, y: number, z: number): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.gliding = false;
    this.boostTime = 0;
    if (this.flight3dActive) this.endFlight3d();
    this.levelTime = 0;
  }

  look(input: Input): void {
    const k = 0.0022 * this.sensitivity;
    if (this.flight3dActive) {
      this.pendingPitch -= input.mouseDY * k * (this.invertY ? -1 : 1);
      this.pendingRoll -= input.mouseDX * k * this.rollSensitivity * ROLL_GAIN;
      return;
    }
    this.yaw -= input.mouseDX * k;
    this.pitch -= input.mouseDY * k * (this.invertY ? -1 : 1);
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    this.yaw = ((this.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  update(dt: number, input: Input | null): void {
    const solid = (x: number, y: number, z: number) => this.world.isSolid(x, y, z) || !this.world.isLoaded(x, z);
    const fwd = input ? (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0) : 0;
    const strafe = input ? (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0) : 0;
    const jump = !!input?.isDown('jump');
    const wantCrouch = !!input?.isDown('crouch');

    const feet = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.2), Math.floor(this.pos.z));
    const chest = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 1.0), Math.floor(this.pos.z));
    this.inWater = feet === B.WATER || chest === B.WATER;

    // double-tap jump toggles flying; with an elytra on, a tap while falling opens the wings
    // (and a tap while gliding folds them)
    if (input?.wasPressed('jump')) {
      const now = performance.now();
      if (this.gliding) { this.stopGliding(solid); this.lastJumpTap = 0; }
      else if (now - this.lastJumpTap < 300) { this.flying = !this.flying; this.vel.y = 0; this.lastJumpTap = 0; }
      else if (this.canGlide && !this.onGround && !this.flying && !this.inWater && this.vel.y < 0) {
        this.gliding = true;
        this.crouching = false;
        this.glideAcc = 0;
        this.lastJumpTap = 0;
        if (this.flight3dArmed) this.startFlight3d();
        this.events.onGlideStart?.();
      } else this.lastJumpTap = now;
    }
    if (this.gliding && (!this.canGlide || this.flying || this.inWater)) this.stopGliding(solid);

    // crouch, but don't stand up into a ceiling
    if (wantCrouch && !this.flying && !this.gliding) this.crouching = true;
    else if (this.crouching) {
      const stand = boxAt(this.pos.x, this.pos.y, this.pos.z, HALF_W, STAND_H);
      if (!boxCollides(stand, solid)) this.crouching = false;
    }
    this.sprinting = !!input?.isDown('sprint') && fwd > 0 && !this.crouching && !this.gliding;

    // horizontal target velocity
    let speed = this.flying ? FLY * (this.sprinting ? 1.8 : 1) : this.crouching ? CROUCH : this.sprinting ? SPRINT : WALK;
    if (this.inWater && !this.flying) speed = SWIM * (this.sprinting ? 1.4 : 1);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * fwd + cos * strafe;
    let wz = -cos * fwd - sin * strafe;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    if (!this.gliding) {
      const accel = this.flying ? 10 : this.onGround ? 16 : this.inWater ? 6 : 3.5;
      const a = 1 - Math.exp(-accel * dt);
      this.vel.x += (wx * speed - this.vel.x) * a;
      this.vel.z += (wz * speed - this.vel.z) * a;
    }

    // vertical
    if (this.gliding) {
      // with no input (menus open) the attitude holds still; rotation runs every
      // rendered frame because stepping it at the 20 Hz physics rate visibly judders
      if (this.flight3dActive && input) {
        this.steerFlight3d(dt, strafe);
        this.bankTurn(dt);
      }
      this.glideAcc += dt;
      while (this.glideAcc >= TICK) {
        this.glideAcc -= TICK;
        this.tickVelPrev.copy(this.vel);
        this.glideTick();
        this.boostTime = Math.max(0, this.boostTime - TICK);
      }
      if (this.flight3dActive) this.syncYawPitch();
    } else if (this.flying) {
      const up = (jump ? 1 : 0) - (wantCrouch ? 1 : 0);
      this.vel.y += (up * FLY - this.vel.y) * (1 - Math.exp(-10 * dt));
    } else if (this.inWater) {
      this.vel.y -= 9 * dt;
      if (jump) this.vel.y = Math.min(this.vel.y + 30 * dt, 3.2);
      this.vel.y = Math.max(this.vel.y, -3.5);
      this.vel.y *= 1 - Math.min(1, 1.5 * dt);
    } else {
      if (jump && this.onGround) { this.vel.y = JUMP_V; this.onGround = false; }
      this.vel.y = Math.max(this.vel.y - GRAVITY * dt, -55);
    }

    // integrate with collision, one axis at a time
    const b = this.box();
    const fallSpeed = -this.vel.y;
    // 3D flight moves along a blend of the last two physics ticks so the camera glides
    const move = this.flight3dActive ? this.tmpMove.copy(this.tickVelPrev).lerp(this.vel, this.glideAcc / TICK) : this.vel;
    const dy = move.y * dt;
    const movedY = sweepAxis(b, 1, dy, solid);
    const wasGround = this.onGround;
    if (Math.abs(movedY - dy) > 1e-5) {
      if (dy < 0) this.onGround = true;
      this.vel.y = 0;
      this.tickVelPrev.y = 0;
    } else this.onGround = false;
    if (this.flying && this.onGround) this.flying = false; // landing ends flight
    const glideSpeed = this.gliding ? Math.hypot(this.vel.x, this.vel.z) : 0;

    const supported = (bb: AABB) => boxCollides({ ...bb, minY: bb.minY - 0.08, maxY: bb.minY }, solid);
    for (const axis of [0, 2] as const) {
      const d = (axis === 0 ? move.x : move.z) * dt;
      const before = { ...b };
      const moved = sweepAxis(b, axis, d, solid);
      // sneaking keeps you from walking off ledges
      if (this.crouching && this.onGround && !supported(b)) {
        Object.assign(b, before);
        if (axis === 0) this.vel.x = 0; else this.vel.z = 0;
        continue;
      }
      if (Math.abs(moved - d) > 1e-5) {
        if (axis === 0) this.vel.x = this.tickVelPrev.x = 0;
        else this.vel.z = this.tickVelPrev.z = 0;
      }
    }
    this.pos.set((b.minX + b.maxX) / 2, b.minY, (b.minZ + b.maxZ) / 2);
    if (this.gliding) {
      const lost = glideSpeed - Math.hypot(this.vel.x, this.vel.z);
      if (lost > 9) this.events.onBonk?.(lost);
      if (this.onGround) this.stopGliding(solid);
    }
    if (this.onGround) this.flight3dArmed = this.flight3d;

    const below = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.1), Math.floor(this.pos.z));
    if (!wasGround && this.onGround && fallSpeed > 6) this.events.onLand?.(fallSpeed, below);

    // footsteps & bob
    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hspeed > 0.5) {
      // one bob (phase += 1) per footstep; longer strides when moving faster keep the
      // cadence calm (~2.2 steps/s walking, ~2.6 sprinting) instead of a fast jiggle
      const stride = this.sprinting ? 2.2 : 1.9;
      this.stepDist += hspeed * dt;
      this.bobPhase += (hspeed * dt) / stride;
      if (this.stepDist > stride) { this.stepDist = 0; this.events.onStep?.(below); }
    }
    this.bob += ((this.onGround && hspeed > 0.5 ? Math.min(1, hspeed / WALK) * 0.75 : 0) - this.bob) * Math.min(1, dt * 6);
    this.speed = hspeed;

    const targetEye = this.gliding ? EYE_GLIDE : this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 14);
    this.levelTime = Math.max(0, this.levelTime - dt);

    if (this.pos.y < -20) this.events.onVoid?.();
  }

  applyCamera(cam: THREE.PerspectiveCamera): void {
    cam.position.set(this.pos.x, this.pos.y + this.eyeHeight + Math.abs(Math.sin(this.bobPhase * Math.PI)) * 0.06 * this.bob, this.pos.z);
    cam.rotation.order = 'YXZ';
    this.viewQuat(cam.quaternion);
  }
}
