import { BRAND } from './config/brand';
import type { RunnerConfig } from './config/runners';
import { SHOES, SHOE_ORDER, type ShoeId } from './config/shoes';
import type { WeatherId } from './config/weather';
import type { Judgement } from './sim/rhythm';

const WEATHER_ICON: Record<WeatherId, string> = { dry: '☀️', rain: '🌧️', snow: '❄️' };
const TICKS_PER_SIDE = 4;
const TICK_SPAN_BEATS = 3;

export interface HudHandlers {
  onPlay(): void;
  onShoe(shoe: ShoeId): void;
  onPause(): void;
  onRunner(direction: -1 | 1): void;
  onMenu(): void;
}

export interface HudFrame {
  score: number;
  multiplier: number;
  clouds: number;
  zone: string;
  location: string;
  nextZone: string;
  /** 0..1 progress through the current zone. */
  zoneProgress: number;
  distance: number;
  bpm: number;
  beat: number;
  landingBeat: number | null;
  glideCharge: number;
  shoe: ShoeId;
  lowGrip: boolean;
}

export interface RunSummary {
  score: number;
  distance: number;
  clouds: number;
  perfects: number;
  maxCombo: number;
  zone: string;
  best: number;
  newBest: boolean;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** DOM overlay: HUD, beat bar, shoe selector, runner picker and menu screens. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly over: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly multEl: HTMLElement;
  private readonly cloudsEl: HTMLElement;
  private readonly zoneEl: HTMLElement;
  private readonly zoneFill: HTMLElement;
  private readonly nextEl: HTMLElement;
  private readonly msgEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly forecastEl: HTMLElement;
  private readonly cardEl: HTMLElement;
  private readonly gripEl: HTMLElement;
  private readonly podEl: HTMLElement;
  private readonly glideEl: HTMLElement;
  private readonly glideFill: HTMLElement;
  private readonly ticks: HTMLElement[] = [];
  private readonly shoeButtons = new Map<ShoeId, HTMLButtonElement>();
  private barHalfWidth = 160;
  private msgTimer = 0;
  private hintTimer = 0;
  private forecastTimer = 0;
  private cardTimer = 0;
  private last = { score: -1, mult: -1, clouds: -1, zone: '', next: '' };

