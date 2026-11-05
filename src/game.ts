import * as THREE from 'three';
import { GRIP_DYNAMICS, GRIP_RANK, LANES, laneToX, type GripLevel } from './config/gameplay';
import { RUNNERS, runnerById, type RunnerConfig } from './config/runners';
import { SHOES, bestShoeFor, type ShoeId } from './config/shoes';
import { HAZARD_MIN_GRIP, type HazardKind, type WeatherId } from './config/weather';
import { clamp, damp, lerp } from './core/math';
import { createRng, randomSeed, type Rng } from './core/random';
import { beatError, judgeLanding, type Judgement } from './sim/rhythm';
import { GameAudio } from './audio';
import { Hud } from './hud';
import { Effects } from './world/effects';
import { createObstacle, type ObstacleType } from './world/obstacles';
import { Runner, type RunnerPose } from './world/runner';
import { Scenery } from './world/scenery';
import { Sky } from './world/sky';
import { roadMarkingsTexture, softDotTexture } from './world/textures';
import { ZONE_LEN, ZONE_THEMES, locationAt, zoneAt, zoneIndexAt, type ZoneKey } from './world/themes';

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
const ATTRACT_SPEED = 6.5;
const JUMP_BEATS = 2;
const JUMP_H = 1.6;
const SLIDE_BEATS = 1.6;
const SLAM_SPEED = 22;
const GLIDE_BEATS = 6;
const GLIDE_H = 4.2;
const HORIZON = 140;
const BODY_H = 1.7;
const SLIDE_H = 0.75;
const HALF_W = 0.35;
const HALF_D = 0.25;
const MAX_INPUT_LATE_SEC = 0.15;
/** Glide meter gained per landing (1 = full): three perfect landings fill it. */
const GLIDE_PER_PERFECT = 0.34;
const GLIDE_PER_GOOD = 0.15;
/** Oncoming trams and buses drive towards the runner at this speed (m/s). */
const ONCOMING_SPEED = 7;
const STORAGE = { best: 'cloudtec.best', runner: 'cloudtec.runner' } as const;

/** Dev-only helpers: `?at=<metres>` starts a run further along, `?god` disables crashes. */
const DEV_PARAMS = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
const DEV_START = Math.max(0, Number(DEV_PARAMS?.get('at') ?? 0) || 0);
const DEV_GOD = DEV_PARAMS?.has('god') ?? false;

type Mode = 'run' | 'jump' | 'slam' | 'slide' | 'glide' | 'dead';
type State = 'menu' | 'run' | 'paused' | 'over';
type Action = 'left' | 'right' | 'jump' | 'slide' | ShoeId;

/**
 * Obstacle patterns on the beat grid (rows near → far, one char per lane):
 * '-' jump, '=' slide, '#' block, '<' oncoming tram or bus meeting you on that row.
 */
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
  { rows: ['.#.', '.#.', '.#.', '.#.'], tier: 1 },
  { rows: ['-.-', '...', '.=.'], tier: 1 },
  { rows: ['.<.'], tier: 1 },
  { rows: ['---', '...', '==='], tier: 2 },
  { rows: ['#.#', '#-#', '#.#'], tier: 2 },
  { rows: ['.#.', '.#.', '-#='], tier: 2 },
  { rows: ['#..', '#-.', '#..'], tier: 2 },
  { rows: ['=.=', '...', '-.-'], tier: 2 },
  { rows: ['<.#'], tier: 2 },
  { rows: ['<..', '...', '...', '..<'], tier: 2 },
  { rows: ['---', '...', '---', '...', '---'], tier: 3 },
  { rows: ['#.#', '#=#', '#.#', '#-#', '#.#'], tier: 3 },
  { rows: ['-<-'], tier: 3 },
  { rows: ['=<='], tier: 3 },
];

interface Obstacle {
  type: ObstacleType;
  lane: number;
  s0: number;
  s1: number;
  prevS0: number;
  y0: number;
  y1: number;
  /** Track velocity (m/s); negative for oncoming traffic. */
  vel: number;
  hit: boolean;
  announced: boolean;
  tram: boolean;
  mesh: THREE.Object3D;
}
interface CloudPickup { lane: number; s: number; y: number; mesh: THREE.Object3D; taken: boolean }
interface Hazard { kind: HazardKind; lane: number; s0: number; s1: number; done: boolean; mesh: THREE.Mesh }

const RAIN_TINT = new THREE.Color(0x6f7a86);
const SNOW_TINT = new THREE.Color(0xe3e9f0);

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) */
  }
}

