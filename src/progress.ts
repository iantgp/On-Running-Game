import { MAX_LEVEL, SHOES, SHOE_IDS, STARTER_LOADOUT, upgradeCost, type ShoeId, type ShoeSlot } from './config/shoes';

const STORAGE_KEY = 'cloudtec.progress.v1';
const LEGACY_BEST_KEY = 'cloudtec.best';

export interface ProgressState {
  /** Cloud Pods available to spend. */
  pods: number;
  ecoTokens: number;
  badges: number;
  /** Shoe level: 0 = locked, 1-3 = owned and upgraded. */
  levels: Record<ShoeId, number>;
  loadout: Record<ShoeSlot, ShoeId>;
  best: number;
  bestDistance: number;
  runs: number;
  totalDistance: number;
}

function defaults(): ProgressState {
  const levels = Object.fromEntries(SHOE_IDS.map((id) => [id, SHOES[id].cost === 0 ? 1 : 0])) as Record<ShoeId, number>;
  return { pods: 0, ecoTokens: 0, badges: 0, levels, loadout: { ...STARTER_LOADOUT }, best: 0, bestDistance: 0, runs: 0, totalDistance: 0 };
}

const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback);

/** Rebuilds a valid state from whatever was stored, ignoring anything malformed. */
export function sanitizeProgress(raw: unknown): ProgressState {
  const state = defaults();
  if (!raw || typeof raw !== 'object') return state;
  const r = raw as Record<string, unknown>;
  state.pods = Math.floor(num(r.pods, 0));
  state.ecoTokens = Math.floor(num(r.ecoTokens, 0));
  state.badges = Math.floor(num(r.badges, 0));
  state.best = Math.floor(num(r.best, 0));
  state.bestDistance = num(r.bestDistance, 0);
  state.runs = Math.floor(num(r.runs, 0));
  state.totalDistance = num(r.totalDistance, 0);
  if (r.levels && typeof r.levels === 'object') {
    const levels = r.levels as Record<string, unknown>;
    for (const id of SHOE_IDS) {
      const level = Math.floor(num(levels[id], state.levels[id]));
      state.levels[id] = Math.min(MAX_LEVEL, Math.max(state.levels[id], level));
    }
  }
  if (r.loadout && typeof r.loadout === 'object') {
    const loadout = r.loadout as Record<string, unknown>;
    for (const slot of Object.keys(state.loadout) as ShoeSlot[]) {
      const id = loadout[slot];
      if (typeof id === 'string' && id in SHOES && SHOES[id as ShoeId].slot === slot && state.levels[id as ShoeId] > 0) {
        state.loadout[slot] = id as ShoeId;
      }
    }
  }
  return state;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Player progression: Cloud Pod wallet, shoe unlocks and upgrades, loadout and records. */
export class Progress {
  private s: ProgressState;

  constructor(private readonly storage: Storage | null = safeStorage()) {
    this.s = this.load();
  }

  get state(): Readonly<ProgressState> {
    return this.s;
  }

  level(id: ShoeId): number {
    return this.s.levels[id];
  }

  unlock(id: ShoeId): boolean {
    const cost = SHOES[id].cost;
    if (this.s.levels[id] > 0 || this.s.pods < cost) return false;
    this.s.pods -= cost;
    this.s.levels[id] = 1;
    this.s.loadout[SHOES[id].slot] = id;
    this.save();
    return true;
  }

  upgrade(id: ShoeId): boolean {
    const level = this.s.levels[id];
    const cost = upgradeCost(level);
    if (level < 1 || level >= MAX_LEVEL || this.s.pods < cost) return false;
    this.s.pods -= cost;
    this.s.levels[id] = level + 1;
    this.save();
    return true;
  }

  equip(id: ShoeId): boolean {
    if (this.s.levels[id] < 1) return false;
    this.s.loadout[SHOES[id].slot] = id;
    this.save();
    return true;
  }

  /** Banks a finished run. Returns whether it set a new best score. */
  addRun(run: { score: number; distance: number; pods: number; ecoTokens: number; badges: number }): boolean {
    const newBest = run.score > this.s.best;
    this.s.pods += run.pods;
    this.s.ecoTokens += run.ecoTokens;
    this.s.badges += run.badges;
    this.s.best = Math.max(this.s.best, Math.floor(run.score));
    this.s.bestDistance = Math.max(this.s.bestDistance, run.distance);
    this.s.runs += 1;
    this.s.totalDistance += run.distance;
    this.save();
    return newBest;
  }

  private load(): ProgressState {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      const state = sanitizeProgress(raw ? JSON.parse(raw) : null);
      const legacyBest = Number(this.storage?.getItem(LEGACY_BEST_KEY) ?? 0);
      if (Number.isFinite(legacyBest) && legacyBest > state.best) state.best = Math.floor(legacyBest);
      return state;
    } catch {
      return defaults();
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.s));
    } catch {
      /* storage unavailable (private mode); progress lasts for this session only */
    }
  }
}
