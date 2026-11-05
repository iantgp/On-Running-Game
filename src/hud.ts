import { BRAND } from './config/brand';
import type { RunnerConfig } from './config/runners';
import {
  MAX_LEVEL,
  PERKS,
  SHOES,
  SHOE_IDS,
  SLOT_INFO,
  SLOT_ORDER,
  perkValue,
  shoeName,
  shortShoeName,
  upgradeCost,
  type ShoeId,
  type ShoeSlot,
} from './config/shoes';
import type { WeatherId } from './config/weather';
import type { ProgressState } from './progress';
import type { Judgement } from './sim/rhythm';
import { formatDuration, formatPace, type RunReport } from './stats';

const WEATHER_ICON: Record<WeatherId, string> = { dry: '☀️', rain: '🌧️', snow: '❄️' };
const TICKS_PER_SIDE = 4;
const TICK_SPAN_BEATS = 3;
const SVG_NS = 'http://www.w3.org/2000/svg';

export type LockerAction = 'unlock' | 'upgrade' | 'equip';

export interface HudHandlers {
  onPlay(): void;
  onShoe(slot: ShoeSlot): void;
  onPause(): void;
  onRunner(direction: -1 | 1): void;
  onMenu(): void;
  onLocker(): void;
  onLockerAction(action: LockerAction, id: ShoeId): void;
}

export interface HudFrame {
  score: number;
  multiplier: number;
  pods: number;
  /** Remaining CloudTec Surge, 0..1. */
  surge: number;
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
  slot: ShoeSlot;
  lowGrip: boolean;
}

