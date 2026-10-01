export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Lane {
  x: number;
  /** Half width of the door opening. */
  half: number;
}

export interface Layout {
  w: number;
  h: number;
  /** Bot radius. */
  r: number;
  wallT: number;
  /** Outer edge of the club walls. */
  shell: Rect;
  /** Free floor inside the walls. */
  room: Rect;
  /** Centre line of the entrance wall. */
  doorY: number;
  lanes: Lane[];
  /** Where a bot stands while Clef-flash decides. */
  queueY: number;
  /** Walkable street below the club. */
  street: Rect;
  /** Where the line mills about. */
  waitArea: Rect;
  floor: Rect;
  booth: Rect;
  speakers: [Rect, Rect];
  obstacles: Rect[];
  tile: number;
}

export const LANE_COUNT = 6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Lays the club out in CSS pixels for a viewport, leaving `top` and `bottom`
 * free for the header and the control dock.
 */
export function computeLayout(w: number, h: number, top: number, bottom: number): Layout {
  const r = clamp(Math.min(w, h * 1.1) * 0.0108, 6.5, 12);
  const margin = clamp(w * 0.035, 12, 40);
  const y0 = top + 6;
  const y1 = Math.max(y0 + 160, h - bottom - 2);
  const height = y1 - y0;
  const wallT = clamp(r * 1.05, 7, 12);

  const shellWidth = Math.min(w - margin * 2, 1320);
  const sx0 = (w - shellWidth) / 2;
  const roomShare = height < 420 ? 0.56 : w / height > 1.6 ? 0.6 : 0.63;
  const shell: Rect = { x0: sx0, y0, x1: sx0 + shellWidth, y1: y0 + height * roomShare };
  const room: Rect = { x0: shell.x0 + wallT, y0: shell.y0 + wallT, x1: shell.x1 - wallT, y1: shell.y1 - wallT };
  const roomW = room.x1 - room.x0;
  const roomH = room.y1 - room.y0;
  const doorY = shell.y1 - wallT / 2;

  const strip = Math.min(roomW * 0.8, LANE_COUNT * r * 10);
  const spacing = strip / LANE_COUNT;
  const half = Math.max(r * 1.45, Math.min(spacing * 0.34, r * 2.5));
  const cx = (room.x0 + room.x1) / 2;
  const lanes: Lane[] = Array.from({ length: LANE_COUNT }, (_, i) => ({
    x: cx - strip / 2 + spacing * (i + 0.5),
    half,
  }));

  const street: Rect = { x0: margin * 0.4, y0: shell.y1, x1: w - margin * 0.4, y1 };
  const queueY = shell.y1 + r + 3;
  const waitTop = Math.min(queueY + r * 5.5, street.y1 - r * 7);
  const waitArea: Rect = {
    x0: shell.x0 + r * 2,
    y0: Math.max(queueY + r * 3, waitTop),
    x1: shell.x1 - r * 2,
    y1: street.y1 - r * 1.6,
  };

  const boothW = clamp(roomW * 0.22, 84, 230);
  const boothH = clamp(roomH * 0.11, 24, 52);
  const booth: Rect = { x0: cx - boothW / 2, y0: room.y0, x1: cx + boothW / 2, y1: room.y0 + boothH };
  const sp = boothH * 0.92;
  const gap = clamp(roomW * 0.03, 8, 28);
  const speakers: [Rect, Rect] = [
    { x0: booth.x0 - gap - sp, y0: room.y0 + 3, x1: booth.x0 - gap, y1: room.y0 + 3 + sp },
    { x0: booth.x1 + gap, y0: room.y0 + 3, x1: booth.x1 + gap + sp, y1: room.y0 + 3 + sp },
  ];

  const floor: Rect = {
    x0: room.x0 + roomW * 0.1,
    x1: room.x1 - roomW * 0.1,
    y0: booth.y1 + roomH * 0.1,
    y1: room.y1 - roomH * 0.15,
  };

  return {
    w,
    h,
    r,
    wallT,
    shell,
    room,
    doorY,
    lanes,
    queueY,
    street,
    waitArea,
    floor,
    booth,
    speakers,
    obstacles: [booth, ...speakers],
    tile: r * 3.4,
  };
}

/** Map a point from one rect into the same relative spot in another. */
export function remapPoint(x: number, y: number, from: Rect, to: Rect): [number, number] {
  const fx = (x - from.x0) / Math.max(1, from.x1 - from.x0);
  const fy = (y - from.y0) / Math.max(1, from.y1 - from.y0);
  return [to.x0 + fx * (to.x1 - to.x0), to.y0 + fy * (to.y1 - to.y0)];
}
