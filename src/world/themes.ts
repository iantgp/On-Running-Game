import type { WeatherId } from '../config/weather';

export type ZoneKey = 'zurich' | 'alps' | 'newyork';

export interface ZoneTheme {
  readonly key: ZoneKey;
  readonly name: string;
  readonly skyTop: number;
  readonly skyHorizon: number;
  readonly fog: number;
  readonly ground: number;
  readonly road: number;
  readonly sidewalk: number;
  readonly sun: number;
  readonly hemiSky: number;
  readonly hemiGround: number;
  readonly weathers: readonly WeatherId[];
}

/** Metres per zone; the map changes this often. */
export const ZONE_LEN = 450;
/** In Zürich, the second half of the zone runs along the lake. */
export const LAKE_START = 210;

export const ZONE_THEMES: readonly ZoneTheme[] = [
  {
    key: 'zurich',
    name: 'Zürich',
    skyTop: 0x4f9be0,
    skyHorizon: 0xd8ecf8,
    fog: 0xd3e6f3,
    ground: 0x9fa6a3,
    road: 0x585e63,
    sidewalk: 0xc9c4ba,
    sun: 0xfff1d6,
    hemiSky: 0xdfefff,
    hemiGround: 0x8a8578,
    weathers: ['dry', 'rain'],
  },
  {
    key: 'alps',
    name: 'Swiss Alps',
    skyTop: 0x2f7fd8,
    skyHorizon: 0xe4f1fb,
    fog: 0xe6f0f8,
    ground: 0xf3f6f9,
    road: 0x9aa6b1,
    sidewalk: 0xe9eef3,
    sun: 0xffffff,
    hemiSky: 0xeaf4ff,
    hemiGround: 0xb9c6d2,
    weathers: ['snow', 'dry'],
  },
  {
    key: 'newyork',
    name: 'New York',
    skyTop: 0x2b3a66,
    skyHorizon: 0xf3a77a,
    fog: 0xe6b490,
    ground: 0x5d6168,
    road: 0x34373c,
    sidewalk: 0x8e8c88,
    sun: 0xffc48a,
    hemiSky: 0xffd9bd,
    hemiGround: 0x4a3f3a,
    weathers: ['dry', 'rain', 'snow'],
  },
];

export function zoneIndexAt(s: number): number {
  const index = Math.floor(Math.max(0, s) / ZONE_LEN) % ZONE_THEMES.length;
  return index;
}

export function zoneAt(s: number): ZoneTheme {
  return ZONE_THEMES[zoneIndexAt(s)]!;
}

/** Distance into the current zone, in metres. */
export function zoneOffset(s: number): number {
  return Math.max(0, s) % ZONE_LEN;
}

export function isLakeAt(s: number): boolean {
  return zoneAt(s).key === 'zurich' && zoneOffset(s) >= LAKE_START;
}

export function locationAt(s: number): string {
  switch (zoneAt(s).key) {
    case 'zurich':
      return isLakeAt(s) ? 'Seepromenade' : 'Bahnhofstrasse';
    case 'alps':
      return 'Furka Pass';
    default:
      return 'Manhattan';
  }
}
