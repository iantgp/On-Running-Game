import * as THREE from 'three';

const CAPACITY = 320;

interface Particle {
  x: number;
  y: number;
  s: number;
  vx: number;
  vy: number;
  vs: number;
  life: number;
  maxLife: number;
  size: number;
  grow: number;
  gravity: number;
}

export interface ParticleSpec {
  x: number;
  y: number;
  s: number;
  vx?: number;
  vy?: number;
  vs?: number;
  life: number;
  size: number;
  color: number;
  gravity?: number;
  grow?: number;
}

/**
 * Lightweight particle system (single draw call) plus speed lines and the landing
 * shockwave ring. Particles live in track space (x, y, s) so they stay put on the
 * road while the world scrolls.
 */
export class Effects {
  readonly group = new THREE.Group();
  private readonly particles: (Particle | null)[] = new Array(CAPACITY).fill(null);
  private readonly positions = new Float32Array(CAPACITY * 3);
  private readonly colors = new Float32Array(CAPACITY * 3);
  private readonly sizes = new Float32Array(CAPACITY);
  private readonly alphas = new Float32Array(CAPACITY);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly speedLines: THREE.LineSegments;
  private readonly ring: THREE.Mesh;
  private ringAge = 1;
  private ringS = 0;
  private cursor = 0;
  private readonly tmpColor = new THREE.Color();

  constructor(dot: THREE.Texture, camera: THREE.Camera) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: dot }, uScale: { value: 400 } },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          vColor = aColor;
          vAlpha = aAlpha;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
        }`,
    });
    const points = new THREE.Points(this.geometry, this.material);
    points.frustumCulled = false;
    this.group.add(points);

    // Speed lines live in camera space.
    const lineCount = 28;
    const linePos = new Float32Array(lineCount * 6);
    for (let i = 0; i < lineCount; i++) this.resetLine(linePos, i, -Math.random() * 30);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.speedLines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    this.speedLines.frustumCulled = false;
    camera.add(this.speedLines);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.72, 40),
      new THREE.MeshBasicMaterial({ color: 0xd4ff3a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.group.add(this.ring);
  }

  setScale(viewportHeightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale!.value = viewportHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  spawn(spec: ParticleSpec): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % CAPACITY;
    this.particles[i] = {
      x: spec.x,
      y: spec.y,
      s: spec.s,
      vx: spec.vx ?? 0,
      vy: spec.vy ?? 0,
      vs: spec.vs ?? 0,
      life: spec.life,
      maxLife: spec.life,
      size: spec.size,
      grow: spec.grow ?? 0,
      gravity: spec.gravity ?? 0,
    };
    this.tmpColor.setHex(spec.color);
    this.colors[i * 3] = this.tmpColor.r;
    this.colors[i * 3 + 1] = this.tmpColor.g;
    this.colors[i * 3 + 2] = this.tmpColor.b;
  }

  /** Radial burst of particles on the road. */
  burst(x: number, y: number, s: number, color: number, count: number, speed: number, size: number, life = 0.5, gravity = 0): void {
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + Math.random() * 0.3;
      const v = speed * (0.6 + Math.random() * 0.6);
      this.spawn({ x, y, s, vx: Math.cos(a) * v, vs: Math.sin(a) * v, vy: Math.random() * speed * 0.5, life, size, color, gravity, grow: size });
    }
  }

  shockwave(x: number, s: number, color: number): void {
    this.ringAge = 0;
    this.ringS = s;
    this.ring.position.x = x;
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  update(dt: number, distance: number, boost: number, speed: number): void {
    for (let i = 0; i < CAPACITY; i++) {
      const p = this.particles[i];
      if (!p) {
        this.alphas[i] = 0;
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        this.particles[i] = null;
        this.alphas[i] = 0;
        continue;
      }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.02, p.y + p.vy * dt);
      p.s += p.vs * dt;
      p.size += p.grow * dt;
      const t = p.life / p.maxLife;
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = distance - p.s;
      this.sizes[i] = p.size;
      this.alphas[i] = Math.min(1, t * 1.6);
    }
    for (const name of ['position', 'aSize', 'aAlpha', 'aColor']) this.geometry.getAttribute(name).needsUpdate = true;

    // Speed lines while boosted.
    const lineMat = this.speedLines.material as THREE.LineBasicMaterial;
    lineMat.opacity = Math.min(0.55, boost * 3);
    this.speedLines.visible = lineMat.opacity > 0.02;
    if (this.speedLines.visible) {
      const attr = this.speedLines.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const step = speed * dt * 2.2;
      for (let i = 0; i < arr.length / 6; i++) {
        arr[i * 6 + 2] += step;
        arr[i * 6 + 5] += step;
        if (arr[i * 6 + 2] > 0) this.resetLine(arr, i, -30);
      }
      attr.needsUpdate = true;
    }

    // Landing shockwave.
    this.ringAge += dt;
    const ringMat = this.ring.material as THREE.MeshBasicMaterial;
    const k = Math.min(1, this.ringAge / 0.45);
    ringMat.opacity = (1 - k) * 0.85;
    this.ring.visible = k < 1;
    this.ring.scale.setScalar(1 + k * 3.5);
    this.ring.position.set(this.ring.position.x, 0.04, distance - this.ringS);
  }

  private resetLine(arr: Float32Array, i: number, z: number): void {
    const a = Math.random() * Math.PI * 2;
    const r = 1.4 + Math.random() * 2.2;
    const x = Math.cos(a) * r * 1.4;
    const y = Math.sin(a) * r;
    const len = 1.5 + Math.random() * 2.5;
    arr.set([x, y, z, x, y, z - len], i * 6);
  }
}
