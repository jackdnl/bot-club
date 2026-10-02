import type { Ticket, TicketStatus } from '../admissions';
import { BOT_COLORS, PALETTE } from '../../shared/colors';
import { INK, WARM, boothParts, paintBody, paintFloor, spillPath, tileSeam, type Booth } from './floor';
import { computeLayout, remapPoint, type Layout, type Rect } from './layout';

type Mode = 'arrive' | 'mill' | 'approach' | 'door' | 'enter' | 'dance' | 'bounce' | 'leave';
type Zone = 'arrive' | 'street' | 'gate' | 'room' | 'exit';
type Style = 'hop' | 'sway' | 'spin' | 'shuffle' | 'shy';

const STYLES: Style[] = ['hop', 'sway', 'spin', 'shuffle', 'shy'];
const BPM = 118;
const LIME = '196, 240, 74';
const CORAL = '255, 107, 91';
const LAVENDER = '180, 156, 255';
const CREAM = '#fffaf2';
const DJ_COLOR = '#efe6da';
const TAU = Math.PI * 2;
/** Steady colour pools on the light tiles: rgb, then position as a fraction of the floor. */
const POOLS: [string, number, number][] = [
  ['255, 107, 91', 0.14, 0.3],
  ['180, 156, 255', 0.4, 0.78],
  ['69, 221, 230', 0.66, 0.2],
  ['196, 240, 74', 0.9, 0.7],
];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Bot {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  tx = 0;
  ty = 0;
  mode: Mode = 'arrive';
  zone: Zone = 'arrive';
  modeT = 0;
  lane = -1;
  /** Door this bot was admitted through, kept until it is inside. */
  door = -1;
  /** Verdict has been drawn: the bot is through the door or bouncing away. */
  shown = false;
  delay: number;
  /** Not on the street yet: staggered spawns wait off screen until their delay runs out. */
  hidden = true;
  scale = 0;
  scaleV = 0;
  squash = 0;
  squashV = 0;
  squashAngle = 0;
  lift = 0;
  lookX = 0;
  lookY = -1;
  glanceX = 0;
  glanceY = -1;
  glanceT = 0;
  blinkIn = rand(1, 5);
  blinkT = 0;
  style: Style = STYLES[Math.floor(Math.random() * STYLES.length)]!;
  energy = rand(0.65, 1.35);
  phase = Math.random();
  group = 0;
  slotA = rand(0, TAU);
  slotR = Math.sqrt(Math.random());
  regroupIn = rand(9, 24);
  wanderIn = 0;
  lastBeat = -1;
  exitX = 0;
  readonly color: string;
  /** Index into the palette, shared with the light tiles this bot stands on. */
  readonly hue: number;

  constructor(
    readonly ticket: Ticket,
    delay: number,
  ) {
    this.delay = delay;
    this.hue = BOT_COLORS.indexOf(ticket.profile.color);
    this.color = PALETTE[this.hue]!;
    if (this.style === 'shy') this.slotR = rand(0.85, 1);
  }

  get id(): number {
    return this.ticket.id;
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.modeT = 0;
  }

  kick(amount: number, angle: number): void {
    this.squashV += amount;
    this.squashAngle = angle;
  }
}

interface Door {
  angle: number;
  openUntil: number;
  /** The gate light holds the last verdict's colour until this time. */
  verdictUntil: number;
  verdict: string;
}

interface Group {
  ax: number;
  ay: number;
  fx: number;
  fy: number;
  px: number;
  py: number;
  spin: number;
  count: number;
  x: number;
  y: number;
}

export interface WorldCallbacks {
  /** A delayed spawn has stepped onto the street and should join the line. */
  onArrive(ticket: Ticket): void;
}

export class World {
  layout: Layout;
  bots: Bot[] = [];
  readonly byId = new Map<number, Bot>();
  selectedId: number | null = null;
  hoverId: number | null = null;
  reducedMotion = false;
  /** Anchor rectangle of the inspect card in CSS px, for the leader line. */
  cardRect: DOMRect | null = null;

