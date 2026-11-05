import type { GripLevel } from './gameplay';
import type { WeatherId } from './weather';

export type ShoeId = 'road' | 'wet' | 'trail';

export interface ShoeColors {
  readonly upper: number;
  readonly accent: number;
  readonly sole: number;
  readonly pods: number;
}

export interface ShoeConfig {
  readonly id: ShoeId;
  /** Model names are placeholders for the concept and can be changed freely here. */
  readonly name: string;
  readonly shortName: string;
  readonly tagline: string;
  readonly bestFor: WeatherId;
  readonly grip: Readonly<Record<WeatherId, GripLevel>>;
  /** Multiplier applied to the PERFECT-landing speed boost. */
  readonly rebound: Readonly<Record<WeatherId, number>>;
  readonly colors: ShoeColors;
}

export const SHOE_ORDER: readonly ShoeId[] = ['road', 'wet', 'trail'];

export const SHOES: Readonly<Record<ShoeId, ShoeConfig>> = {
  road: {
    id: 'road',
    name: 'Cloudboom',
    shortName: 'Cloudboom',
    tagline: 'Race-day rebound for dry streets',
    bestFor: 'dry',
    grip: { dry: 'full', rain: 'low', snow: 'low' },
    rebound: { dry: 1, rain: 0.5, snow: 0.4 },
    colors: { upper: 0xf4f6f2, accent: 0xd4ff3a, sole: 0xffffff, pods: 0xe4e8ec },
  },
  wet: {
    id: 'wet',
    name: 'Cloudrunner Waterproof',
    shortName: 'Cloudrunner WP',
    tagline: 'Sealed upper, wet-grip rubber',
    bestFor: 'rain',
    grip: { dry: 'full', rain: 'full', snow: 'medium' },
    rebound: { dry: 0.7, rain: 1, snow: 0.6 },
    colors: { upper: 0x1f2a3a, accent: 0x38d6ff, sole: 0x2a2f36, pods: 0x8a95a3 },
  },
  trail: {
    id: 'trail',
    name: 'Cloudventure',
    shortName: 'Cloudventure',
    tagline: 'Lugged outsole for snow and ice',
    bestFor: 'snow',
    grip: { dry: 'full', rain: 'medium', snow: 'full' },
    rebound: { dry: 0.6, rain: 0.7, snow: 1 },
    colors: { upper: 0xff6a2b, accent: 0x262a25, sole: 0x3a3d38, pods: 0x2a2c27 },
  },
};

export function bestShoeFor(weather: WeatherId): ShoeId {
  return SHOE_ORDER.find((id) => SHOES[id].bestFor === weather) ?? 'road';
}