export interface SummaryData {
  report: RunReport;
  score: number;
  best: number;
  newBest: boolean;
  wallet: number;
  runner: string;
  shoe: string;
  startedAt: Date;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function shoeSwatch(id: ShoeId): HTMLElement {
  const c = SHOES[id].colors;
  const sw = el('span', 'sw');
  sw.style.background = `linear-gradient(90deg, ${hex(c.upper)} 66%, ${hex(c.accent)} 66%)`;
  sw.style.boxShadow = `inset 0 -3px 0 ${hex(c.pods)}`;
  return sw;
}

function podIcon(): HTMLElement {
  return el('i', 'pod-icon');
}

function timeOfDay(date: Date): string {
  const h = date.getHours();
  if (h < 5) return 'Night Run';
  if (h < 12) return 'Morning Run';
  if (h < 17) return 'Afternoon Run';
  if (h < 21) return 'Evening Run';
  return 'Night Run';
}

/** Deterministic GPS-style trace whose length follows the distance run. */
function routeSvg(distance: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 320 150');
  svg.setAttribute('class', 'route-map');
  svg.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 9; i++) {
    const line = document.createElementNS(SVG_NS, 'path');
    const x = 20 + i * 36;
    line.setAttribute('d', `M${x} 0 L${x - 30} 150 M0 ${18 + i * 16} L320 ${8 + i * 16}`);
    line.setAttribute('class', 'map-street');
    svg.append(line);
  }
  const points: [number, number][] = [[0, 0]];
  let heading = -0.9;
  const steps = Math.max(12, Math.min(220, Math.round(distance / 12)));
  for (let i = 1; i <= steps; i++) {
    heading += Math.sin(i * 0.37) * 0.22 + Math.sin(i * 0.091) * 0.12;
    const [px, py] = points[i - 1]!;
    points.push([px + Math.cos(heading), py + Math.sin(heading)]);
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, (Math.max(...ys) - minY) * (296 / 126), 1e-6);
  const scale = 296 / span;
  const ox = 12 + (296 - (Math.max(...xs) - minX) * scale) / 2;
  const oy = 12 + (126 - (Math.max(...ys) - minY) * scale) / 2;
  const mapped = points.map(([x, y]) => [ox + (x - minX) * scale, oy + (y - minY) * scale] as const);
  const route = document.createElementNS(SVG_NS, 'polyline');
  route.setAttribute('points', mapped.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  route.setAttribute('class', 'map-route');
  svg.append(route);
  const [sx, sy] = mapped[0]!;
  const [ex, ey] = mapped[mapped.length - 1]!;
  for (const [x, y, cls] of [[sx, sy, 'map-start'], [ex, ey, 'map-end']] as const) {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', x.toFixed(1));
    dot.setAttribute('cy', y.toFixed(1));
    dot.setAttribute('r', '5');
    dot.setAttribute('class', cls);
    svg.append(dot);
  }
  return svg;
}

/** DOM overlay: HUD, beat bar, shoe selector, menus, Shoe Locker and run summary. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly locker: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly multEl: HTMLElement;
  private readonly podsEl: HTMLElement;
  private readonly zoneEl: HTMLElement;
  private readonly zoneFill: HTMLElement;
  private readonly nextEl: HTMLElement;
  private readonly msgEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly forecastEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly cardEl: HTMLElement;
  private readonly gripEl: HTMLElement;
  private readonly podEl: HTMLElement;
  private readonly glideEl: HTMLElement;
  private readonly glideFill: HTMLElement;
  private readonly surgeEl: HTMLElement;
  private readonly surgeFill: HTMLElement;
  private readonly ticks: HTMLElement[] = [];
  private readonly shoeButtons = new Map<ShoeSlot, HTMLButtonElement>();
  private barHalfWidth = 160;
  private msgTimer = 0;
  private hintTimer = 0;
  private forecastTimer = 0;
  private toastTimer = 0;
  private cardTimer = 0;
  private last = { score: -1, mult: -1, pods: -1, zone: '', next: '' };

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
            <div class="pill glass"><i class="pod-icon"></i><span class="pods">0</span></div>
            <div class="pill glass mult">x1</div>
          </div>
        </div>
        <div class="forecast glass"></div>
        <div class="toast glass"><b></b><small></small></div>
        <div class="zonecard"><small></small><b></b></div>
        <div class="center-msg"></div>
        <div class="hint"></div>
        <div class="bottom">
          <div class="surge hidden"><span class="surge-label"></span><div class="surge-track"><i></i></div></div>
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
          <div class="menu-row">
            <button class="ghost locker-open">Shoe Locker</button>
            <button class="ghost howto-toggle">How to play</button>
          </div>
          <div class="howto glass hidden">
            <p><b>Swipe</b> ← → to switch lanes, ↑ to jump, ↓ to slide.</p>
            <p><b>Land on the beat</b> for a PERFECT rebound: speed boost and glide charge.</p>
            <p><b>Glide:</b> when the meter is full, swipe ↑ again mid-air.</p>
            <p><b>Surge:</b> grab the glowing pod ring to inflate your shoes and super-jump everything.</p>
            <p><b>Weather:</b> tap the right shoe for grip, or slip on puddles and ice.</p>
            <p><b>Cloud Pods</b> unlock and upgrade shoes in the Shoe Locker.</p>
            <p class="sub">Keys: arrows / WASD · Space · 1 2 3 shoes · P pause</p>
          </div>
          <div class="menu-meta"><span class="wallet"><i class="pod-icon"></i><span class="wallet-value">0</span></span><span class="best"></span></div>
        </div>
      </div>
      <div class="screen locker hidden">
        <div class="sheet glass">
          <header class="sheet-head">
            <div><div class="eyebrow">Loadout</div><h2>Shoe Locker</h2></div>
            <div class="wallet big"><i class="pod-icon"></i><span class="wallet-value">0</span></div>
            <button class="close" aria-label="Close Shoe Locker">✕</button>
          </header>
          <p class="sheet-note">Carry one shoe per weather slot. Perks work while you wear the shoe.</p>
          <div class="locker-list"></div>
        </div>
      </div>
      <div class="screen summary hidden">
        <div class="sheet glass summary-card"></div>
      </div>`;

    const q = <T extends HTMLElement>(sel: string): T => {
      const found = root.querySelector<T>(sel);
      if (!found) throw new Error(`HUD element missing: ${sel}`);
      return found;
    };
    this.hud = q('.hud');
    this.menu = q('.menu');
    this.summary = q('.summary');
    this.locker = q('.locker');
    this.scoreEl = q('.score');
    this.multEl = q('.mult');
    this.podsEl = q('.pods');
    this.zoneEl = q('.zone');
    this.zoneFill = q('.zonebar i');
    this.nextEl = q('.next');
    this.msgEl = q('.center-msg');
    this.hintEl = q('.hint');
    this.forecastEl = q('.forecast');
    this.toastEl = q('.toast');
    this.cardEl = q('.zonecard');
    this.gripEl = q('.grip');
    this.podEl = q('.pod');
    this.glideEl = q('.glide');
    this.glideFill = q('.glide i');
    this.surgeEl = q('.surge');
    this.surgeFill = q('.surge-track i');
    q('.surge-label').textContent = `${BRAND.tech} Surge`;

    const brand = q('.brand');
    brand.hidden = BRAND.neutral;
    if (BRAND.logoUrl) {
      const img = el('img');
      img.src = BRAND.logoUrl;
      img.alt = BRAND.mark;
      img.addEventListener('error', () => img.replaceWith(document.createTextNode(BRAND.mark)));
      brand.append(img);
    }
    q('.game-title').textContent = BRAND.title;

    const bar = q('.beatbar');
    for (let i = 0; i < TICKS_PER_SIDE * 2; i++) {
      const tick = el('div', 'tick');
      bar.insertBefore(tick, this.podEl);
      this.ticks.push(tick);
    }
    const measure = (): void => {
      this.barHalfWidth = bar.clientWidth / 2 || 160;
    };
    window.addEventListener('resize', measure);
    requestAnimationFrame(measure);

    const shoes = q('.shoes');
    SLOT_ORDER.forEach((slot) => {
      const button = el('button', 'shoe glass');
      button.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        handlers.onShoe(slot);
      });
      shoes.append(button);
      this.shoeButtons.set(slot, button);
    });

    const click = (node: HTMLElement, fn: () => void): void =>
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
    click(q('.menu .play'), handlers.onPlay);
    click(q('.prev'), () => handlers.onRunner(-1));
    click(q('.next-runner'), () => handlers.onRunner(1));
    click(q('.howto-toggle'), () => q('.howto').classList.toggle('hidden'));
    click(q('.locker-open'), handlers.onLocker);
    click(q('.locker .close'), () => this.locker.classList.add('hidden'));
    q('.locker-list').addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
      if (!target || target.disabled) return;
      handlers.onLockerAction(target.dataset.action as LockerAction, target.dataset.id as ShoeId);
    });
    this.summary.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-go]');
      if (!target) return;
      e.stopPropagation();
      if (target.dataset.go === 'again') handlers.onPlay();
      else if (target.dataset.go === 'locker') {
        handlers.onMenu();
        handlers.onLocker();
      } else handlers.onMenu();
    });
    q('.pause').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      handlers.onPause();
    });
  }

  // ---- screens --------------------------------------------------------------------

  showMenu(progress: Readonly<ProgressState>, runner: RunnerConfig, show = true): void {
    if (show) {
      this.menu.classList.remove('hidden');
      this.summary.classList.add('hidden');
      this.hud.classList.add('hidden');
    }
    this.root.querySelectorAll('.wallet-value').forEach((n) => (n.textContent = progress.pods.toLocaleString()));
    this.root.querySelector('.best')!.textContent = progress.best > 0 ? `Best ${progress.best.toLocaleString()}` : '';
    this.setRunner(runner);
  }

  setRunner(runner: RunnerConfig): void {
    const node = this.root.querySelector('.runner-name')!;
    node.querySelector('b')!.textContent = runner.name;
    node.querySelector('small')!.textContent = `from ${runner.hometown}`;
  }

  /** Labels the three in-run shoe buttons with the equipped loadout. */
  setLoadout(loadout: Readonly<Record<ShoeSlot, ShoeId>>): void {
    SLOT_ORDER.forEach((slot, index) => {
      const button = this.shoeButtons.get(slot)!;
      const id = loadout[slot];
      button.setAttribute('aria-label', `Switch to ${shoeName(id)}`);
      button.replaceChildren(shoeSwatch(id), el('span', 'shoe-name', shortShoeName(id)), el('span', 'wx', `${SLOT_INFO[slot].icon} ${index + 1}`));
    });
  }

