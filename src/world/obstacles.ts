import * as THREE from 'three';
import { BRAND } from '../config/brand';
import { ModelBuilder, vertexColorMaterial } from './builder';
import { textTexture } from './textures';
import type { ZoneKey } from './themes';

export type ObstacleType = 'low' | 'high' | 'block';

const C = {
  zvvBlue: 0x1560bd,
  white: 0xf3f4f1,
  glass: 0x24303f,
  dark: 0x2b2f35,
  steel: 0x8d949c,
  red: 0xd8262e,
  stone: 0xb9b1a3,
  water: 0x5d8fc0,
  wood: 0x8a5a3b,
  snow: 0xf7fafc,
  orange: 0xff7a1a,
  yellow: 0xf6c518,
  green: 0x3f7a4a,
  light: 0xfff4c2,
};

const labelMaterials = new Map<string, THREE.Material>();
function label(text: string, opts: Parameters<typeof textTexture>[1], basic = false): THREE.Material {
  const key = `${text}|${opts.background}|${opts.color}|${basic}`;
  let mat = labelMaterials.get(key);
  if (!mat) {
    const map = textTexture(text, opts);
    mat = basic
      ? new THREE.MeshBasicMaterial({ map, transparent: opts.background === null })
      : new THREE.MeshLambertMaterial({ map, transparent: opts.background === null });
    labelMaterials.set(key, mat);
  }
  return mat;
}

const plane = new THREE.PlaneGeometry(1, 1);
function addLabel(group: THREE.Object3D, mat: THREE.Material, w: number, h: number, x: number, y: number, z: number, ry = 0): void {
  const m = new THREE.Mesh(plane, mat);
  m.scale.set(w, h, 1);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  group.add(m);
}

const geometryCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geometryCache.get(key);
  if (!g) {
    g = build();
    geometryCache.set(key, g);
  }
  return g;
}

// ---- vehicles (front faces +z, body extends to -length) ---------------------

function busGeometry(len: number): THREE.BufferGeometry {
  const b = new ModelBuilder();
  const mid = -len / 2;
  b.box(2.05, 0.45, len - 0.4, C.dark, { y: 0.32, z: mid });
  b.box(2.05, 1.15, len, C.zvvBlue, { y: 1.12, z: mid });
  b.box(2.05, 1.25, len, C.white, { y: 2.3, z: mid });
  b.box(2.07, 0.75, len - 0.8, C.glass, { y: 2.3, z: mid });
  b.box(1.95, 0.2, len - 0.3, C.white, { y: 3.0, z: mid });
  b.box(1.75, 0.85, 0.06, C.glass, { y: 2.15, z: 0.01 });
  b.box(2.08, 0.12, len, C.white, { y: 1.55, z: mid });
  for (const x of [-0.75, 0.75]) b.box(0.3, 0.14, 0.05, C.light, { x, y: 0.75, z: 0.03 });
  for (const z of [-0.9, -len + 1.2]) for (const x of [-1.02, 1.02]) b.cylinder(0.45, 0.45, 0.25, 0x15171a, { x, y: 0.45, z, rz: Math.PI / 2 }, 12);
  return b.build();
}

function tramGeometry(len: number): THREE.BufferGeometry {
  const b = new ModelBuilder();
  const sections = Math.max(2, Math.round(len / 7));
  const sectionLen = len / sections;
  for (let i = 0; i < sections; i++) {
    const z = -sectionLen * (i + 0.5);
    const l = sectionLen - 0.35;
    b.box(2.05, 1.1, l, C.zvvBlue, { y: 0.95, z });
    b.box(2.05, 1.3, l, C.white, { y: 2.15, z });
    b.box(2.07, 0.85, l - 0.6, C.glass, { y: 2.2, z });
    b.box(1.9, 0.18, l, C.white, { y: 2.88, z });
    b.box(2.05, 0.35, l - 0.3, C.dark, { y: 0.25, z });
    if (i < sections - 1) b.box(1.8, 2.3, 0.4, 0x3a3f46, { y: 1.55, z: -sectionLen * (i + 1) });
  }
  b.box(1.8, 0.95, 0.06, C.glass, { y: 2.15, z: 0.01 });
  for (const x of [-0.7, 0.7]) b.box(0.26, 0.12, 0.05, C.light, { x, y: 0.7, z: 0.03 });
  // Pantograph.
  b.box(0.9, 0.08, 0.9, C.dark, { y: 3.02, z: -sectionLen * 0.5 });
  b.box(0.06, 0.9, 0.06, C.dark, { y: 3.45, z: -sectionLen * 0.5, rx: 0.5 });
  b.box(1.0, 0.05, 0.08, C.dark, { y: 3.9, z: -sectionLen * 0.5 - 0.2 });
  return b.build();
}

