import { BRAND } from './brand';
import type { GripLevel } from './gameplay';
import type { WeatherId } from './weather';

export type ShoeId = 'cloudboom' | 'cloudmonster' | 'cloudtilt' | 'cloudrunner' | 'cloudsurfer' | 'cloudventure' | 'cloudultra';

/** Loadout slots. Each slot suits one weather; you carry one shoe per slot into a run. */
export type ShoeSlot = 'road' | 'wet' | 'trail';

export type PerkId = 'rebound' | 'bounce' | 'agility' | 'weatherproof' | 'magnet' | 'trailsense' | 'endurance';

export interface ShoeColors {
  readonly upper: number;
  readonly accent: number;
  readonly sole: number;
  readonly pods: number;
}

export interface ShoeConfig {
  readonly id: ShoeId;
  readonly name: string;
  /** Generic name used in the unbranded build. */
  readonly alias: string;
  readonly slot: ShoeSlot;
  readonly tagline: string;
  readonly perk: PerkId;
  /** Cloud Pods needed to unlock; 0 for starter shoes. */
  readonly cost: number;
  readonly colors: ShoeColors;
}

export interface PerkConfig {
  readonly name: string;
  /** Perk strength at levels 1, 2 and 3. */
  readonly values: readonly [number, number, number];
  readonly describe: (value: number) => string;
}

export const MAX_LEVEL = 3;
export const SLOT_ORDER: readonly ShoeSlot[] = ['road', 'wet', 'trail'];

export const SLOT_INFO: Readonly<Record<ShoeSlot, { label: string; weather: WeatherId; icon: string }>> = {
  road: { label: 'Road', weather: 'dry', icon: '☀️' },
  wet: { label: 'Wet', weather: 'rain', icon: '🌧️' },
  trail: { label: 'Trail', weather: 'snow', icon: '❄️' },
};

const SLOT_GRIP: Readonly<Record<ShoeSlot, Record<WeatherId, GripLevel>>> = {
  road: { dry: 'full', rain: 'low', snow: 'low' },
  wet: { dry: 'full', rain: 'full', snow: 'medium' },
  trail: { dry: 'full', rain: 'medium', snow: 'full' },
};

const SLOT_REBOUND: Readonly<Record<ShoeSlot, Record<WeatherId, number>>> = {
  road: { dry: 1, rain: 0.5, snow: 0.4 },
  wet: { dry: 0.7, rain: 1, snow: 0.6 },
  trail: { dry: 0.6, rain: 0.7, snow: 1 },
};

const pct = (v: number): string => `${Math.round(v * 100)}%`;

export const PERKS: Readonly<Record<PerkId, PerkConfig>> = {
  rebound: { name: 'Race rebound', values: [0.1, 0.2, 0.3], describe: (v) => `+${pct(v)} speed boost from perfect landings` },
  bounce: { name: 'Max bounce', values: [0.3, 0.6, 1.0], describe: (v) => `Glide meter fills ${pct(v)} faster` },
  agility: { name: 'Agility', values: [0.2, 0.35, 0.5], describe: (v) => `${pct(v)} snappier lane changes` },
  weatherproof: { name: 'Weatherproof', values: [0.2, 0.35, 0.5], describe: (v) => `${pct(v)} less speed lost when you stumble` },
  magnet: { name: 'Pod magnet', values: [1.6, 2.4, 3.2], describe: (v) => `Pulls in Cloud Pods within ${v.toFixed(1)} m` },
  trailsense: { name: 'Trail sense', values: [0.5, 1, 1.5], describe: (v) => `+${pct(v)} eco-tokens on the course` },
  endurance: { name: 'Endurance', values: [0.25, 0.5, 0.8], describe: (v) => `${BRAND.tech} Surge lasts ${pct(v)} longer` },
};

