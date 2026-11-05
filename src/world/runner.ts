import * as THREE from 'three';
import { BRAND } from '../config/brand';
import type { RunnerLook } from '../config/runners';
import { SHOES, type ShoeId } from '../config/shoes';
import { damp } from '../core/math';
import { textTexture } from './textures';

export type RunnerPose = 'run' | 'jump' | 'slam' | 'slide' | 'glide' | 'dead' | 'idle';

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

/** Stylised runner rig built from primitives and animated procedurally from the beat. */
export class Runner {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly hips: THREE.Group[] = [];
  private readonly knees: THREE.Group[] = [];
  private readonly shoulders: THREE.Group[] = [];
  private readonly elbows: THREE.Group[] = [];
  private readonly pods: THREE.Group[] = [];
  private readonly ponytail: THREE.Group | null = null;
  private readonly shoeUpper = lambert(0xffffff);
  private readonly shoeAccent = lambert(0xffffff);
  private readonly shoeSole = lambert(0xffffff);
  private readonly podMat = lambert(0xffffff);
  private readonly cloud = new THREE.Group();
  private readonly shadow: THREE.Mesh;
  private squash = 0;
  private swing = 0;
  private surge = 0;
  private surgeTarget = 0;
  private readonly glow = new THREE.Color();

  constructor(look: RunnerLook, shadowTexture: THREE.Texture) {
    const skin = lambert(look.skin);
    const top = lambert(look.top);
    const accent = lambert(look.accent);
    const shorts = lambert(look.shorts);
    const hair = lambert(look.hair);
    const socks = lambert(look.socks);
    const limb = (r: number, len: number, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
      m.position.y = -len / 2 - r * 0.5;
      return m;
    };

    this.root.add(this.body);
    this.body.position.y = 0.95;
    this.body.add(this.torso);

    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.36, 6, 14), top);
    chest.position.y = 0.3;
    chest.scale.set(1, 1, 0.72);
    this.torso.add(chest);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.3), accent);
    stripe.position.set(0, 0.5, 0);
    this.torso.add(stripe);
    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.08, 4, 12), shorts);
    pelvis.position.y = 0.02;
    this.torso.add(pelvis);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), skin);
    neck.position.y = 0.62;
    this.torso.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skin);
    head.position.y = 0.74;
    head.scale.set(0.95, 1.05, 1);
    this.torso.add(head);
    // Minimal face so the runner reads front-on in the menu shot.
    const eyeMat = lambert(0x1b1b1b);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), eyeMat);
      eye.position.set(side * 0.045, 0.765, -0.118);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.01, 0.01), hair);
      brow.position.set(side * 0.047, 0.8, -0.115);
      this.torso.add(eye, brow);
    }
    const capFraction = look.hairStyle === 'cap' ? 2.2 : 1.75;
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.137, 16, 10, 0, Math.PI * 2, 0, Math.PI / capFraction), hair);
    hairCap.position.set(0, 0.76, 0.01);
    this.torso.add(hairCap);

    if (look.hairStyle === 'ponytail') {
      const tail = new THREE.Group();
      tail.position.set(0, 0.8, 0.12);
      const strand = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.2, 4, 8), hair);
      strand.position.set(0, -0.12, 0.04);
      strand.rotation.x = 0.4;
      tail.add(strand);
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 6, 10), accent);
      tie.rotation.x = Math.PI / 2;
      tail.add(tie);
      this.torso.add(tail);
      this.ponytail = tail;
    } else if (look.hairStyle === 'bun') {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), hair);
      bun.position.set(0, 0.86, 0.08);
      this.torso.add(bun);
    } else if (look.hairStyle === 'cap') {
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.142, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.1), accent);
      crown.position.set(0, 0.77, 0);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, 0.14), accent);
      brim.position.set(0, 0.79, -0.15);
      this.torso.add(crown, brim);
    }

    if (BRAND.mark) {
      const logo = new THREE.Mesh(
        new THREE.PlaneGeometry(0.2, 0.1),
        new THREE.MeshBasicMaterial({
          map: textTexture(BRAND.mark, { width: 128, height: 64, background: null, color: look.top === 0x16181c ? '#f4f6f2' : '#16181c', fontSize: 52 }),
          transparent: true,
        }),
      );
      logo.position.set(0, 0.36, 0.152);
      this.torso.add(logo);
    }

    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.25, 0.52, 0);
      shoulder.add(limb(0.055, 0.22, top));
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      elbow.rotation.x = 1.3;
      elbow.add(limb(0.048, 0.2, skin));
      shoulder.add(elbow);
      this.torso.add(shoulder);
      this.shoulders.push(shoulder);
      this.elbows.push(elbow);

      const hip = new THREE.Group();
      hip.position.set(side * 0.11, 0, 0);
      hip.add(limb(0.085, 0.3, shorts));
      const knee = new THREE.Group();
      knee.position.y = -0.46;
      knee.add(limb(0.065, 0.3, skin));
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.1, 10), socks);
      sock.position.y = -0.37;
      knee.add(sock);
      const foot = new THREE.Group();
      foot.position.y = -0.44;
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.18, 4, 10), this.shoeUpper);
      upper.rotation.x = Math.PI / 2;
      upper.position.set(0, -0.005, -0.05);
      upper.scale.set(1.05, 1, 0.85);
      const swoosh = new THREE.Mesh(new THREE.BoxGeometry(0.128, 0.03, 0.16), this.shoeAccent);
      swoosh.position.set(0, 0.0, -0.03);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.035, 0.31), this.shoeSole);
      sole.position.set(0, -0.06, -0.05);
      const podGroup = new THREE.Group();
      podGroup.position.set(0, -0.09, -0.05);
      for (let i = 0; i < 5; i++) {
        const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.13, 10), this.podMat);
        pod.rotation.z = Math.PI / 2;
        pod.position.z = -0.12 + i * 0.06;
        podGroup.add(pod);
      }
      foot.add(upper, swoosh, sole, podGroup);
      knee.add(foot);
      hip.add(knee);
      this.body.add(hip);
      this.hips.push(hip);
      this.knees.push(knee);
      this.pods.push(podGroup);
    }

    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9fb4c8 });
    const puffs: [number, number, number, number][] = [[0, 0, 0, 0.5], [0.45, -0.05, 0.1, 0.38], [-0.45, -0.05, 0.05, 0.4], [0, 0.05, 0.4, 0.35], [0.1, -0.02, -0.4, 0.36]];
    for (const [x, y, z, r] of puffs) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), cloudMat);
      puff.position.set(x, y, z);
      this.cloud.add(puff);
    }
    this.cloud.scale.setScalar(0);
    this.root.add(this.cloud);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.1),
      new THREE.MeshBasicMaterial({ map: shadowTexture, color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.root.add(this.shadow);

    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== this.shadow) o.castShadow = true;
    });
  }

  setShoe(id: ShoeId): void {
    const c = SHOES[id].colors;
    this.shoeUpper.color.setHex(c.upper);
    this.shoeAccent.color.setHex(c.accent);
    this.shoeSole.color.setHex(c.sole);
    this.podMat.color.setHex(c.pods);
  }

  /** CloudTec Surge: 0 = off, 1 = pods fully inflated and glowing. */
  setSurge(level: number): void {
    this.surgeTarget = level;
  }

  /** Triggers the landing squash (CloudTec pods compress). */
  land(): void {
    this.squash = 1;
  }

  update(dt: number, beat: number, pose: RunnerPose, y: number, stumble: number, deadTime: number): void {
    const phase = beat * Math.PI;
    const airborne = pose === 'jump' || pose === 'slam';
    this.squash = Math.max(0, this.squash - dt * 5);

    let bodyY = 0.95 - 0.06 * Math.abs(Math.cos(phase)) - this.squash * 0.12;
    let lean = -0.18;
    for (let i = 0; i < 2; i++) {
      const p = phase + i * Math.PI;
      let thigh = 0.62 * Math.cos(p);
      let knee = -(0.25 + 1.2 * Math.max(0, -Math.sin(p)));
      let arm = -0.7 * Math.cos(p);
      let elbow = 1.3;
      if (pose === 'idle') {
        thigh = 0.05 * Math.cos(p);
        knee = -0.12;
        arm = 0.1 * Math.cos(p);
        elbow = 0.4;
      } else if (airborne) {
        thigh = i === 0 ? 1.0 : -0.5;
        knee = i === 0 ? -1.2 : -0.7;
        arm = i === 0 ? -0.9 : 1.4;
      } else if (pose === 'slide') {
        thigh = 1.4;
        knee = -0.25;
        arm = -0.8;
        elbow = 0.5;
      } else if (pose === 'glide') {
        thigh = 0.2;
        knee = -0.5;
        arm = 0;
        elbow = 0.3;
      }
      this.hips[i]!.rotation.x = thigh;
      this.knees[i]!.rotation.x = knee;
      this.shoulders[i]!.rotation.x = arm;
      this.elbows[i]!.rotation.x = elbow;
      this.shoulders[i]!.rotation.z = pose === 'glide' ? (i === 0 ? -1.2 : 1.2) : 0;
      // CloudTec pods compress at this foot's strike, then spring back.
      const sinceStrike = (((beat - i) % 2) + 2) % 2;
      const contact = pose === 'run' ? Math.exp(-sinceStrike * 7) : this.squash;
      const inflate = 1 + this.surge * 0.9;
      this.pods[i]!.scale.set((1 + contact * 0.25) * inflate, (1 - contact * 0.55) * inflate, inflate);
    }
    if (pose === 'slide') {
      bodyY = 0.45;
      lean = 1.0;
    } else if (pose === 'glide') {
      lean = -0.3;
    } else if (pose === 'idle') {
      bodyY = 0.95 + Math.sin(beat * Math.PI) * 0.01;
      lean = 0;
    }
    this.body.position.y = bodyY;
    this.torso.rotation.x = lean;
    this.torso.rotation.y = pose === 'run' ? 0.12 * Math.cos(phase) : 0;
    this.torso.rotation.z = stumble > 0 ? Math.sin(stumble * 30) * 0.3 * stumble : 0;

    if (this.ponytail) {
      const target = pose === 'run' ? Math.sin(phase) * 0.35 : airborne ? -0.6 : 0;
      this.swing = damp(this.swing, target, 12, dt);
      this.ponytail.rotation.z = this.swing;
      this.ponytail.rotation.x = airborne ? 0.5 : 0.15 + Math.abs(Math.cos(phase)) * 0.15;
    }

    this.surge = damp(this.surge, this.surgeTarget, 8, dt);
    const pulse = this.surge * (0.75 + 0.25 * Math.sin(beat * Math.PI * 2));
    this.podMat.emissive.copy(this.glow.setHex(0xd4ff3a)).multiplyScalar(pulse);
    this.shoeAccent.emissive.copy(this.glow.setHex(0xd4ff3a)).multiplyScalar(pulse * 0.6);
    this.cloud.scale.setScalar(damp(this.cloud.scale.x, pose === 'glide' ? 1 : 0, 10, dt));
    this.cloud.position.y = 0.05;
    this.cloud.rotation.y += dt;

    this.root.rotation.x = pose === 'dead' ? -Math.min(1.45, deadTime * 5) : 0;
    this.shadow.position.y = 0.025 - y;
    this.shadow.scale.setScalar(Math.max(0.35, 1 - y * 0.16));
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
}
