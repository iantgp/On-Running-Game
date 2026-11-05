import * as THREE from 'three';
import { ModelBuilder, vertexColorMaterial } from './builder';
import { skylineTexture, streetSignTexture, textTexture } from './textures';
import { ZONE_LEN, ZONE_THEMES, LAKE_START, isLakeAt, zoneAt, zoneIndexAt, zoneOffset, type ZoneKey } from './themes';

const SPACING = 15;
const CURB_X = 7.5;
const PROP_X = 5.1;
const HORIZON = 150;

const C = {
  glass: 0x2c3b4c,
  frame: 0xf2efe8,
  roof: 0x5d4639,
  slate: 0x4a525c,
  stone: 0xd8d0c2,
  steel: 0x5b636c,
  dark: 0x2b2f35,
  red: 0xd8262e,
  white: 0xf5f5f2,
  blue: 0x1d5fb5,
  leaf: 0x5f8f4e,
  leafDark: 0x4b7a3f,
  trunk: 0x6b4a2f,
  wood: 0x8a5a3b,
  pine: 0x2e5e45,
  snow: 0xf7fafc,
  lit: 0xffd27a,
  yellow: 0xf6c518,
};

const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ---- Zürich ---------------------------------------------------------------------

function swissFlag(b: ModelBuilder, x: number, y: number, z: number): void {
  b.cylinder(0.04, 0.04, 2.4, C.steel, { x: x - 1.0, y: y + 0.55, z, rz: -1.0 });
  b.box(1.1, 1.1, 0.04, C.red, { x: x + 0.15, y, z });
  b.box(0.68, 0.22, 0.08, C.white, { x: x + 0.15, y, z });
  b.box(0.22, 0.68, 0.08, C.white, { x: x + 0.15, y, z });
}

function zurichFlag(b: ModelBuilder, x: number, y: number, z: number): void {
  b.cylinder(0.04, 0.04, 2.4, C.steel, { x: x - 1.0, y: y + 0.55, z, rz: -1.0 });
  const s = 1.1;
  for (const [dz, ry] of [[0.02, 0], [-0.02, Math.PI]] as const) {
    const ox = ry === 0 ? x - 0.4 : x + 0.7;
    b.triangle([[0, 0], [s, s], [0, s]], C.white, { x: ox, y: y - s / 2, z: z + dz, ry });
    b.triangle([[0, 0], [s, 0], [s, s]], C.blue, { x: ox, y: y - s / 2, z: z + dz, ry });
  }
}

/** Old-town facade facing +x (the street), base at y = 0, length 15 m along z. */
function zurichBuilding(v: number): THREE.BufferGeometry {
  const b = new ModelBuilder();
  const W = SPACING;
  const D = 10;
  const facades = [0xefe3c8, 0xc9d6b4, 0xe9bba5, 0xb5cddd, 0xf1ede4, 0xe6d3a3];
  const facade = facades[v % facades.length]!;
  const shutter = v % 2 ? 0x2f5d3a : 0x5b6f86;
  const floors = 4 + (v % 2);
  const floorH = 3.1;
  const groundH = 4.2;
  const H = groundH + floors * floorH;
  const fx = D / 2;
  b.box(D, H, W, facade, { y: H / 2 });
  b.box(0.22, groundH, W, C.stone, { x: fx + 0.06, y: groundH / 2 });
  const awning = [0x1d5fb5, 0x2f5d3a, 0xa8322d, 0x2b2f35][v % 4]!;
  for (let i = 0; i < 3; i++) {
    const z = -5 + i * 5;
    b.box(0.08, 2.7, 3.5, C.glass, { x: fx + 0.18, y: 1.75, z });
    b.box(0.1, 0.12, 3.7, C.frame, { x: fx + 0.2, y: 3.15, z });
  }
  b.box(1.5, 0.08, 4.4, awning, { x: fx + 0.85, y: 3.35, rz: -0.32 });
  b.box(0.4, 0.28, W, 0xefe9de, { x: fx + 0.12, y: groundH });
  for (let f = 0; f < floors; f++) {
    const y = groundH + f * floorH + 1.55;
    for (let k = 0; k < 4; k++) {
      const z = -5.4 + k * 3.6;
      b.box(0.06, 1.55, 1.0, C.glass, { x: fx + 0.04, y, z });
      b.box(0.16, 0.09, 1.25, C.frame, { x: fx + 0.08, y: y - 0.84, z });
      b.box(0.16, 0.09, 1.15, C.frame, { x: fx + 0.06, y: y + 0.82, z });
      for (const side of [-1, 1]) b.box(0.05, 1.55, 0.42, shutter, { x: fx + 0.07, y, z: z + side * 0.74 });
    }
  }
  // Pitched roof with gables, dormers and a chimney.
  const roofH = 4.2;
  const angle = Math.atan(roofH / (D / 2));
  const slope = Math.hypot(D / 2, roofH) + 0.5;
  const roof = v % 3 === 0 ? C.slate : C.roof;
  b.box(slope, 0.3, W + 0.5, roof, { x: D / 4 + 0.05, y: H + roofH / 2, rz: -angle });
  b.box(slope, 0.3, W + 0.5, roof, { x: -D / 4 - 0.05, y: H + roofH / 2, rz: angle });
  b.triangle([[-D / 2, 0], [D / 2, 0], [0, roofH]], facade, { y: H, z: W / 2 - 0.01 });
  b.triangle([[-D / 2, 0], [D / 2, 0], [0, roofH]], facade, { y: H, z: -W / 2 + 0.01, ry: Math.PI });
  for (const z of [-3.6, 3.6]) {
    b.box(1.5, 1.5, 1.6, facade, { x: D / 4 + 0.4, y: H + 1.3, z });
    b.box(0.06, 0.9, 0.8, C.glass, { x: D / 4 + 1.17, y: H + 1.25, z });
    b.box(1.8, 0.2, 1.9, roof, { x: D / 4 + 0.4, y: H + 2.1, z });
  }
  b.box(0.8, 2.2, 0.8, 0x8a7e72, { x: -1.5, y: H + roofH - 0.4, z: 4 });
  if (v % 3 === 1) swissFlag(b, fx + 1.4, groundH + floorH * 1.6, 2.5);
  if (v % 3 === 2) zurichFlag(b, fx + 1.4, groundH + floorH * 1.6, -2.5);
  return b.build();
}