export const SHOES: Readonly<Record<ShoeId, ShoeConfig>> = {
  cloudboom: {
    id: 'cloudboom', name: 'Cloudboom', alias: 'Racer', slot: 'road', perk: 'rebound', cost: 0,
    tagline: 'Race-day rebound for dry streets',
    colors: { upper: 0xf4f6f2, accent: 0xd4ff3a, sole: 0xffffff, pods: 0xe4e8ec },
  },
  cloudmonster: {
    id: 'cloudmonster', name: 'Cloudmonster', alias: 'Bouncer', slot: 'road', perk: 'bounce', cost: 450,
    tagline: 'Maximum cushioning, maximum bounce',
    colors: { upper: 0x121316, accent: 0xff5a1f, sole: 0xf2f2f2, pods: 0xffffff },
  },
  cloudtilt: {
    id: 'cloudtilt', name: 'Cloudtilt', alias: 'Tilt', slot: 'road', perk: 'agility', cost: 350,
    tagline: 'Soft, agile and quick off the line',
    colors: { upper: 0xd9dbe0, accent: 0xa995ff, sole: 0xf5f5f7, pods: 0xc9c2ff },
  },
  cloudrunner: {
    id: 'cloudrunner', name: 'Cloudrunner Waterproof', alias: 'Rain Shell', slot: 'wet', perk: 'weatherproof', cost: 0,
    tagline: 'Sealed upper, wet-grip rubber',
    colors: { upper: 0x1f2a3a, accent: 0x38d6ff, sole: 0x2a2f36, pods: 0x8a95a3 },
  },
  cloudsurfer: {
    id: 'cloudsurfer', name: 'Cloudsurfer', alias: 'Wave', slot: 'wet', perk: 'magnet', cost: 350,
    tagline: 'Smooth roll, pulls in every pod',
    colors: { upper: 0xf2f4f7, accent: 0x2fd1c4, sole: 0xe9eef2, pods: 0x9fe8e1 },
  },
  cloudventure: {
    id: 'cloudventure', name: 'Cloudventure', alias: 'Trail Grip', slot: 'trail', perk: 'trailsense', cost: 0,
    tagline: 'Lugged outsole for snow and ice',
    colors: { upper: 0xff6a2b, accent: 0x262a25, sole: 0x3a3d38, pods: 0x2a2c27 },
  },
  cloudultra: {
    id: 'cloudultra', name: 'Cloudultra', alias: 'Ultra', slot: 'trail', perk: 'endurance', cost: 500,
    tagline: 'Rugged comfort for the long haul',
    colors: { upper: 0x56653a, accent: 0xe6ff3f, sole: 0x2c3127, pods: 0x9aa77a },
  },
};

export const SHOE_IDS = Object.keys(SHOES) as ShoeId[];

export const STARTER_LOADOUT: Readonly<Record<ShoeSlot, ShoeId>> = { road: 'cloudboom', wet: 'cloudrunner', trail: 'cloudventure' };

export function shoeName(id: ShoeId): string {
  return BRAND.neutral ? SHOES[id].alias : SHOES[id].name;
}

export function shortShoeName(id: ShoeId): string {
  return BRAND.neutral ? SHOES[id].alias : SHOES[id].name.replace(' Waterproof', ' WP');
}

export function shoeGrip(id: ShoeId, weather: WeatherId): GripLevel {
  return SLOT_GRIP[SHOES[id].slot][weather];
}

export function shoeRebound(id: ShoeId, weather: WeatherId): number {
  return SLOT_REBOUND[SHOES[id].slot][weather];
}

export function slotFor(weather: WeatherId): ShoeSlot {
  return weather === 'rain' ? 'wet' : weather === 'snow' ? 'trail' : 'road';
}

/** Perk strength for a shoe at a level (1-3); 0 when locked. */
export function perkValue(id: ShoeId, level: number): number {
  if (level < 1) return 0;
  return PERKS[SHOES[id].perk].values[Math.min(MAX_LEVEL, level) - 1]!;
}

/** Cloud Pods needed to go from `level` to `level + 1`. */
export function upgradeCost(level: number): number {
  return level * 200;
}
