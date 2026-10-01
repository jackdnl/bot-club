import type { Layout, Rect } from './layout';

export const INK = '243, 235, 225';
/** Lamp light spilling out of the doors. */
export const WARM = '255, 205, 150';
const NIGHT = '#0d0c12';
const WALL = '#2d2735';
const ROOM = '#16121b';
const GROUT = '#09080c';
const TILE = '#1d1823';
const KIT = '#241e2c';
const KIT_DARK = '#0e0c12';

const TAU = Math.PI * 2;

export interface Booth {
  dj: { x: number; y: number; r: number };
  deck: Rect;
  platters: { x: number; y: number; r: number }[];
}

/** Where the moving parts of the booth sit, shared by the static paint and the live layer. */
export function boothParts(layout: Layout): Booth {
  const { booth, r } = layout;
  const bw = booth.x1 - booth.x0;
  const bh = booth.y1 - booth.y0;
  const deckH = Math.min(bh * 0.46, r * 2.3);
  const deck: Rect = { x0: booth.x0 + 5, y0: booth.y1 - deckH - 3, x1: booth.x1 - 5, y1: booth.y1 - 3 };
  const djR = Math.min(r * 1.05, (deck.y0 - booth.y0) * 0.46);
  const py = (deck.y0 + deck.y1) / 2;
  const pr = Math.min(deckH * 0.4, bw * 0.12);
  const cx = (booth.x0 + booth.x1) / 2;
  return {
    dj: { x: cx, y: booth.y0 + (deck.y0 - booth.y0) * 0.5, r: djR },
    deck,
    platters: [
      { x: booth.x0 + bw * 0.24, y: py, r: pr },
      { x: booth.x1 - bw * 0.24, y: py, r: pr },
    ],
  };
}

function rect(ctx: CanvasRenderingContext2D, r: Rect) {
  ctx.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
}

/** Light leaving one door: a wedge that widens and fades across the pavement. */
export function spillPath(ctx: CanvasRenderingContext2D, x: number, half: number, y: number, length: number) {
  ctx.beginPath();
  ctx.moveTo(x - half, y);
  ctx.lineTo(x + half, y);
  ctx.lineTo(x + half * 1.8, y + length);
  ctx.lineTo(x - half * 1.8, y + length);
  ctx.closePath();
}

