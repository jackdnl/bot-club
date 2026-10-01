import type { Layout, Rect } from './layout';

export const INK = '243, 235, 225';
const BG = '#161210';
const ROOM = '#1e1916';
const FLOOR = '#241e1a';

function rect(ctx: CanvasRenderingContext2D, r: Rect) {
  ctx.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
}

function grid(ctx: CanvasRenderingContext2D, area: Rect, step: number, alpha: number, ox = 0, oy = 0) {
  ctx.beginPath();
  const startX = area.x0 + ((((ox - area.x0) % step) + step) % step);
  for (let x = startX; x <= area.x1; x += step) {
    ctx.moveTo(Math.round(x) + 0.5, area.y0);
    ctx.lineTo(Math.round(x) + 0.5, area.y1);
  }
  const startY = area.y0 + ((((oy - area.y0) % step) + step) % step);
  for (let y = startY; y <= area.y1; y += step) {
    ctx.moveTo(area.x0, Math.round(y) + 0.5);
    ctx.lineTo(area.x1, Math.round(y) + 0.5);
  }
  ctx.strokeStyle = `rgba(${INK}, ${alpha})`;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, align: CanvasTextAlign = 'left', alpha = 0.3) {
  ctx.save();
  ctx.font = `600 ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.letterSpacing = `${(size * 0.22).toFixed(1)}px`;
  ctx.fillStyle = `rgba(${INK}, ${alpha})`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Diagonal hatching clipped to the wall poché. */
function hatch(ctx: CanvasRenderingContext2D, clip: () => void, bounds: Rect, step: number) {
  ctx.save();
  ctx.beginPath();
  clip();
  ctx.clip('evenodd');
  ctx.beginPath();
  const span = bounds.y1 - bounds.y0;
  for (let x = bounds.x0 - span; x < bounds.x1; x += step) {
    ctx.moveTo(x, bounds.y1);
    ctx.lineTo(x + span, bounds.y0);
  }
  ctx.strokeStyle = `rgba(${INK}, 0.16)`;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** Paints everything that never moves into an offscreen canvas. */
export function paintFloor(layout: Layout, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(layout.w * dpr);
  canvas.height = Math.round(layout.h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const { shell, room, floor, booth, speakers, lanes, wallT, street, r } = layout;
  const small = Math.max(8, Math.min(10.5, r * 1.0));

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, layout.w, layout.h);

  // Street paving: big slabs, very faint, with a kerb line at the bottom.
  grid(ctx, { x0: 0, y0: street.y0, x1: layout.w, y1: street.y1 }, layout.tile * 2.4, 0.028, layout.w / 2, street.y0);
  ctx.fillStyle = `rgba(${INK}, 0.05)`;
  ctx.fillRect(0, street.y1 - 1, layout.w, 1);

  // Interior.
  ctx.fillStyle = ROOM;
  ctx.fillRect(room.x0, room.y0, room.x1 - room.x0, room.y1 - room.y0);
  grid(ctx, room, layout.tile, 0.035, (room.x0 + room.x1) / 2, room.y0);

  // Dance floor: finer checker, a hairline border, corner ticks.
  ctx.fillStyle = FLOOR;
  ctx.fillRect(floor.x0, floor.y0, floor.x1 - floor.x0, floor.y1 - floor.y0);
  const cell = layout.tile * 0.75;
  ctx.fillStyle = `rgba(${INK}, 0.022)`;
  for (let y = floor.y0, row = 0; y < floor.y1; y += cell, row++) {
    for (let x = floor.x0 + (row % 2) * cell, col = 0; x < floor.x1; x += cell * 2, col++) {
      ctx.fillRect(x, y, Math.min(cell, floor.x1 - x), Math.min(cell, floor.y1 - y));
    }
  }
  ctx.strokeStyle = `rgba(${INK}, 0.14)`;
  ctx.lineWidth = 1;
  ctx.strokeRect(floor.x0 + 0.5, floor.y0 + 0.5, floor.x1 - floor.x0 - 1, floor.y1 - floor.y0 - 1);
  label(ctx, 'DANCE FLOOR', floor.x0 + 10, floor.y1 - small - 2, small);

  // Walls: outer and inner hairlines with hatched poché; the entrance wall has openings.
  const openings = lanes.map((lane) => [lane.x - lane.half, lane.x + lane.half] as const);
  const wallPath = () => {
    rect(ctx, shell);
    rect(ctx, room);
    for (const [a, b] of openings) ctx.rect(a, room.y1, b - a, wallT);
  };
  ctx.save();
  ctx.beginPath();
  wallPath();
  ctx.fillStyle = `rgba(${INK}, 0.07)`;
  ctx.fill('evenodd');
  ctx.restore();
  hatch(ctx, wallPath, shell, 5);

  ctx.strokeStyle = `rgba(${INK}, 0.55)`;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  // Top and sides as closed runs; bottom wall broken by each opening.
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

  // Plan-style door swings: dashed quarter arcs into the room.
  ctx.save();
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = `rgba(${INK}, 0.2)`;
  ctx.lineWidth = 1;
  for (const lane of lanes) {
    const hx = lane.x - lane.half;
    const len = lane.half * 2;
    ctx.beginPath();
    ctx.arc(hx, room.y1, len, -Math.PI / 2, 0);
    ctx.stroke();
  }
  ctx.restore();

  // Queue rope: posts between lanes on the street side.
  const ropeLen = r * 3.6;
  ctx.strokeStyle = `rgba(${INK}, 0.16)`;
  ctx.lineWidth = 1;
  const posts: number[] = [lanes[0]!.x - (lanes[1]!.x - lanes[0]!.x) / 2];
  for (let i = 0; i < lanes.length; i++) {
    const next = lanes[i + 1];
    posts.push(next ? (lanes[i]!.x + next.x) / 2 : lanes[i]!.x + (lanes[i]!.x - lanes[i - 1]!.x) / 2);
  }
  ctx.beginPath();
  for (const px of posts) {
    ctx.moveTo(px, shell.y1 + 2);
    ctx.lineTo(px, shell.y1 + ropeLen);
  }
  ctx.stroke();
  ctx.fillStyle = `rgba(${INK}, 0.32)`;
  for (const px of posts) {
    ctx.beginPath();
    ctx.arc(px, shell.y1 + ropeLen, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  const entranceX = posts[0]! - 10;
  if (entranceX - small * 7 > street.x0) label(ctx, 'ENTRANCE', entranceX, shell.y1 + ropeLen * 0.55, small, 'right', 0.26);
  else label(ctx, 'ENTRANCE', (posts[0]! + posts[posts.length - 1]!) / 2, shell.y1 + ropeLen + small * 1.4, small, 'center', 0.22);
  label(ctx, 'STREET', street.x0 + 8, street.y1 - small, small, 'left', 0.2);

  // DJ booth: deck with two platters and a mixer.
  const bw = booth.x1 - booth.x0;
  const bh = booth.y1 - booth.y0;
  ctx.fillStyle = `rgba(${INK}, 0.05)`;
  ctx.strokeStyle = `rgba(${INK}, 0.45)`;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.roundRect(booth.x0, booth.y0 - 2, bw, bh + 2, [0, 0, 6, 6]);
  ctx.fill();
  ctx.stroke();
  const pr = Math.min(bh * 0.34, bw * 0.14);
  ctx.lineWidth = 1;
  for (const px of [booth.x0 + bw * 0.22, booth.x1 - bw * 0.22]) {
    ctx.beginPath();
    ctx.arc(px, booth.y0 + bh * 0.5, pr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, booth.y0 + bh * 0.5, pr * 0.25, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeRect(booth.x0 + bw * 0.42, booth.y0 + bh * 0.25, bw * 0.16, bh * 0.5);

  // Speakers: squares with concentric cones.
  for (const s of speakers) {
    const sw = s.x1 - s.x0;
    ctx.fillStyle = `rgba(${INK}, 0.04)`;
    ctx.strokeStyle = `rgba(${INK}, 0.42)`;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.roundRect(s.x0, s.y0, sw, s.y1 - s.y0, 3);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1;
    for (const f of [0.36, 0.22, 0.08]) {
      ctx.beginPath();
      ctx.arc((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, sw * f, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  label(ctx, 'DJ', (booth.x0 + booth.x1) / 2, booth.y1 + small + 3, small, 'center', 0.3);

  return canvas;
}