/** Grossmünster: Romanesque minster with its twin domed towers. */
function grossmunster(): THREE.BufferGeometry {
  const b = new ModelBuilder();
  const sand = 0xd9c9a8;
  const lead = 0x5f6b72;
  b.box(12, 15, 15, sand, { y: 7.5 });
  b.box(0.1, 6, 2.2, 0x3a3a3a, { x: 6.05, y: 6, z: 0 });
  for (const z of [-4.5, 4.5]) b.box(0.1, 4, 1.3, C.glass, { x: 6.05, y: 9, z });
  for (const z of [-4.2, 4.2]) {
    b.box(6, 30, 6, sand, { x: 2.5, y: 15, z });
    for (const y of [17, 22, 26]) b.box(0.1, 2.2, 1.4, 0x3a3a3a, { x: 5.55, y, z });
    b.cylinder(2.6, 2.9, 6, sand, { x: 2.5, y: 33, z }, 8);
    for (const y of [32.5]) b.box(0.1, 2.4, 1.2, 0x3a3a3a, { x: 5.4, y, z });
    b.sphere(2.7, lead, { x: 2.5, y: 36, z, sy: 0.8 }, 10, 6);
    b.cone(0.5, 3, lead, { x: 2.5, y: 39.4, z }, 8);
  }
  b.box(13, 0.4, 15.5, 0x8b7e6a, { y: 15.2 });
  return b.build();
}

/** St. Peter: church tower with Europe's largest clock face. */
function stPeter(): THREE.BufferGeometry {
  const b = new ModelBuilder();
  const plaster = 0xe9e2d2;
  b.box(10, 11, 15, plaster, { x: -1, y: 5.5 });
  b.box(7, 30, 7, plaster, { x: 1.5, y: 15, z: 2 });
  b.cylinder(3.0, 3.0, 0.15, 0xe2c76d, { x: 5.1, y: 24, z: 2, rz: Math.PI / 2 }, 24);
  b.cylinder(2.7, 2.7, 0.18, 0x1c1c1c, { x: 5.1, y: 24, z: 2, rz: Math.PI / 2 }, 24);
  b.box(0.1, 2.1, 0.22, 0xe2c76d, { x: 5.25, y: 24.8, z: 2 });
  b.box(0.1, 0.22, 1.5, 0xe2c76d, { x: 5.25, y: 24, z: 2.6 });
  b.cone(5.2, 14, 0x3f7a6a, { x: 1.5, y: 37, z: 2, ry: Math.PI / 4 }, 4);
  b.cone(0.6, 2, 0xe2c76d, { x: 1.5, y: 44.5, z: 2 }, 6);
  return b.build();
}

