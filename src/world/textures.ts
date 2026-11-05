import * as THREE from 'three';
import type { ZoneKey } from './themes';

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return [c, g];
}

function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export interface TextTextureOptions {
  width: number;
  height: number;
  /** CSS colour, or null for a transparent background. */
  background: string | null;
  color: string;
  fontSize: number;
  border?: string;
}

/** Renders a short bold label (banners, bus livery, shirt logo, signs). */
export function textTexture(text: string, o: TextTextureOptions): THREE.CanvasTexture {
  const [c, g] = canvas(o.width, o.height);
  if (o.background) {
    g.fillStyle = o.background;
    g.fillRect(0, 0, o.width, o.height);
  }
  if (o.border) {
    g.strokeStyle = o.border;
    g.lineWidth = o.height * 0.07;
    g.strokeRect(o.height * 0.08, o.height * 0.08, o.width - o.height * 0.16, o.height - o.height * 0.16);
  }
  g.fillStyle = o.color;
  g.font = `900 ${o.fontSize}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, o.width / 2, o.height / 2 + o.fontSize * 0.04, o.width * 0.88);
  return toTexture(c);
}

/** Blue Swiss street-name sign. */
export function streetSignTexture(text: string): THREE.CanvasTexture {
  return textTexture(text, { width: 512, height: 128, background: '#1d4f9e', color: '#ffffff', fontSize: 62, border: '#ffffff' });
}

/** Transparent road markings, repeated every 10 m along the road. */
export function roadMarkingsTexture(zone: ZoneKey): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const lane = 256 / 3;
  const pxPerM = 256 / 8;
  if (zone === 'alps') {
    // Packed-snow road: tyre ruts instead of paint.
    g.fillStyle = 'rgba(70, 90, 110, 0.16)';
    for (let i = 0; i < 3; i++) {
      for (const offset of [-0.55, 0.55]) g.fillRect(i * lane + lane / 2 + offset * pxPerM - 6, 0, 12, 256);
    }
    g.fillStyle = 'rgba(255, 120, 40, 0.9)';
    g.fillRect(0, 0, 6, 256);
    g.fillRect(250, 0, 6, 256);
  } else {
    g.fillStyle = 'rgba(255,255,255,0.88)';
    for (const x of [lane, lane * 2]) g.fillRect(x - 3, 0, 6, 120);
    g.fillStyle = zone === 'newyork' ? 'rgba(255, 200, 40, 0.9)' : 'rgba(255,255,255,0.9)';
    g.fillRect(0, 0, 6, 256);
    g.fillRect(250, 0, 6, 256);
    if (zone === 'zurich') {
      // Tram rails in the centre lane.
      for (const offset of [-0.72, 0.72]) {
        const x = 128 + offset * pxPerM;
        g.fillStyle = 'rgba(30, 32, 36, 0.75)';
        g.fillRect(x - 4, 0, 8, 256);
        g.fillStyle = 'rgba(210, 215, 222, 0.85)';
        g.fillRect(x - 1.5, 0, 3, 256);
      }
    }
  }
  const tex = toTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

type Point = [number, number];

function fillPath(g: CanvasRenderingContext2D, color: string, points: Point[]): void {
  g.fillStyle = color;
  g.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
  g.closePath();
  g.fill();
}

/** Jagged ridge from left to right; peaks are [x, height] pairs. Returns the polygon. */
function ridge(peaks: Point[], base: number, width: number): Point[] {
  return [[0, base], ...peaks.map(([x, h]): Point => [x, base - h]), [width, base]];
}

function drawAlpsRange(g: CanvasRenderingContext2D, w: number, base: number, scale: number, color: string): void {
  const peaks: Point[] = [];
  for (let x = 0, i = 0; x <= w; x += 70, i++) {
    const h = (90 + Math.abs(Math.sin(i * 1.7)) * 110 + (i % 3) * 25) * scale;
    peaks.push([x, h]);
  }
  fillPath(g, color, ridge(peaks, base, w));
  // Snow caps on the higher peaks.
  g.fillStyle = 'rgba(255,255,255,0.95)';
  for (const [x, h] of peaks) {
    if (h < 150 * scale) continue;
    const top = base - h;
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x - 26 * scale, top + 34 * scale);
    g.lineTo(x - 8 * scale, top + 28 * scale);
    g.lineTo(x + 6 * scale, top + 38 * scale);
    g.lineTo(x + 26 * scale, top + 34 * scale);
    g.closePath();
    g.fill();
  }
}

function drawZurich(g: CanvasRenderingContext2D, w: number, h: number): void {
  const base = h - 8;
  drawAlpsRange(g, w, base - 40, 0.75, '#c3d6e8');
  // Uetliberg ridge.
  g.fillStyle = '#7d98ad';
  g.beginPath();
  g.moveTo(0, base);
  g.bezierCurveTo(300, base - 150, 650, base - 135, 900, base - 60);
  g.lineTo(900, base);
  g.closePath();
  g.fill();
  // Old-town roofline.
  for (let x = 560; x < 1500; x += 34) {
    const rh = 34 + ((x * 7) % 30);
    fillPath(g, '#8aa0b3', [[x, base], [x, base - rh], [x + 17, base - rh - 14], [x + 34, base - rh], [x + 34, base]]);
  }
  const tower = '#728699';
  // Grossmünster: twin towers with domed caps.
  for (const tx of [850, 900]) {
    g.fillStyle = tower;
    g.fillRect(tx, base - 175, 34, 175);
    g.fillRect(tx + 4, base - 196, 26, 22);
    g.beginPath();
    g.arc(tx + 17, base - 196, 13, Math.PI, 0);
    g.fill();
    g.fillStyle = '#8ea3b6';
    g.fillRect(tx + 11, base - 150, 12, 22);
  }
  g.fillStyle = tower;
  g.fillRect(830, base - 70, 124, 70);
  // Fraumünster: slender spire.
  g.fillRect(1010, base - 150, 24, 150);
  fillPath(g, '#6f8a96', [[1006, base - 150], [1022, base - 245], [1038, base - 150]]);
  // St. Peter: tower with Europe's largest church clock face.
  g.fillStyle = tower;
  g.fillRect(1120, base - 160, 36, 160);
  fillPath(g, tower, [[1116, base - 160], [1138, base - 215], [1160, base - 160]]);
  g.fillStyle = '#d8e2ea';
  g.beginPath();
  g.arc(1138, base - 132, 13, 0, Math.PI * 2);
  g.fill();
  // Prime Tower.
  fillPath(g, '#6a8294', [[1330, base], [1334, base - 250], [1384, base - 262], [1388, base]]);
  g.fillStyle = 'rgba(200, 225, 240, 0.35)';
  for (let y = base - 240; y < base - 10; y += 14) g.fillRect(1338, y, 46, 5);
}

function drawAlps(g: CanvasRenderingContext2D, w: number, h: number): void {
  const base = h - 8;
  drawAlpsRange(g, w, base - 30, 1.5, '#cfdeec');
  // Matterhorn-like pyramid.
  fillPath(g, '#9fb2c6', [[880, base - 30], [1010, base - 430], [1040, base - 400], [1180, base - 30]]);
  fillPath(g, '#ffffff', [[1010, base - 430], [968, base - 330], [1000, base - 345], [1030, base - 320], [1060, base - 350], [1040, base - 400]]);
  drawAlpsRange(g, w, base, 0.8, '#8fa6bc');
}

function drawNewYork(g: CanvasRenderingContext2D, w: number, h: number): void {
  const base = h - 8;
  let x = 0;
  let i = 0;
  while (x < w) {
    const bw = 40 + ((i * 37) % 50);
    const bh = 90 + ((i * 53) % 200) + (Math.abs(x - w / 2) < 400 ? 80 : 0);
    g.fillStyle = i % 2 ? '#5d6583' : '#525a78';
    g.fillRect(x, base - bh, bw, bh);
    g.fillStyle = 'rgba(255, 214, 140, 0.55)';
    for (let wy = base - bh + 8; wy < base - 6; wy += 12) {
      for (let wx = x + 5; wx < x + bw - 5; wx += 9) if ((wx * 13 + wy * 7) % 5 === 0) g.fillRect(wx, wy, 4, 5);
    }
    x += bw + 4;
    i++;
  }
  // Stepped art-deco tower with a spire.
  g.fillStyle = '#4b5270';
  g.fillRect(990, base - 300, 80, 300);
  g.fillRect(1005, base - 360, 50, 60);
  g.fillRect(1018, base - 400, 24, 40);
  g.fillRect(1027, base - 460, 6, 60);
  // Crown with triangular setbacks.
  g.fillRect(1240, base - 280, 60, 280);
  for (let k = 0; k < 4; k++) fillPath(g, '#6a7290', [[1240 + k * 6, base - 280 - k * 22], [1270, base - 330 - k * 22], [1300 - k * 6, base - 280 - k * 22]]);
}

/** Distant skyline silhouette for the backdrop of each zone. */
export function skylineTexture(zone: ZoneKey): THREE.CanvasTexture {
  const [c, g] = canvas(2048, 512);
  if (zone === 'zurich') drawZurich(g, 2048, 512);
  else if (zone === 'alps') drawAlps(g, 2048, 512);
  else drawNewYork(g, 2048, 512);
  return toTexture(c);
}

/** Soft round sprite for particles and blob shadows. */
export function softDotTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return toTexture(c);
}