/** Paints everything that never moves into an offscreen canvas. */
export function paintFloor(layout: Layout, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(layout.w * dpr);
  canvas.height = Math.round(layout.h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const { w, h, shell, room, floor, booth, speakers, lanes, wallT, street, kerbY, r, tile, cols, rows } = layout;

  ctx.fillStyle = NIGHT;
  ctx.fillRect(0, 0, w, h);

  // Pavement: staggered slabs, brightest by the club wall.
  const pave = ctx.createLinearGradient(0, street.y0, 0, kerbY);
  pave.addColorStop(0, '#201c28');
  pave.addColorStop(1, '#14121a');
  ctx.fillStyle = pave;
  ctx.fillRect(0, street.y0, w, kerbY - street.y0);
  const slab = r * 5;
  const courses = Math.max(1, Math.round((kerbY - street.y0) / slab));
  const course = (kerbY - street.y0) / courses;
  ctx.beginPath();
  for (let row = 0; row < courses; row++) {
    const y = street.y0 + row * course;
    if (row) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    for (let x = w / 2 + (row % 2 ? slab : 0) - Math.ceil(w / slab) * slab; x < w; x += slab * 2) {
      ctx.moveTo(Math.round(x) + 0.5, y);
      ctx.lineTo(Math.round(x) + 0.5, y + course);
    }
  }
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Kerb, then the road the bots arrive from.
  const kerb = Math.max(3, r * 0.36);
  ctx.fillStyle = '#0a090e';
  ctx.fillRect(0, kerbY, w, h - kerbY);
  ctx.fillStyle = '#322d3b';
  ctx.fillRect(0, kerbY - kerb, w, kerb);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(0, kerbY, w, kerb * 0.7);

  // The club lights its own doorstep.
  const cx = (room.x0 + room.x1) / 2;
  const reach = (lanes[lanes.length - 1]!.x - lanes[0]!.x) / 2 + r * 9;
  const depth = Math.min(kerbY - street.y0, r * 13);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, street.y0, w, kerbY - street.y0);
  ctx.clip();
  ctx.translate(cx, street.y0);
  ctx.scale(1, depth / reach);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
  glow.addColorStop(0, `rgba(${WARM}, 0.26)`);
  glow.addColorStop(0.5, `rgba(${WARM}, 0.1)`);
  glow.addColorStop(1, `rgba(${WARM}, 0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(-reach, 0, reach * 2, reach);
  ctx.restore();

  // A strip of carpet and a wedge of light at every door, roped off from the next.
  const rope = r * 4.2;
  for (const lane of lanes) {
    const carpet = ctx.createLinearGradient(0, shell.y1, 0, shell.y1 + rope);
    carpet.addColorStop(0, '#453848');
    carpet.addColorStop(1, '#2b2430');
    ctx.fillStyle = carpet;
    ctx.beginPath();
    ctx.roundRect(lane.x - lane.half + 1, shell.y1, lane.half * 2 - 2, rope, [0, 0, 3, 3]);
    ctx.fill();
    const spill = ctx.createLinearGradient(0, shell.y1, 0, shell.y1 + rope * 1.5);
    spill.addColorStop(0, `rgba(${WARM}, 0.34)`);
    spill.addColorStop(1, `rgba(${WARM}, 0)`);
    ctx.fillStyle = spill;
    spillPath(ctx, lane.x, lane.half, shell.y1, rope * 1.5);
    ctx.fill();
  }
  const gapX = lanes[1]!.x - lanes[0]!.x;
  const posts = [lanes[0]!.x - gapX / 2, ...lanes.map((lane) => lane.x + gapX / 2)];
  ctx.strokeStyle = 'rgba(226, 189, 119, 0.4)';
  ctx.lineWidth = Math.max(1.25, r * 0.13);
  ctx.beginPath();
  for (const px of posts) {
    ctx.moveTo(px, shell.y1);
    ctx.lineTo(px, shell.y1 + rope);
  }
  ctx.stroke();
  const postR = Math.max(2, r * 0.24);
  for (const px of posts) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.arc(px + 1, shell.y1 + rope + 1.5, postR, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#e2bd77';
    ctx.beginPath();
    ctx.arc(px, shell.y1 + rope, postR, 0, TAU);
    ctx.fill();
  }

  // Interior: dark room, walls throwing shadow inwards.
  ctx.fillStyle = ROOM;
  ctx.fillRect(room.x0, room.y0, room.x1 - room.x0, room.y1 - room.y0);
  const shade = r * 2.4;
  // Each edge: the strip to shade, then the gradient from the wall inwards.
  const edges: [Rect, number, number, number, number][] = [
    [{ x0: room.x0, y0: room.y0, x1: room.x1, y1: room.y0 + shade }, 0, room.y0, 0, room.y0 + shade],
    [{ x0: room.x0, y0: room.y1 - shade * 0.6, x1: room.x1, y1: room.y1 }, 0, room.y1, 0, room.y1 - shade * 0.6],
    [{ x0: room.x0, y0: room.y0, x1: room.x0 + shade, y1: room.y1 }, room.x0, 0, room.x0 + shade, 0],
    [{ x0: room.x1 - shade, y0: room.y0, x1: room.x1, y1: room.y1 }, room.x1, 0, room.x1 - shade, 0],
  ];
  for (const [strip, gx0, gy0, gx1, gy1] of edges) {
    const { x0: x, y0: y } = strip;
    const ew = strip.x1 - strip.x0;
    const eh = strip.y1 - strip.y0;
    const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, ew, eh);
  }

  // Dance floor: unlit light tiles in a dark frame. The live layer adds the colour.
  const pad = Math.max(2, r * 0.3);
  ctx.fillStyle = '#2a2431';
  ctx.beginPath();
  ctx.roundRect(floor.x0 - pad, floor.y0 - pad, floor.x1 - floor.x0 + pad * 2, floor.y1 - floor.y0 + pad * 2, pad);
  ctx.fill();
  ctx.fillStyle = GROUT;
  ctx.fillRect(floor.x0, floor.y0, floor.x1 - floor.x0, floor.y1 - floor.y0);
  const seam = tileSeam(layout) / 2;
  ctx.fillStyle = TILE;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      ctx.fillRect(floor.x0 + i * tile + seam, floor.y0 + j * tile + seam, tile - seam * 2, tile - seam * 2);
    }
  }

  // Walls: one solid mass with a lit top edge; the entrance wall has six openings.
  const openings = lanes.map((lane) => [lane.x - lane.half, lane.x + lane.half] as const);
  ctx.beginPath();
  rect(ctx, shell);
  rect(ctx, room);
  for (const [a, b] of openings) ctx.rect(a, room.y1, b - a, wallT);
  ctx.fillStyle = WALL;
  ctx.fill('evenodd');
  ctx.fillStyle = '#4a3d40';
  for (const [a, b] of openings) ctx.fillRect(a, room.y1, b - a, wallT);

  ctx.strokeStyle = `rgba(${INK}, 0.16)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const y of [shell.y1, room.y1]) {
    const inset = y === room.y1 ? wallT : 0;
    let x = shell.x0 + inset;
    for (const [a, b] of openings) {
      ctx.moveTo(x, y);
      ctx.lineTo(a, y);
      x = b;
    }
    ctx.moveTo(x, y);
    ctx.lineTo(shell.x1 - inset, y);
  }
  ctx.moveTo(shell.x0, shell.y1);
  ctx.lineTo(shell.x0, shell.y0);
  ctx.lineTo(shell.x1, shell.y0);
  ctx.lineTo(shell.x1, shell.y1);
  ctx.moveTo(room.x0, room.y1);
  ctx.lineTo(room.x0, room.y0);
  ctx.lineTo(room.x1, room.y0);
  ctx.lineTo(room.x1, room.y1);
  for (const [a, b] of openings) {
    ctx.moveTo(a, room.y1);
    ctx.lineTo(a, shell.y1);
    ctx.moveTo(b, room.y1);
    ctx.lineTo(b, shell.y1);
  }
  ctx.stroke();

  // DJ booth: a riser against the back wall with the decks at its front edge.
  const parts = boothParts(layout);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.roundRect(booth.x0 + 2, booth.y0, booth.x1 - booth.x0, booth.y1 - booth.y0 + 4, [0, 0, 8, 8]);
  ctx.fill();
  ctx.fillStyle = KIT;
  ctx.beginPath();
  ctx.roundRect(booth.x0, booth.y0, booth.x1 - booth.x0, booth.y1 - booth.y0, [0, 0, 7, 7]);
  ctx.fill();
  const { deck, platters } = parts;
  ctx.fillStyle = '#39313f';
  ctx.beginPath();
  ctx.roundRect(deck.x0, deck.y0, deck.x1 - deck.x0, deck.y1 - deck.y0, 4);
  ctx.fill();
  ctx.fillStyle = `rgba(${INK}, 0.12)`;
  ctx.fillRect(deck.x0 + 3, deck.y0, deck.x1 - deck.x0 - 6, 1);
  platters.forEach((p, i) => {
    ctx.fillStyle = KIT_DARK;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(${INK}, 0.14)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 0.68, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = i ? '#45dde6' : '#ff6b5b';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 0.34, 0, TAU);
    ctx.fill();
  });
  // Mixer: three knobs between the decks.
  const knob = Math.max(1.2, platters[0]!.r * 0.16);
  ctx.fillStyle = `rgba(${INK}, 0.5)`;
  for (const k of [-1, 0, 1]) {
    ctx.beginPath();
    ctx.arc((deck.x0 + deck.x1) / 2 + k * knob * 3.4, (deck.y0 + deck.y1) / 2, knob, 0, TAU);
    ctx.fill();
  }

  // Speakers: a cabinet either side, cone facing up.
  for (const s of speakers) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.roundRect(s.x0 + 2, s.y0 + 3, s.x1 - s.x0, s.y1 - s.y0, 4);
    ctx.fill();
    ctx.fillStyle = KIT;
    ctx.beginPath();
    ctx.roundRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0, 4);
    ctx.fill();
    ctx.strokeStyle = `rgba(${INK}, 0.1)`;
    ctx.lineWidth = 1;
    ctx.stroke();
    const sx = (s.x0 + s.x1) / 2;
    const sy = (s.y0 + s.y1) / 2;
    const cone = (s.x1 - s.x0) * 0.34;
    ctx.fillStyle = KIT_DARK;
    ctx.beginPath();
    ctx.arc(sx, sy, cone, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(${INK}, 0.16)`;
    ctx.stroke();
    ctx.fillStyle = '#3a323f';
    ctx.beginPath();
    ctx.arc(sx, sy, cone * 0.36, 0, TAU);
    ctx.fill();
  }

  return canvas;
}

/** Width of the dark joint between two light tiles. */
export function tileSeam(layout: Layout): number {
  return Math.max(1.5, layout.tile * 0.07);
}

/** A shaded body for one bot colour, drawn once and stamped for every bot. */
export function paintBody(color: string, radius: number, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const size = Math.ceil(radius * 2 * dpr) + 2;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const R = c - 1;
  ctx.beginPath();
  ctx.arc(c, c, R, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.clip();
  // Lit from the top left, falling into shade at the opposite rim.
  const dark = ctx.createRadialGradient(c - R * 0.3, c - R * 0.35, R * 0.7, c - R * 0.3, c - R * 0.35, R * 1.55);
  dark.addColorStop(0, 'rgba(30, 10, 45, 0)');
  dark.addColorStop(1, 'rgba(30, 10, 45, 0.42)');
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, size, size);
  const lit = ctx.createRadialGradient(c - R * 0.38, c - R * 0.44, 0, c - R * 0.38, c - R * 0.44, R * 0.9);
  lit.addColorStop(0, 'rgba(255, 255, 255, 0.36)');
  lit.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = lit;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