function groomerGeometry(len: number): THREE.BufferGeometry {
  const b = new ModelBuilder();
  const mid = -len / 2;
  b.box(2.0, 0.9, len, 0x22252a, { y: 0.45, z: mid });
  b.box(1.9, 1.3, len * 0.55, C.red, { y: 1.55, z: mid - len * 0.15 });
  b.box(1.7, 1.1, len * 0.4, C.red, { y: 2.7, z: -len * 0.32 });
  b.box(1.72, 0.7, len * 0.36, C.glass, { y: 2.8, z: -len * 0.32 });
  b.box(2.3, 1.2, 0.25, 0xd6dbe0, { y: 0.7, z: 0.15, rx: -0.25 });
  b.box(0.4, 0.2, 0.2, C.orange, { y: 3.35, z: -len * 0.32 });
  return b.build();
}

function foodTruckGeometry(len: number): THREE.BufferGeometry {
  const b = new ModelBuilder();
  const mid = -len / 2;
  b.box(2.0, 2.4, len - 1.6, 0xe9e6df, { y: 1.75, z: mid - 0.8 });
  b.box(2.0, 1.6, 1.6, C.yellow, { y: 1.3, z: -0.8 });
  b.box(1.8, 0.7, 0.06, C.glass, { y: 1.75, z: 0.01 });
  b.box(2.1, 0.12, len - 2.4, 0xd8262e, { y: 2.75, z: mid - 0.8 });
  b.box(0.05, 0.9, len - 2.6, 0x3a3f46, { x: 1.01, y: 1.9, z: mid - 0.8 });
  b.box(2.02, 0.4, len, C.dark, { y: 0.3, z: mid });
  for (const x of [-0.7, 0.7]) b.box(0.25, 0.14, 0.05, C.light, { x, y: 0.75, z: 0.03 });
  return b.build();
}

// ---- low obstacles (≤ 0.85 m so they read as jumpable) ---------------------------

function lowGeometry(zone: ZoneKey, variant: number): THREE.BufferGeometry {
  const b = new ModelBuilder();
  if (zone === 'zurich' && variant === 1) {
    // Zürich drinking fountain (one of the city's 1,200 Brunnen).
    b.cylinder(0.95, 0.9, 0.62, C.stone, { y: 0.31 }, 8);
    b.cylinder(0.82, 0.82, 0.04, C.water, { y: 0.6 }, 8);
    b.cylinder(0.14, 0.18, 0.8, 0x9e968a, { y: 0.4 }, 8);
    b.box(0.06, 0.06, 0.3, C.steel, { y: 0.74, z: 0.15 });
  } else if (zone === 'zurich' && variant === 2) {
    // Bike rack with parked bikes.
    b.box(2.0, 0.06, 0.06, C.steel, { y: 0.7 });
    for (const x of [-0.95, 0.95]) b.box(0.06, 0.7, 0.06, C.steel, { x, y: 0.35 });
    for (const x of [-0.55, 0.15, 0.75]) {
      for (const z of [-0.35, 0.35]) b.torus(0.3, 0.03, 0x1a1c1f, { x, y: 0.32, z, ry: Math.PI / 2 });
      b.box(0.04, 0.04, 0.7, x > 0 ? C.red : C.zvvBlue, { x, y: 0.55 });
    }
  } else if (zone === 'zurich') {
    for (const x of [-0.9, 0.9]) b.box(0.12, 0.85, 0.12, C.dark, { x, y: 0.425 });
    for (let i = 0; i < 4; i++) b.box(0.5, 0.22, 0.14, i % 2 ? C.white : C.red, { x: -0.75 + i * 0.5, y: 0.72 });
    for (let i = 0; i < 4; i++) b.box(0.5, 0.22, 0.14, i % 2 ? C.red : C.white, { x: -0.75 + i * 0.5, y: 0.45 });
    b.sphere(0.07, C.orange, { x: -0.9, y: 0.92 });
  } else if (zone === 'alps' && variant === 1) {
    b.sphere(1.0, C.snow, { y: 0.1, sx: 1.05, sy: 0.65, sz: 0.6 });
    b.sphere(0.6, C.snow, { x: -0.6, y: 0.1, sy: 0.7 });
    b.sphere(0.6, C.snow, { x: 0.6, y: 0.05, sy: 0.6 });
    b.cylinder(0.04, 0.04, 1.2, C.orange, { x: 0.95, y: 0.6 });
  } else if (zone === 'alps') {
    for (const x of [-0.95, 0, 0.95]) b.cylinder(0.08, 0.09, 0.9, C.wood, { x, y: 0.45 }, 6);
    for (const y of [0.4, 0.72]) b.cylinder(0.06, 0.06, 2.0, 0x9a6a46, { y, rz: Math.PI / 2 }, 6);
    b.box(2.0, 0.08, 0.2, C.snow, { y: 0.8 });
  } else if (variant === 1) {
    for (const x of [-0.75, 0, 0.75]) {
      b.cone(0.22, 0.75, C.orange, { x, y: 0.375 }, 10);
      b.cylinder(0.16, 0.18, 0.08, C.white, { x, y: 0.45 }, 10);
    }
    b.box(1.8, 0.05, 0.05, C.white, { y: 0.72 });
  } else {
    // Police-style sawhorse barricade.
    for (let i = 0; i < 6; i++) b.box(0.34, 0.22, 0.1, i % 2 ? C.white : 0x1f4fbf, { x: -0.85 + i * 0.34, y: 0.66 });
    for (const x of [-0.85, 0.85]) {
      b.box(0.08, 0.8, 0.08, 0xd9d9d9, { x, y: 0.38, z: 0.15, rx: 0.25 });
      b.box(0.08, 0.8, 0.08, 0xd9d9d9, { x, y: 0.38, z: -0.15, rx: -0.25 });
    }
  }
  return b.build();
}

