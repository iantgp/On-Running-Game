import * as THREE from 'three';
import { BRAND } from '../config/brand';
import { textTexture } from './textures';

export type PickupKind = 'pod' | 'eco' | 'badge' | 'surge';

/** A collectible in track space. `x` is free (not lane-bound) so magnets can pull it. */
export interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  s: number;
  taken: boolean;
  /** Instance index for pods; -1 for special pickups. */
  handle: number;
  mesh: THREE.Object3D | null;
}

const POD_CAPACITY = 220;
const HALO_CAPACITY = 260;
const HALO: Record<PickupKind, { color: number; size: number }> = {
  pod: { color: 0x58d4ff, size: 1.2 },
  eco: { color: 0x3fe08a, size: 2.2 },
  badge: { color: 0xffffff, size: 2.4 },
  surge: { color: 0xd4ff3a, size: 3.4 },
};

function leafTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f9d5b';
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#eafff2';
  g.lineWidth = 6;
  g.stroke();
  g.fillStyle = '#eafff2';
  g.beginPath();
  g.moveTo(40, 92);
  g.bezierCurveTo(30, 50, 60, 28, 96, 30);
  g.bezierCurveTo(98, 70, 76, 96, 40, 92);
  g.fill();
  g.strokeStyle = '#1f9d5b';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(42, 90);
  g.quadraticCurveTo(62, 64, 90, 36);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Renders Cloud Pods (instanced, one draw call), eco-tokens, On badges and the
 * CloudTec Surge power-up, each with an additive glow halo.
 */
export class PickupView {
  readonly group = new THREE.Group();
  private readonly pods: THREE.InstancedMesh;
  private readonly freePods: number[] = [];
  private usedPods = 0;
  private readonly pools: Record<'eco' | 'badge' | 'surge', THREE.Object3D[]> = { eco: [], badge: [], surge: [] };
  private readonly haloGeo = new THREE.BufferGeometry();
  private readonly haloPos = new Float32Array(HALO_CAPACITY * 3);
  private readonly haloColor = new Float32Array(HALO_CAPACITY * 3);
  private readonly haloSize = new Float32Array(HALO_CAPACITY);
  private readonly haloMat: THREE.ShaderMaterial;
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly tmpColor = new THREE.Color();
  private readonly ecoMaterial: THREE.Material;
  private readonly badgeMaterial: THREE.Material;