function linden(): THREE.BufferGeometry {
  return new ModelBuilder()
    .cylinder(0.16, 0.22, 2.6, C.trunk, { y: 1.3 }, 6)
    .ico(1.6, C.leaf, { y: 3.8 })
    .ico(1.2, C.leafDark, { x: 0.7, y: 3.3, z: 0.4 })
    .ico(1.1, C.leaf, { x: -0.6, y: 4.4, z: -0.3 })
    .build();
}

function streetLamp(color = C.dark): THREE.BufferGeometry {
  return new ModelBuilder()
    .cylinder(0.07, 0.1, 5.2, color, { y: 2.6 }, 8)
    .box(1.3, 0.08, 0.08, color, { x: -0.6, y: 5.1 })
    .box(0.5, 0.18, 0.32, color, { x: -1.15, y: 5.0 })
    .box(0.42, 0.06, 0.26, 0xfff2c4, { x: -1.15, y: 4.88 })
    .build();
}

function bench(): THREE.BufferGeometry {
  const b = new ModelBuilder();
  for (const y of [0.45, 0.55]) b.box(0.45, 0.06, 1.8, C.wood, { y, x: y === 0.55 ? 0.15 : 0 });
  b.box(0.06, 0.45, 1.8, C.wood, { x: 0.25, y: 0.8 });
  for (const z of [-0.75, 0.75]) b.box(0.5, 0.45, 0.06, C.dark, { y: 0.22, z });
  return b.build();
}

function fountainProp(): THREE.BufferGeometry {
  return new ModelBuilder()
    .box(1.2, 0.7, 2.4, 0xb9b1a3, { y: 0.35 })
    .box(1.0, 0.04, 2.2, 0x5d8fc0, { y: 0.68 })
    .cylinder(0.2, 0.25, 1.8, 0x9e968a, { y: 0.9, z: 1.0 }, 8)
    .sphere(0.28, 0x9e968a, { y: 1.9, z: 1.0 })
    .box(0.06, 0.06, 0.4, 0x8d949c, { y: 1.4, z: 0.75 })
    .build();
}

function lakeRailing(withLamp: boolean): THREE.BufferGeometry {
  const b = new ModelBuilder();
  b.box(0.08, 0.08, SPACING, C.steel, { x: 1.9, y: 1.05 });
  b.box(0.05, 0.05, SPACING, C.steel, { x: 1.9, y: 0.6 });
  for (let z = -SPACING / 2; z < SPACING / 2; z += 2.5) b.box(0.07, 1.05, 0.07, C.steel, { x: 1.9, y: 0.52, z });
  if (withLamp) b.add(streetLamp(), 0x2b2f35, { x: 1.4, ry: Math.PI });
  else b.add(bench(), C.wood, { x: 0.8, ry: Math.PI });
  return b.build();
}

/** Tram overhead line: poles, span wire and a 30 m stretch of contact wire. */
function catenary(): THREE.BufferGeometry {
  const b = new ModelBuilder();
  for (const x of [-4.7, 4.7]) b.cylinder(0.09, 0.12, 6.6, C.steel, { x, y: 3.3 }, 8);
  b.box(9.4, 0.04, 0.04, 0x30343a, { y: 6.25 });
  b.box(0.03, 0.5, 0.03, 0x30343a, { y: 6.0 });
  b.box(0.035, 0.035, 30, 0x30343a, { y: 5.75, z: -15 });
  return b.build();
}

function crosswalk(color: number): THREE.BufferGeometry {
  const b = new ModelBuilder();
  for (let i = 0; i < 7; i++) b.box(0.6, 0.02, 3.2, color, { x: -3.3 + i * 1.1, y: 0.015 });
  return b.build();
}

// ---- Alps -------------------------------------------------------------------------

function pineCluster(v: number): THREE.BufferGeometry {
  const b = new ModelBuilder();
  const count = 3 + (v % 3);
  for (let i = 0; i < count; i++) {
    const s = 0.7 + hash(v * 10 + i) * 0.9;
    const x = (hash(v * 7 + i) - 0.5) * 7;
    const z = (hash(v * 3 + i) - 0.5) * 12;
    b.cylinder(0.2 * s, 0.28 * s, 1.4 * s, C.trunk, { x, y: 0.7 * s, z }, 6);
    for (let k = 0; k < 3; k++) {
      b.cone((2.3 - k * 0.6) * s, 2.6 * s, C.pine, { x, y: (2 + k * 1.5) * s, z }, 8);
      b.cone((1.1 - k * 0.3) * s, 0.9 * s, C.snow, { x, y: (2.9 + k * 1.5) * s, z }, 8);
    }
  }
  return b.build();
}

