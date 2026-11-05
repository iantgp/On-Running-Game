/**
 * Gameplay tunables, kept in one place so the game can be balanced without touching logic.
 *
 * Units are metres, seconds and beats. Track space is described by
 *   s – distance along the course (forward is +),
 *   x – lateral offset from the centre lane (right is +),
 *   y – height above the road.
 *
 * The rhythm is locked to distance: every zone has a fixed stride (metres per beat), so
 * the tempo rises and falls with running speed and obstacles placed on the beat grid
 * always arrive on the beat, whatever the speed.
 */

/** Fixed simulation rate; physics and collisions run at this rate regardless of display refresh. */
export const SIM_HZ = 120;
export const SIM_STEP = 1 / SIM_HZ;

export const LANES = {
  count: 3,
  width: 2.4,
} as const;

export const START_LANE = 1;

/** Lateral centre of a lane, in metres. */
export function laneToX(lane: number): number {
  return (lane - (LANES.count - 1) / 2) * LANES.width;
}

export const SPEED = {
  /** Base speed at the start of a run (m/s). */
  start: 11.5,
  /** Asymptotic base speed (m/s). */
  max: 20,
  /** Distance over which the base speed closes ~63% of the gap to `max`. */
  rampDistance: 4200,
  /** Jog speed used behind the menu. */
  attract: 7.5,
  /** Fractional speed boost from a PERFECT landing, scaled by the shoe's rebound. */
  boostPerPerfect: 0.08,
  boostMax: 0.2,
  /** Time constant of the boost's exponential decay (s). */
  boostDecaySec: 1.2,
  /** Fraction of speed lost on a stumble; recovers linearly. */
  stumblePenalty: 0.25,
  stumbleRecoverySec: 1.8,
} as const;

export const PLAYER = {
  width: 0.7,
  depth: 0.5,
  height: 1.7,
  slideHeight: 0.75,
  /** A jump always lasts exactly this many beats: take off on the beat, land on the beat. */
  jumpBeats: 2,
  jumpHeight: 1.55,
  slideBeats: 2,
  /** Downward speed of a fast-fall (swipe down mid-air), m/s. */
  slamSpeed: 22,
  /** A jump pressed this close (in beats) before touchdown is buffered into a rebound jump. */
  jumpBufferBeats: 0.4,
  glideBeats: 6,
  glideHeight: 4.2,
  glideRiseBeats: 0.75,
  glideFallBeats: 1.5,
  stumbleSec: 0.7,
  /** Two stumbles inside this window end the run. */
  strikeWindowSec: 7,
  /** Lateral push when bouncing off the side of an obstacle (m/s). */
  bounceImpulse: 5,
} as const;

export type GripLevel = 'low' | 'medium' | 'full';

export const GRIP_RANK: Readonly<Record<GripLevel, number>> = { low: 0, medium: 1, full: 2 };

/** Lateral (lane change) spring per grip level: natural frequency (rad/s) and damping ratio. */
export const GRIP_DYNAMICS: Readonly<Record<GripLevel, { omega: number; zeta: number }>> = {
  full: { omega: 24, zeta: 1 },
  medium: { omega: 16, zeta: 0.62 },
  low: { omega: 11, zeta: 0.32 },
};

export const RHYTHM = {
  perfectMs: 80,
  perfectMaxBeats: 0.22,
  goodMs: 165,
  goodMaxBeats: 0.42,
  /** Upper bound for input-lateness compensation (ms). */
  maxCompensationMs: 150,
  /** Beats of warning before a weather change. */
  forecastBeats: 8,
} as const;

/** Glide meter gained per landing (1 = full). */
export const GLIDE_CHARGE = { perfect: 0.25, good: 0.1 } as const;

export const SCORE = {
  pointsPerMeter: 1,
  cloud: 10,
  perfect: 50,
  good: 20,
  comboPerMultiplier: 4,
  maxMultiplier: 10,
} as const;

export const OBSTACLE_SIZE = {
  low: { width: 2.0, y0: 0, y1: 0.85, depth: 0.5 },
  high: { width: 2.2, y0: 1.15, y1: 3.4, depth: 0.6 },
  /** Blocks cover their rows plus `coverBeats` either side. */
  block: { width: 2.05, y0: 0, y1: 3.4, coverBeats: 0.4 },
} as const;

export const CLOUD = { radius: 0.55, groundY: 0.95, slideY: 0.5, bodyOffsetY: 0.95 } as const;

export const HAZARD = { width: 2.0, halfLengthBeats: 0.42 } as const;

export const TRACK = {
  spawnHorizon: 150,
  despawnBehind: 15,
  introBars: 4,
  /** Beats of tunnel either side of a zone boundary. */
  tunnelBeats: 8,
  /** Calm bars (no obstacles) before a tunnel entrance and after its exit. */
  calmBarsAroundTunnel: 1,
  /** Difficulty reaches 1 at this distance (m). */
  difficultyDistance: 3600,
  /** Hazards appear only once the weather has held for this many beats. */
  hazardGraceBeats: 4,
} as const;
