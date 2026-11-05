export type RunnerId = 'lena' | 'noah' | 'amara' | 'kenji';
export type HairStyle = 'ponytail' | 'short' | 'bun' | 'cap';

export interface RunnerLook {
  readonly skin: number;
  readonly hair: number;
  readonly hairStyle: HairStyle;
  readonly top: number;
  readonly accent: number;
  readonly shorts: number;
  readonly socks: number;
}

export interface RunnerConfig {
  readonly id: RunnerId;
  readonly name: string;
  readonly hometown: string;
  readonly look: RunnerLook;
}

/** Selectable runners. They differ in look only, so every choice plays the same. */
export const RUNNERS: readonly RunnerConfig[] = [
  {
    id: 'lena',
    name: 'Lena',
    hometown: 'Zürich',
    look: { skin: 0xf1c9a5, hair: 0xc9964f, hairStyle: 'ponytail', top: 0xf4f6f2, accent: 0xd4ff3a, shorts: 0x1b1e23, socks: 0xffffff },
  },
  {
    id: 'noah',
    name: 'Noah',
    hometown: 'Winterthur',
    look: { skin: 0xc68c64, hair: 0x2a211c, hairStyle: 'short', top: 0x1560bd, accent: 0xffffff, shorts: 0x14171c, socks: 0x1560bd },
  },
  {
    id: 'amara',
    name: 'Amara',
    hometown: 'Brooklyn',
    look: { skin: 0x7b4a31, hair: 0x15110f, hairStyle: 'bun', top: 0xff6a2b, accent: 0x16181c, shorts: 0x2a2d33, socks: 0xffffff },
  },
  {
    id: 'kenji',
    name: 'Kenji',
    hometown: 'Zermatt',
    look: { skin: 0xe2b68e, hair: 0x101010, hairStyle: 'cap', top: 0x16181c, accent: 0x38d6ff, shorts: 0x16181c, socks: 0x38d6ff },
  },
];

export function runnerById(id: string | null): RunnerConfig {
  return RUNNERS.find((r) => r.id === id) ?? RUNNERS[0]!;
}
