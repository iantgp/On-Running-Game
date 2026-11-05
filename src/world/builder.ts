import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface Transform {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const pos = new THREE.Vector3();
const scale = new THREE.Vector3();
const color = new THREE.Color();

/**
 * Collects primitives with baked vertex colours and merges them into one geometry,
 * so every model (a tram, a facade, a tree) renders in a single draw call with a
 * single shared material.
 */
export class ModelBuilder {
  private readonly parts: THREE.BufferGeometry[] = [];

  add(geometry: THREE.BufferGeometry, hex: number, t: Transform = {}): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    euler.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0);
    quat.setFromEuler(euler);
    pos.set(t.x ?? 0, t.y ?? 0, t.z ?? 0);
    scale.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
    g.applyMatrix4(matrix.compose(pos, quat, scale));
    color.setHex(hex);
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
    return this;
  }

  box(w: number, h: number, d: number, hex: number, t: Transform = {}): this {
    return this.add(new THREE.BoxGeometry(w, h, d), hex, t);
  }

  cylinder(radiusTop: number, radiusBottom: number, h: number, hex: number, t: Transform = {}, segments = 8): this {
    return this.add(new THREE.CylinderGeometry(radiusTop, radiusBottom, h, segments), hex, t);
  }

  cone(radius: number, h: number, hex: number, t: Transform = {}, segments = 8): this {
    return this.add(new THREE.ConeGeometry(radius, h, segments), hex, t);
  }

  sphere(radius: number, hex: number, t: Transform = {}, widthSegments = 10, heightSegments = 8): this {
    return this.add(new THREE.SphereGeometry(radius, widthSegments, heightSegments), hex, t);
  }

  ico(radius: number, hex: number, t: Transform = {}, detail = 1): this {
    return this.add(new THREE.IcosahedronGeometry(radius, detail), hex, t);
  }

  torus(radius: number, tube: number, hex: number, t: Transform = {}): this {
    return this.add(new THREE.TorusGeometry(radius, tube, 6, 14), hex, t);
  }

  plane(w: number, h: number, hex: number, t: Transform = {}): this {
    return this.add(new THREE.PlaneGeometry(w, h), hex, t);
  }

  /** Flat triangle in the XY plane (used for flags and gables). */
  triangle(points: [number, number][], hex: number, t: Transform = {}): this {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    return this.add(new THREE.ShapeGeometry(shape), hex, t);
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    for (const part of this.parts) part.dispose();
    this.parts.length = 0;
    if (!merged) throw new Error('ModelBuilder: failed to merge geometry');
    merged.computeBoundingSphere();
    return merged;
  }
}

/** Shared material for all vertex-coloured models. */
export const vertexColorMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
