/**
 * Branding (school project, non-commercial).
 *
 * Build with `VITE_NEUTRAL=1` to produce an unbranded copy (generic names, no logo).
 * Drop the official logo file from the brand kit into `public/brand/on-logo.svg`;
 * the bundled file is a stand-in wordmark.
 */
const NEUTRAL = import.meta.env.VITE_NEUTRAL === '1';

export const BRAND = {
  neutral: NEUTRAL,
  /** Wordmark used on banners, badges and the runner's shirt. */
  mark: NEUTRAL ? '' : 'On',
  /** Game title shown on the menu. */
  title: NEUTRAL ? 'Cloud Pod' : 'CloudTec',
  /** Name of the cushioning tech used in copy (power-up, efficiency stat). */
  tech: NEUTRAL ? 'Cloud Pod' : 'CloudTec®',
  /** Logo image for the menu and run summary. */
  logoUrl: NEUTRAL ? '' : './brand/on-logo.svg',
  /** Operator name painted on the blue/white city buses. */
  busOperator: 'ZVV',
  /** Monochrome brand palette with one signal colour for feedback. */
  colors: { ink: '#000000', paper: '#ffffff', signal: '#d4ff3a' },
} as const;
