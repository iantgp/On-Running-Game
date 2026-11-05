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
- **Runners:** pick Lena (Zürich), Noah (Winterthur), Jonas (Basel), Selina (Bern), Amara (Brooklyn) or Kenji (Zermatt) on the menu by swiping or using the arrows. They differ in look only.
- **CloudTec rhythm:** the beat is tied to your stride, so the tempo rises as you speed up. Every jump lasts exactly 2 beats, and obstacles sit on the beat grid. Jump on the beat and you land on the beat.
- **Perfect landing:** a speed boost plus glide charge. Three perfect landings fill the meter; then swipe ↑ again mid-air to **Cloud Glide** over everything.
- **Weather:** a forecast warns you before rain or snow arrives. Tap the matching shoe for grip. In the wrong shoe, lane changes slide around, and puddles or ice make you slip. Two stumbles end the run.
- **Traffic:** blue-and-white ZVV trams and buses drive towards you. Trams ring their bell, buses honk.
- **Zones** change every 450 m:
  - Zürich, Bahnhofstrasse: old-town facades with Swiss and Zürich flags, linden trees, fountains, tram rails and overhead lines, yellow crosswalks, the Grossmünster and St. Peter.
  - Zürich, Seepromenade: the lake, with sailboats, swans and the Alps on the horizon.
  - Swiss Alps, Furka Pass: chalets, pines, cows and snow groomers.
  - New York, Manhattan: skyscrapers with water towers, yellow cabs and food trucks.

## Progression

- **Cloud Pods** are the currency. Glowing pods line the course; rare **eco-tokens** (+10) and **On badges** (+25) are scattered around too.
- **Shoe Locker** (menu): unlock and upgrade shoes up to level 3. You carry one shoe per weather slot, and its perk works while you wear it.

| Slot | Shoe | Unlock | Perk (level 1 / 2 / 3) |
| --- | --- | --- | --- |
| Road ☀️ | Cloudboom | starter | Perfect-landing boost +10 / 20 / 30% |
| Road ☀️ | Cloudmonster | 450 | Glide meter fills 30 / 60 / 100% faster |
| Road ☀️ | Cloudtilt | 350 | Lane changes 20 / 35 / 50% snappier |
| Wet 🌧️ | Cloudrunner WP | starter | 20 / 35 / 50% less speed lost on stumbles |
| Wet 🌧️ | Cloudsurfer | 350 | Pod magnet, 1.6 / 2.4 / 3.2 m |
| Trail ❄️ | Cloudventure | starter | +50 / 100 / 150% eco-tokens |
| Trail ❄️ | Cloudultra | 500 | CloudTec Surge lasts 25 / 50 / 80% longer |

Upgrades cost 200 pods for level 2 and 400 for level 3.

- **CloudTec® Surge:** grab the glowing pod ring. Your shoes' pods inflate and glow, you bounce over everything in automatic on-beat super-jumps, and nearby pods fly to you.
- **Run summary:** a fitness-app style recap with a route trace, distance, average pace, time, CloudTec efficiency (share of on-beat landings), cadence, max speed, elevation gain, splits per location, and pods earned.

## Branding

All brand settings live in `src/config/brand.ts`. The file `public/brand/on-logo.svg` is a stand-in wordmark; replace it with the official logo from On's brand kit. `VITE_NEUTRAL=1 npm run build` produces an unbranded build with generic shoe names.

## Code layout

```
src/
  game.ts            Game loop, simulation (fixed 120 Hz step), generation, collisions
  hud.ts             DOM HUD, beat bar, shoe selector, runner picker, menus
  audio.ts           Procedural WebAudio music (scheduled in beat space) and SFX
  progress.ts        Wallet, shoe unlocks/upgrades, loadout, records (localStorage)
  stats.ts           Run tracker and pace/time formatting for the summary
  config/            Tunables: brand, gameplay, runners, shoes, weather
  sim/rhythm.ts      Landing-judgement windows
  world/
    themes.ts        Zone palettes, zone and lake boundaries, location names
    builder.ts       Merges vertex-coloured primitives into one draw call per model
    obstacles.ts     Obstacle models per zone (trams, buses, fountains, groomers...)
    scenery.ts       Facades, landmarks, street furniture, lake, skylines
    runner.ts        Procedurally animated runner rig
    effects.ts       Particles, speed lines, landing shockwave
    pickups.ts       Cloud Pods (instanced), eco-tokens, badges, Surge power-up
    sky.ts           Gradient sky dome
    textures.ts      Canvas textures (road markings, signs, skylines, labels)
```

Branding lives in `src/config/brand.ts`. During development, `?at=600` starts a run 600 m in and `?god` turns off crashes, and `?surge` triggers a Surge right after the count-in.
