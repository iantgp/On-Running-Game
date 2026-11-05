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
- **Runners:** pick Lena, Noah, Amara or Kenji on the menu by swiping or using the arrows. They differ in look only.
- **CloudTec rhythm:** the beat is tied to your stride, so the tempo rises as you speed up. Every jump lasts exactly 2 beats, and obstacles sit on the beat grid. Jump on the beat and you land on the beat.
- **Perfect landing:** a speed boost plus glide charge. Three perfect landings fill the meter; then swipe ↑ again mid-air to **Cloud Glide** over everything.
- **Weather:** a forecast warns you before rain or snow arrives. Tap the matching shoe for grip. In the wrong shoe, lane changes slide around, and puddles or ice make you slip. Two stumbles end the run.
- **Traffic:** blue-and-white ZVV trams and buses drive towards you. Trams ring their bell, buses honk.
- **Zones** change every 450 m:
  - Zürich, Bahnhofstrasse: old-town facades with Swiss and Zürich flags, linden trees, fountains, tram rails and overhead lines, yellow crosswalks, the Grossmünster and St. Peter.
  - Zürich, Seepromenade: the lake, with sailboats, swans and the Alps on the horizon.
  - Swiss Alps, Furka Pass: chalets, pines, cows and snow groomers.
  - New York, Manhattan: skyscrapers with water towers, yellow cabs and food trucks.

## Code layout

```
src/
  game.ts            Game loop, simulation (fixed 120 Hz step), generation, collisions
  hud.ts             DOM HUD, beat bar, shoe selector, runner picker, menus
  audio.ts           Procedural WebAudio music (scheduled in beat space) and SFX
  config/            Tunables: brand, gameplay, runners, shoes, weather
  sim/rhythm.ts      Landing-judgement windows
  world/
    themes.ts        Zone palettes, zone and lake boundaries, location names
    builder.ts       Merges vertex-coloured primitives into one draw call per model
    obstacles.ts     Obstacle models per zone (trams, buses, fountains, groomers...)
    scenery.ts       Facades, landmarks, street furniture, lake, skylines
    runner.ts        Procedurally animated runner rig
    effects.ts       Particles, speed lines, landing shockwave
    sky.ts           Gradient sky dome
    textures.ts      Canvas textures (road markings, signs, skylines, labels)
```

Branding lives in `src/config/brand.ts`. During development, `?at=600` starts a run 600 m in and `?god` turns off crashes.
