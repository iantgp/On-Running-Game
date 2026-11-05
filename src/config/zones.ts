import type { WeatherId } from './weather';

export type ZoneId = 'zurich' | 'alps' | 'newyork';

export interface ZoneWeatherPlan {
  /** Weather at the start of the zone. */
  readonly opening: WeatherId;
  /** Relative likelihood of each weather for later spells. */
  readonly weights: Readonly<Partial<Record<WeatherId, number>>>;
  /** Length range of a weather spell, in bars. */
  readonly spanBars: readonly [number, number];
}

export interface ZoneConfig {
  readonly id: ZoneId;
  readonly name: string;
  readonly locale: string;
  /** Zone length in bars (4 beats each), including the tunnel into the next zone. */
  readonly bars: number;
  /** Tempo at the zone entrance; it then rises with running speed. */
  readonly bpm: number;
  readonly weather: ZoneWeatherPlan;
}

/** The run tours these zones in order and then starts the next, faster lap. */
export const ZONE_ORDER: readonly ZoneId[] = ['zurich', 'alps', 'newyork'];

export const ZONES: Readonly<Record<ZoneId, ZoneConfig>> = {
  zurich: {
    id: 'zurich',
    name: 'Zürich',
    locale: 'Bahnhofstrasse',
    bars: 32,
    bpm: 156,
    weather: { opening: 'dry', weights: { dry: 1, rain: 1.5 }, spanBars: [6, 10] },
  },
  alps: {
    id: 'alps',
    name: 'Swiss Alps',
    locale: 'Furka Pass',
    bars: 40,
    bpm: 150,
    weather: { opening: 'snow', weights: { snow: 1.6, dry: 0.7 }, spanBars: [6, 12] },
  },
  newyork: {
    id: 'newyork',
    name: 'New York',
    locale: 'Manhattan',
    bars: 44,
    bpm: 162,
    weather: { opening: 'dry', weights: { dry: 1, rain: 1.3, snow: 0.5 }, spanBars: [6, 10] },
  },
};