function chalet(v: number): THREE.BufferGeometry {
  const b = new ModelBuilder();
  const D = 8;
  const W = 9;
  b.box(D, 3, W, 0xefece6, { y: 1.5 });
  b.box(D, 3.2, W, 0x8a5a3b, { y: 4.6 });
  for (const z of [-2.6, 0, 2.6]) {
    b.box(0.06, 1.2, 1.0, C.glass, { x: D / 2 + 0.03, y: 4.6, z });
    for (const s of [-1, 1]) b.box(0.05, 1.2, 0.4, v % 2 ? 0x2f5d3a : C.red, { x: D / 2 + 0.05, y: 4.6, z: z + s * 0.7 });
    b.box(0.06, 1.0, 0.9, C.glass, { x: D / 2 + 0.03, y: 1.6, z });
  }
  b.box(1.0, 0.15, W, 0x6b4a2f, { x: D / 2 + 0.5, y: 3.3 });
  b.box(0.08, 0.7, W, 0x6b4a2f, { x: D / 2 + 0.98, y: 3.7 });
  b.box(0.3, 0.25, W - 1, C.red, { x: D / 2 + 1.05, y: 4.1 });
  const roofH = 3;
  const angle = Math.atan(roofH / (D / 2));
  const slope = Math.hypot(D / 2, roofH) + 1.4;
  for (const s of [-1, 1]) {
    b.box(slope, 0.35, W + 1.6, 0x4a3a30, { x: (s * D) / 4, y: 6.2 + roofH / 2, rz: -s * angle });
    b.box(slope, 0.3, W + 1.6, C.snow, { x: (s * D) / 4, y: 6.5 + roofH / 2, rz: -s * angle });
  }
  b.triangle([[-D / 2, 0], [D / 2, 0], [0, roofH]], 0x8a5a3b, { y: 6.2, z: W / 2 });
  b.triangle([[-D / 2, 0], [D / 2, 0], [0, roofH]], 0x8a5a3b, { y: 6.2, z: -W / 2, ry: Math.PI });
  return b.build();
}

function cow(): THREE.BufferGeometry {
  const b = new ModelBuilder();
  b.box(0.9, 0.85, 1.8, 0xf3efe8, { y: 1.05 });
  b.box(0.92, 0.5, 0.6, 0x6b3f22, { y: 1.15, z: 0.3 });
  b.box(0.92, 0.4, 0.4, 0x6b3f22, { y: 1.25, z: -0.6 });
  b.box(0.5, 0.5, 0.6, 0xf3efe8, { y: 1.35, z: -1.15 });
  b.box(0.42, 0.3, 0.2, 0xd9a59a, { y: 1.2, z: -1.48 });
  for (const s of [-1, 1]) b.cone(0.06, 0.25, 0xf2e6c8, { x: s * 0.22, y: 1.72, z: -1.05, rz: -s * 0.6 });
  for (const x of [-0.3, 0.3]) for (const z of [-0.65, 0.65]) b.box(0.18, 0.65, 0.18, 0xf3efe8, { x, y: 0.33, z });
  b.cylinder(0.12, 0.09, 0.2, 0xd8b04a, { y: 0.95, z: -1.05 }, 8);
  return b.build();
}

function snowPole(): THREE.BufferGeometry {
  const b = new ModelBuilder();
  for (let i = 0; i < 6; i++) b.cylinder(0.05, 0.05, 0.3, i % 2 ? 0x1b1b1b : 0xff7a1a, { y: 0.15 + i * 0.3 }, 6);
  return b.build();
}

// ---- New York -----------------------------------------------------------------------