  showLocker(progress: Readonly<ProgressState>): void {
    this.locker.classList.remove('hidden');
    this.root.querySelectorAll('.wallet-value').forEach((n) => (n.textContent = progress.pods.toLocaleString()));
    const list = this.locker.querySelector('.locker-list')!;
    list.replaceChildren();
    for (const slot of SLOT_ORDER) {
      const section = el('section', 'slot');
      section.append(el('h3', 'slot-title', `${SLOT_INFO[slot].icon} ${SLOT_INFO[slot].label} · best in ${SLOT_INFO[slot].weather === 'dry' ? 'dry weather' : SLOT_INFO[slot].weather}`));
      for (const id of SHOE_IDS.filter((s) => SHOES[s].slot === slot)) section.append(this.shoeCard(id, progress));
      list.append(section);
    }
  }

  private shoeCard(id: ShoeId, progress: Readonly<ProgressState>): HTMLElement {
    const cfg = SHOES[id];
    const level = progress.levels[id];
    const equipped = progress.loadout[cfg.slot] === id;
    const perk = PERKS[cfg.perk];
    const card = el('article', `shoe-card${equipped ? ' equipped' : ''}${level === 0 ? ' locked' : ''}`);
    const head = el('div', 'card-head');
    const titles = el('div', 'card-titles');
    titles.append(el('b', '', shoeName(id)), el('small', '', cfg.tagline));
    head.append(shoeSwatch(id), titles);
    if (equipped) head.append(el('span', 'tag', 'Equipped'));
    card.append(head);

    const perkRow = el('div', 'perk');
    perkRow.append(el('span', 'perk-name', perk.name));
    const pips = el('span', 'pips');
    pips.setAttribute('aria-label', `Level ${level} of ${MAX_LEVEL}`);
    for (let i = 1; i <= MAX_LEVEL; i++) pips.append(el('i', i <= level ? 'on' : ''));
    perkRow.append(pips);
    card.append(perkRow);
    const shown = Math.max(1, level);
    const detail = el('p', 'perk-text', perk.describe(perkValue(id, shown)));
    if (level > 0 && level < MAX_LEVEL) detail.append(el('span', 'next-level', ` → ${perk.describe(perkValue(id, level + 1))}`));
    card.append(detail);

    const actions = el('div', 'card-actions');
    const action = (label: string, kind: LockerAction, cost: number | null): void => {
      const button = el('button', `buy ${kind}`);
      button.dataset.action = kind;
      button.dataset.id = id;
      button.append(el('span', '', label));
      if (cost !== null) {
        const price = el('span', 'price');
        price.append(podIcon(), document.createTextNode(cost.toLocaleString()));
        button.append(price);
        button.disabled = progress.pods < cost;
      }
      actions.append(button);
    };
    if (level === 0) action('Unlock', 'unlock', cfg.cost);
    else {
      if (!equipped) action('Equip', 'equip', null);
      if (level < MAX_LEVEL) action(`Upgrade to L${level + 1}`, 'upgrade', upgradeCost(level));
      else actions.append(el('span', 'maxed', 'Max level'));
    }
    card.append(actions);
    return card;
  }