  constructor(dot: THREE.Texture) {
    // A CloudTec pod: a hollow, slightly oval tube.
    const podGeo = new THREE.TorusGeometry(0.24, 0.09, 10, 24);
    podGeo.scale(1.35, 0.9, 1);
    this.pods = new THREE.InstancedMesh(
      podGeo,
      new THREE.MeshLambertMaterial({ color: 0xeafcff, emissive: 0x2fb8ff, emissiveIntensity: 0.85 }),
      POD_CAPACITY,
    );
    this.pods.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pods.count = 0;
    this.pods.frustumCulled = false;
    this.group.add(this.pods);

    this.haloGeo.setAttribute('position', new THREE.BufferAttribute(this.haloPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.haloGeo.setAttribute('aColor', new THREE.BufferAttribute(this.haloColor, 3).setUsage(THREE.DynamicDrawUsage));
    this.haloGeo.setAttribute('aSize', new THREE.BufferAttribute(this.haloSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.haloMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: dot }, uScale: { value: 400 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        uniform float uScale;
        varying vec3 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          vColor = aColor;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * 0.55;
          gl_FragColor = vec4(vColor * a, a);
          #include <colorspace_fragment>
        }`,
    });
    const halos = new THREE.Points(this.haloGeo, this.haloMat);
    halos.frustumCulled = false;
    this.group.add(halos);

    this.ecoMaterial = new THREE.MeshBasicMaterial({ map: leafTexture(), side: THREE.DoubleSide });
    this.badgeMaterial = new THREE.MeshBasicMaterial({
      map: textTexture(BRAND.mark || '★', { width: 256, height: 256, background: '#000000', color: '#ffffff', fontSize: 120 }),
      side: THREE.DoubleSide,
    });
  }

  setScale(viewportHeightPx: number, fovDeg: number): void {
    this.haloMat.uniforms.uScale!.value = viewportHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  attach(p: Pickup): void {
    if (p.kind === 'pod') {
      const index = this.freePods.pop() ?? (this.usedPods < POD_CAPACITY ? this.usedPods++ : -1);
      p.handle = index;
      this.pods.count = this.usedPods;
      return;
    }
    const pool = this.pools[p.kind];
    const mesh = pool.pop() ?? this.createSpecial(p.kind);
    mesh.visible = true;
    this.group.add(mesh);
    p.mesh = mesh;
  }

  detach(p: Pickup): void {
    if (p.kind === 'pod') {
      if (p.handle >= 0) {
        this.pods.setMatrixAt(p.handle, this.zero);
        this.freePods.push(p.handle);
        this.pods.instanceMatrix.needsUpdate = true;
      }
      p.handle = -1;
      return;
    }
    if (p.mesh) {
      p.mesh.visible = false;
      this.group.remove(p.mesh);
      this.pools[p.kind].push(p.mesh);
      p.mesh = null;
    }
  }

  private createSpecial(kind: 'eco' | 'badge' | 'surge'): THREE.Object3D {
    const group = new THREE.Group();
    if (kind === 'surge') {
      const glow = new THREE.MeshBasicMaterial({ color: 0xd4ff3a });
      const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const pod = new THREE.CapsuleGeometry(0.1, 0.3, 4, 10);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const m = new THREE.Mesh(pod, i % 2 ? glow : white);
        m.position.set(Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0);
        m.rotation.z = a;
        group.add(m);
      }
      group.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), glow));
    } else {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 28), new THREE.MeshLambertMaterial({ color: kind === 'eco' ? 0x1f9d5b : 0x111111 }));
      disc.rotation.x = Math.PI / 2;
      const faceGeo = new THREE.CircleGeometry(0.46, 28);
      const front = new THREE.Mesh(faceGeo, kind === 'eco' ? this.ecoMaterial : this.badgeMaterial);
      front.position.z = 0.045;
      const back = front.clone();
      back.position.z = -0.045;
      back.rotation.y = Math.PI;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 8, 32), new THREE.MeshBasicMaterial({ color: kind === 'eco' ? 0xeafff2 : 0xffffff }));
      group.add(disc, front, back, rim);
    }
    return group;
  }

  update(list: readonly Pickup[], distance: number, time: number): void {
    let halo = 0;
    for (const p of list) {
      if (p.taken) continue;
      const z = distance - p.s;
      const bob = Math.sin(time * 3 + p.s) * 0.08;
      if (p.kind === 'pod') {
        if (p.handle < 0) continue;
        this.euler.set(0, time * 2.2 + p.s * 0.3, 0);
        this.quat.setFromEuler(this.euler);
        this.pos.set(p.x, p.y + bob, z);
        this.scl.setScalar(1);
        this.pods.setMatrixAt(p.handle, this.matrix.compose(this.pos, this.quat, this.scl));
      } else if (p.mesh) {
        p.mesh.position.set(p.x, p.y + bob, z);
        p.mesh.rotation.y = time * (p.kind === 'surge' ? 1.2 : 2.4);
        if (p.kind === 'surge') p.mesh.rotation.z = time * 1.6;
      }
      if (halo < HALO_CAPACITY && z > -60 && z < 8) {
        const cfg = HALO[p.kind];
        this.haloPos[halo * 3] = p.x;
        this.haloPos[halo * 3 + 1] = p.y + bob;
        this.haloPos[halo * 3 + 2] = z;
        this.tmpColor.setHex(cfg.color);
        this.haloColor[halo * 3] = this.tmpColor.r;
        this.haloColor[halo * 3 + 1] = this.tmpColor.g;
        this.haloColor[halo * 3 + 2] = this.tmpColor.b;
        this.haloSize[halo] = cfg.size * (1 + Math.sin(time * 4 + p.s) * 0.1);
        halo++;
      }
    }
    this.pods.instanceMatrix.needsUpdate = true;
    this.haloGeo.setDrawRange(0, halo);
    for (const name of ['position', 'aColor', 'aSize']) this.haloGeo.getAttribute(name).needsUpdate = true;
  }
}