// ---- high obstacles (slide under) ---------------------------------------------------

function highFrameGeometry(zone: ZoneKey): THREE.BufferGeometry {
  const b = new ModelBuilder();
  if (zone === 'newyork') {
    // Scaffolding bridge.
    for (const x of [-1.05, 1.05]) for (const z of [-0.35, 0.35]) b.box(0.08, 3.0, 0.08, C.steel, { x, y: 1.5, z });
    b.box(2.3, 0.18, 1.0, 0x6a5040, { y: 1.3 });
    b.box(2.3, 0.9, 0.04, C.green, { y: 1.85, z: 0.38 });
    b.box(2.3, 0.06, 0.06, C.steel, { y: 2.9, z: 0.35 });
  } else {
    const pole = zone === 'alps' ? C.wood : C.dark;
    for (const x of [-1.07, 1.07]) b.box(0.1, 2.7, 0.1, pole, { x, y: 1.35 });
    b.box(2.25, 0.06, 0.06, pole, { y: 2.68 });
    b.box(2.2, 0.95, 0.06, zone === 'alps' ? C.red : C.zvvBlue, { y: 1.65 });
  }
  return b.build();
}

const BANNER_TEXT: Record<ZoneKey, string[]> = {
  zurich: [BRAND.mark || 'ZÜRI', 'GRÜEZI', 'ZÜRI'],
  alps: ['FURKA', BRAND.mark || 'ALPS'],
  newyork: [BRAND.mark || 'NYC'],
};

export interface ObstacleVisual {
  object: THREE.Object3D;
  /** Whether the vehicle carries a tram bell (for the approach sound). */
  tram: boolean;
}

/** Builds the scene object for an obstacle. Geometry is cached and shared. */
export function createObstacle(type: ObstacleType, zone: ZoneKey, length: number, seed: number, oncoming: boolean): ObstacleVisual {
  const group = new THREE.Group();
  const lenKey = Math.round(length * 2) / 2;
  let tram = false;
  const add = (geo: THREE.BufferGeometry): void => {
    const mesh = new THREE.Mesh(geo, vertexColorMaterial);
    mesh.castShadow = true;
    group.add(mesh);
  };

  if (type === 'low') {
    const variant = Math.floor(seed * (zone === 'zurich' ? 3 : 2));
    add(cached(`low:${zone}:${variant}`, () => lowGeometry(zone, variant)));
  } else if (type === 'high') {
    add(cached(`high:${zone}`, () => highFrameGeometry(zone)));
    if (zone !== 'newyork') {
      const options = BANNER_TEXT[zone];
      const text = options[Math.floor(seed * options.length)]!;
      const bg = zone === 'alps' ? '#d8262e' : text === BRAND.mark ? '#16181c' : '#1560bd';
      addLabel(group, label(text, { width: 512, height: 220, background: bg, color: '#ffffff', fontSize: 130 }), 2.2, 0.95, 0, 1.65, 0.035);
    }
  } else {
    const operator = BRAND.busOperator;
    if (zone === 'zurich' && length >= 8) {
      tram = true;
      add(cached(`tram:${lenKey}`, () => tramGeometry(lenKey)));
      addLabel(group, label('11  Rehalp', { width: 384, height: 64, background: '#111111', color: '#ffb000', fontSize: 40 }, true), 1.4, 0.24, 0, 2.72, 0.05);
    } else if (zone === 'alps' && length < 8) {
      add(cached(`groomer:${lenKey}`, () => groomerGeometry(lenKey)));
    } else if (zone === 'newyork' && length < 8 && !oncoming) {
      add(cached(`truck:${lenKey}`, () => foodTruckGeometry(lenKey)));
    } else {
      add(cached(`bus:${lenKey}`, () => busGeometry(lenKey)));
      addLabel(group, label(operator, { width: 256, height: 56, background: '#111111', color: '#ffb000', fontSize: 44 }, true), 1.3, 0.28, 0, 2.78, 0.05);
    }
    if (tram || group.children.length > 1) {
      const side = label(operator, { width: 384, height: 132, background: null, color: '#ffffff', fontSize: 104 });
      for (const s of [-1, 1]) addLabel(group, side, 1.6, 0.55, s * 1.04, 1.0, Math.max(-length / 2, -2.4), s * (Math.PI / 2));
    }
    if (oncoming) {
      const glow = new THREE.MeshBasicMaterial({ color: 0xfff1b0 });
      for (const x of [-0.72, 0.72]) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), glow);
        lamp.position.set(x, 0.75, 0.06);
        group.add(lamp);
      }
    }
  }
  return { object: group, tram };
}
