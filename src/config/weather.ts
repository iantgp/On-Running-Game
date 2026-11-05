import type { GripLevel } from './gameplay';

export type WeatherId = 'dry' | 'rain' | 'snow';
export type HazardKind = 'puddle' | 'ice';

export interface WeatherConfig {
  readonly id: WeatherId;
  readonly label: string;
  /** Road hazard that spawns in this weather, if any. */
  readonly hazard: HazardKind | null;
}

export const WEATHER: Readonly<Record<WeatherId, WeatherConfig>> = {
  dry: { id: 'dry', label: 'Clear', hazard: null },
  rain: { id: 'rain', label: 'Rain', hazard: 'puddle' },
  snow: { id: 'snow', label: 'Snow', hazard: 'ice' },
};

/** Minimum shoe grip needed to cross a hazard without slipping. */
export const HAZARD_MIN_GRIP: Readonly<Record<HazardKind, GripLevel>> = {
  puddle: 'medium',
  ice: 'full',
};