  showRun(): void {
    this.menu.classList.add('hidden');
    this.summary.classList.add('hidden');
    this.locker.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.last = { score: -1, mult: -1, pods: -1, zone: '', next: '' };
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  /** Fitness-app style run summary. */
  showSummary(data: SummaryData): void {
    const r = data.report;
    const card = this.summary.querySelector('.summary-card')!;
    card.replaceChildren();

    const head = el('header', 'sum-head');
    if (BRAND.logoUrl) {
      const logo = el('img', 'sum-logo');
      logo.src = BRAND.logoUrl;
      logo.alt = BRAND.mark;
      logo.addEventListener('error', () => logo.remove());
      head.append(logo);
    }
    const titles = el('div');
    titles.append(el('h2', '', timeOfDay(data.startedAt)));
    const when = data.startedAt.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    titles.append(el('small', '', `${when} · ${data.runner} · ${data.shoe}`));
    head.append(titles);
    card.append(head);

    card.append(routeSvg(r.distance));

    const hero = el('div', 'sum-hero');
    const heroStat = (value: string, unit: string, label: string): void => {
      const cell = el('div');
      const v = el('b', '', value);
      v.append(el('span', 'unit', unit));
      cell.append(v, el('small', '', label));
      hero.append(cell);
    };
    heroStat((r.distance / 1000).toFixed(2), ' km', 'Distance');
    heroStat(formatPace(r.pace), ' /km', 'Avg pace');
    heroStat(formatDuration(r.time), '', 'Time');
    card.append(hero);

    const grid = el('div', 'sum-grid');
    const stat = (label: string, value: string): void => {
      const cell = el('div');
      cell.append(el('small', '', label), el('b', '', value));
      grid.append(cell);
    };
    stat(`${BRAND.tech} efficiency`, r.efficiency === null ? '–' : `${r.efficiency}%`);
    stat('Cadence', `${r.cadence} spm`);
    stat('Max speed', `${r.maxSpeedKmh.toFixed(0)} km/h`);
    stat('Elevation gain', `${r.elevation} m`);
    stat('Perfect landings', `${r.perfects}`);
    stat('Best combo', `${r.maxCombo}`);
    card.append(grid);

    if (r.splits.length > 0) {
      const splits = el('section', 'splits');
      splits.append(el('h3', 'eyebrow', 'Splits'));
      const fastest = Math.min(...r.splits.map((s) => s.time / s.distance));
      for (const split of r.splits) {
        const secPerKm = (split.time / split.distance) * 1000;
        const row = el('div', 'split');
        const label = el('span', 'split-label', split.label);
        const meta = el('span', 'split-dist', `${Math.round(split.distance)} m`);
        const barWrap = el('span', 'split-bar');
        const fill = el('i', split.time / split.distance === fastest ? 'fastest' : '');
        fill.style.width = `${Math.max(12, (fastest / (split.time / split.distance)) * 100)}%`;
        barWrap.append(fill);
        row.append(label, meta, barWrap, el('span', 'split-pace', `${formatPace(secPerKm)} /km`));
        splits.append(row);
      }
      card.append(splits);
    }

    const rewards = el('section', 'rewards');
    const reward = (icon: HTMLElement | string, value: string, label: string): void => {
      const cell = el('div', 'reward');
      const top = el('b');
      if (typeof icon === 'string') top.append(document.createTextNode(icon));
      else top.append(icon);
      top.append(document.createTextNode(` ${value}`));
      cell.append(top, el('small', '', label));
      rewards.append(cell);
    };
    const earned = r.pods + r.ecoTokens * 10 + r.badges * 25;
    reward(podIcon(), `+${earned}`, `Cloud Pods · ${data.wallet.toLocaleString()} total`);
    reward('🌱', `${r.ecoTokens}`, 'Eco-tokens');
    reward(BRAND.mark ? '◉' : '★', `${r.badges}`, BRAND.mark ? `${BRAND.mark} badges` : 'Badges');
    card.append(rewards);

    const score = el('div', 'sum-score');
    score.append(el('span', '', data.newBest ? 'New personal best' : `Score · best ${data.best.toLocaleString()}`), el('b', '', data.score.toLocaleString()));
    card.append(score);

    const actions = el('div', 'sum-actions');
    const go = (label: string, target: string, cls: string): void => {
      const button = el('button', cls, label);
      button.dataset.go = target;
      actions.append(button);
    };
    go('RUN AGAIN', 'again', 'play');
    go('Shoe Locker', 'locker', 'ghost');
    go('Menu', 'menu', 'ghost');
    card.append(actions);

    this.summary.classList.remove('hidden');
    card.scrollTop = 0;
  }

  // ---- in-run feedback -----------------------------------------------------------

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
    if (small) this.msgEl.append(el('small', '', small));
    this.msgTimer = seconds;
  }