  private ctx: CanvasRenderingContext2D;
  private floorCanvas: HTMLCanvasElement | null = null;
  private bodies: HTMLCanvasElement[] = [];
  private djBody: HTMLCanvasElement | null = null;
  private booth: Booth | null = null;
  /** One pixel per light tile, plus a dark border so the glow fades out at the edges. */
  private light: HTMLCanvasElement | null = null;
  private lightCtx: CanvasRenderingContext2D | null = null;
  private tileGlow = new Float32Array(0);
  private tileHue = new Uint8Array(0);
  private dpr = 1;
  private time = 0;
  private laneQueues: number[][] = [];
  private doors: Door[] = [];
  private groups: Group[] = [];
  private cellHead = new Int32Array(0);
  private cellNext = new Int32Array(0);

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: WorldCallbacks,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.layout = computeLayout(1, 1, 0, 0);
    this.resetTiles();
  }

  private resetTiles(): void {
    const count = this.layout.cols * this.layout.rows;
    this.tileGlow = new Float32Array(count);
    this.tileHue = new Uint8Array(count);
  }

  resize(w: number, h: number, top: number, bottom: number, dpr: number): void {
    const prev = this.layout;
    const next = computeLayout(w, h, top, bottom);
    this.layout = next;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.floorCanvas = paintFloor(next, dpr);
    this.bodies = PALETTE.map((color) => paintBody(color, next.r, dpr));
    this.booth = boothParts(next);
    this.djBody = paintBody(DJ_COLOR, this.booth.dj.r, dpr);
    this.light = document.createElement('canvas');
    this.light.width = next.cols + 2;
    this.light.height = next.rows + 2;
    this.lightCtx = this.light.getContext('2d');
    this.resetTiles();
    if (this.laneQueues.length !== next.lanes.length) {
      this.laneQueues = next.lanes.map(() => []);
      this.doors = next.lanes.map(() => ({ angle: 0, openUntil: 0, verdictUntil: 0, verdict: LIME }));
    }
    this.buildGroups();
    if (prev.w > 1) {
      const fullPrev: Rect = { ...prev.street, x0: 0, x1: prev.w };
      const fullNext: Rect = { ...next.street, x0: 0, x1: next.w };
      for (const b of this.bots) {
        const inside = b.zone === 'room' || b.zone === 'gate';
        [b.x, b.y] = inside ? remapPoint(b.x, b.y, prev.room, next.room) : remapPoint(b.x, b.y, fullPrev, fullNext);
        b.wanderIn = 0;
        if (b.mode === 'leave') b.exitX = b.exitX < prev.w / 2 ? -next.r * 4 : next.w + next.r * 4;
      }
    }
  }

  private buildGroups(): void {
    const { floor, r } = this.layout;
    const fw = floor.x1 - floor.x0;
    const count = clamp(Math.round(fw / (r * 13)), 3, 7);
    const old = this.groups;
    this.groups = Array.from({ length: count }, (_, i) => ({
      ax: rand(0.55, 0.9),
      ay: rand(0.2, 0.34),
      fx: rand(0.035, 0.075) * (i % 2 ? 1 : -1),
      fy: rand(0.05, 0.1),
      px: (i / count) * TAU + rand(-0.3, 0.3),
      py: rand(0, TAU),
      spin: rand(0.06, 0.16) * (Math.random() < 0.5 ? -1 : 1),
      count: 0,
      x: 0,
      y: 0,
    }));
    for (const b of this.bots) {
      if (b.mode !== 'dance') continue;
      if (b.group >= count || old.length !== count) b.group = Math.floor(Math.random() * count);
      this.groups[b.group]!.count++;
    }
  }

  addBot(ticket: Ticket, delay: number): Bot {
    const bot = new Bot(ticket, delay);
    const { street, w, r } = this.layout;
    const spread = Math.min(w * 0.42, (street.x1 - street.x0) * 0.45);
    bot.x = w / 2 + rand(-1, 1) * spread * Math.random();
    bot.y = street.y1 + r * rand(2, 5);
    this.bots.push(bot);
    this.byId.set(ticket.id, bot);
    return bot;
  }

  clear(): void {
    this.bots = [];
    this.byId.clear();
    this.laneQueues = this.layout.lanes.map(() => []);
    for (const door of this.doors) Object.assign(door, { openUntil: 0, verdictUntil: 0 });
    for (const g of this.groups) g.count = 0;
    this.tileGlow.fill(0);
    this.selectedId = null;
    this.hoverId = null;
  }

  /** The request for this bot has started: give it a lane at the door. */
  assignLane(ticket: Ticket): void {
    const bot = this.byId.get(ticket.id);
    if (!bot || bot.lane >= 0) return;
    let best = 0;
    let bestScore = Infinity;
    this.layout.lanes.forEach((lane, i) => {
      const score = this.laneQueues[i]!.length * 10_000 + Math.abs(lane.x - bot.x);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    bot.lane = best;
    this.laneQueues[best]!.push(bot.id);
    if (bot.mode !== 'arrive') bot.setMode('approach');
  }

  /** Failed (after any automatic retry): step out of the lane and wait in the street. */
  releaseToStreet(ticket: Ticket): void {
    const bot = this.byId.get(ticket.id);
    if (!bot) return;
    this.leaveLane(bot);
    if (bot.mode !== 'arrive') {
      bot.setMode('mill');
      bot.wanderIn = 0;
      bot.kick(0.25, 0);
    }
  }

  private leaveLane(bot: Bot): void {
    if (bot.lane < 0) return;
    const q = this.laneQueues[bot.lane]!;
    const i = q.indexOf(bot.id);
    if (i >= 0) q.splice(i, 1);
    bot.lane = -1;
  }

  /**
   * Status shown in the card and guest list: the real verdict as soon as it arrives.
   * "Admitted" means permission granted; the walk through the door follows on its own.
   */
  displayStatus(ticket: Ticket): TicketStatus {
    return ticket.status;
  }

  pick(x: number, y: number, slop: number): number | null {
    let best: number | null = null;
    let bestD = Infinity;
    for (const b of this.bots) {
      if (b.hidden) continue;
      const d = Math.hypot(b.x - x, b.y - b.lift - y);
      if (d < this.layout.r + slop && d < bestD) {
        bestD = d;
        best = b.id;
      }
    }
    return best;
  }

  anchorOf(id: number): { x: number; y: number; r: number } | null {
    const b = this.byId.get(id);
    if (!b || b.hidden) return null;
    return { x: b.x, y: b.y - b.lift, r: this.layout.r * Math.max(0.4, b.scale) };
  }

  /** Bots in draw order (top to bottom) for keyboard cycling. */
  visibleIds(): number[] {
    return this.bots.filter((b) => !b.hidden && b.mode !== 'leave').map((b) => b.id);
  }

  // ---------------------------------------------------------------- simulation

  step(dt: number): void {
    this.time += dt;
    const t = this.time;
    const L = this.layout;
    const beat = (t * BPM) / 60;

    this.updateGroups(t);

    for (const door of this.doors) {
      const target = t < door.openUntil ? Math.PI / 2 : 0;
      door.angle += (target - door.angle) * Math.min(1, dt * (this.reducedMotion ? 30 : 16));
    }

    const removed: Bot[] = [];
    for (const b of this.bots) {
      if (b.hidden) {
        b.delay -= dt;
        if (b.delay > 0) continue;
        b.hidden = false;
        b.vy = -rand(5, 9) * L.r * 10;
        b.vx = (b.x - L.w / 2) * rand(0.6, 1.4);
        b.wanderIn = 0;
        this.callbacks.onArrive(b.ticket);
      }
      b.modeT += dt;
      this.think(b, dt, t, beat);
      this.animate(b, dt, t, beat);
      if (b.mode === 'leave' && (b.x < -L.r * 3 || b.x > L.w + L.r * 3)) removed.push(b);
    }

    this.collide();
    for (const b of this.bots) if (!b.hidden) this.constrain(b);
    this.lightTiles(dt);

    for (const b of removed) {
      this.byId.delete(b.id);
      if (this.selectedId === b.id) this.selectedId = null;
      if (this.hoverId === b.id) this.hoverId = null;
    }
    if (removed.length) this.bots = this.bots.filter((b) => !removed.includes(b));
  }

  /** Every bot on the floor lights the tile under it in its own colour; the light fades behind it. */
  private lightTiles(dt: number): void {
    const { floor, tile, cols, rows } = this.layout;
    const glow = this.tileGlow;
    const fade = dt * 1.1;
    for (let k = 0; k < glow.length; k++) glow[k] = Math.max(0, glow[k]! - fade);
    for (const b of this.bots) {
      if (b.zone !== 'room') continue;
      const i = Math.floor((b.x - floor.x0) / tile);
      const j = Math.floor((b.y - floor.y0) / tile);
      if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
      const k = j * cols + i;
      // A tile shared by two bots keeps the colour of whoever lit it first.
      if (glow[k]! >= 0.75 && this.tileHue[k] !== b.hue) continue;
      glow[k] = 0.8;
      this.tileHue[k] = b.hue;
    }
  }

  private updateGroups(t: number): void {
    const { floor, r } = this.layout;
    const cy = (floor.y0 + floor.y1) / 2;
    const fw = floor.x1 - floor.x0;
    const fh = floor.y1 - floor.y0;
    const n = this.groups.length;
    this.groups.forEach((g, i) => {
      // Each group drifts around its own slice of the floor, so crowds stay loose and distinct.
      const home = floor.x0 + fw * ((i + 0.5) / n);
      const slice = fw / n / 2;
      const zig = i % 2 ? fh * 0.2 : -fh * 0.2;
      if (this.reducedMotion) {
        g.x = home;
        g.y = cy + zig;
      } else {
        g.x = home + Math.sin(t * g.fx + g.px) * slice * g.ax;
        g.y = cy + zig * Math.cos(t * g.fy * 0.7 + g.px) + Math.sin(t * g.fy + g.py) * fh * g.ay;
      }
      const R = this.groupRadius(g);
      g.x = clamp(g.x, floor.x0 + Math.min(R, fw / 2 - r), floor.x1 - Math.min(R, fw / 2 - r));
      g.y = clamp(g.y, floor.y0 + Math.min(R * 0.7, fh / 2 - r), floor.y1 - Math.min(R * 0.7, fh / 2 - r));
    });
  }

  private groupRadius(g: Group): number {
    return this.layout.r * 1.9 * Math.sqrt(g.count + 1);
  }

  private think(b: Bot, dt: number, t: number, beat: number): void {
    const L = this.layout;
    const r = L.r;
    let maxSpeed = r * 7;
    let accel = 4;
    let steer = true;

    if (b.zone === 'arrive' && b.y < L.street.y1 - r) b.zone = 'street';

    switch (b.mode) {
      case 'arrive': {
        maxSpeed = r * 9;
        accel = 2.5;
        this.wander(b, dt);
        if (b.zone === 'street') b.setMode(b.lane >= 0 ? 'approach' : 'mill');
        break;
      }
      case 'mill': {
        maxSpeed = r * (b.ticket.status === 'error' ? 3 : 4.5) * b.energy;
        accel = 2.2;
        this.wander(b, dt);
        if (b.lane >= 0) b.setMode('approach');
        break;
      }
      case 'approach':
      case 'door': {
        maxSpeed = r * 18;
        accel = 6;
        const slot = this.laneQueues[b.lane]?.indexOf(b.id) ?? -1;
        const lane = L.lanes[b.lane];
        if (!lane || slot < 0) {
          b.setMode('mill');
          break;
        }
        b.tx = lane.x + (slot ? Math.sin(b.phase * TAU) * r * 0.6 : 0);
        b.ty = L.queueY + slot * r * 2.4;
        const close = Math.hypot(b.tx - b.x, b.ty - b.y) < r * 0.6;
        if (b.mode === 'approach' && slot === 0 && close) {
          b.setMode('door');
          b.kick(0.18, Math.PI / 2);
        }
        // Act the verdict out quickly so the floor never lags far behind finished requests.
        // Rejections need no door: they bounce out of the line from wherever they stand.
        // Admitted bots follow each other straight through once everyone ahead is decided too.
        const status = b.ticket.status;
        const near = Math.hypot(b.tx - b.x, b.ty - b.y) < r * 3;
        if (status === 'rejected' && (near || b.modeT > 1.5)) this.showVerdict(b);
        else if (status === 'admitted' && (near || b.modeT > 1.5) && this.laneAheadDecided(b, slot)) {
          this.showVerdict(b);
        }
        break;
      }
      case 'enter': {
        maxSpeed = r * 18;
        accel = 7;
        const lane = L.lanes[b.door];
        const door = this.doors[b.door];
        if (!lane || !door) {
          b.zone = 'room';
          b.setMode('dance');
          break;
        }
        if (b.zone !== 'gate') {
          b.tx = lane.x;
          b.ty = L.queueY;
          door.openUntil = t + 0.5;
          door.verdictUntil = t + 0.5;
          door.verdict = LIME;
          if (Math.abs(b.x - lane.x) < r * 0.8 && Math.abs(b.y - L.queueY) < r * 1.6 && door.angle > 0.6) {
            b.zone = 'gate';
            this.leaveLane(b);
          }
        } else {
          b.tx = lane.x;
          b.ty = L.room.y1 - r * 3.5;
          door.openUntil = t + 0.35;
          door.verdictUntil = t + 0.35;
          door.verdict = LIME;
          if (b.y < L.room.y1 - r * 1.3) {
            b.zone = 'room';
            this.joinGroup(b, Math.floor(Math.random() * this.groups.length));
            b.setMode('dance');
          }
        }
        break;
      }
      case 'dance': {
        maxSpeed = r * 6;
        accel = 3.5;
        b.regroupIn -= dt;
        if (b.regroupIn <= 0) {
          b.regroupIn = rand(10, 26);
          const next = (b.group + 1 + Math.floor(Math.random() * (this.groups.length - 1))) % this.groups.length;
          this.joinGroup(b, next);
        }
        const g = this.groups[b.group]!;
        const R = this.groupRadius(g);
        const a = b.slotA + (this.reducedMotion ? 0 : t * g.spin);
        let tx = g.x + Math.cos(a) * R * b.slotR;
        let ty = g.y + Math.sin(a) * R * b.slotR * 0.75;
        if (!this.reducedMotion) {
          const e = b.energy;
          const ph = (beat + b.phase) * Math.PI;
          if (b.style === 'sway') tx += Math.sin(ph) * r * 0.8 * e;
          else if (b.style === 'spin') {
            tx += Math.cos(ph * 0.5) * r * 1.1 * e;
            ty += Math.sin(ph * 0.5) * r * 1.1 * e;
          } else if (b.style === 'shuffle') {
            const k = Math.floor(beat + b.phase);
            tx += (hash(b.id, k) - 0.5) * r * 2 * e;
            ty += (hash(k, b.id) - 0.5) * r * 1.4 * e;
          } else if (b.style === 'shy') tx += Math.sin(ph * 0.5) * r * 0.35;
        }
        const f = L.floor;
        b.tx = clamp(tx, f.x0 + r, f.x1 - r);
        b.ty = clamp(ty, f.y0 + r, f.y1 - r);
        break;
      }
      case 'bounce': {
        steer = false;
        b.vx *= Math.pow(0.12, dt);
        b.vy *= Math.pow(0.12, dt);
        if (b.modeT > 0.42) {
          b.setMode('leave');
          b.zone = 'exit';
        }
        break;
      }
      case 'leave': {
        maxSpeed = r * 10;
        accel = 2.5;
        b.tx = b.exitX;
        b.ty = clamp(b.ty, L.waitArea.y0, L.street.y1 - r);
        break;
      }
    }

    if (steer) {
      const dx = b.tx - b.x;
      const dy = b.ty - b.y;
      const d = Math.hypot(dx, dy) || 1;
      const speed = Math.min(maxSpeed, d * 3);
      const k = Math.min(1, accel * dt);
      b.vx += ((dx / d) * speed - b.vx) * k;
      b.vy += ((dy / d) * speed - b.vy) * k;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }

  private laneAheadDecided(b: Bot, slot: number): boolean {
    const q = this.laneQueues[b.lane] ?? [];
    for (let i = 0; i < slot; i++) {
      const s = this.byId.get(q[i]!)?.ticket.status;
      if (s !== 'admitted' && s !== 'rejected') return false;
    }
    return true;
  }

  private joinGroup(b: Bot, index: number): void {
    if (b.mode === 'dance') this.groups[b.group]!.count--;
    b.group = clamp(index, 0, this.groups.length - 1);
    this.groups[b.group]!.count++;
  }

  private wander(b: Bot, dt: number): void {
    b.wanderIn -= dt;
    const close = Math.hypot(b.tx - b.x, b.ty - b.y) < this.layout.r;
    if (b.wanderIn > 0 && !close) return;
    const w = this.layout.waitArea;
    // Loose crowd biased toward the middle; new arrivals fan out from where they appear.
    const u = (Math.random() + Math.random()) / 2;
    const fx = b.mode === 'arrive' ? clamp((b.x - w.x0) / (w.x1 - w.x0), 0, 1) * 0.5 + u * 0.5 : u;
    b.tx = w.x0 + (w.x1 - w.x0) * fx;
    b.ty = w.y0 + (w.y1 - w.y0) * Math.random();
    b.wanderIn = rand(2.5, 7);
  }

  private showVerdict(b: Bot): void {
    const L = this.layout;
    const door = this.doors[b.lane];
    b.shown = true;
    if (b.ticket.status === 'admitted') {
      b.door = b.lane;
      b.setMode('enter');
      if (door) {
        door.verdict = LIME;
        door.verdictUntil = this.time + 0.6;
        door.openUntil = this.time + 0.6;
      }
      b.kick(0.3, Math.PI / 2);
    } else {
      const lane = L.lanes[b.lane];
      const side = lane ? (lane.x < L.w / 2 ? -1 : 1) * (Math.random() < 0.2 ? -1 : 1) : 1;
      // A door that is already open for someone else stays lime; a shut one shows the refusal.
      if (door && this.time >= door.openUntil) {
        door.verdict = CORAL;
        door.verdictUntil = this.time + 0.9;
      }
      this.leaveLane(b);
      b.vx = side * L.r * rand(26, 36);
      b.vy = L.r * rand(7, 12);
      b.kick(0.55, 0);
      b.exitX = side < 0 ? -L.r * 4 : L.w + L.r * 4;
      b.ty = clamp(b.y + rand(2, 6) * L.r, L.waitArea.y0, L.street.y1 - L.r);
      b.setMode('bounce');
    }
  }

  private animate(b: Bot, dt: number, t: number, beat: number): void {
    const r = this.layout.r;
    // Spawn pop.
    if (this.reducedMotion) b.scale = Math.min(1, b.scale + dt * 5);
    else {
      b.scaleV += ((1 - b.scale) * 260 - b.scaleV * 15) * dt;
      b.scale += b.scaleV * dt;
    }
    // Squash spring.
    b.squashV += (-b.squash * 320 - b.squashV * 14) * dt;
    b.squash = clamp(b.squash + b.squashV * dt, -0.35, 0.35);

    b.lift = 0;
    if (b.mode === 'dance' && !this.reducedMotion) {
      const k = Math.floor(beat + b.phase);
      if (k !== b.lastBeat) {
        b.lastBeat = k;
        if (b.style === 'hop' || b.style === 'shuffle') b.kick(0.16 * b.energy, Math.PI / 2);
        else if (b.style !== 'shy' && hash(b.id, k) < 0.3) b.kick(0.08, 0);
      }
      if (b.style === 'hop') {
        const ph = (beat + b.phase) % 1;
        b.lift = Math.sin(ph * Math.PI) * r * 0.45 * b.energy;
      }
    }

    // Where the eyes point.
    const speed = Math.hypot(b.vx, b.vy);
    b.glanceT -= dt;
    if (b.glanceT <= 0) {
      b.glanceT = rand(1.2, 3.6);
      const L = this.layout;
      if (b.mode === 'dance' && Math.random() < 0.55) {
        const bx = (L.booth.x0 + L.booth.x1) / 2 - b.x;
        const by = L.booth.y1 - b.y;
        const d = Math.hypot(bx, by) || 1;
        b.glanceX = bx / d;
        b.glanceY = by / d;
      } else {
        const a = rand(0, TAU);
        b.glanceX = Math.cos(a);
        b.glanceY = Math.sin(a);
      }
    }
    let lx = b.glanceX;
    let ly = b.glanceY;
    if (b.mode === 'door' || b.mode === 'approach') {
      lx = Math.sin(t * 0.9 + b.phase * TAU) * 0.45;
      ly = -1;
    } else if (speed > r * 5 && b.mode !== 'bounce') {
      lx = b.vx / speed;
      ly = b.vy / speed;
    } else if (b.mode === 'bounce' || b.mode === 'leave') {
      lx = b.vx >= 0 ? 0.5 : -0.5;
      ly = 0.85;
    }
    const k = Math.min(1, dt * 8);
    b.lookX += (lx - b.lookX) * k;
    b.lookY += (ly - b.lookY) * k;
    const n = Math.hypot(b.lookX, b.lookY) || 1;
    b.lookX /= n;
    b.lookY /= n;

    b.blinkIn -= dt;
    if (b.blinkIn <= 0) {
      b.blinkT = 0.13;
      b.blinkIn = rand(2.2, 6.5);
    }
    b.blinkT = Math.max(0, b.blinkT - dt);
  }

  private mass(b: Bot): number {
    switch (b.mode) {
      case 'approach':
      case 'door':
      case 'enter':
        return 6;
      case 'bounce':
      case 'leave':
        return 2.5;
      default:
        return 1;
    }
  }

  private collide(): void {
    const L = this.layout;
    const r = L.r;
    const cell = r * 2.4;
    const cols = Math.ceil(L.w / cell) + 2;
    const rows = Math.ceil(L.h / cell) + 8;
    const cellCount = cols * rows;
    if (this.cellHead.length < cellCount) this.cellHead = new Int32Array(cellCount);
    if (this.cellNext.length < this.bots.length) this.cellNext = new Int32Array(this.bots.length * 2);
    const head = this.cellHead;
    const next = this.cellNext;
    head.fill(-1, 0, cellCount);
    const cellOf = (b: Bot) => {
      const cx = clamp(Math.floor(b.x / cell) + 1, 0, cols - 1);
      const cy = clamp(Math.floor(b.y / cell) + 1, 0, rows - 1);
      return cy * cols + cx;
    };
    const bots = this.bots;
    for (let i = 0; i < bots.length; i++) {
      if (bots[i]!.hidden) continue;
      const c = cellOf(bots[i]!);
      next[i] = head[c]!;
      head[c] = i;
    }
    const minD = r * 2.05;
    for (let i = 0; i < bots.length; i++) {
      const a = bots[i]!;
      if (a.hidden) continue;
      const acx = clamp(Math.floor(a.x / cell) + 1, 0, cols - 1);
      const acy = clamp(Math.floor(a.y / cell) + 1, 0, rows - 1);
      for (let oy = -1; oy <= 1; oy++) {
        const cy = acy + oy;
        if (cy < 0 || cy >= rows) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const cx = acx + ox;
          if (cx < 0 || cx >= cols) continue;
          for (let j = head[cy * cols + cx]!; j !== -1; j = next[j]!) {
            if (j <= i) continue;
            const b = bots[j]!;
            // Walls keep street and room apart; only bots in the door frame mix with both.
            const roomA = a.zone === 'room' || a.zone === 'gate';
            const roomB = b.zone === 'room' || b.zone === 'gate';
            if (roomA !== roomB && a.zone !== 'gate' && b.zone !== 'gate') continue;
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let d2 = dx * dx + dy * dy;
            if (d2 >= minD * minD) continue;
            if (d2 < 1e-6) {
              dx = Math.random() - 0.5;
              dy = Math.random() - 0.5;
              d2 = dx * dx + dy * dy;
            }
            const d = Math.sqrt(d2);
            const nx = dx / d;
            const ny = dy / d;
            const overlap = (minD - d) * 0.5;
            const ma = this.mass(a);
            const mb = this.mass(b);
            const wa = mb / (ma + mb);
            const wb = ma / (ma + mb);
            a.x -= nx * overlap * wa;
            a.y -= ny * overlap * wa;
            b.x += nx * overlap * wb;
            b.y += ny * overlap * wb;
            const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rel < 0) {
              const imp = rel * 0.6;
              a.vx += nx * imp * wa;
              a.vy += ny * imp * wa;
              b.vx -= nx * imp * wb;
              b.vy -= ny * imp * wb;
              if (rel < -r * 8) {
                const ang = Math.atan2(ny, nx);
                a.kick(0.12, ang);
                b.kick(0.12, ang);
              }
            }
          }
        }
      }
    }
  }

  private constrain(b: Bot): void {
    const L = this.layout;
    const r = L.r;
    let x0 = -Infinity;
    let x1 = Infinity;
    let y0 = -Infinity;
    let y1 = Infinity;
    switch (b.zone) {
      case 'room':
        x0 = L.room.x0 + r;
        x1 = L.room.x1 - r;
        y0 = L.room.y0 + r;
        y1 = L.room.y1 - r;
        break;
      case 'street':
        x0 = L.street.x0 + r;
        x1 = L.street.x1 - r;
        y0 = L.shell.y1 + r;
        y1 = L.street.y1 - r;
        break;
      case 'arrive':
        x0 = L.street.x0 + r;
        x1 = L.street.x1 - r;
        y0 = L.shell.y1 + r;
        break;
      case 'exit':
        y0 = L.shell.y1 + r;
        y1 = L.street.y1 - r;
        break;
      case 'gate': {
        y0 = L.room.y0 + r;
        y1 = L.street.y1 - r;
        const lane = L.lanes[b.door];
        if (lane && b.y > L.room.y1 - r && b.y < L.shell.y1 + r) {
          x0 = lane.x - lane.half + r;
          x1 = lane.x + lane.half - r;
        } else {
          x0 = L.room.x0 + r;
          x1 = L.room.x1 - r;
        }
        break;
      }
    }
    if (b.x < x0 || b.x > x1) {
      const hit = Math.abs(b.vx);
      b.x = clamp(b.x, x0, x1);
      b.vx *= -0.3;
      if (hit > r * 10) b.kick(Math.min(0.3, hit / (r * 120)), 0);
    }
    if (b.y < y0 || b.y > y1) {
      const hit = Math.abs(b.vy);
      b.y = clamp(b.y, y0, y1);
      b.vy *= -0.3;
      if (hit > r * 10 && b.zone !== 'arrive') b.kick(Math.min(0.3, hit / (r * 120)), Math.PI / 2);
    }
    if (b.zone === 'room') {
      for (const o of L.obstacles) {
        const cx = clamp(b.x, o.x0, o.x1);
        const cy = clamp(b.y, o.y0, o.y1);
        const dx = b.x - cx;
        const dy = b.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          b.x = cx + (dx / d) * r;
          b.y = cy + (dy / d) * r;
        } else {
          b.y = o.y1 + r;
        }
      }
    }
  }

  // ---------------------------------------------------------------- rendering

  render(): void {
    const ctx = this.ctx;
    const L = this.layout;
    const t = this.time;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.floorCanvas) ctx.drawImage(this.floorCanvas, 0, 0, L.w, L.h);
    else {
      ctx.fillStyle = '#0d0c12';
      ctx.fillRect(0, 0, L.w, L.h);
    }
    this.drawFloorLight(ctx);
    this.drawBooth(ctx, t);
    this.drawDoors(ctx);

    const live = this.bots.filter((b) => !b.hidden);
    live.sort((a, b) => a.y - b.y);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    for (const b of live) {
      const s = L.r * b.scale * (1 - b.lift / (L.r * 3));
      ctx.beginPath();
      ctx.ellipse(b.x + L.r * 0.18, b.y + L.r * 0.36, s * 1.02, s * 0.84, 0, 0, TAU);
      ctx.fill();
    }
    for (const b of live) this.drawBot(ctx, b);
    this.drawSelection(ctx);
  }

  /** Light tiles: steady colour pools plus the tiles the dancers are standing on. */
  private drawFloorLight(ctx: CanvasRenderingContext2D): void {
    const light = this.light;
    const lc = this.lightCtx;
    if (!light || !lc) return;
    const { floor, room, tile, cols, rows } = this.layout;
    const fw = floor.x1 - floor.x0;
    const fh = floor.y1 - floor.y0;

    lc.globalCompositeOperation = 'source-over';
    lc.globalAlpha = 1;
    lc.fillStyle = '#000';
    lc.fillRect(0, 0, cols + 2, rows + 2);
    lc.save();
    lc.beginPath();
    lc.rect(1, 1, cols, rows);
    lc.clip();
    lc.globalCompositeOperation = 'lighter';
    const radius = Math.sqrt(cols * rows) * 0.42;
    for (const [rgb, fx, fy] of POOLS) {
      const x = 1 + cols * fx;
      const y = 1 + rows * fy;
      const g = lc.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, `rgba(${rgb}, 0.34)`);
      g.addColorStop(1, `rgba(${rgb}, 0)`);
      lc.fillStyle = g;
      lc.fillRect(1, 1, cols, rows);
    }
    // A lit tile takes its dancer's colour outright rather than adding to the pool under it.
    lc.globalCompositeOperation = 'source-over';
    const glow = this.tileGlow;
    const hue = this.tileHue;
    for (let c = 0; c < PALETTE.length; c++) {
      lc.fillStyle = PALETTE[c]!;
      for (let k = 0; k < glow.length; k++) {
        if (hue[k] !== c || glow[k]! < 0.02) continue;
        lc.globalAlpha = glow[k]! * 0.62;
        lc.fillRect(1 + (k % cols), 1 + Math.floor(k / cols), 1, 1);
      }
    }
    lc.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(light, 1, 1, cols, rows, floor.x0, floor.y0, fw, fh);
    ctx.restore();

    // Joints between tiles, redrawn over the light so every tile keeps a crisp edge.
    ctx.beginPath();
    for (let i = 0; i <= cols; i++) {
      ctx.moveTo(floor.x0 + i * tile, floor.y0);
      ctx.lineTo(floor.x0 + i * tile, floor.y1);
    }
    for (let j = 0; j <= rows; j++) {
      ctx.moveTo(floor.x0, floor.y0 + j * tile);
      ctx.lineTo(floor.x1, floor.y0 + j * tile);
    }
    ctx.strokeStyle = '#09080c';
    ctx.lineWidth = tileSeam(this.layout);
    ctx.stroke();

    // The same light, blurred by upscaling, hangs over the floor and reaches the walls.
    ctx.save();
    ctx.beginPath();
    ctx.rect(room.x0, room.y0, room.x1 - room.x0, room.y1 - room.y0);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.22;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(light, floor.x0 - tile * 1.5, floor.y0 - tile * 1.5, fw + tile * 3, fh + tile * 3);
    ctx.restore();
  }

  private drawBooth(ctx: CanvasRenderingContext2D, t: number): void {
    const booth = this.booth;
    if (!booth) return;
    const spin = this.reducedMotion ? 0 : t;

    // Records turn; a pale mark on each label shows it.
    ctx.fillStyle = CREAM;
    booth.platters.forEach((p, i) => {
      const a = spin * 3.4 * (i ? 1 : 1.07) - Math.PI / 4;
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(a) * p.r * 0.2, p.y + Math.sin(a) * p.r * 0.2, Math.max(1, p.r * 0.09), 0, TAU);
      ctx.fill();
    });

    // The DJ: scenery, not a guest. Watches the floor from behind the decks.
    const { x, y, r } = booth.dj;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.18, y + r * 0.36, r * 1.02, r * 0.84, 0, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.translate(x, y);
    if (this.djBody) ctx.drawImage(this.djBody, -r, -r, r * 2, r * 2);
    const lx = Math.sin(spin * 0.45) * 0.6;
    const n = Math.hypot(lx, 1);
    this.drawEyes(ctx, r, lx / n, 1 / n, !this.reducedMotion && t % 4.3 < 0.12);
    // Headphones: a cup on each ear.
    ctx.fillStyle = '#3a323f';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * r * 0.98, 0, r * 0.22, r * 0.4, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /** What the gate light says, straight from the tickets in that lane. */
  private doorLight(i: number, door: Door): [string, number] {
    if (this.time < door.verdictUntil) return [door.verdict, 1];
    const deciding = this.laneQueues[i]!.some((id) => {
      const b = this.byId.get(id);
      return b && b.mode === 'door' && !b.shown;
    });
    if (deciding) return [LAVENDER, 0.62];
    return [WARM, 0.5 * (door.angle / (Math.PI / 2))];
  }

  private drawDoors(ctx: CanvasRenderingContext2D): void {
    const L = this.layout;
    const reach = L.r * 6.6;
    L.lanes.forEach((lane, i) => {
      const door = this.doors[i]!;
      const [rgb, level] = this.doorLight(i, door);
      const x0 = lane.x - lane.half;
      const wide = lane.half * 2;

      if (level > 0.02) {
        // The doorway fills with the colour and throws it down the carpet.
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(${rgb}, ${level * 0.4})`;
        ctx.fillRect(x0, L.room.y1, wide, L.wallT);
        const g = ctx.createLinearGradient(0, L.shell.y1, 0, L.shell.y1 + reach);
        g.addColorStop(0, `rgba(${rgb}, ${level * 0.5})`);
        g.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = g;
        spillPath(ctx, lane.x, lane.half, L.shell.y1, reach);
        ctx.fill();
        ctx.restore();
      }
      // Lamp strip on the street side of the threshold.
      const lamp = Math.max(2.5, L.r * 0.26);
      ctx.fillStyle = level > 0.02 ? `rgba(${rgb}, ${0.55 + level * 0.45})` : `rgba(${WARM}, 0.5)`;
      ctx.beginPath();
      ctx.roundRect(x0 + 2, L.shell.y1 - lamp / 2, wide - 4, lamp, lamp / 2);
      ctx.fill();

      // Door leaf, hinged on the left, swinging into the room.
      const a = door.angle;
      const hy = L.doorY;
      ctx.strokeStyle = '#d9cfc4';
      ctx.lineWidth = Math.max(2.5, L.r * 0.3);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, hy);
      ctx.lineTo(x0 + Math.cos(-a) * wide, hy + Math.sin(-a) * wide);
      ctx.stroke();
    });
  }

  private drawBot(ctx: CanvasRenderingContext2D, b: Bot): void {
    const r = this.layout.r * b.scale;
    if (r <= 0.3) return;
    const x = b.x;
    const y = b.y - b.lift;
    const speed = Math.hypot(b.vx, b.vy);
    const stretch = this.reducedMotion ? 0 : Math.min(0.1, speed / (this.layout.r * 130));
    const status = b.ticket.status;

    ctx.save();
    if (status === 'error') ctx.globalAlpha = 0.7;
    ctx.translate(x, y);
    // Squash on its own axis, stretch along travel.
    ctx.rotate(b.squashAngle);
    ctx.scale(1 + b.squash, 1 - b.squash);
    ctx.rotate(-b.squashAngle);
    if (stretch > 0.01) {
      const va = Math.atan2(b.vy, b.vx);
      ctx.rotate(va);
      ctx.scale(1 + stretch, 1 - stretch * 0.8);
      ctx.rotate(-va);
    }
    const R = r * (1 + b.lift / (this.layout.r * 5));
    const body = this.bodies[b.hue];
    if (body) ctx.drawImage(body, -R, -R, R * 2, R * 2);
    this.drawEyes(ctx, R, b.lookX, b.lookY, b.blinkT > 0);
    ctx.restore();

    if (status === 'error') {
      ctx.save();
      ctx.setLineDash([2.5, 2.5]);
      ctx.strokeStyle = `rgba(${CORAL}, 0.95)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r + 3.5, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawEyes(ctx: CanvasRenderingContext2D, r: number, lx: number, ly: number, blink: boolean): void {
    const px = -ly;
    const py = lx;
    const fwd = r * 0.26;
    const side = r * 0.38;
    const ew = r * 0.31;
    const tilt = Math.atan2(ly, lx) + Math.PI / 2;
    for (const s of [-1, 1]) {
      const ex = lx * fwd + px * side * s;
      const ey = ly * fwd + py * side * s;
      ctx.fillStyle = CREAM;
      ctx.beginPath();
      if (blink) ctx.ellipse(ex, ey, ew * 0.7, ew * 0.16, tilt, 0, TAU);
      else ctx.ellipse(ex, ey, ew, ew, tilt, 0, TAU);
      ctx.fill();
      if (blink) continue;
      ctx.fillStyle = '#1b1512';
      ctx.beginPath();
      ctx.arc(ex + lx * ew * 0.42, ey + ly * ew * 0.42, ew * 0.54, 0, TAU);
      ctx.fill();
    }
  }

  private drawSelection(ctx: CanvasRenderingContext2D): void {
    const r = this.layout.r;
    const hover = this.hoverId !== null && this.hoverId !== this.selectedId ? this.byId.get(this.hoverId) : undefined;
    if (hover && !hover.hidden) {
      ctx.strokeStyle = `rgba(${INK}, 0.45)`;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(hover.x, hover.y - hover.lift, r + 5, 0, TAU);
      ctx.stroke();
    }
    const sel = this.selectedId !== null ? this.byId.get(this.selectedId) : undefined;
    if (!sel || sel.hidden) return;
    const x = sel.x;
    const y = sel.y - sel.lift;
    ctx.strokeStyle = CREAM;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r + 6, 0, TAU);
    ctx.stroke();
    const card = this.cardRect;
    if (card) {
      // Leader line from ring to the nearest point of the inspect card.
      const cx = clamp(x, card.left, card.right);
      const cy = clamp(y, card.top, card.bottom);
      const d = Math.hypot(cx - x, cy - y);
      if (d > r + 14) {
        const ux = (cx - x) / d;
        const uy = (cy - y) / d;
        ctx.strokeStyle = 'rgba(255, 250, 242, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + ux * (r + 8), y + uy * (r + 8));
        ctx.lineTo(cx, cy);
        ctx.stroke();
      }
    }
  }
}
