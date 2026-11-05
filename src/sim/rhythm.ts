import { RHYTHM } from '../config/gameplay';

export type Judgement = 'perfect' | 'good' | 'miss';

/** Signed offset (in beats) from the nearest whole beat; negative means early. */
export function beatError(beat: number): number {
  return beat - Math.round(beat);
}

/** Timing windows in beats at a given tempo: fixed in milliseconds, capped as a fraction of a beat. */
export function judgementWindows(beatsPerSecond: number): { perfect: number; good: number } {
  return {
    perfect: Math.min((RHYTHM.perfectMs / 1000) * beatsPerSecond, RHYTHM.perfectMaxBeats),
    good: Math.min((RHYTHM.goodMs / 1000) * beatsPerSecond, RHYTHM.goodMaxBeats),
  };
}

/** Judges a landing that happened `errorBeats` away from the beat. */
export function judgeLanding(errorBeats: number, beatsPerSecond: number): Judgement {
  const windows = judgementWindows(beatsPerSecond);
  const error = Math.abs(errorBeats);
  if (error <= windows.perfect) return 'perfect';
  if (error <= windows.good) return 'good';
  return 'miss';
}