  constructor(root: HTMLElement, handlers: HudHandlers) {
    this.root = root;
    // Static markup only; all dynamic values are written with textContent.
    root.innerHTML = `
      <div class="vignette"></div>
      <div class="hud hidden">
        <div class="top">
          <div class="left glass">
            <div class="score">0</div>
            <div class="sub zone"></div>
            <div class="zonebar"><i></i></div>
            <div class="sub next"></div>
          </div>
          <div class="right">
            <button class="pause glass" aria-label="Pause">II</button>
            <div class="pill glass">☁ <span class="clouds">0</span></div>
            <div class="pill glass mult">x1</div>
          </div>
        </div>
        <div class="forecast glass"></div>
        <div class="zonecard"><small></small><b></b></div>
        <div class="center-msg"></div>
        <div class="hint"></div>
        <div class="bottom">
          <div class="grip"></div>
          <div class="beatbar"><div class="glide"><i></i></div><div class="line"></div><div class="pod"></div></div>
          <div class="shoes"></div>
        </div>
      </div>
      <div class="screen menu">
        <div class="menu-top">
          <div class="brand"></div>
          <div class="title"><b class="game-title"></b><span>INFINITE RUNNER</span></div>
          <div class="route">Zürich · Swiss Alps · New York</div>
        </div>
        <div class="menu-bottom">
          <div class="picker glass">
            <button class="arrow prev" aria-label="Previous runner">‹</button>
            <div class="runner-name"><b></b><small></small></div>
            <button class="arrow next-runner" aria-label="Next runner">›</button>
          </div>
          <button class="play">RUN</button>
          <button class="link howto-toggle">How to play</button>
          <div class="howto glass hidden">
            <p><b>Swipe</b> ← → to switch lanes, ↑ to jump, ↓ to slide.</p>
            <p><b>Land on the beat</b> for a PERFECT rebound: speed boost and glide charge.</p>
            <p><b>Glide:</b> when the meter is full, swipe ↑ again mid-air.</p>
            <p><b>Weather:</b> tap the right shoe for grip, or slip on puddles and ice.</p>
            <p><b>Trams and buses</b> drive towards you. Listen for the bell.</p>
            <p class="sub">Keys: arrows / WASD · Space · 1 2 3 shoes · P pause</p>
          </div>
          <div class="best"></div>
        </div>
      </div>
      <div class="screen over hidden">
        <div class="over-card glass">
          <div class="over-title">Run complete</div>
          <div class="final-score"></div>
          <div class="best newbest"></div>
          <div class="stats"></div>
          <button class="play">RUN AGAIN</button>
          <button class="link to-menu">Change runner</button>
        </div>
      </div>`;

    const q = <T extends HTMLElement>(sel: string): T => {
      const found = root.querySelector<T>(sel);
      if (!found) throw new Error(`HUD element missing: ${sel}`);
      return found;
    };
    this.hud = q('.hud');
    this.menu = q('.menu');
    this.over = q('.over');
    this.scoreEl = q('.score');
    this.multEl = q('.mult');
    this.cloudsEl = q('.clouds');
    this.zoneEl = q('.zone');
    this.zoneFill = q('.zonebar i');
    this.nextEl = q('.next');
    this.msgEl = q('.center-msg');
    this.hintEl = q('.hint');
    this.forecastEl = q('.forecast');
    this.cardEl = q('.zonecard');
    this.gripEl = q('.grip');
    this.podEl = q('.pod');
    this.glideEl = q('.glide');
    this.glideFill = q('.glide i');

    const brand = q('.brand');
    brand.textContent = BRAND.mark;
    brand.hidden = BRAND.mark.length === 0;
    q('.game-title').textContent = BRAND.title;

    const bar = q('.beatbar');
    for (let i = 0; i < TICKS_PER_SIDE * 2; i++) {
      const tick = document.createElement('div');
      tick.className = 'tick';
      bar.insertBefore(tick, this.podEl);
      this.ticks.push(tick);
    }
    const measure = (): void => {
      this.barHalfWidth = bar.clientWidth / 2 || 160;
    };
    window.addEventListener('resize', measure);
    requestAnimationFrame(measure);

    const shoes = q('.shoes');
    SHOE_ORDER.forEach((id, index) => {
      const cfg = SHOES[id];
      const button = document.createElement('button');
      button.className = 'shoe glass';
      button.setAttribute('aria-label', `Switch to ${cfg.name}`);
      const swatch = document.createElement('span');
      swatch.className = 'sw';
      swatch.style.background = `linear-gradient(90deg, ${hex(cfg.colors.upper)} 68%, ${hex(cfg.colors.accent)} 68%)`;
      const name = document.createElement('span');
      name.className = 'shoe-name';
      name.textContent = cfg.shortName;
      const meta = document.createElement('span');
      meta.className = 'wx';
      meta.textContent = `${WEATHER_ICON[cfg.bestFor]} ${index + 1}`;
      button.append(swatch, name, meta);
      button.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        handlers.onShoe(id);
      });
      shoes.append(button);
      this.shoeButtons.set(id, button);
    });

    const click = (el: HTMLElement, fn: () => void): void =>
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
    root.querySelectorAll<HTMLButtonElement>('.play').forEach((b) => click(b, handlers.onPlay));
    click(q('.prev'), () => handlers.onRunner(-1));
    click(q('.next-runner'), () => handlers.onRunner(1));
    click(q('.to-menu'), handlers.onMenu);
    click(q('.howto-toggle'), () => q('.howto').classList.toggle('hidden'));
    q('.pause').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      handlers.onPause();
    });
  }

  showMenu(best: number, runner: RunnerConfig): void {
    this.menu.classList.remove('hidden');
    this.over.classList.add('hidden');
    this.hud.classList.add('hidden');
    this.root.querySelector('.best')!.textContent = best > 0 ? `Best ${best.toLocaleString()}` : '';
    this.setRunner(runner);
  }

  setRunner(runner: RunnerConfig): void {
    const el = this.root.querySelector('.runner-name')!;
    el.querySelector('b')!.textContent = runner.name;
    el.querySelector('small')!.textContent = `from ${runner.hometown}`;
  }

  showRun(): void {
    this.menu.classList.add('hidden');
    this.over.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.last = { score: -1, mult: -1, clouds: -1, zone: '', next: '' };
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  showGameOver(summary: RunSummary): void {
    this.over.classList.remove('hidden');
    this.over.querySelector('.final-score')!.textContent = summary.score.toLocaleString();
    this.over.querySelector('.newbest')!.textContent = summary.newBest ? 'New personal best!' : `Best ${summary.best.toLocaleString()}`;
    const stats = this.over.querySelector('.stats')!;
    stats.replaceChildren();
    const rows: [string, string][] = [
      ['Distance', `${Math.round(summary.distance)} m`],
      ['Clouds', String(summary.clouds)],
      ['Perfect landings', String(summary.perfects)],
      ['Best combo', String(summary.maxCombo)],
      ['Reached', summary.zone],
    ];
    for (const [label, value] of rows) {
      const cell = document.createElement('div');
      const strong = document.createElement('b');
      strong.textContent = value;
      cell.append(strong, label);
      stats.append(cell);
    }
  }

  setPaused(paused: boolean): void {
    this.showHint(paused ? 'Paused · tap II or press P to resume' : '', paused ? 999 : 0);
  }

  judgement(j: Judgement, combo: number): void {
    const label = j === 'perfect' ? 'PERFECT' : j === 'good' ? 'GOOD' : 'OFF BEAT';
    this.flash(label, j, combo > 1 && j !== 'miss' ? `${combo} combo` : '');
  }

  flash(text: string, cls: string, small = '', seconds = 0.7): void {
    this.msgEl.className = `center-msg show ${cls}`;
    this.msgEl.textContent = text;
    if (small) {
      const s = document.createElement('small');
      s.textContent = small;
      this.msgEl.append(s);
    }
    this.msgTimer = seconds;
  }

  showHint(text: string, seconds = 2.5): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('show', text.length > 0);
    this.hintTimer = seconds;
  }

  zoneCard(zone: string, location: string): void {
    this.cardEl.querySelector('small')!.textContent = location;
    this.cardEl.querySelector('b')!.textContent = zone;
    this.cardEl.classList.add('show');
    this.cardTimer = 2.2;
  }

  forecast(weather: WeatherId, shoe: ShoeId): void {
    const label = weather === 'dry' ? 'Clearing up' : weather === 'rain' ? 'Rain ahead' : 'Snow ahead';
    this.forecastEl.textContent = `${WEATHER_ICON[weather]} ${label} · switch to ${SHOES[shoe].shortName}`;
    this.forecastEl.classList.add('show');
    this.forecastTimer = 3.5;
    this.shoeButtons.forEach((b, id) => b.classList.toggle('suggest', id === shoe));
  }

  update(frame: HudFrame, dt: number): void {
    const score = Math.floor(frame.score);
    if (score !== this.last.score) this.scoreEl.textContent = score.toLocaleString();
    if (frame.multiplier !== this.last.mult) this.multEl.textContent = `x${frame.multiplier}`;
    if (frame.clouds !== this.last.clouds) this.cloudsEl.textContent = String(frame.clouds);
    const zone = `${frame.location} · ${(frame.distance / 1000).toFixed(2)} km · ${Math.round(frame.bpm)} spm`;
    if (zone !== this.last.zone) this.zoneEl.textContent = zone;
    const next = `Next: ${frame.nextZone}`;
    if (next !== this.last.next) this.nextEl.textContent = next;
    this.last = { score, mult: frame.multiplier, clouds: frame.clouds, zone, next };
    this.zoneFill.style.transform = `scaleX(${frame.zoneProgress})`;

    // Beat bar: ticks slide in from both edges and meet the CloudTec pod on each beat.
    const nextBeat = Math.ceil(frame.beat);
    for (let i = 0; i < TICKS_PER_SIDE; i++) {
      const k = nextBeat + i;
      const offset = (k - frame.beat) / TICK_SPAN_BEATS;
      const isLanding = frame.landingBeat !== null && Math.abs(frame.landingBeat - k) < 0.5;
      for (const side of [-1, 1]) {
        const tick = this.ticks[i * 2 + (side < 0 ? 0 : 1)]!;
        tick.style.transform = `translateX(${side * offset * this.barHalfWidth}px)`;
        tick.style.opacity = String(Math.max(0, 1 - offset));
        tick.classList.toggle('land', isLanding);
      }
    }
    const sinceBeat = frame.beat - Math.floor(frame.beat);
    const squash = Math.exp(-sinceBeat * 9);
    this.podEl.style.transform = `scale(${1 + squash * 0.25}, ${1 - squash * 0.35})`;

    this.glideFill.style.transform = `scaleX(${Math.min(1, frame.glideCharge)})`;
    this.glideEl.classList.toggle('ready', frame.glideCharge >= 1);

    this.shoeButtons.forEach((b, id) => b.classList.toggle('active', id === frame.shoe));
    this.gripEl.textContent = frame.lowGrip ? '⚠ LOW GRIP · SWITCH SHOES' : '';

    if (this.msgTimer > 0 && (this.msgTimer -= dt) <= 0) this.msgEl.classList.remove('show');
    if (this.hintTimer > 0 && (this.hintTimer -= dt) <= 0) this.hintEl.classList.remove('show');
    if (this.cardTimer > 0 && (this.cardTimer -= dt) <= 0) this.cardEl.classList.remove('show');
    if (this.forecastTimer > 0 && (this.forecastTimer -= dt) <= 0) {
      this.forecastEl.classList.remove('show');
      this.shoeButtons.forEach((b) => b.classList.remove('suggest'));
    }
  }
}
