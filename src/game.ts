import * as THREE from 'three';
import { BRAND } from './config/brand';
import { GRIP_DYNAMICS, GRIP_RANK, LANES, laneToX, type GripLevel } from './config/gameplay';
import { SHOES, bestShoeFor, type ShoeId } from './config/shoes';
import { HAZARD_MIN_GRIP, type HazardKind, type WeatherId } from './config/weather';
import { clamp, damp, lerp } from './core/math';
import { createRng, randomSeed, type Rng } from './core/random';
import { beatError, judgeLanding, type Judgement } from './sim/rhythm';
import { GameAudio } from './audio';
import { Hud } from './hud';

// ---------------------------------------------------------------------------
// Tuning. The beat is locked to distance (one stride = BEAT_LEN metres), so the
// tempo follows running speed and obstacles placed on whole beats always arrive
// on the beat: jump on a beat and you land on a beat.
// ---------------------------------------------------------------------------
const STEP = 1 / 120;
const BEAT_LEN = 5;
const SPEED_START = 11;
const SPEED_MAX = 17;
const SPEED_RAMP = 3000;
const ATTRACT_SPEED = 7;
const JUMP_BEATS = 2;
const JUMP_H = 1.6;
const SLIDE_BEATS = 1.6;
const SLAM_SPEED = 22;
const GLIDE_BEATS = 6;
const GLIDE_H = 4.2;
const HORIZON = 140;
/** Metres per zone; the map changes this often. */
const ZONE_LEN = 450;
const BODY_H = 1.7;
const SLIDE_H = 0.75;
const HALF_W = 0.35;
const HALF_D = 0.25;
const MAX_INPUT_LATE_SEC = 0.15;
/** Glide meter gained per landing (1 = full): three perfect landings fill it. */
const GLIDE_PER_PERFECT = 0.34;
const GLIDE_PER_GOOD = 0.15;

type Mode = 'run' | 'jump' | 'slam' | 'slide' | 'glide' | 'dead';
type ObstacleType = 'low' | 'high' | 'block';
type State = 'menu' | 'run' | 'paused' | 'over';

interface ZoneStyle {
  name: string;
  sky: number;
  fog: number;
  ground: number;
  road: number;
  city: boolean;
  buildingColors: number[];
  height: [number, number];
  weathers: WeatherId[];
  block: number;
}

const ZONES: ZoneStyle[] = [
  {
    name: 'Zürich', sky: 0x8fc8f5, fog: 0xd5e9f5, ground: 0xb4b8b2, road: 0x5d6266, city: true,
    buildingColors: [0xefe3c8, 0xb9c9a3, 0xe8b4a0, 0xa9c6d8, 0xf2efe9], height: [10, 18],
    weathers: ['dry', 'rain'], block: 0x2f6fd6,
  },
  {
    name: 'Swiss Alps', sky: 0x5fa6e8, fog: 0xe6f0f8, ground: 0xf4f7fa, road: 0xb9c4cf, city: false,
    buildingColors: [], height: [0, 0], weathers: ['snow', 'dry'], block: 0xf2c200,
  },
  {
    name: 'New York', sky: 0xf0a070, fog: 0xe9b991, ground: 0x6b6f75, road: 0x3a3d42, city: true,
    buildingColors: [0x4a4f5a, 0x7a4e3b, 0x9a9a96, 0x5e6470, 0x3d4250], height: [24, 60],
    weathers: ['dry', 'rain', 'snow'], block: 0xf6c518,
  },
];

/** Obstacle patterns on the beat grid (rows near → far, one char per lane). */
const PATTERNS: { rows: string[]; tier: number }[] = [
  { rows: ['-..'], tier: 0 },
  { rows: ['=..'], tier: 0 },
  { rows: ['#..', '#..'], tier: 0 },
  { rows: ['---'], tier: 0 },
  { rows: ['==='], tier: 1 },
  { rows: ['#.#', '#.#'], tier: 1 },
  { rows: ['##.', '##.'], tier: 1 },
  { rows: ['-.='], tier: 1 },
  { rows: ['-..', '...', '-..'], tier: 1 },
  { rows: ['---', '...', '==='], tier: 2 },
  { rows: ['#.#', '#-#', '#.#'], tier: 2 },
  { rows: ['.#.', '.#.', '-#='], tier: 2 },
  { rows: ['---', '...', '---', '...', '---'], tier: 3 },
  { rows: ['#.#', '#=#', '#.#', '#-#', '#.#'], tier: 3 },
];

interface Obstacle {
  type: ObstacleType;
  lane: number;
  s0: number;
  s1: number;
  y0: number;
  y1: number;
  hit: boolean;
  mesh: THREE.Object3D;
}
interface CloudPickup { lane: number; s: number; y: number; mesh: THREE.Object3D }
interface Hazard { kind: HazardKind; lane: number; s0: number; s1: number; done: boolean; mesh: THREE.Mesh }

const WEATHER_TINT: Record<WeatherId, { color: number; amount: number; fogNear: number; fogFar: number }> = {
  dry: { color: 0xffffff, amount: 0, fogNear: 40, fogFar: 160 },
  rain: { color: 0x6f7a86, amount: 0.6, fogNear: 20, fogFar: 110 },
  snow: { color: 0xe3e9f0, amount: 0.55, fogNear: 14, fogFar: 95 },
};

function zoneIndexAt(s: number): number {
  return ((Math.floor(Math.max(0, s) / ZONE_LEN) % ZONES.length) + ZONES.length) % ZONES.length;
}

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

