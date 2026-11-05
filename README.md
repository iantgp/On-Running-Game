# CloudTec Infinite Runner (prototype)

A mobile-first, three-lane rhythm runner. You run from Zürich through the Swiss Alps to New York.

## Play

```bash
npm ci
npm run dev:host   # open the printed network URL on your phone (same Wi-Fi)
```

`npm run build` writes a static site to `dist/`, which you can host anywhere (for example on GitHub Pages).

## How it plays

- **Swipe** ← → to switch lanes, ↑ to jump, ↓ to slide (swipe ↓ in mid-air to fast-fall). On a keyboard: arrows/WASD, Space, 1/2/3 for shoes, P to pause.
- **CloudTec rhythm:** the beat is tied to your stride, so the tempo rises as you speed up. Every jump lasts exactly 2 beats, and obstacles sit on the beat grid. Jump on the beat and you land on the beat.
- **Perfect landing:** a speed boost plus glide charge. Four perfect landings fill the meter; then swipe ↑ again mid-air to **Cloud Glide** over everything.
- **Weather:** a forecast warns you before rain or snow arrives. Tap the matching shoe for grip. In the wrong shoe, lane changes slide around, and puddles or ice make you slip. Two stumbles end the run.
  - Cloudboom: dry roads, biggest rebound
  - Cloudrunner WP: rain
  - Cloudventure: snow and ice

## Code layout

- `src/game.ts`: simulation (fixed 120 Hz step), procedural Three.js world and runner, and the game loop.
- `src/hud.ts`: DOM HUD, beat bar, shoe selector and menus.
- `src/audio.ts`: procedural WebAudio music, scheduled in beat space, plus sound effects.
- `src/config/*`: tunables for shoes, weather, zones and gameplay.
- `src/sim/rhythm.ts`: landing-judgement windows.
