/**
 * Deterministic random numbers. The simulation only ever uses seeded generators so
 * that a run can be reproduced exactly (tests, debugging, shared seeds).
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Picks an item proportionally to its weight. Non-positive weights are ignored. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T;
}

/** Mulberry32: tiny, fast and good enough for gameplay randomness. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('Cannot pick from an empty list');
      return items[Math.floor(next() * items.length)] as T;
    },
    weighted: <T>(entries: readonly (readonly [T, number])[]): T => {
      let total = 0;
      for (const [, weight] of entries) total += Math.max(0, weight);
      if (total <= 0) throw new Error('Weighted pick needs at least one positive weight');
      let roll = next() * total;
      for (const [item, weight] of entries) {
        if (weight <= 0) continue;
        roll -= weight;
        if (roll < 0) return item;
      }
      // Floating point fallthrough: return the last positive entry.
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i] as readonly [T, number];
        if (entry[1] > 0) return entry[0];
      }
      throw new Error('Unreachable');
    },
  };
}

/** Combines integers into a well-mixed 32-bit seed (order sensitive). */
export function hashSeed(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const value of values) {
    h ^= value >>> 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

/** Non-deterministic seed for a fresh run. */
export function randomSeed(): number {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    return cryptoApi.getRandomValues(new Uint32Array(1))[0] as number;
  }
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}
