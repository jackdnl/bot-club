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
  /** Where the pavement ends and the road begins. */
  kerbY: number;
  /** Where the line mills about. */
  waitArea: Rect;
  floor: Rect;
  booth: Rect;
  speakers: [Rect, Rect];
  obstacles: Rect[];
  /** Side of one light tile; the dance floor is exactly `cols` by `rows` of them. */
  tile: number;
  cols: number;
  rows: number;
}

export const LANE_COUNT = 6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Lays the club out in CSS pixels for a viewport, leaving `top` and `bottom`
 * free for the header and the control dock.
 */
export function computeLayout(w: number, h: number, top: number, bottom: number): Layout {
  const margin = clamp(w * 0.035, 12, 40);
  const y0 = top + 6;
  const y1 = Math.max(y0 + 160, h - bottom - 2);
  const height = y1 - y0;
  const r = clamp(Math.sqrt(w * height) * 0.0155, 6.5, 14);
  const wallT = clamp(r * 1.05, 7, 14);

  const shellWidth = Math.min(w - margin * 2, 1320);
  const sx0 = (w - shellWidth) / 2;
  const roomShare = height < 420 ? 0.6 : 0.68;
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
  // A strip of road shows below the pavement when there is height to spare.
  const kerbY = height < 420 ? street.y1 : street.y1 - r * 2.6;
  const waitTop = Math.min(queueY + r * 5.5, street.y1 - r * 7);
  const waitArea: Rect = {
    x0: shell.x0 + r * 2,
    y0: Math.max(queueY + r * 3, waitTop),
    x1: shell.x1 - r * 2,
    y1: Math.min(street.y1 - r * 1.6, kerbY - r * 0.4),
  };

  // The DJ stands between the back wall and the decks, so the booth is two bots deep.
  const boothW = clamp(roomW * 0.24, 96, 250);
  const boothH = clamp(r * 5, 32, Math.max(32, roomH * 0.2));
  const booth: Rect = { x0: cx - boothW / 2, y0: room.y0, x1: cx + boothW / 2, y1: room.y0 + boothH };
  const sp = boothH * 0.78;
  const gap = clamp(roomW * 0.03, 8, 28);
  const speakers: [Rect, Rect] = [
    { x0: booth.x0 - gap - sp, y0: room.y0 + 3, x1: booth.x0 - gap, y1: room.y0 + 3 + sp },
    { x0: booth.x1 + gap, y0: room.y0 + 3, x1: booth.x1 + gap + sp, y1: room.y0 + 3 + sp },
  ];

  // Light tiles: about one bot each, snapped so the floor is a whole number of them.
  const sideGap = r * 2;
  const floorW = roomW - sideGap * 2;
  const cols = Math.max(4, Math.round(floorW / (r * 2.7)));
  const tile = floorW / cols;
  const freeTop = booth.y1 + r * 1.6;
  const freeBottom = room.y1 - r * 3.4;
  const rows = Math.max(2, Math.floor((freeBottom - freeTop) / tile));
  const floorY0 = freeTop + (freeBottom - freeTop - rows * tile) / 2;
  const floor: Rect = { x0: room.x0 + sideGap, x1: room.x1 - sideGap, y0: floorY0, y1: floorY0 + rows * tile };

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
    kerbY,
    waitArea,
    floor,
    booth,
    speakers,
    obstacles: [booth, ...speakers],
    tile,
    cols,
    rows,
  };
}

/** Map a point from one rect into the same relative spot in another. */
export function remapPoint(x: number, y: number, from: Rect, to: Rect): [number, number] {
  const fx = (x - from.x0) / Math.max(1, from.x1 - from.x0);
  const fy = (y - from.y0) / Math.max(1, from.y1 - from.y0);
  return [to.x0 + fx * (to.x1 - to.x0), to.y0 + fy * (to.y1 - to.y0)];
}