/** The game: fixed-step simulation, Three.js view and wiring to HUD and audio. */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1600);
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.0);
  private readonly sun = new THREE.DirectionalLight(0xfff2dd, 2.0);
  private readonly fog = new THREE.Fog(0xd5e9f5, 40, 160);
  private readonly roadMat = lambert(0x585e63);
  private readonly groundMat = lambert(0x9fa6a3);
  private readonly linesMat: THREE.MeshBasicMaterial;
  private readonly markings: Record<ZoneKey, THREE.CanvasTexture>;
  private readonly dot = softDotTexture();
  private readonly sky = new Sky();
  private readonly scenery = new Scenery();
  private readonly effects: Effects;
  private runner: Runner;
  private runnerConfig: RunnerConfig;
  private readonly audio = new GameAudio();
  private readonly hud: Hud;
  private readonly shared = {
    cloudGeo: new THREE.SphereGeometry(0.32, 12, 10),
    cloudMat: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8fa6bf }),
    puddle: new THREE.MeshPhongMaterial({ color: 0x5d7690, shininess: 90, specular: 0xaaaaaa, transparent: true, opacity: 0.85 }),
    ice: new THREE.MeshPhongMaterial({ color: 0xcdeeff, shininess: 120, specular: 0xffffff, transparent: true, opacity: 0.9 }),
    hazardGeo: new THREE.CircleGeometry(1, 20),
  };
  private rain: THREE.LineSegments | null = null;
  private snow: THREE.Points | null = null;

  private state: State = 'menu';
  private rng: Rng = createRng(1);
  private obstacles: Obstacle[] = [];
  private clouds: CloudPickup[] = [];
  private hazards: Hazard[] = [];
  private input: { type: Action; time: number }[] = [];

  // Simulation state.
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
  /** Row index until which each lane is kept clear for oncoming traffic. */
  private reserved = [0, 0, 0];
  private weather: WeatherId = 'dry';
  private nextWeatherAt = 0;
  private nextWeather: WeatherId = 'rain';
  private forecastShown = false;
  private zoneIndex = 0;
  private lastBeatIndex = 0;
  private runStartBeat = 0;
  private readonly hintsShown = new Set<string>();
  private best = 0;

  // Presentation state.
  private acc = 0;
  private lastFrame = 0;
  private touch: { id: number; x: number; y: number; used: boolean } | null = null;
  private readonly skyTop = new THREE.Color(0x4f9be0);
  private readonly skyHorizon = new THREE.Color(0xd8ecf8);
  private readonly fogColor = new THREE.Color(0xd3e6f3);
  private readonly tmp = new THREE.Color();
  private readonly camFront = new THREE.Vector3();
  private readonly camBack = new THREE.Vector3();
  private readonly lookFront = new THREE.Vector3();
  private readonly lookBack = new THREE.Vector3();
  private readonly tint = { rain: 0, snow: 0 };
  private chaseX = 0;
  private chase = 0;
  private markingsZone: ZoneKey = 'zurich';
  private slowFrames = 0;
  private pixelRatio = 1;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.fog = this.fog;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.camera, this.sky.mesh, this.scenery.group);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const shadowCam = this.sun.shadow.camera;
    shadowCam.left = -12;
    shadowCam.right = 12;
    shadowCam.top = 16;
    shadowCam.bottom = -16;
    shadowCam.near = 1;
    shadowCam.far = 60;
    this.sun.shadow.bias = -0.0008;

    this.markings = { zurich: roadMarkingsTexture('zurich'), alps: roadMarkingsTexture('alps'), newyork: roadMarkingsTexture('newyork') };
    this.linesMat = new THREE.MeshBasicMaterial({ map: this.markings.zurich, transparent: true, depthWrite: false });
    this.effects = new Effects(this.dot, this.camera);
    this.scene.add(this.effects.group);

    this.runnerConfig = runnerById(readStorage(STORAGE.runner));
    this.runner = new Runner(this.runnerConfig.look, this.dot);
    this.scene.add(this.runner.root);

    this.hud = new Hud(uiRoot, {
      onPlay: () => this.startRun(),
      onShoe: (shoe) => this.queue(shoe, performance.now()),
      onPause: () => this.togglePause(),
      onRunner: (direction) => this.cycleRunner(direction),
      onMenu: () => this.toMenu(),
    });

    this.buildRoad();
    this.best = Number(readStorage(STORAGE.best) ?? 0) || 0;
    this.resetRun(false);
    this.hud.showMenu(this.best, this.runnerConfig);
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
      this.adaptQuality(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ---- setup -------------------------------------------------------------------

  private buildRoad(): void {
    const width = LANES.width * 3 + 0.8;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(width, 420), this.roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -190);
    road.receiveShadow = true;
    const lines = new THREE.Mesh(new THREE.PlaneGeometry(width, 420), this.linesMat);
    for (const tex of Object.values(this.markings)) tex.repeat.set(1, 420 / 10);
    lines.rotation.x = -Math.PI / 2;
    lines.position.set(0, 0.01, -190);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, -250);
    ground.receiveShadow = true;
    this.scene.add(road, lines, ground);
  }

  private cycleRunner(direction: -1 | 1): void {
    const index = RUNNERS.findIndex((r) => r.id === this.runnerConfig.id);
    this.runnerConfig = RUNNERS[(index + direction + RUNNERS.length) % RUNNERS.length]!;
    writeStorage(STORAGE.runner, this.runnerConfig.id);
    this.scene.remove(this.runner.root);
    this.runner.dispose();
    this.runner = new Runner(this.runnerConfig.look, this.dot);
    this.runner.setShoe(this.shoe);
    this.scene.add(this.runner.root);
    this.hud.setRunner(this.runnerConfig);
    this.audio.unlock();
    this.audio.shoe();
  }

  // ---- run lifecycle -----------------------------------------------------------

  private resetRun(playing: boolean): void {
    for (const o of this.obstacles) this.scene.remove(o.mesh);
    for (const c of this.clouds) this.scene.remove(c.mesh);
    for (const h of this.hazards) this.scene.remove(h.mesh);
    this.obstacles = [];
    this.clouds = [];
    this.hazards = [];
    this.input = [];
    this.rng = createRng(randomSeed());
    this.distance = playing ? DEV_START : 0;
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
    this.nextRow = Math.ceil(this.distance / BEAT_LEN) + 8; // two bars of warm-up and count-in
    this.restRows = 0;
    this.reserved = [0, 0, 0];
    this.weather = 'dry';
    this.scheduleWeather(true);
    this.zoneIndex = zoneIndexAt(this.distance);
    this.lastBeatIndex = Math.floor(this.beat);
    this.runStartBeat = Math.floor(this.beat);
    this.setShoe('road', false);
    this.audio.resetMusic();
    this.scenery.reset(this.distance);
  }

  private startRun(): void {
    this.audio.unlock();
    this.resetRun(true);
    this.state = 'run';
    this.hud.showRun();
  }

  private toMenu(): void {
    this.resetRun(false);
    this.state = 'menu';
    this.hud.showMenu(this.best, this.runnerConfig);
  }

  private endRun(): void {
    this.state = 'over';
    const newBest = this.score > this.best;
    if (newBest) {
      this.best = Math.floor(this.score);
      writeStorage(STORAGE.best, String(this.best));
    }
    window.setTimeout(() => {
      this.hud.showGameOver({
        score: Math.floor(this.score),
        distance: this.distance,
        clouds: this.cloudCount,
        perfects: this.perfects,
        maxCombo: this.maxCombo,
        zone: locationAt(this.distance),
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
    const zone = zoneAt(this.distance + 200);
    const options = zone.weathers.filter((w) => w !== this.weather);
    this.nextWeather = options.length > 0 ? this.rng.pick(options) : this.weather;
    this.nextWeatherAt = this.distance + (first ? 180 : this.rng.range(150, 240));
    this.forecastShown = false;
  }

  // ---- input ---------------------------------------------------------------------

  private queue(type: Action, time: number): void {
    if (this.state === 'run') this.input.push({ type, time });
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    const keys: Record<string, Action> = {
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', ArrowDown: 'slide', KeyS: 'slide',
      Digit1: 'road', Digit2: 'wet', Digit3: 'trail',
    };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' || e.code === 'Escape') {
        this.togglePause();
        return;
      }
      if (this.state === 'menu' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        this.cycleRunner(e.code === 'ArrowLeft' ? -1 : 1);
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
      if (this.state === 'menu' && Math.abs(dx) > Math.abs(dy)) {
        this.cycleRunner(dx < 0 ? 1 : -1);
        return;
      }
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

  // ---- simulation ----------------------------------------------------------------

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

  private get multiplier(): number {
    return Math.min(10, 1 + Math.floor(this.combo / 4));
  }

  private setShoe(shoe: ShoeId, announce = true): void {
    if (shoe === this.shoe && announce) return;
    this.shoe = shoe;
    this.runner.setShoe(shoe);
    if (announce) {
      this.audio.shoe();
      this.hud.flash(SHOES[shoe].shortName, 'good', SHOES[shoe].tagline, 0.9);
      this.effects.burst(this.x, 0.15, this.distance, SHOES[shoe].colors.accent, 14, 2.5, 0.18, 0.5);
    }
  }

  private step(dt: number): void {
    this.time += dt;
    if (this.state === 'menu') {
      this.speed = ATTRACT_SPEED;
      this.distance += ATTRACT_SPEED * dt;
      this.updateWeather();
      return;
    }
    if (this.isDead) {
      this.deadTime += dt;
      this.y = Math.max(0, this.y - 8 * dt);
      return;
    }

    this.processInput();
    const base = SPEED_START + (SPEED_MAX - SPEED_START) * (1 - Math.exp(-this.distance / SPEED_RAMP));
    this.boost *= Math.exp(-dt / 1.2);
    this.penalty = Math.max(0, this.penalty - (dt / 1.8) * 0.25);
    this.speed = base * (1 + this.boost) * (1 - this.penalty);
    const prevDistance = this.distance;
    const prevY = this.y;
    const prevX = this.x;
    this.distance += this.speed * dt;
    this.score += (this.distance - prevDistance) * this.multiplier;

    for (const o of this.obstacles) {
      o.prevS0 = o.s0;
      if (o.vel !== 0) {
        o.s0 += o.vel * dt;
        o.s1 += o.vel * dt;
      }
    }

    // Lateral spring: grip sets stiffness and damping, so the wrong shoes feel slippery.
    const { omega, zeta } = GRIP_DYNAMICS[this.grip];
    this.vx += (omega * omega * (laneToX(this.lane) - this.x) - 2 * zeta * omega * this.vx) * dt;
    this.x += this.vx * dt;
    this.stumbleTimer = Math.max(0, this.stumbleTimer - dt);

    this.updateVertical(dt);
    this.generate();
    this.collide(prevDistance, prevX, prevY);
    this.updateWeather();
    this.updateZone();
    this.onBeat();
    this.cleanup();
  }

  /** Per-beat events: count-in, footstrike puffs and oncoming-traffic warnings. */
  private onBeat(): void {
    const index = Math.floor(this.beat);
    if (index === this.lastBeatIndex) return;
    this.lastBeatIndex = index;
    const sinceStart = index - this.runStartBeat;
    if (sinceStart >= 1 && sinceStart <= 4) {
      const labels = ['3', '2', '1', 'GO!'];
      const go = sinceStart === 4;
      this.hud.flash(labels[sinceStart - 1]!, go ? 'perfect' : 'count', go ? 'Land on the beat' : '', 0.32);
      this.audio.count(go);
    }
    if (sinceStart === 6) this.hud.zoneCard(ZONE_THEMES[this.zoneIndex]!.name, locationAt(this.distance));
    if (sinceStart === 12) this.hud.showHint('Swipe ↑ to jump, ↓ to slide, ← → to switch lanes', 2.6);
    if (this.mode === 'run') {
      const foot = index % 2 === 0 ? -1 : 1;
      const dry = this.weather === 'dry';
      const color = this.weather === 'rain' ? 0xa8c6e6 : this.weather === 'snow' ? 0xffffff : 0xcfcac0;
      for (let i = 0; i < (dry ? 2 : 4); i++) {
        this.effects.spawn({
          x: this.x + foot * 0.12 + (Math.random() - 0.5) * 0.2,
          y: 0.08,
          s: this.distance - 0.15,
          vx: (Math.random() - 0.5) * 1.2,
          vy: dry ? 0.3 : 1.6 + Math.random(),
          vs: -1 - Math.random(),
          life: 0.45,
          size: dry ? 0.16 : 0.09,
          color,
          gravity: dry ? 0 : 7,
          grow: dry ? 0.5 : 0,
        });
      }
    }
    for (const o of this.obstacles) {
      if (o.vel !== 0 && !o.announced && o.s0 - this.distance < 75) {
        o.announced = true;
        this.audio.vehicle(o.tram);
      }
    }
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
          this.audio.whoosh();
        }
      } else if (type === 'jump') {
        this.tryJump(this.beat - late * this.bps);
      } else if (type === 'slide') {
        if (this.mode === 'run' || this.mode === 'slide') {
          if (this.mode === 'run') this.audio.slide();
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
      this.effects.burst(this.x, this.y + 0.3, this.distance, 0xffffff, 18, 3, 0.45, 0.7);
      vibrate(20);
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
      this.effects.shockwave(this.x, this.distance, 0xd4ff3a);
      this.effects.burst(this.x, 0.1, this.distance, 0xffffff, 12, 2.6, 0.32, 0.5);
      vibrate(12);
    } else if (judgement === 'good') {
      this.glideCharge = Math.min(1, this.glideCharge + GLIDE_PER_GOOD);
      this.effects.shockwave(this.x, this.distance, 0x38d6ff);
    }
    if (this.combo > 0 && this.combo % 10 === 0) this.hud.flash(`${this.combo} COMBO`, 'perfect', `x${this.multiplier} multiplier`, 1);
    else this.hud.judgement(judgement, this.combo);
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

  // ---- generation ------------------------------------------------------------------

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
      let rows: string[] | null = null;
      for (let attempt = 0; attempt < 6 && !rows; attempt++) {
        const pattern = this.rng.pick(pool);
        const mirror = this.rng.chance(0.5);
        const candidate = pattern.rows.map((r) => (mirror ? [...r].reverse().join('') : r));
        if (this.fitsReservations(this.nextRow, candidate)) rows = candidate;
      }
      if (!rows) {
        this.restRow(this.nextRow);
        this.nextRow++;
        continue;
      }
      this.emitPattern(this.nextRow, rows);
      this.nextRow += rows.length;
      this.restRows = Math.round(lerp(4, 1, difficulty)) + (this.rng.chance(0.3) ? 1 : 0);
    }
  }

  /** Lanes kept clear for oncoming traffic may not receive new obstacles. */
  private fitsReservations(startRow: number, rows: string[]): boolean {
    return rows.every((row, i) => [...row].every((cell, lane) => cell === '.' || startRow + i >= this.reserved[lane]!));
  }

  private restRow(row: number): void {
    const free = [0, 1, 2].filter((lane) => row >= this.reserved[lane]!);
    if (free.length === 0) return;
    if (this.rng.chance(0.35)) {
      const lane = this.rng.pick(free);
      for (const half of [0, 0.5]) this.addCloud(lane, (row + half) * BEAT_LEN, 1);
    }
    const s = row * BEAT_LEN;
    const w = this.weatherAt(s);
    if (w !== 'dry' && this.rng.chance(0.3)) {
      const kind: HazardKind = w === 'rain' ? 'puddle' : 'ice';
      const lane = this.rng.pick(free);
      const mesh = new THREE.Mesh(this.shared.hazardGeo, kind === 'puddle' ? this.shared.puddle : this.shared.ice);
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.set(0.95, 1.9, 1);
      mesh.position.set(laneToX(lane), 0.02, 0);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.hazards.push({ kind, lane, s0: s - 2, s1: s + 2, done: false, mesh });
    }
  }

  private emitPattern(startRow: number, rows: string[]): void {
    // Cloud trail along a lane that is never blocked, hinting the path.
    const freeLanes = [0, 1, 2].filter((l) => rows.every((r) => r[l] !== '#' && r[l] !== '<') && startRow >= this.reserved[l]!);
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
          this.addObstacle('block', lane, (blockStart - 0.4) * BEAT_LEN, (row - 1 + 0.4) * BEAT_LEN, 0);
          blockStart = -1;
        }
        if (cell === '-') this.addObstacle('low', lane, row * BEAT_LEN - 0.25, row * BEAT_LEN + 0.25, 0);
        if (cell === '=') this.addObstacle('high', lane, row * BEAT_LEN - 0.3, row * BEAT_LEN + 0.3, 0);
        if (cell === '<') this.addOncoming(lane, row);
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

  /** A tram or bus driving towards the runner, timed to meet them on `row`. */
  private addOncoming(lane: number, row: number): void {
    const meet = row * BEAT_LEN;
    const length = zoneAt(meet).key === 'zurich' ? 12 : 9;
    const timeToMeet = Math.max(0.5, (meet - this.distance) / Math.max(1, this.speed));
    const s0 = meet + ONCOMING_SPEED * timeToMeet;
    this.addObstacle('block', lane, s0, s0 + length, -ONCOMING_SPEED, zoneAt(meet).key);
    // Keep the lane clear along the stretch the vehicle drives through.
    this.reserved[lane] = Math.max(this.reserved[lane]!, Math.ceil((s0 + length) / BEAT_LEN) + 2);
  }

  private addObstacle(type: ObstacleType, lane: number, s0: number, s1: number, vel: number, zoneKey?: ZoneKey): void {
    const zone = zoneKey ?? zoneAt(s0).key;
    const visual = createObstacle(type, zone, s1 - s0, this.rng.next(), vel !== 0);
    visual.object.position.set(laneToX(lane), 0, 0);
    this.scene.add(visual.object);
    const y0 = type === 'high' ? 1.15 : 0;
    const y1 = type === 'low' ? 0.85 : 3.4;
    this.obstacles.push({ type, lane, s0, s1, prevS0: s0, y0, y1, vel, hit: false, announced: false, tram: visual.tram, mesh: visual.object });
  }

  private addCloud(lane: number, s: number, y: number): void {
    const group = new THREE.Group();
    for (const [x, yy, r] of [[0, 0, 1], [0.28, -0.05, 0.75], [-0.28, -0.05, 0.75]] as const) {
      const puff = new THREE.Mesh(this.shared.cloudGeo, this.shared.cloudMat);
      puff.position.set(x, yy, 0);
      puff.scale.setScalar(r);
      group.add(puff);
    }
    group.position.set(laneToX(lane), y, 0);
    this.scene.add(group);
    this.clouds.push({ lane, s, y, mesh: group, taken: false });
  }

  private spawnSkyTrail(): void {
    let lane = this.lane;
    for (let b = Math.ceil(this.beat) + 1; b < this.glideEnd - 1; b += 0.5) {
      if (b % 2 === 0 && this.rng.chance(0.6)) lane = clamp(lane + this.rng.pick([-1, 1]), 0, 2);
      this.addCloud(lane, b * BEAT_LEN, GLIDE_H + 0.9);
    }
  }

  // ---- collisions --------------------------------------------------------------------

  private collide(prevDistance: number, prevX: number, prevY: number): void {
    const h = this.mode === 'slide' ? SLIDE_H : BODY_H;
    const s0 = this.distance - HALF_D;
    const s1 = this.distance + HALF_D;
    for (const o of this.obstacles) {
      if (o.hit || o.s0 > s1 + 1 || o.s1 < s0 - 1) continue;
      const ox = laneToX(o.lane);
      const halfW = o.type === 'high' ? 1.1 : o.type === 'low' ? 1.0 : 1.025;
      const overlap = s1 > o.s0 && s0 < o.s1 && Math.abs(this.x - ox) < HALF_W + halfW && this.y + h > o.y0 && this.y < o.y1;
      if (!overlap || this.mode === 'glide' || DEV_GOD) continue;
      o.hit = true;
      if (prevDistance + HALF_D <= o.prevS0 + 1e-3) {
        this.crash();
        return;
      }
      const sideHit = Math.abs(prevX - ox) >= HALF_W + halfW - 1e-3 && prevY < o.y1;
      this.stumble(sideHit ? 'side' : 'trip', ox);
      if (this.isDead) return;
    }

    for (const c of this.clouds) {
      if (c.taken) continue;
      if (Math.abs(c.s - this.distance) < 0.9 && Math.abs(laneToX(c.lane) - this.x) < 1.0 && c.y > this.y - 0.4 && c.y < this.y + h + 0.4) {
        c.taken = true;
        c.mesh.visible = false;
        this.cloudStreak = this.time - this.lastCloudTime < 0.6 ? this.cloudStreak + 1 : 0;
        this.lastCloudTime = this.time;
        this.cloudCount++;
        this.score += 10 * this.multiplier;
        this.audio.collect(this.cloudStreak);
        this.effects.burst(laneToX(c.lane), c.y, c.s, 0xffe58a, 6, 1.6, 0.14, 0.35);
      }
    }

    if (this.mode === 'run' || this.mode === 'slide') {
      for (const hz of this.hazards) {
        if (hz.done || this.distance < hz.s0 || this.distance > hz.s1 || Math.abs(laneToX(hz.lane) - this.x) > 1) continue;
        hz.done = true;
        if (GRIP_RANK[this.grip] < GRIP_RANK[HAZARD_MIN_GRIP[hz.kind]]) {
          this.stumble('slip', this.x);
          if (this.isDead) return;
        } else {
          this.effects.burst(this.x, 0.1, this.distance, hz.kind === 'puddle' ? 0xa8c6e6 : 0xe8f6ff, 10, 2.2, 0.1, 0.4, 6);
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
    vibrate(40);
    this.effects.burst(this.x, 0.3, this.distance, 0xbab4a8, 10, 2, 0.25, 0.5);
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
    vibrate([60, 40, 120]);
    this.effects.burst(this.x, 0.6, this.distance, 0xd9d4ca, 24, 3.5, 0.4, 0.8);
    this.endRun();
  }

  // ---- weather and zones ------------------------------------------------------------

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
      this.hud.zoneCard(ZONE_THEMES[z]!.name, locationAt(this.distance));
      this.audio.zone();
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
    this.hazards = keep(this.hazards, (h) => h.s1);
  }

  // ---- rendering ----------------------------------------------------------------------

  private baseFov(): number {
    // Keep all three lanes in view on narrow portrait screens.
    const halfH = Math.atan(4.8 / 7);
    return clamp((2 * Math.atan(Math.tan(halfH) / this.camera.aspect) * 180) / Math.PI, 55, 100);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = this.baseFov();
    this.camera.updateProjectionMatrix();
    this.effects.setScale(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  /** Drops the render resolution on devices that cannot hold ~45 fps. */
  private adaptQuality(dt: number): void {
    this.slowFrames = dt > 1 / 45 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 90 && this.pixelRatio > 1) {
      this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.slowFrames = 0;
      this.resize();
    }
  }

  private weathered(hex: number, amount: number): THREE.Color {
    return this.tmp.setHex(hex).lerp(RAIN_TINT, this.tint.rain * amount).lerp(SNOW_TINT, this.tint.snow * amount);
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

    // Environment: blend the zone palette with the weather.
    const zone = zoneAt(d);
    this.tint.rain = damp(this.tint.rain, this.weather === 'rain' ? 1 : 0, 1.5, dt);
    this.tint.snow = damp(this.tint.snow, this.weather === 'snow' ? 1 : 0, 1.5, dt);
    const haze = Math.max(this.tint.rain, this.tint.snow);
    const blend = 1 - Math.exp(-3 * dt);
    this.skyTop.lerp(this.weathered(zone.skyTop, 0.65), blend);
    this.skyHorizon.lerp(this.weathered(zone.skyHorizon, 0.5), blend);
    this.fogColor.lerp(this.weathered(zone.fog, 0.7), blend);
    this.sky.update(this.camera, this.skyTop, this.skyHorizon, this.tmp.setHex(zone.sun).multiplyScalar(1 - haze * 0.85));
    this.scene.background = this.fogColor;
    this.fog.color.copy(this.fogColor);
    this.fog.near = lerp(lerp(45, 20, this.tint.rain), 14, this.tint.snow);
    this.fog.far = lerp(lerp(170, 110, this.tint.rain), 95, this.tint.snow);
    this.roadMat.color.setHex(zone.road).lerp(this.tmp.setHex(0x2a2e33), this.tint.rain * 0.45);
    if (zone.key !== 'alps') this.roadMat.color.lerp(this.tmp.setHex(0xe8eef4), this.tint.snow * 0.55);
    this.groundMat.color.setHex(zone.ground).lerp(this.tmp.setHex(0xf1f5f9), this.tint.snow * 0.7);
    this.scenery.sidewalkMaterial.color.setHex(zone.sidewalk).lerp(this.tmp.setHex(0xf1f5f9), this.tint.snow * 0.6);
    this.hemi.color.setHex(zone.hemiSky);
    this.hemi.groundColor.setHex(zone.hemiGround);
    this.hemi.intensity = 2.0 - this.tint.rain * 0.6;
    this.sun.color.setHex(zone.sun);
    this.sun.intensity = 2.1 - this.tint.rain * 1.3 - this.tint.snow * 0.8;
    if (zone.key !== this.markingsZone) {
      this.markingsZone = zone.key;
      this.linesMat.map = this.markings[zone.key];
      this.linesMat.needsUpdate = true;
    }
    for (const tex of Object.values(this.markings)) tex.offset.y = d / 10;
    this.scenery.update(d, dt, haze);
    this.effects.update(dt, d, this.state === 'run' ? this.boost : 0, this.speed);
    this.weatherParticles(dt);

    // Runner.
    const pose: RunnerPose = this.state === 'menu' ? 'run' : this.mode;
    this.runner.root.position.set(this.x, this.y, 0);
    this.runner.update(dt, this.beat, pose, this.y, this.stumbleTimer, this.deadTime);

    // Camera: a front-on tracking shot on the menu, swinging to the chase camera in a run.
    this.chase = damp(this.chase, this.state === 'menu' ? 0 : 1, 3.2, dt);
    const k = this.chase * this.chase * (3 - 2 * this.chase);
    this.chaseX = damp(this.chaseX, this.x * 0.8, 8, dt);
    this.camFront.set(this.x - 0.55, 1.45, -3.5);
    this.camBack.set(this.chaseX, 3.4 + this.y * 0.55, 6.6 + this.boost * 2);
    this.camera.position.lerpVectors(this.camFront, this.camBack, k);
    if (this.stumbleTimer > 0) this.camera.position.x += (Math.random() - 0.5) * this.stumbleTimer * 0.2;
    this.lookFront.set(this.x, 1.05, 0);
    this.lookBack.set(this.chaseX * 0.9, 1.2 + this.y * 0.35, -10);
    this.camera.lookAt(this.lookFront.lerp(this.lookBack, k));
    this.camera.rotation.z += -this.vx * 0.006 * k;
    const fovTarget = this.baseFov() + this.boost * 30;
    if (Math.abs(this.camera.fov - fovTarget) > 0.05) {
      this.camera.fov = damp(this.camera.fov, fovTarget, 4, dt);
      this.camera.updateProjectionMatrix();
    }

    // Keep the shadow camera centred on the runner.
    this.sun.position.set(this.x - 7, 14, 6);
    this.sun.target.position.set(this.x, 0, -6);

    this.renderer.render(this.scene, this.camera);

    const intensity = this.state === 'menu' ? 0 : this.combo >= 4 ? 2 : 1;
    if (this.state === 'run' || this.state === 'menu') {
      this.audio.updateMusic(this.beat, this.bps, intensity, this.weather, this.state === 'run' && this.mode === 'run');
    }
    if (this.state !== 'menu') {
      this.hud.update(
        {
          score: this.score,
          multiplier: this.multiplier,
          clouds: this.cloudCount,
          zone: zone.name,
          location: locationAt(d),
          nextZone: ZONE_THEMES[(zoneIndexAt(d) + 1) % ZONE_THEMES.length]!.name,
          zoneProgress: (d % ZONE_LEN) / ZONE_LEN,
          distance: d,
          bpm: this.bps * 60,
          beat: this.beat,
          landingBeat: this.mode === 'jump' ? this.takeoffBeat + JUMP_BEATS : this.mode === 'glide' ? this.glideEnd : null,
          glideCharge: this.glideCharge,
          shoe: this.shoe,
          lowGrip: this.grip !== 'full' && !this.isDead,
        },
        dt,
      );
    }
  }

  private weatherParticles(dt: number): void {
    if (!this.rain || !this.snow) {
      const rainPos = new Float32Array(700 * 6);
      for (let i = 0; i < 700; i++) {
        const x = (Math.random() - 0.5) * 30;
        const y = Math.random() * 18;
        const zz = -Math.random() * 60 + 8;
        rainPos.set([x, y, zz, x, y + 0.7, zz + 0.25], i * 6);
      }
      const rainGeo = new THREE.BufferGeometry();
      rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
      this.rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xc8d6e6, transparent: true, opacity: 0 }));
      const snowPos = new Float32Array(600 * 3);
      for (let i = 0; i < 600; i++) snowPos.set([(Math.random() - 0.5) * 30, Math.random() * 18, -Math.random() * 60 + 8], i * 3);
      const snowGeo = new THREE.BufferGeometry();
      snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
      this.snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, map: this.dot, transparent: true, opacity: 0, depthWrite: false }));
      this.rain.frustumCulled = false;
      this.snow.frustumCulled = false;
      this.scene.add(this.rain, this.snow);
    }
    const camX = this.camera.position.x;
    const rainOpacity = this.tint.rain * 0.55;
    (this.rain.material as THREE.LineBasicMaterial).opacity = rainOpacity;
    this.rain.visible = rainOpacity > 0.01;
    if (this.rain.visible) {
      const attr = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const fall = 22 * dt;
      const fwd = this.speed * dt;
      for (let i = 0; i < arr.length; i += 6) {
        let y = arr[i + 1]! - fall;
        let zz = arr[i + 2]! + fwd;
        if (y < 0) y += 18;
        if (zz > 8) zz -= 60;
        arr[i + 1] = y;
        arr[i + 2] = zz;
        arr[i + 3] = arr[i]!;
        arr[i + 4] = y + 0.7;
        arr[i + 5] = zz + 0.25;
      }
      attr.needsUpdate = true;
      this.rain.position.x = camX;
    }
    const snowOpacity = this.tint.snow * 0.95;
    (this.snow.material as THREE.PointsMaterial).opacity = snowOpacity;
    this.snow.visible = snowOpacity > 0.01;
    if (this.snow.visible) {
      const attr = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        let y = arr[i + 1]! - 2.2 * dt;
        let zz = arr[i + 2]! + this.speed * dt * 0.9;
        if (y < 0) y += 18;
        if (zz > 8) zz -= 60;
        arr[i] = arr[i]! + Math.sin(this.time * 1.3 + i) * dt * 0.6;
        arr[i + 1] = y;
        arr[i + 2] = zz;
      }
      attr.needsUpdate = true;
      this.snow.position.x = camX;
    }
  }
}