function skyscraper(v: number): THREE.BufferGeometry {
  const b = new ModelBuilder();
  const W = SPACING;
  const D = 14;
  const H = 30 + ((v * 13) % 6) * 7;
  const bodies = [0x7a4e3b, 0xb6aa98, 0x3e4a5c, 0x6b707a, 0x8c5a42, 0x9a9488];
  const body = bodies[v % bodies.length]!;
  const fx = D / 2;
  b.box(D, H, W, body, { y: H / 2 });
  b.box(0.12, 4, W, 0x22262c, { x: fx + 0.05, y: 2 });
  b.box(1.6, 0.1, W - 2, [0xa8322d, 0x1f4f3a, 0x2b2f35][v % 3]!, { x: fx + 0.85, y: 3.9, rz: -0.25 });
  for (let y = 5.6, row = 0; y < H - 1.5; y += 3.4, row++) {
    b.box(0.06, 1.7, W - 1.2, 0x2a3442, { x: fx + 0.03, y });
    for (let k = 0; k < 6; k++) {
      if (hash(v * 100 + row * 7 + k) > 0.62) b.box(0.07, 1.5, 1.9, C.lit, { x: fx + 0.04, y, z: -6.2 + k * 2.48 });
    }
  }
  if (v % 2 === 0) {
    for (let y = 6; y < Math.min(H - 4, 26); y += 3.4) {
      b.box(1.0, 0.06, 4.2, 0x1b1d20, { x: fx + 0.5, y: y - 1.2, z: 2 });
      b.box(0.06, 3.4, 0.06, 0x1b1d20, { x: fx + 0.98, y: y + 0.5, z: 2, rx: 0.9 });
    }
  }
  if (H > 50) b.box(D - 4, 8, W - 4, body, { y: H + 4 });
  if (v % 3 !== 1) {
    const top = H > 50 ? H + 8 : H;
    for (const x of [-1, 1]) for (const z of [-1, 1]) b.box(0.15, 2.4, 0.15, 0x2b2f35, { x: x - 2, y: top + 1.2, z: z + 3 });
    b.cylinder(1.6, 1.6, 2.6, 0x7a5a3a, { x: -2, y: top + 3.6, z: 3 }, 12);
    b.cone(1.75, 1.2, 0x3b3530, { x: -2, y: top + 5.5, z: 3 }, 12);
  }
  return b.build();
}

function taxi(): THREE.BufferGeometry {
  const b = new ModelBuilder();
  b.box(1.8, 0.7, 4.4, C.yellow, { y: 0.65 });
  b.box(1.6, 0.6, 2.2, C.yellow, { y: 1.3, z: 0.2 });
  b.box(1.62, 0.45, 2.0, C.glass, { y: 1.3, z: 0.2 });
  b.box(0.6, 0.18, 0.25, 0xffffff, { y: 1.68, z: 0.2 });
  for (const x of [-0.9, 0.9]) for (const z of [-1.4, 1.4]) b.cylinder(0.33, 0.33, 0.22, 0x15171a, { x, y: 0.33, z, rz: Math.PI / 2 }, 10);
  b.box(1.82, 0.06, 4.0, 0x1b1b1b, { y: 0.8 });
  return b.build();
}

function hydrant(): THREE.BufferGeometry {
  return new ModelBuilder()
    .cylinder(0.18, 0.2, 0.7, 0xc8282e, { y: 0.35 }, 10)
    .sphere(0.19, 0xc8282e, { y: 0.72 })
    .cylinder(0.08, 0.08, 0.5, 0xc8282e, { y: 0.45, rz: Math.PI / 2 }, 8)
    .build();
}

function trafficLight(): THREE.BufferGeometry {
  return new ModelBuilder()
    .cylinder(0.08, 0.1, 5.6, 0x2b2f35, { y: 2.8 }, 8)
    .box(3.2, 0.1, 0.1, 0x2b2f35, { x: -1.6, y: 5.5 })
    .box(0.35, 1.0, 0.35, 0x1b1d20, { x: -3.0, y: 5.0 })
    .sphere(0.11, 0x3ccf6a, { x: -3.0, y: 4.7, z: 0.18 })
    .sphere(0.11, 0x47201d, { x: -3.0, y: 5.25, z: 0.18 })
    .build();
}

function signPost(): THREE.BufferGeometry {
  return new ModelBuilder().cylinder(0.05, 0.05, 3.2, C.steel, { y: 1.6 }, 6).build();
}

// ---- Scenery manager ---------------------------------------------------------------

interface BuildingSlot {
  mesh: THREE.Mesh;
  s: number;
  side: -1 | 1;
}

interface PropSlot {
  mesh: THREE.Mesh;
  sign: THREE.Mesh;
  s: number;
  side: -1 | 1;
}

interface Library {
  zurich: THREE.BufferGeometry[];
  newyork: THREE.BufferGeometry[];
  pines: THREE.BufferGeometry[];
  chalets: THREE.BufferGeometry[];
  grossmunster: THREE.BufferGeometry;
  stPeter: THREE.BufferGeometry;
  linden: THREE.BufferGeometry;
  lamp: THREE.BufferGeometry;
  nyLamp: THREE.BufferGeometry;
  fountain: THREE.BufferGeometry;
  railLamp: THREE.BufferGeometry;
  railBench: THREE.BufferGeometry;
  cow: THREE.BufferGeometry;
  snowPole: THREE.BufferGeometry;
  taxi: THREE.BufferGeometry;
  hydrant: THREE.BufferGeometry;
  trafficLight: THREE.BufferGeometry;
  signPost: THREE.BufferGeometry;
  empty: THREE.BufferGeometry;
}

