import type { Judgement } from './sim/rhythm';

export interface Split {
  readonly label: string;
  readonly distance: number;
  readonly time: number;
}

export interface RunReport {
  readonly distance: number;
  readonly time: number;
  /** Seconds per kilometre. */
  readonly pace: number;
  /** Steps per minute (one step per beat). */
  readonly cadence: number;
  /** Share of landings on the beat (perfect = 1, good = 0.6), 0-100; null without landings. */
  readonly efficiency: number | null;
  readonly maxSpeedKmh: number;
  readonly elevation: number;
  readonly maxCombo: number;
  readonly perfects: number;
  readonly goods: number;
  readonly misses: number;
  readonly pods: number;
  readonly ecoTokens: number;
  readonly badges: number;
  readonly surges: number;
  readonly splits: readonly Split[];
}

/** Gradient applied to Alpine stretches for the elevation stat. */
const ALPINE_GRADIENT = 0.07;
const MIN_SPLIT = 20;

/** Collects fitness-style data during a run for the post-run summary. */
export class RunTracker {
  private startDistance = 0;
  private time = 0;
  private distance = 0;
  private maxSpeed = 0;
  private alpineMeters = 0;
  private splitLabel = '';
  private splitDistance = 0;
  private splitTime = 0;
  private splits: Split[] = [];
  perfects = 0;
  goods = 0;
  misses = 0;
  maxCombo = 0;
  pods = 0;
  ecoTokens = 0;
  badges = 0;
  surges = 0;

  reset(startDistance: number, location: string): void {
    this.startDistance = startDistance;
    this.time = 0;
    this.distance = 0;
    this.maxSpeed = 0;
    this.alpineMeters = 0;
    this.splits = [];
    this.splitLabel = location;
    this.splitDistance = 0;
    this.splitTime = 0;
    this.perfects = this.goods = this.misses = this.maxCombo = 0;
    this.pods = this.ecoTokens = this.badges = this.surges = 0;
  }

  tick(dt: number, distance: number, speed: number, location: string, alpine: boolean): void {
    const covered = distance - this.startDistance;
    const step = covered - this.distance;
    this.time += dt;
    this.distance = covered;
    this.maxSpeed = Math.max(this.maxSpeed, speed);
    if (alpine) this.alpineMeters += step;
    if (location !== this.splitLabel) {
      this.closeSplit();
      this.splitLabel = location;
    }
  }

  landing(judgement: Judgement, combo: number): void {
    if (judgement === 'perfect') this.perfects++;
    else if (judgement === 'good') this.goods++;
    else this.misses++;
    this.maxCombo = Math.max(this.maxCombo, combo);
  }

  finish(beatLength: number): RunReport {
    this.closeSplit();
    const landings = this.perfects + this.goods + this.misses;
    return {
      distance: this.distance,
      time: this.time,
      pace: this.distance > 0 ? this.time / (this.distance / 1000) : 0,
      cadence: this.time > 0 ? Math.round(this.distance / beatLength / (this.time / 60)) : 0,
      efficiency: landings > 0 ? Math.round(((this.perfects + this.goods * 0.6) / landings) * 100) : null,
      maxSpeedKmh: this.maxSpeed * 3.6,
      elevation: Math.round(this.alpineMeters * ALPINE_GRADIENT),
      maxCombo: this.maxCombo,
      perfects: this.perfects,
      goods: this.goods,
      misses: this.misses,
      pods: this.pods,
      ecoTokens: this.ecoTokens,
      badges: this.badges,
      surges: this.surges,
      splits: this.splits,
    };
  }

  private closeSplit(): void {
    const d = this.distance - this.splitDistance;
    const t = this.time - this.splitTime;
    if (d >= MIN_SPLIT && t > 0) this.splits.push({ label: this.splitLabel, distance: d, time: t });
    this.splitDistance = this.distance;
    this.splitTime = this.time;
  }
}

/** m:ss, or h:mm:ss for an hour or more. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Pace in m:ss per km. */
export function formatPace(secondsPerKm: number): string {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return '–';
  return formatDuration(secondsPerKm);
}
