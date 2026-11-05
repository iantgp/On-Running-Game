import { BRAND } from './config/brand';
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
}

export interface HudFrame {
  score: number;
  multiplier: number;
  clouds: number;
  zone: string;
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

/** DOM overlay: HUD, beat bar, shoe selector and menu / game-over screens. */
export class Hud {
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
  private readonly gripEl: HTMLElement;
  private readonly podEl: HTMLElement;
  private readonly glideEl: HTMLElement;
  private readonly glideFill: HTMLElement;
  private readonly ticks: HTMLElement[] = [];
  private barHalfWidth = 160;
  private readonly shoeButtons = new Map<ShoeId, HTMLButtonElement>();
  private msgTimer = 0;
  private hintTimer = 0;
  private forecastTimer = 0;
  private last = { score: -1, mult: -1, clouds: -1, zone: '' };

  constructor(root: HTMLElement, handlers: HudHandlers) {
    // Static markup only; all dynamic values are written with textContent.
    root.innerHTML = `
      <div class="hud hidden">
        <div class="top">
          <div class="left"><div class="score">0</div><div class="sub zone"></div>
            <div class="zonebar"><i></i></div><div class="sub next"></div></div>
          <div class="right">
            <button class="pause" aria-label="Pause">II</button>
            <div class="pill">☁ <span class="clouds">0</span></div>
            <div class="pill mult">x1</div>
          </div>
        </div>
        <div class="forecast"></div>
        <div class="center-msg"></div>
        <div class="hint"></div>
        <div class="bottom">
          <div class="grip"></div>
          <div class="beatbar"><div class="glide"><i></i></div><div class="line"></div><div class="pod"></div></div>
          <div class="shoes"></div>
        </div>
      </div>
      <div class="screen menu">
        <div class="brand"></div>
        <div class="title"><b class="game-title"></b><span>INFINITE RUNNER</span></div>
        <div class="route">Zürich → Swiss Alps → New York</div>
        <div class="howto">
          <b>Swipe</b> ← → to switch lanes, ↑ to jump, ↓ to slide.<br/>
          <b>Land on the beat</b> for a PERFECT CloudTec rebound — speed boost + glide charge.<br/>
          <b>Glide:</b> when the meter is full, swipe ↑ again mid-air.<br/>
          <b>Weather changes:</b> tap the right shoe for grip, or slip on puddles &amp; ice.<br/>
          <span class="sub">Keys: arrows / WASD · Space · 1 2 3 shoes · P pause</span>
        </div>
        <button class="play">RUN</button>
        <div class="best"></div>
      </div>
      <div class="screen over hidden">
        <div class="title">Wiped out</div>
        <div class="best newbest"></div>
        <div class="stats"></div>
        <button class="play">RUN AGAIN</button>
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
    const brand = q('.brand');
    brand.textContent = BRAND.mark;
    brand.hidden = BRAND.mark.length === 0;
    q('.game-title').textContent = BRAND.title;
    this.msgEl = q('.center-msg');
    this.hintEl = q('.hint');
    this.forecastEl = q('.forecast');
    this.gripEl = q('.grip');
    this.podEl = q('.pod');
    this.glideEl = q('.glide');
    this.glideFill = q('.glide i');

    const bar = q('.beatbar');
    const measure = (): void => {
      this.barHalfWidth = bar.clientWidth / 2 || 160;
    };
    window.addEventListener('resize', measure);
    requestAnimationFrame(measure);
    for (let i = 0; i < TICKS_PER_SIDE * 2; i++) {
      const tick = document.createElement('div');
      tick.className = 'tick';
      bar.insertBefore(tick, this.podEl);
      this.ticks.push(tick);
    }

    const shoes = q('.shoes');
    SHOE_ORDER.forEach((id, index) => {
      const cfg = SHOES[id];
      const button = document.createElement('button');
      button.className = 'shoe';
      button.setAttribute('aria-label', `Switch to ${cfg.name}`);
      const swatch = document.createElement('span');
      swatch.className = 'sw';
      swatch.style.background = `linear-gradient(90deg, ${hex(cfg.colors.upper)} 70%, ${hex(cfg.colors.accent)} 70%)`;
      const name = document.createElement('span');
      name.textContent = `${index + 1} · ${cfg.shortName}`;
      const wx = document.createElement('span');
      wx.className = 'wx';
      wx.textContent = WEATHER_ICON[cfg.bestFor];
      button.append(swatch, name, wx);
      button.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        handlers.onShoe(id);
      });
      shoes.append(button);
      this.shoeButtons.set(id, button);
    });

    root.querySelectorAll<HTMLButtonElement>('.play').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.onPlay();
      }),
    );
    q('.pause').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      handlers.onPause();
    });
  }

  showMenu(best: number): void {
    this.menu.classList.remove('hidden');
    this.over.classList.add('hidden');
    this.hud.classList.add('hidden');
    this.menu.querySelector('.best')!.textContent = best > 0 ? `Best ${best.toLocaleString()}` : '';
  }

  showRun(): void {
    this.menu.classList.add('hidden');
    this.over.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.last = { score: -1, mult: -1, clouds: -1, zone: '' };
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  showGameOver(summary: RunSummary): void {
    this.over.classList.remove('hidden');
    this.over.querySelector('.newbest')!.textContent = summary.newBest
      ? `New best: ${summary.score.toLocaleString()}!`
      : `Score ${summary.score.toLocaleString()} · Best ${summary.best.toLocaleString()}`;
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
    this.showHint(paused ? 'Paused — tap II or press P to resume' : '', paused ? 999 : 0);
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

  forecast(weather: WeatherId, shoe: ShoeId): void {
    const label = weather === 'dry' ? 'Clearing up' : weather === 'rain' ? 'Rain ahead' : 'Snow ahead';
    this.forecastEl.textContent = `${WEATHER_ICON[weather]} ${label} — switch to ${SHOES[shoe].shortName}`;
    this.forecastEl.classList.add('show');
    this.forecastTimer = 3.5;
    this.shoeButtons.forEach((b, id) => b.classList.toggle('suggest', id === shoe));
  }

  update(frame: HudFrame, dt: number): void {
    const score = Math.floor(frame.score);
    if (score !== this.last.score) this.scoreEl.textContent = score.toLocaleString();
    if (frame.multiplier !== this.last.mult) this.multEl.textContent = `x${frame.multiplier}`;
    if (frame.clouds !== this.last.clouds) this.cloudsEl.textContent = String(frame.clouds);
    const zone = `${frame.zone} · ${(frame.distance / 1000).toFixed(2)} km · ${Math.round(frame.bpm)} spm`;
    if (zone !== this.last.zone) this.zoneEl.textContent = zone;
    this.last = { score, mult: frame.multiplier, clouds: frame.clouds, zone };
    this.zoneFill.style.transform = `scaleX(${frame.zoneProgress})`;
    const next = `Next: ${frame.nextZone}`;
    if (this.nextEl.textContent !== next) this.nextEl.textContent = next;

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

    this.glideFill.style.width = `${Math.min(1, frame.glideCharge) * 100}%`;
    this.glideEl.classList.toggle('ready', frame.glideCharge >= 1);

    this.shoeButtons.forEach((b, id) => b.classList.toggle('active', id === frame.shoe));
    this.gripEl.textContent = frame.lowGrip ? '⚠ LOW GRIP — SWITCH SHOES' : '';

    if (this.msgTimer > 0 && (this.msgTimer -= dt) <= 0) this.msgEl.classList.remove('show');
    if (this.hintTimer > 0 && (this.hintTimer -= dt) <= 0) this.hintEl.classList.remove('show');
    if (this.forecastTimer > 0 && (this.forecastTimer -= dt) <= 0) {
      this.forecastEl.classList.remove('show');
      this.shoeButtons.forEach((b) => b.classList.remove('suggest'));
    }
  }
}