/**
 * Everything beside the road: facades and landmarks, street furniture, the Zürich
 * tram overhead line and lake promenade, crosswalks, and the distant skylines.
 * Slots are recycled ahead of the runner as the world scrolls.
 */
export class Scenery {
  readonly group = new THREE.Group();
  private readonly lib: Library;
  private readonly buildings: BuildingSlot[] = [];
  private readonly props: PropSlot[] = [];
  private readonly catenaries: { mesh: THREE.Mesh; s: number }[] = [];
  private readonly crosswalks: { mesh: THREE.Mesh; s: number }[] = [];
  private readonly lake = new THREE.Group();
  private readonly backdrops: THREE.Mesh[] = [];
  private readonly signMaterials = new Map<string, THREE.Material>();
  private readonly crosswalkGeo: Record<'yellow' | 'white', THREE.BufferGeometry>;
  readonly sidewalkMaterial = new THREE.MeshLambertMaterial({ color: 0xc9c4ba });

  constructor() {
    this.lib = {
      zurich: Array.from({ length: 6 }, (_, i) => zurichBuilding(i)),
      newyork: Array.from({ length: 6 }, (_, i) => skyscraper(i)),
      pines: Array.from({ length: 4 }, (_, i) => pineCluster(i)),
      chalets: [chalet(0), chalet(1)],
      grossmunster: grossmunster(),
      stPeter: stPeter(),
      linden: linden(),
      lamp: streetLamp(),
      nyLamp: streetLamp(0x1f3b2c),
      fountain: fountainProp(),
      railLamp: lakeRailing(true),
      railBench: lakeRailing(false),
      cow: cow(),
      snowPole: snowPole(),
      taxi: taxi(),
      hydrant: hydrant(),
      trafficLight: trafficLight(),
      signPost: signPost(),
      empty: new THREE.BufferGeometry(),
    };
    this.crosswalkGeo = { yellow: crosswalk(0xf2c230), white: crosswalk(0xf2f2ee) };

    const count = Math.ceil((HORIZON + 45) / SPACING);
    const signGeo = new THREE.PlaneGeometry(1.9, 0.48);
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(this.lib.empty, vertexColorMaterial);
        this.group.add(mesh);
        this.buildings.push({ mesh, s: i * SPACING - 30, side });
        const propMesh = new THREE.Mesh(this.lib.empty, vertexColorMaterial);
        const sign = new THREE.Mesh(signGeo, this.signMaterial('Bahnhofstrasse', false));
        this.group.add(propMesh, sign);
        this.props.push({ mesh: propMesh, sign, s: i * SPACING - 30 + SPACING / 2, side });
      }
    }
    const catGeo = catenary();
    for (let i = 0; i < Math.ceil((HORIZON + 60) / 30); i++) {
      const mesh = new THREE.Mesh(catGeo, vertexColorMaterial);
      this.group.add(mesh);
      this.catenaries.push({ mesh, s: i * 30 - 30 });
    }
    for (let i = 0; i < 2; i++) {
      const mesh = new THREE.Mesh(this.crosswalkGeo.yellow, vertexColorMaterial);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.crosswalks.push({ mesh, s: 60 + i * 120 });
    }

    // Raised sidewalks with curbs, static along the visible road.
    for (const side of [-1, 1]) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.14, 420), this.sidewalkMaterial);
      walk.position.set(side * 5.8, 0.07, -190);
      walk.receiveShadow = true;
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 420), new THREE.MeshLambertMaterial({ color: 0x8f8a82 }));
      curb.position.set(side * 4.05, 0.08, -190);
      this.group.add(walk, curb);
    }

    this.buildLake();
    ZONE_THEMES.forEach((zone, i) => {
      const mat = new THREE.MeshBasicMaterial({ map: skylineTexture(zone.key), transparent: true, depthWrite: false, fog: false, opacity: i === 0 ? 1 : 0 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1500, 375), mat);
      plane.position.set(0, 170, -480);
      plane.renderOrder = -5;
      this.group.add(plane);
      this.backdrops.push(plane);
    });
  }

  private signMaterial(text: string, green: boolean): THREE.Material {
    const key = `${text}|${green}`;
    let mat = this.signMaterials.get(key);
    if (!mat) {
      const map = green
        ? textTexture(text, { width: 512, height: 128, background: '#1f6b3a', color: '#ffffff', fontSize: 62, border: '#ffffff' })
        : streetSignTexture(text);
      mat = new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide });
      this.signMaterials.set(key, mat);
    }
    return mat;
  }

  private buildLake(): void {
    const length = ZONE_LEN - LAKE_START + 30;
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(260, length),
      new THREE.MeshPhongMaterial({ color: 0x3d7fb8, specular: 0x9fb8cc, shininess: 70 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(CURB_X + 130, 0.01, -length / 2 + 15);
    water.receiveShadow = false;
    this.lake.add(water);
    const extras = new ModelBuilder();
    extras.box(0.6, 0.6, length, 0xb9b1a3, { x: CURB_X + 0.3, y: 0.0, z: -length / 2 + 15 });
    // Sailboats and swans.
    const boats: [number, number][] = [[30, -40], [55, -110], [22, -170], [80, -60]];
    for (const [x, z] of boats) {
      extras.box(1.4, 0.5, 4.2, C.white, { x, y: 0.25, z });
      extras.cylinder(0.05, 0.05, 6, 0xd0d0d0, { x, y: 3.2, z });
      extras.triangle([[0, 0], [0, 5.4], [2.4, 0]], 0xfafafa, { x: x + 0.05, y: 0.6, z, ry: -Math.PI / 2 });
      extras.triangle([[0, 0], [0, 5.4], [2.4, 0]], 0xfafafa, { x: x - 0.05, y: 0.6, z, ry: Math.PI / 2 });
    }
    const swans: [number, number][] = [[11, -30], [12.5, -34], [10.5, -120], [13, -150]];
    for (const [x, z] of swans) {
      extras.sphere(0.35, 0xffffff, { x, y: 0.2, z, sz: 1.5, sy: 0.6 });
      extras.cylinder(0.06, 0.07, 0.6, 0xffffff, { x, y: 0.5, z: z - 0.35, rx: -0.2 });
      extras.sphere(0.1, 0xffffff, { x, y: 0.82, z: z - 0.45 });
      extras.cone(0.05, 0.15, 0xf08a24, { x, y: 0.8, z: z - 0.6, rx: -Math.PI / 2 });
    }
    this.lake.add(new THREE.Mesh(extras.build(), vertexColorMaterial));
    this.group.add(this.lake);
  }

  /** Re-dresses a building slot for the zone at its position. */
  private layoutBuilding(slot: BuildingSlot): void {
    const zone = zoneAt(slot.s).key;
    const offset = zoneOffset(slot.s);
    const r = hash(slot.s * 0.37 + slot.side * 17);
    const mesh = slot.mesh;
    mesh.visible = true;
    mesh.rotation.y = slot.side < 0 ? 0 : Math.PI;
    if (zone === 'zurich') {
      if (slot.side > 0 && isLakeAt(slot.s)) {
        mesh.visible = false;
        return;
      }
      let geo = this.lib.zurich[Math.floor(r * this.lib.zurich.length)]!;
      if (slot.side < 0 && offset >= 90 && offset < 90 + SPACING) geo = this.lib.grossmunster;
      else if (slot.side > 0 && offset >= 150 && offset < 150 + SPACING) geo = this.lib.stPeter;
      else if (r < 0.07) mesh.visible = false;
      mesh.geometry = geo;
      mesh.position.x = slot.side * (CURB_X + 5);
    } else if (zone === 'newyork') {
      mesh.geometry = this.lib.newyork[Math.floor(r * this.lib.newyork.length)]!;
      mesh.position.x = slot.side * (CURB_X + 7);
    } else {
      const chaletChance = r < 0.3;
      mesh.geometry = chaletChance ? this.lib.chalets[Math.floor(r * 10) % 2]! : this.lib.pines[Math.floor(r * 40) % 4]!;
      mesh.position.x = slot.side * (CURB_X + (chaletChance ? 6 : 5 + r * 8));
    }
  }

  private layoutProp(slot: PropSlot): void {
    const zone: ZoneKey = zoneAt(slot.s).key;
    const k = Math.round(slot.s / SPACING);
    const r = hash(slot.s * 0.71 + slot.side * 5);
    const mesh = slot.mesh;
    slot.sign.visible = false;
    mesh.visible = true;
    mesh.rotation.y = slot.side < 0 ? 0 : Math.PI;
    mesh.position.x = slot.side * PROP_X;
    if (zone === 'zurich') {
      if (slot.side > 0 && isLakeAt(slot.s)) {
        mesh.geometry = k % 2 ? this.lib.railLamp : this.lib.railBench;
        mesh.position.x = slot.side * (CURB_X - 1.9);
      } else if (r < 0.14) {
        mesh.geometry = this.lib.signPost;
        this.showSign(slot, isLakeAt(slot.s) ? 'Seepromenade' : r < 0.07 ? 'Paradeplatz' : 'Bahnhofstrasse', false);
      } else if (r < 0.24) {
        mesh.geometry = this.lib.fountain;
        mesh.position.x = slot.side * 6.4;
      } else {
        mesh.geometry = k % 2 ? this.lib.linden : this.lib.lamp;
      }
    } else if (zone === 'alps') {
      if (r < 0.25) {
        mesh.geometry = this.lib.cow;
        mesh.position.x = slot.side * (CURB_X + 3 + r * 10);
        mesh.rotation.y = r * 6;
      } else if (r < 0.32) {
        mesh.geometry = this.lib.signPost;
        this.showSign(slot, 'Furka Pass', false);
      } else {
        mesh.geometry = this.lib.snowPole;
        mesh.position.x = slot.side * 4.4;
      }
    } else {
      if (r < 0.1) {
        mesh.geometry = this.lib.signPost;
        this.showSign(slot, 'Broadway', true);
      } else if (k % 6 === 0) {
        mesh.geometry = this.lib.trafficLight;
      } else if (k % 3 === 1) {
        mesh.geometry = this.lib.taxi;
        mesh.position.x = slot.side * 5.2;
        mesh.rotation.y = 0;
      } else {
        mesh.geometry = k % 3 === 2 ? this.lib.hydrant : this.lib.nyLamp;
      }
    }
  }

  private showSign(slot: PropSlot, text: string, green: boolean): void {
    slot.sign.visible = true;
    slot.sign.material = this.signMaterial(text, green);
    slot.sign.position.x = slot.mesh.position.x;
    slot.sign.position.y = 2.9;
    slot.sign.rotation.y = slot.side < 0 ? Math.PI / 2 - 0.5 : -Math.PI / 2 + 0.5;
  }

  reset(distance = 0): void {
    const n = this.buildings.length / 2;
    const origin = Math.floor(distance / 30) * 30;
    this.buildings.forEach((b, i) => {
      b.s = origin + (i % n) * SPACING - 30;
      this.layoutBuilding(b);
    });
    this.props.forEach((p, i) => {
      p.s = origin + (i % n) * SPACING - 30 + SPACING / 2;
      this.layoutProp(p);
    });
    this.catenaries.forEach((c, i) => (c.s = origin + i * 30 - 30));
    this.crosswalks.forEach((c, i) => (c.s = origin + 60 + i * 120));
  }

  update(distance: number, dt: number, haze: number): void {
    const z = (s: number): number => distance - s;
    const span = (this.buildings.length / 2) * SPACING;
    for (const b of this.buildings) {
      if (b.s < distance - 30) {
        b.s += span;
        this.layoutBuilding(b);
      }
      b.mesh.position.z = z(b.s);
    }
    for (const p of this.props) {
      if (p.s < distance - 30) {
        p.s += span;
        this.layoutProp(p);
      }
      p.mesh.position.z = z(p.s);
      p.sign.position.z = z(p.s) + 0.3;
    }
    const catSpan = this.catenaries.length * 30;
    for (const c of this.catenaries) {
      if (c.s < distance - 40) c.s += catSpan;
      c.mesh.visible = zoneAt(c.s).key === 'zurich' && zoneAt(c.s - 30).key === 'zurich';
      c.mesh.position.z = z(c.s);
    }
    for (const c of this.crosswalks) {
      if (c.s < distance - 20) c.s += 240;
      const key = zoneAt(c.s).key;
      c.mesh.visible = key !== 'alps';
      c.mesh.geometry = key === 'zurich' ? this.crosswalkGeo.yellow : this.crosswalkGeo.white;
      c.mesh.position.z = z(c.s);
    }

    // Lake: the next Zürich lakeside stretch that is not yet behind the runner.
    const lap = ZONE_LEN * ZONE_THEMES.length;
    let lakeStart = Math.floor(distance / lap) * lap + LAKE_START;
    if (lakeStart + (ZONE_LEN - LAKE_START) < distance - 20) lakeStart += lap;
    this.lake.position.z = z(lakeStart);

    const current = zoneIndexAt(distance);
    this.backdrops.forEach((plane, i) => {
      const mat = plane.material as THREE.MeshBasicMaterial;
      const target = (i === current ? 1 : 0) * (1 - haze * 0.55);
      mat.opacity += (target - mat.opacity) * (1 - Math.exp(-2.5 * dt));
      plane.visible = mat.opacity > 0.01;
    });
  }
}