/** Builds a canvas texture of a facade window grid (tinted by the material colour). */
function windowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#3b4552';
  g.fillRect(14, 14, 36, 34);
  g.fillStyle = '#6d7c8f';
  g.fillRect(14, 14, 36, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface TextTextureOptions {
  width: number;
  height: number;
  /** CSS colour, or null for a transparent background. */
  background: string | null;
  color: string;
  fontSize: number;
}

/** Renders a short bold label into a texture (banners, bus livery, shirt logo). */
function textTexture(text: string, o: TextTextureOptions): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = o.width;
  c.height = o.height;
  const g = c.getContext('2d')!;
  if (o.background) {
    g.fillStyle = o.background;
    g.fillRect(0, 0, o.width, o.height);
  }
  g.fillStyle = o.color;
  g.font = `900 ${o.fontSize}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, o.width / 2, o.height / 2 + o.fontSize * 0.04, o.width * 0.92);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function laneLinesTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  // Lane dividers at 1/3 and 2/3 of the road width, dashed.
  for (const x of [256 / 3, (256 * 2) / 3]) g.fillRect(x - 3, 0, 6, 128);
  // Road edges, solid.
  g.fillRect(0, 0, 5, 256);
  g.fillRect(251, 0, 5, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Stylised runner rig built from primitives; animated procedurally from the beat. */
class Runner {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly hips: THREE.Group[] = [];
  private readonly knees: THREE.Group[] = [];
  private readonly shoulders: THREE.Group[] = [];
  private readonly pods: THREE.Group[] = [];
  private readonly shoeUpper = lambert(0xffffff);
  private readonly shoeAccent = lambert(0xffffff);
  private readonly shoeSole = lambert(0xffffff);
  private readonly podMat = lambert(0xffffff);
  private readonly cloud = new THREE.Group();
  private squash = 0;

  constructor() {
    const skin = lambert(0xc98e6b);
    const shirt = lambert(0xf4f6f2);
    const shorts = lambert(0x1c1f24);
    const hair = lambert(0x2b2420);
    const limb = (r: number, len: number, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat);
      m.position.y = -len / 2 - r * 0.5;
      return m;
    };

    this.root.add(this.body);
    this.body.position.y = 0.95;
    this.body.add(this.torso);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.36, 4, 10), shirt);
    chest.position.y = 0.3;
    chest.scale.z = 0.75;
    this.torso.add(chest);
    if (BRAND.mark) {
      // Wordmark on the back of the shirt, facing the camera.
      const logo = new THREE.Mesh(
        new THREE.PlaneGeometry(0.2, 0.1),
        new THREE.MeshBasicMaterial({
          map: textTexture(BRAND.mark, { width: 128, height: 64, background: null, color: '#16181c', fontSize: 52 }),
          transparent: true,
        }),
      );
      logo.position.set(0, 0.42, 0.158);
      this.torso.add(logo);
    }
    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.08, 4, 10), shorts);
    pelvis.position.y = 0.02;
    this.torso.add(pelvis);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin);
    head.position.y = 0.72;
    this.torso.add(head);
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.8), hair);
    hairCap.position.set(0, 0.74, 0.01);
    this.torso.add(hairCap);

    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.25, 0.52, 0);
      shoulder.add(limb(0.055, 0.22, shirt));
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      elbow.rotation.x = 1.3;
      elbow.add(limb(0.05, 0.2, skin));
      shoulder.add(elbow);
      this.torso.add(shoulder);
      this.shoulders.push(shoulder);

      const hip = new THREE.Group();
      hip.position.set(side * 0.11, 0, 0);
      hip.add(limb(0.085, 0.3, side < 0 ? shorts : shorts));
      const knee = new THREE.Group();
      knee.position.y = -0.46;
      knee.add(limb(0.065, 0.3, skin));
      const foot = new THREE.Group();
      foot.position.y = -0.44;
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.28), this.shoeUpper);
      upper.position.set(0, 0, -0.05);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.03, 0.18), this.shoeAccent);
      stripe.position.set(0, 0.01, -0.03);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.3), this.shoeSole);
      sole.position.set(0, -0.065, -0.05);
      const podGroup = new THREE.Group();
      podGroup.position.set(0, -0.095, -0.05);
      for (let i = 0; i < 4; i++) {
        const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.13, 8), this.podMat);
        pod.rotation.z = Math.PI / 2;
        pod.position.z = -0.11 + i * 0.075;
        podGroup.add(pod);
      }
      foot.add(upper, stripe, sole, podGroup);
      knee.add(foot);
      hip.add(knee);
      this.body.add(hip);
      this.hips.push(hip);
      this.knees.push(knee);
      this.pods.push(podGroup);
    }

    // The glide cloud the runner rides on.
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9fb4c8 });
    for (const [x, y, z, r] of [[0, 0, 0, 0.5], [0.45, -0.05, 0.1, 0.38], [-0.45, -0.05, 0.05, 0.4], [0, 0.05, 0.4, 0.35], [0.1, -0.02, -0.4, 0.36]] as const) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), cloudMat);
      puff.position.set(x, y, z);
      this.cloud.add(puff);
    }
    this.cloud.scale.setScalar(0);
    this.root.add(this.cloud);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    shadow.name = 'shadow';
    this.root.add(shadow);
  }

  setShoe(id: ShoeId): void {
    const c = SHOES[id].colors;
    this.shoeUpper.color.setHex(c.upper);
    this.shoeAccent.color.setHex(c.accent);
    this.shoeSole.color.setHex(c.sole);
    this.podMat.color.setHex(c.pods);
  }

  land(): void {
    this.squash = 1;
  }

  update(dt: number, beat: number, mode: Mode, y: number, stumble: number, deadTime: number): void {
    const phase = beat * Math.PI;
    const airborne = mode === 'jump' || mode === 'slam';
    this.squash = Math.max(0, this.squash - dt * 5);

    let bodyY = 0.95 - 0.06 * Math.abs(Math.cos(phase)) - this.squash * 0.12;
    let lean = -0.18;
    for (let i = 0; i < 2; i++) {
      const p = phase + i * Math.PI;
      let thigh = 0.62 * Math.cos(p);
      let knee = -(0.25 + 1.2 * Math.max(0, -Math.sin(p)));
      let arm = -0.7 * Math.cos(p);
      if (airborne) {
        thigh = i === 0 ? 1.0 : -0.5;
        knee = i === 0 ? -1.2 : -0.7;
        arm = i === 0 ? -0.9 : 1.4;
      } else if (mode === 'slide') {
        thigh = 1.4;
        knee = -0.25;
        arm = -0.8;
      } else if (mode === 'glide') {
        thigh = 0.2;
        knee = -0.5;
        arm = 0;
      }
      this.hips[i]!.rotation.x = thigh;
      this.knees[i]!.rotation.x = knee;
      this.shoulders[i]!.rotation.x = arm;
      this.shoulders[i]!.rotation.z = mode === 'glide' ? (i === 0 ? -1.2 : 1.2) : 0;
      // CloudTec pods compress at this foot's strike and spring back.
      const sinceStrike = ((beat - i) % 2 + 2) % 2;
      const contact = mode === 'run' ? Math.exp(-sinceStrike * 7) : this.squash;
      this.pods[i]!.scale.set(1 + contact * 0.25, 1 - contact * 0.55, 1);
    }
    if (mode === 'slide') {
      bodyY = 0.45;
      lean = 1.0;
    }
    if (mode === 'glide') lean = -0.3;
    this.body.position.y = bodyY;
    this.torso.rotation.x = lean;
    this.torso.rotation.y = mode === 'run' ? 0.12 * Math.cos(phase) : 0;
    this.torso.rotation.z = stumble > 0 ? Math.sin(stumble * 30) * 0.3 * stumble : 0;

    const cloudTarget = mode === 'glide' ? 1 : 0;
    this.cloud.scale.setScalar(damp(this.cloud.scale.x, cloudTarget, 10, dt));
    this.cloud.position.y = 0.05;
    this.cloud.rotation.y += dt;

    if (mode === 'dead') {
      this.root.rotation.x = -Math.min(1.45, deadTime * 5);
    } else {
      this.root.rotation.x = 0;
    }
    const shadow = this.root.getObjectByName('shadow');
    if (shadow) {
      shadow.position.y = 0.02 - y;
      shadow.scale.setScalar(Math.max(0.3, 1 - y * 0.18));
    }
  }
}

/** The whole prototype game: simulation, Three.js view and wiring to HUD/audio. */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.1, 900);
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.2);
  private readonly sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
  private readonly fog = new THREE.Fog(0xd5e9f5, 40, 160);
  private readonly roadMat = lambert(0x5d6266);
  private readonly groundMat = lambert(0xb4b8b2);
  private readonly linesTex = laneLinesTexture();
  private readonly windowTex = windowTexture();
  private readonly runner = new Runner();
  private readonly scenery: { group: THREE.Group; building: THREE.Mesh; roof: THREE.Mesh; tree: THREE.Group; s: number; side: number }[] = [];
  private readonly mountains = new THREE.Group();
  private readonly rain: THREE.LineSegments;
  private readonly snow: THREE.Points;
  private readonly audio = new GameAudio();
  private readonly hud: Hud;
  private readonly shared = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cloud: (() => {
      const geo = new THREE.SphereGeometry(0.32, 10, 8);
      return geo;
    })(),
    cloudMat: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8fa6bf }),
    white: lambert(0xf4f4f0),
    red: lambert(0xd8262e),
    pole: lambert(0x50555c),
    banner: lambert(0x16181c),
    glass: lambert(0x253040),
    busBlue: lambert(0x1560bd),
    plane: new THREE.PlaneGeometry(1, 1),
    bannerSign: new THREE.MeshLambertMaterial({
      map: textTexture(BRAND.mark || 'RUN', { width: 512, height: 210, background: '#16181c', color: '#f4f6f2', fontSize: 150 }),
    }),
    busLabel: new THREE.MeshLambertMaterial({
      map: textTexture(BRAND.busOperator, { width: 384, height: 132, background: null, color: '#ffffff', fontSize: 104 }),
      transparent: true,
    }),
    busDestination: new THREE.MeshBasicMaterial({
      map: textTexture(BRAND.busOperator, { width: 256, height: 56, background: '#111111', color: '#ffb000', fontSize: 44 }),
    }),
    puddle: new THREE.MeshPhongMaterial({ color: 0x5d7690, shininess: 90, specular: 0xaaaaaa, transparent: true, opacity: 0.85 }),
    ice: new THREE.MeshPhongMaterial({ color: 0xcdeeff, shininess: 120, specular: 0xffffff, transparent: true, opacity: 0.9 }),
  };

  private state: State = 'menu';
  private rng: Rng = createRng(1);
  private obstacles: Obstacle[] = [];
  private clouds: CloudPickup[] = [];
  private hazards: Hazard[] = [];
  private input: { type: 'left' | 'right' | 'jump' | 'slide' | ShoeId; time: number }[] = [];

  // Simulation state
  private distance = 0;
  private speed = ATTRACT_SPEED;
  private boost = 0;
  private penalty = 0;
  private lane = 1;
  private prevLane = 1;
  private x = 0;
  private vx = 0;
  private y = 0;
  private mode: Mode = 'run';
  private takeoffBeat = 0;
  private slideEnd = 0;
  private glideStart = 0;
  private glideEnd = 0;
  private glideFromY = 0;
  private bufferedJump = false;
  private slideAfterSlam = false;
  private stumbleTimer = 0;
  private strikes: number[] = [];
  private deadTime = 0;
  private time = 0;
  private shoe: ShoeId = 'road';
  private glideCharge = 0;
  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private perfects = 0;
  private cloudCount = 0;
  private cloudStreak = 0;
  private lastCloudTime = 0;
  private nextRow = 0;
  private restRows = 0;
  private weather: WeatherId = 'dry';
  private nextWeatherAt = 0;
  private nextWeather: WeatherId = 'rain';
  private forecastShown = false;
  private zoneIndex = 0;
  private lastBeatIndex = 0;
  private hintsShown = new Set<string>();
  private best = 0;
  private acc = 0;
  private lastFrame = 0;
  private touch: { id: number; x: number; y: number; used: boolean } | null = null;
  private skyColor = new THREE.Color();
  private fogColor = new THREE.Color();
  private tint = { rain: 0, snow: 0 };

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.fog = this.fog;
    this.scene.add(this.hemi, this.sun);
    this.sun.position.set(-6, 12, 4);

    this.hud = new Hud(uiRoot, {
      onPlay: () => this.startRun(),
      onShoe: (shoe) => this.queue(shoe, performance.now()),
      onPause: () => this.togglePause(),
    });

    this.buildWorld();
    this.rain = this.buildRain();
    this.snow = this.buildSnow();
    this.scene.add(this.runner.root, this.rain, this.snow);
    this.runner.setShoe(this.shoe);

    try {
      this.best = Number(localStorage.getItem('cloudtec.best') ?? 0) || 0;
    } catch {
      this.best = 0;
    }
    this.resetRun(false);
    this.hud.showMenu(this.best);
    this.bindInput(canvas);
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'run') this.togglePause();
        this.audio.suspend();
      }
    });
    this.resize();
  }

  start(): void {
    this.lastFrame = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      if (this.state !== 'paused') {
        this.acc += dt;
        while (this.acc >= STEP) {
          this.step(STEP);
          this.acc -= STEP;
        }
      }
      this.render(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ---- world construction ------------------------------------------------

  private buildWorld(): void {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(LANES.width * 3 + 0.8, 400), this.roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -180);
    const lines = new THREE.Mesh(
      new THREE.PlaneGeometry(LANES.width * 3 + 0.8, 400),
      new THREE.MeshBasicMaterial({ map: this.linesTex, transparent: true, depthWrite: false }),
    );
    this.linesTex.repeat.set(1, 400 / 10);
    lines.rotation.x = -Math.PI / 2;
    lines.position.set(0, 0.01, -180);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, -180);
    this.scene.add(road, lines, ground);

    // Recycled scenery slots along both sides of the road.
    const spacing = 15;
    const count = Math.ceil((HORIZON + 40) / spacing);
    for (const side of [-1, 1]) {
      for (let i = 0; i < count; i++) {
        const group = new THREE.Group();
        const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: this.windowTex.clone() });
        const building = new THREE.Mesh(this.shared.box, mat);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4), lambert(0x5b4a42));
        roof.rotation.y = Math.PI / 4;
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 1.4, 6), lambert(0x6b4a2f));
        trunk.position.y = 0.7;
        tree.add(trunk);
        for (let k = 0; k < 3; k++) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2 - k * 0.55, 2.6, 8), lambert(k === 2 ? 0xf2f6fa : 0x2e5e45));
          cone.position.y = 2 + k * 1.5;
          tree.add(cone);
        }
        group.add(building, roof, tree);
        this.scene.add(group);
        const slot = { group, building, roof, tree, s: i * spacing - 20, side };
        this.layoutScenery(slot);
        this.scenery.push(slot);
      }
    }

    // Distant Alpine peaks, shown in the Alps zone.
    const rock = lambert(0x7d8fa6);
    const snowCap = lambert(0xffffff);
    for (let i = 0; i < 9; i++) {
      const h = 90 + ((i * 37) % 70);
      const peak = new THREE.Mesh(new THREE.ConeGeometry(70 + (i % 3) * 20, h, 5), rock);
      peak.position.set(-320 + i * 80, h / 2 - 5, -420 - (i % 2) * 60);
      const cap = new THREE.Mesh(new THREE.ConeGeometry((70 + (i % 3) * 20) * 0.35, h * 0.35, 5), snowCap);
      cap.position.set(peak.position.x, h - 5 - h * 0.175 + 0.5, peak.position.z);
      this.mountains.add(peak, cap);
    }
    this.scene.add(this.mountains);
  }

  private layoutScenery(slot: (typeof this.scenery)[number]): void {
    const zone = ZONES[zoneIndexAt(slot.s)]!;
    const r = Math.abs(Math.sin(slot.s * 12.9898 + slot.side * 78.233)) % 1;
    slot.building.visible = zone.city;
    slot.roof.visible = zone.city && zone.height[1] < 30;
    slot.tree.visible = !zone.city || r > 0.85;
    if (zone.city) {
      const w = 9 + r * 5;
      const h = lerp(zone.height[0], zone.height[1], (r * 7.31) % 1);
      const d = 10;
      const x = slot.side * (LANES.width * 1.5 + 4.5 + d / 2);
      slot.building.scale.set(d, h, w);
      slot.building.position.set(x, h / 2, 0);
      const mat = slot.building.material as THREE.MeshLambertMaterial;
      mat.color.setHex(zone.buildingColors[Math.floor(r * zone.buildingColors.length)]!);
      mat.map!.repeat.set(Math.round(d / 3), Math.round(h / 3.2));
      slot.roof.scale.set(d * 0.72, 4, w * 0.72);
      slot.roof.position.set(x, h + 2, 0);
      slot.tree.position.set(slot.side * (LANES.width * 1.5 + 2.6), 0, 0);
      slot.tree.scale.setScalar(0.6);
    } else {
      slot.tree.position.set(slot.side * (LANES.width * 1.5 + 4 + r * 10), 0, 0);
      slot.tree.scale.setScalar(0.8 + r * 0.9);
    }
  }

  private buildRain(): THREE.LineSegments {
    const count = 700;
    const pos = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 30;
      const y = Math.random() * 18;
      const z = -Math.random() * 60 + 8;
      pos.set([x, y, z, x, y + 0.7, z + 0.25], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc8d6e6, transparent: true, opacity: 0 }));
    lines.frustumCulled = false;
    return lines;
  }

  private buildSnow(): THREE.Points {
    const count = 600;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) pos.set([(Math.random() - 0.5) * 30, Math.random() * 18, -Math.random() * 60 + 8], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0 }));
    pts.frustumCulled = false;
    return pts;
  }

  // ---- run lifecycle -----------------------------------------------------

  private resetRun(playing: boolean): void {
    for (const o of this.obstacles) this.scene.remove(o.mesh);
    for (const c of this.clouds) this.scene.remove(c.mesh);
    for (const h of this.hazards) this.scene.remove(h.mesh);
    this.obstacles = [];
    this.clouds = [];
    this.hazards = [];
    this.input = [];
    this.rng = createRng(randomSeed());
    this.distance = 0;
    this.speed = playing ? SPEED_START : ATTRACT_SPEED;
    this.boost = 0;
    this.penalty = 0;
    this.lane = this.prevLane = 1;
    this.x = laneToX(1);
    this.vx = 0;
    this.y = 0;
    this.mode = 'run';
    this.bufferedJump = false;
    this.slideAfterSlam = false;
    this.stumbleTimer = 0;
    this.strikes = [];
    this.deadTime = 0;
    this.time = 0;
    this.glideCharge = 0;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.perfects = 0;
    this.cloudCount = 0;
    this.nextRow = 8; // two bars of warm-up
    this.restRows = 0;
    this.weather = 'dry';
    this.scheduleWeather(true);
    this.zoneIndex = 0;
    this.lastBeatIndex = 0;
    this.setShoe('road', false);
    this.audio.resetMusic();
    for (const slot of this.scenery) {
      slot.s = slot.s % 15;
    }
    this.scenery.forEach((slot, i) => {
      slot.s = (i % (this.scenery.length / 2)) * 15 - 20;
      this.layoutScenery(slot);
    });
  }

  private startRun(): void {
    this.audio.unlock();
    this.resetRun(true);
    this.state = 'run';
    this.hud.showRun();
    this.hud.showHint('Swipe ↑ to jump — land on the beat!', 3);
  }

  private endRun(): void {
    this.state = 'over';
    const newBest = this.score > this.best;
    if (newBest) {
      this.best = Math.floor(this.score);
      try {
        localStorage.setItem('cloudtec.best', String(this.best));
      } catch {
        /* storage unavailable (private mode) */
      }
    }
    window.setTimeout(() => {
      this.hud.showGameOver({
        score: Math.floor(this.score),
        distance: this.distance,
        clouds: this.cloudCount,
        perfects: this.perfects,
        maxCombo: this.maxCombo,
        zone: ZONES[this.zoneIndex]!.name,
        best: this.best,
        newBest,
      });
    }, 900);
  }

  private togglePause(): void {
    if (this.state === 'run') {
      this.state = 'paused';
      this.hud.setPaused(true);
    } else if (this.state === 'paused') {
      this.state = 'run';
      this.hud.setPaused(false);
      this.audio.unlock();
    }
  }

  private scheduleWeather(first: boolean): void {
    const zone = ZONES[zoneIndexAt(this.distance + 300)]!;
    const options = zone.weathers.filter((w) => w !== this.weather);
    this.nextWeather = options.length > 0 ? this.rng.pick(options) : this.weather;
    this.nextWeatherAt = this.distance + (first ? 180 : this.rng.range(150, 240));
    this.forecastShown = false;
  }

  // ---- input -------------------------------------------------------------

  private queue(type: (typeof this.input)[number]['type'], time: number): void {
    if (this.state === 'run') this.input.push({ type, time });
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    const keys: Record<string, (typeof this.input)[number]['type']> = {
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', ArrowDown: 'slide', KeyS: 'slide',
      Digit1: 'road', Digit2: 'wet', Digit3: 'trail',
    };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' || e.code === 'Escape') {
        this.togglePause();
        return;
      }
      if (e.code === 'Enter' && (this.state === 'menu' || this.state === 'over')) {
        this.startRun();
        return;
      }
      const action = keys[e.code];
      if (action && !e.repeat) {
        e.preventDefault();
        this.queue(action, e.timeStamp);
      }
    });

    const threshold = (): number => Math.max(22, Math.min(window.innerWidth, window.innerHeight) * 0.05);
    canvas.addEventListener('pointerdown', (e) => {
      this.audio.unlock();
      this.touch = { id: e.pointerId, x: e.clientX, y: e.clientY, used: false };
    });
    canvas.addEventListener('pointermove', (e) => {
      const t = this.touch;
      if (!t || t.id !== e.pointerId || t.used) return;
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      if (Math.hypot(dx, dy) < threshold()) return;
      t.used = true;
      if (Math.abs(dx) > Math.abs(dy)) this.queue(dx < 0 ? 'left' : 'right', e.timeStamp);
      else this.queue(dy < 0 ? 'jump' : 'slide', e.timeStamp);
    });
    const end = (e: PointerEvent): void => {
      if (this.touch?.id === e.pointerId) this.touch = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---- simulation ----------------------------------------------------------

  private get isDead(): boolean {
    return this.mode === 'dead';
  }

  private get beat(): number {
    return this.distance / BEAT_LEN;
  }

  private get bps(): number {
    return this.speed / BEAT_LEN;
  }

  private get grip(): GripLevel {
    return SHOES[this.shoe].grip[this.weather];
  }

  private setShoe(shoe: ShoeId, announce = true): void {
    if (shoe === this.shoe && announce) return;
    this.shoe = shoe;
    this.runner.setShoe(shoe);
    if (announce) {
      this.audio.shoe();
      this.hud.flash(SHOES[shoe].shortName, 'good', SHOES[shoe].tagline, 0.9);
    }
  }

  private step(dt: number): void {
    this.time += dt;
    if (this.state === 'menu') {
      this.distance += ATTRACT_SPEED * dt;
      this.speed = ATTRACT_SPEED;
      this.updateWeather();
      return;
    }
    if (this.mode === 'dead') {
      this.deadTime += dt;
      this.y = Math.max(0, this.y - 8 * dt);
      return;
    }

    this.processInput();
    const base = SPEED_START + (SPEED_MAX - SPEED_START) * (1 - Math.exp(-this.distance / SPEED_RAMP));
    this.boost *= Math.exp(-dt / 1.2);
    this.penalty = Math.max(0, this.penalty - dt / 1.8 * 0.25);
    this.speed = base * (1 + this.boost) * (1 - this.penalty);
    const prevDistance = this.distance;
    const prevY = this.y;
    const prevX = this.x;
    this.distance += this.speed * dt;
    this.score += (this.distance - prevDistance) * this.multiplier;

    // Lateral spring: grip sets stiffness/damping, so wrong shoes feel slippery.
    const { omega, zeta } = GRIP_DYNAMICS[this.grip];
    this.vx += (omega * omega * (laneToX(this.lane) - this.x) - 2 * zeta * omega * this.vx) * dt;
    this.x += this.vx * dt;
    this.stumbleTimer = Math.max(0, this.stumbleTimer - dt);

    this.updateVertical(dt);
    this.generate();
    this.collide(prevDistance, prevX, prevY);
    this.updateWeather();
    this.updateZone();

    const beatIndex = Math.floor(this.beat);
    if (beatIndex !== this.lastBeatIndex) this.lastBeatIndex = beatIndex;
    this.cleanup();
  }

  private get multiplier(): number {
    return Math.min(10, 1 + Math.floor(this.combo / 4));
  }

  private processInput(): void {
    const now = performance.now();
    for (const { type, time } of this.input) {
      const late = clamp((now - time) / 1000, 0, MAX_INPUT_LATE_SEC);
      if (type === 'left' || type === 'right') {
        const target = clamp(this.lane + (type === 'left' ? -1 : 1), 0, LANES.count - 1);
        if (target !== this.lane) {
          this.prevLane = this.lane;
          this.lane = target;
        }
      } else if (type === 'jump') {
        this.tryJump(this.beat - late * this.bps);
      } else if (type === 'slide') {
        if (this.mode === 'run' || this.mode === 'slide') {
          this.mode = 'slide';
          this.slideEnd = this.beat + SLIDE_BEATS;
        } else if (this.mode === 'jump') {
          this.mode = 'slam';
          this.slideAfterSlam = true;
          this.bufferedJump = false;
        }
      } else {
        this.setShoe(type);
      }
    }
    this.input.length = 0;
  }

  private tryJump(takeoff: number): void {
    if (this.mode === 'run' || this.mode === 'slide') {
      this.mode = 'jump';
      this.takeoffBeat = takeoff;
      this.audio.jump();
      return;
    }
    if ((this.mode === 'jump' || this.mode === 'slam') && this.glideCharge >= 1) {
      this.mode = 'glide';
      this.glideCharge = 0;
      this.glideStart = this.beat;
      this.glideEnd = Math.ceil(this.beat + GLIDE_BEATS); // always lands on a beat
      this.glideFromY = this.y;
      this.audio.glide();
      this.hud.flash('CLOUD GLIDE', 'perfect');
      this.spawnSkyTrail();
      return;
    }
    if (this.mode === 'jump' && this.takeoffBeat + JUMP_BEATS - this.beat < 0.4) this.bufferedJump = true;
  }

  private updateVertical(dt: number): void {
    const beat = this.beat;
    if (this.mode === 'jump') {
      const p = (beat - this.takeoffBeat) / JUMP_BEATS;
      if (p >= 1) this.land(this.takeoffBeat + JUMP_BEATS, false);
      else this.y = 4 * JUMP_H * p * (1 - p);
    } else if (this.mode === 'slam') {
      this.y -= SLAM_SPEED * dt;
      if (this.y <= 0) this.land(beat + (this.y / SLAM_SPEED) * this.bps, false);
    } else if (this.mode === 'glide') {
      const t = beat - this.glideStart;
      const total = this.glideEnd - this.glideStart;
      if (t >= total) this.land(this.glideEnd, true);
      else if (t < 0.75) this.y = lerp(this.glideFromY, GLIDE_H, 1 - Math.pow(1 - t / 0.75, 3));
      else if (total - t < 1.5) this.y = GLIDE_H * (0.5 - 0.5 * Math.cos((Math.PI * (total - t)) / 1.5));
      else this.y = GLIDE_H;
    } else if (this.mode === 'slide' && beat >= this.slideEnd) {
      this.mode = 'run';
    }
  }

  private land(beat: number, fromGlide: boolean): void {
    this.y = 0;
    const judgement: Judgement = fromGlide ? 'perfect' : judgeLanding(beatError(beat), this.bps);
    if (judgement === 'miss') {
      this.combo = 0;
    } else {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += (judgement === 'perfect' ? 50 : 20) * this.multiplier;
    }
    if (judgement === 'perfect') {
      this.perfects++;
      this.boost = Math.min(0.2, this.boost + 0.08 * SHOES[this.shoe].rebound[this.weather]);
      if (!fromGlide) this.glideCharge = Math.min(1, this.glideCharge + GLIDE_PER_PERFECT);
    } else if (judgement === 'good') {
      this.glideCharge = Math.min(1, this.glideCharge + GLIDE_PER_GOOD);
    }
    this.hud.judgement(judgement, this.combo);
    if (this.glideCharge >= 1 && !fromGlide && !this.hintsShown.has('glide')) {
      this.hintsShown.add('glide');
      this.hud.showHint('Glide ready! Jump, then swipe ↑ again mid-air', 3);
    }
    this.audio.land(judgement);
    this.runner.land();
    if (this.bufferedJump) {
      this.bufferedJump = false;
      this.mode = 'jump';
      this.takeoffBeat = beat; // rebound: take off exactly at touchdown
      this.audio.jump();
    } else if (this.slideAfterSlam) {
      this.slideAfterSlam = false;
      this.mode = 'slide';
      this.slideEnd = beat + SLIDE_BEATS;
    } else {
      this.mode = 'run';
    }
  }

  // ---- generation ----------------------------------------------------------

  private generate(): void {
    while (this.nextRow * BEAT_LEN < this.distance + HORIZON) {
      if (this.restRows > 0) {
        this.restRow(this.nextRow);
        this.restRows--;
        this.nextRow++;
        continue;
      }
      const difficulty = clamp(this.distance / 2500, 0, 1);
      const maxTier = Math.min(3, Math.floor(difficulty * 4));
      const pool = PATTERNS.filter((p) => p.tier <= maxTier);
      const pattern = this.rng.pick(pool);
      const mirror = this.rng.chance(0.5);
      const rows = pattern.rows.map((r) => (mirror ? [...r].reverse().join('') : r));
      this.emitPattern(this.nextRow, rows);
      this.nextRow += rows.length;
      this.restRows = Math.round(lerp(4, 1, difficulty)) + (this.rng.chance(0.3) ? 1 : 0);
    }
  }

  private restRow(row: number): void {
    if (this.rng.chance(0.35)) {
      const lane = this.rng.int(0, 2);
      for (const half of [0, 0.5]) this.addCloud(lane, (row + half) * BEAT_LEN, 1);
    }
    const s = row * BEAT_LEN;
    const w = this.weatherAt(s);
    if (w !== 'dry' && this.rng.chance(0.3)) {
      const kind: HazardKind = w === 'rain' ? 'puddle' : 'ice';
      const lane = this.rng.int(0, 2);
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 16), kind === 'puddle' ? this.shared.puddle : this.shared.ice);
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.set(0.95, 1.9, 1);
      mesh.position.set(laneToX(lane), 0.02, 0);
      this.scene.add(mesh);
      this.hazards.push({ kind, lane, s0: s - 2, s1: s + 2, done: false, mesh });
    }
  }

  private emitPattern(startRow: number, rows: string[]): void {
    // Cloud trail along a lane that is never blocked, hinting the path.
    const freeLanes = [0, 1, 2].filter((l) => rows.every((r) => r[l] !== '#'));
    const cloudLane = freeLanes.length > 0 && this.rng.chance(0.75) ? this.rng.pick(freeLanes) : -1;

    for (let lane = 0; lane < 3; lane++) {
      let blockStart = -1;
      for (let i = 0; i <= rows.length; i++) {
        const cell = i < rows.length ? rows[i]![lane] : '.';
        const row = startRow + i;
        if (cell === '#') {
          if (blockStart < 0) blockStart = row;
          continue;
        }
        if (blockStart >= 0) {
          this.addObstacle('block', lane, (blockStart - 0.4) * BEAT_LEN, (row - 1 + 0.4) * BEAT_LEN);
          blockStart = -1;
        }
        if (cell === '-') this.addObstacle('low', lane, row * BEAT_LEN - 0.25, row * BEAT_LEN + 0.25);
        if (cell === '=') this.addObstacle('high', lane, row * BEAT_LEN - 0.3, row * BEAT_LEN + 0.3);
        if (lane === cloudLane && i < rows.length) {
          const y = cell === '-' ? JUMP_H + 0.9 : cell === '=' ? 0.5 : 1;
          this.addCloud(lane, row * BEAT_LEN, y);
          if (cell === '-') {
            this.addCloud(lane, (row - 0.5) * BEAT_LEN, 0.75 * JUMP_H + 0.9);
            this.addCloud(lane, (row + 0.5) * BEAT_LEN, 0.75 * JUMP_H + 0.9);
          }
        }
      }
    }
  }

  private addObstacle(type: ObstacleType, lane: number, s0: number, s1: number): void {
    const zone = ZONES[zoneIndexAt(s0)]!;
    const group = new THREE.Group();
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): void => {
      const m = new THREE.Mesh(this.shared.box, mat);
      m.scale.set(w, h, d);
      m.position.set(x, y, z);
      group.add(m);
    };
    let y0 = 0;
    let y1 = 3.4;
    if (type === 'low') {
      y1 = 0.85;
      box(0.12, 0.85, 0.12, this.shared.pole, -0.9, 0.425, 0);
      box(0.12, 0.85, 0.12, this.shared.pole, 0.9, 0.425, 0);
      box(2.0, 0.22, 0.14, this.shared.red, 0, 0.72, 0);
      box(2.0, 0.22, 0.14, this.shared.white, 0, 0.45, 0);
    } else if (type === 'high') {
      y0 = 1.15;
      box(0.12, 2.6, 0.12, this.shared.pole, -1.05, 1.3, 0);
      box(0.12, 2.6, 0.12, this.shared.pole, 1.05, 1.3, 0);
      box(2.2, 0.9, 0.08, this.shared.banner, 0, 1.65, 0);
      // Branded course banner facing the runner.
      const sign = new THREE.Mesh(this.shared.plane, this.shared.bannerSign);
      sign.scale.set(2.2, 0.9, 1);
      sign.position.set(0, 1.65, 0.045);
      group.add(sign);
    } else {
      // Zürich-style city bus: blue body, white window band and roof, operator name on the sides.
      const len = s1 - s0;
      const mid = -len / 2;
      box(2.05, 0.45, len, this.shared.pole, 0, 0.32, mid);
      box(2.05, 1.15, len, this.shared.busBlue, 0, 1.12, mid);
      box(2.05, 1.25, len, this.shared.white, 0, 2.3, mid);
      box(2.07, 0.75, len - 0.8, this.shared.glass, 0, 2.3, mid);
      box(1.95, 0.18, len - 0.2, this.shared.white, 0, 3.0, mid);
      box(1.7, 0.8, 0.06, this.shared.glass, 0, 2.2, 0.01);
      const front = new THREE.Mesh(this.shared.plane, this.shared.busDestination);
      front.scale.set(1.3, 0.28, 1);
      front.position.set(0, 2.78, 0.05);
      group.add(front);
      for (const side of [-1, 1]) {
        const label = new THREE.Mesh(this.shared.plane, this.shared.busLabel);
        label.scale.set(1.6, 0.55, 1);
        label.rotation.y = side * (Math.PI / 2);
        label.position.set(side * 1.035, 1.1, Math.max(mid, -2.2));
        group.add(label);
      }
      if (zone.name === 'Zürich') box(0.08, 0.6, 0.8, this.shared.pole, 0, 3.4, mid);
    }
    group.position.set(laneToX(lane), 0, 0);
    this.scene.add(group);
    this.obstacles.push({ type, lane, s0, s1, y0, y1, hit: false, mesh: group });
  }

  private addCloud(lane: number, s: number, y: number): void {
    const group = new THREE.Group();
    for (const [x, yy, r] of [[0, 0, 1], [0.28, -0.05, 0.75], [-0.28, -0.05, 0.75]] as const) {
      const puff = new THREE.Mesh(this.shared.cloud, this.shared.cloudMat);
      puff.position.set(x, yy, 0);
      puff.scale.setScalar(r);
      group.add(puff);
    }
    group.position.set(laneToX(lane), y, 0);
    this.scene.add(group);
    this.clouds.push({ lane, s, y, mesh: group });
  }

  private spawnSkyTrail(): void {
    let lane = this.lane;
    for (let b = Math.ceil(this.beat) + 1; b < this.glideEnd - 1; b += 0.5) {
      if (b % 2 === 0 && this.rng.chance(0.6)) lane = clamp(lane + this.rng.pick([-1, 1]), 0, 2);
      this.addCloud(lane, b * BEAT_LEN, GLIDE_H + 0.9);
    }
  }

  // ---- collisions ----------------------------------------------------------

  private collide(prevDistance: number, prevX: number, prevY: number): void {
    const h = this.mode === 'slide' ? SLIDE_H : BODY_H;
    const s0 = this.distance - HALF_D;
    const s1 = this.distance + HALF_D;
    for (const o of this.obstacles) {
      if (o.hit || o.s0 > s1 + 1 || o.s1 < s0 - 1) continue;
      const ox = laneToX(o.lane);
      const halfW = o.type === 'high' ? 1.1 : o.type === 'low' ? 1.0 : 1.025;
      const overlap = s1 > o.s0 && s0 < o.s1 && Math.abs(this.x - ox) < HALF_W + halfW && this.y + h > o.y0 && this.y < o.y1;
      if (!overlap || this.mode === 'glide') continue;
      o.hit = true;
      if (prevDistance + HALF_D <= o.s0 + 1e-3) {
        this.crash();
        return;
      }
      const sideHit = Math.abs(prevX - ox) >= HALF_W + halfW - 1e-3 && prevY < o.y1;
      this.stumble(sideHit ? 'side' : 'trip', ox);
      if (this.isDead) return;
    }

    for (const c of this.clouds) {
      if (!c.mesh.visible) continue;
      if (Math.abs(c.s - this.distance) < 0.9 && Math.abs(laneToX(c.lane) - this.x) < 1.0 && c.y > this.y - 0.4 && c.y < this.y + h + 0.4) {
        c.mesh.visible = false;
        this.cloudStreak = this.time - this.lastCloudTime < 0.6 ? this.cloudStreak + 1 : 0;
        this.lastCloudTime = this.time;
        this.cloudCount++;
        this.score += 10 * this.multiplier;
        this.audio.collect(this.cloudStreak);
      }
    }

    if (this.mode === 'run' || this.mode === 'slide') {
      for (const hz of this.hazards) {
        if (hz.done || this.distance < hz.s0 || this.distance > hz.s1 || Math.abs(laneToX(hz.lane) - this.x) > 1) continue;
        hz.done = true;
        if (GRIP_RANK[this.grip] < GRIP_RANK[HAZARD_MIN_GRIP[hz.kind]]) {
          this.stumble('slip', this.x);
          if (this.isDead) return;
        }
      }
    }
  }

  private stumble(reason: 'side' | 'trip' | 'slip', fromX: number): void {
    this.combo = 0;
    this.boost = 0;
    this.penalty = 0.25;
    this.stumbleTimer = 0.7;
    if (reason === 'side') {
      const l = this.lane;
      this.lane = this.prevLane;
      this.prevLane = l;
      this.vx = Math.sign(this.x - fromX || 1) * 5;
    }
    this.strikes = this.strikes.filter((t) => this.time - t < 7);
    this.strikes.push(this.time);
    this.audio.stumble();
    if (this.strikes.length >= 2) {
      this.crash();
      return;
    }
    const label = reason === 'slip' ? (this.weather === 'rain' ? 'SLIPPED! Wet grip needed' : 'SLIPPED! Ice grip needed') : 'STUMBLE!';
    this.hud.flash(label, 'miss', 'One more and you’re out', 1.2);
  }

  private crash(): void {
    this.mode = 'dead';
    this.deadTime = 0;
    this.audio.crash();
    this.endRun();
  }

  // ---- weather & zones -----------------------------------------------------

  private weatherAt(s: number): WeatherId {
    return s >= this.nextWeatherAt ? this.nextWeather : this.weather;
  }

  private updateWeather(): void {
    const ahead = this.nextWeatherAt - this.distance;
    if (!this.forecastShown && ahead < this.speed * 3.5 && this.state !== 'menu') {
      this.forecastShown = true;
      const shoe = bestShoeFor(this.nextWeather);
      this.hud.forecast(this.nextWeather, shoe);
      this.audio.forecast();
      if (!this.hintsShown.has('shoe')) {
        this.hintsShown.add('shoe');
        this.hud.showHint(`Tap ${SHOES[shoe].shortName} below for grip`, 3);
      }
    }
    if (ahead <= 0) {
      this.weather = this.nextWeather;
      this.scheduleWeather(false);
    }
  }

  private updateZone(): void {
    const z = zoneIndexAt(this.distance);
    if (z !== this.zoneIndex) {
      this.zoneIndex = z;
      this.hud.flash(ZONES[z]!.name.toUpperCase(), 'good', 'Next stop', 1.6);
    }
  }

  private cleanup(): void {
    const behind = this.distance - 15;
    const keep = <T extends { mesh: THREE.Object3D }>(list: T[], end: (item: T) => number): T[] =>
      list.filter((item) => {
        if (end(item) >= behind) return true;
        this.scene.remove(item.mesh);
        return false;
      });
    this.obstacles = keep(this.obstacles, (o) => o.s1);
    this.clouds = keep(this.clouds, (c) => c.s);
    this.hazards = keep(this.hazards, (h) => {
      if (h.s1 < behind) h.mesh.geometry.dispose();
      return h.s1;
    });
  }

  // ---- rendering -----------------------------------------------------------

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep all three lanes in view on narrow portrait screens.
    const halfH = Math.atan(4.8 / 7);
    this.camera.fov = clamp((2 * Math.atan(Math.tan(halfH) / this.camera.aspect) * 180) / Math.PI, 55, 100);
    this.camera.updateProjectionMatrix();
  }

  private render(dt: number): void {
    const d = this.distance;
    const z = (s: number): number => d - s;

    for (const o of this.obstacles) o.mesh.position.z = z(o.s0);
    for (const c of this.clouds) {
      c.mesh.position.z = z(c.s);
      c.mesh.position.y = c.y + Math.sin(this.time * 3 + c.s) * 0.08;
      c.mesh.rotation.y += dt * 1.5;
    }
    for (const h of this.hazards) h.mesh.position.z = z((h.s0 + h.s1) / 2);

    const span = (this.scenery.length / 2) * 15;
    for (const slot of this.scenery) {
      if (slot.s < d - 25) {
        slot.s += span;
        this.layoutScenery(slot);
      }
      slot.group.position.z = z(slot.s);
    }
    this.linesTex.offset.y = d / 10;

    // Environment: blend zone palette with weather.
    const zone = ZONES[zoneIndexAt(d)]!;
    const w = this.state === 'menu' ? this.weather : this.weather;
    this.tint.rain = damp(this.tint.rain, w === 'rain' ? 1 : 0, 1.5, dt);
    this.tint.snow = damp(this.tint.snow, w === 'snow' ? 1 : 0, 1.5, dt);
    const sky = new THREE.Color(zone.sky);
    const fog = new THREE.Color(zone.fog);
    sky.lerp(new THREE.Color(WEATHER_TINT.rain.color), this.tint.rain * WEATHER_TINT.rain.amount);
    sky.lerp(new THREE.Color(WEATHER_TINT.snow.color), this.tint.snow * WEATHER_TINT.snow.amount);
    fog.lerp(new THREE.Color(WEATHER_TINT.rain.color), this.tint.rain * 0.7);
    fog.lerp(new THREE.Color(WEATHER_TINT.snow.color), this.tint.snow * 0.7);
    this.skyColor.lerp(sky, 1 - Math.exp(-3 * dt));
    this.fogColor.lerp(fog, 1 - Math.exp(-3 * dt));
    this.scene.background = this.skyColor;
    this.fog.color.copy(this.fogColor);
    this.fog.near = lerp(lerp(40, 20, this.tint.rain), 14, this.tint.snow);
    this.fog.far = lerp(lerp(160, 110, this.tint.rain), 95, this.tint.snow);
    this.roadMat.color.setHex(zone.road).lerp(new THREE.Color(0x2a2e33), this.tint.rain * 0.5).lerp(new THREE.Color(0xe8eef4), this.tint.snow * (zone.city ? 0.6 : 0));
    this.groundMat.color.setHex(zone.ground).lerp(new THREE.Color(0xf1f5f9), this.tint.snow * 0.7);
    this.hemi.intensity = 2.2 - this.tint.rain * 0.7;
    this.sun.intensity = 1.8 - this.tint.rain * 1.1 - this.tint.snow * 0.6;
    this.mountains.visible = !zone.city;

    this.animateWeather(dt);

    // Runner.
    this.runner.root.position.set(this.x, this.y, 0);
    this.runner.update(dt, this.beat, this.state === 'menu' ? 'run' : this.mode, this.y, this.stumbleTimer, this.deadTime);

    // Camera rig.
    const camX = this.camera.position.x;
    const tx = this.x * 0.8;
    const nx = damp(camX, tx, 8, dt);
    const ny = damp(this.camera.position.y, 3.4 + this.y * 0.55, 6, dt);
    this.camera.position.set(nx, ny, 6.6);
    this.camera.lookAt(nx * 0.9, 1.2 + this.y * 0.35, -10);
    if (this.stumbleTimer > 0) this.camera.position.x += (Math.random() - 0.5) * this.stumbleTimer * 0.2;
    this.renderer.render(this.scene, this.camera);

    const intensity = this.state === 'menu' ? 0 : this.combo >= 4 ? 2 : 1;
    if (this.state === 'run' || this.state === 'menu') {
      this.audio.updateMusic(this.beat, this.bps, intensity, this.weather, this.state === 'run' && this.mode === 'run');
    }

    if (this.state === 'run' || this.state === 'paused' || this.state === 'over') {
      this.hud.update(
        {
          score: this.score,
          multiplier: this.multiplier,
          clouds: this.cloudCount,
          zone: zone.name,
          nextZone: ZONES[(zoneIndexAt(d) + 1) % ZONES.length]!.name,
          zoneProgress: (d % ZONE_LEN) / ZONE_LEN,
          distance: d,
          bpm: this.bps * 60,
          beat: this.beat,
          landingBeat: this.mode === 'jump' ? this.takeoffBeat + JUMP_BEATS : this.mode === 'glide' ? this.glideEnd : null,
          glideCharge: this.glideCharge,
          shoe: this.shoe,
          lowGrip: this.grip !== 'full' && this.mode !== 'dead',
        },
        dt,
      );
    }
  }

  private animateWeather(dt: number): void {
    const camX = this.camera.position.x;
    const rainPos = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
    const rainOpacity = this.tint.rain * 0.55;
    (this.rain.material as THREE.LineBasicMaterial).opacity = rainOpacity;
    this.rain.visible = rainOpacity > 0.01;
    if (this.rain.visible) {
      const arr = rainPos.array as Float32Array;
      const fall = 22 * dt;
      const fwd = this.speed * dt;
      for (let i = 0; i < arr.length; i += 6) {
        let y = arr[i + 1]! - fall;
        let zz = arr[i + 2]! + fwd;
        if (y < 0) y += 18;
        if (zz > 8) zz -= 60;
        arr[i + 1] = y;
        arr[i + 2] = zz;
        arr[i + 4] = y + 0.7;
        arr[i + 5] = zz + 0.25;
        arr[i] = arr[i + 3] = arr[i]!;
      }
      rainPos.needsUpdate = true;
      this.rain.position.x = camX;
    }

    const snowPos = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const snowOpacity = this.tint.snow * 0.95;
    (this.snow.material as THREE.PointsMaterial).opacity = snowOpacity;
    this.snow.visible = snowOpacity > 0.01;
    if (this.snow.visible) {
      const arr = snowPos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        let y = arr[i + 1]! - 2.2 * dt;
        let zz = arr[i + 2]! + this.speed * dt * 0.9;
        if (y < 0) y += 18;
        if (zz > 8) zz -= 60;
        arr[i] = arr[i]! + Math.sin(this.time * 1.3 + i) * dt * 0.6;
        arr[i + 1] = y;
        arr[i + 2] = zz;
      }
      snowPos.needsUpdate = true;
      this.snow.position.x = camX;
    }
  }
}