  showHint(text: string, seconds = 2.5): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('show', text.length > 0);
    this.hintTimer = seconds;
  }

  toast(title: string, detail: string): void {
    this.toastEl.querySelector('b')!.textContent = title;
    this.toastEl.querySelector('small')!.textContent = detail;
    this.toastEl.classList.add('show');
    this.toastTimer = 2.2;
  }

  zoneCard(zone: string, location: string): void {
    this.cardEl.querySelector('small')!.textContent = location;
    this.cardEl.querySelector('b')!.textContent = zone;
    this.cardEl.classList.add('show');
    this.cardTimer = 2.2;
  }

  forecast(weather: WeatherId, slot: ShoeSlot, shoe: string): void {
    const label = weather === 'dry' ? 'Clearing up' : weather === 'rain' ? 'Rain ahead' : 'Snow ahead';
    this.forecastEl.textContent = `${WEATHER_ICON[weather]} ${label} · switch to ${shoe}`;
    this.forecastEl.classList.add('show');
    this.forecastTimer = 3.5;
    this.shoeButtons.forEach((b, s) => b.classList.toggle('suggest', s === slot));
  }

  update(frame: HudFrame, dt: number): void {
    const score = Math.floor(frame.score);
    if (score !== this.last.score) this.scoreEl.textContent = score.toLocaleString();
    if (frame.multiplier !== this.last.mult) this.multEl.textContent = `x${frame.multiplier}`;
    if (frame.pods !== this.last.pods) this.podsEl.textContent = String(frame.pods);
    const zone = `${frame.location} · ${(frame.distance / 1000).toFixed(2)} km · ${Math.round(frame.bpm)} spm`;
    if (zone !== this.last.zone) this.zoneEl.textContent = zone;
    const next = `Next: ${frame.nextZone}`;
    if (next !== this.last.next) this.nextEl.textContent = next;
    this.last = { score, mult: frame.multiplier, pods: frame.pods, zone, next };
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
    this.podEl.classList.toggle('surging', frame.surge > 0);

    this.glideFill.style.transform = `scaleX(${Math.min(1, frame.glideCharge)})`;
    this.glideEl.classList.toggle('ready', frame.glideCharge >= 1);
    this.surgeEl.classList.toggle('hidden', frame.surge <= 0);
    this.surgeFill.style.transform = `scaleX(${Math.max(0, frame.surge)})`;

    this.shoeButtons.forEach((b, slot) => b.classList.toggle('active', slot === frame.slot));
    this.gripEl.textContent = frame.lowGrip ? '⚠ LOW GRIP · SWITCH SHOES' : '';

    if (this.msgTimer > 0 && (this.msgTimer -= dt) <= 0) this.msgEl.classList.remove('show');
    if (this.hintTimer > 0 && (this.hintTimer -= dt) <= 0) this.hintEl.classList.remove('show');
    if (this.cardTimer > 0 && (this.cardTimer -= dt) <= 0) this.cardEl.classList.remove('show');
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toastEl.classList.remove('show');
    if (this.forecastTimer > 0 && (this.forecastTimer -= dt) <= 0) {
      this.forecastEl.classList.remove('show');
      this.shoeButtons.forEach((b) => b.classList.remove('suggest'));
    }
  }
}
