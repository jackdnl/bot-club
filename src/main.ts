import './styles.css';
import { validatePolicy } from '../shared/contract';
import { AdmissionDesk, type Ticket, type TicketStatus } from './admissions';
import { STATUS_LABEL, facts, itemLine } from './describe';
import { Metrics } from './metrics';
import { DEFAULT_POLICY, PRESETS, createProfile } from './profiles';
import { BOT_APPEARANCE, BOT_COLORS } from '../shared/colors';
import { World } from './scene/world';

const CLUB_CAPACITY = 150;
const LINE_CAPACITY = 100;
const ROSTER_LIMIT = 600;
const HOLD_DELAY_MS = 380;
const HOLD_INTERVAL_MS = 650;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('scene');
const top = $('top');
const dock = $('dock');
const policyForm = $<HTMLFormElement>('policy-form');
const policyInput = $<HTMLInputElement>('policy');
const customRuleButton = $<HTMLButtonElement>('custom-rule');
const applyButton = $<HTMLButtonElement>('apply');
const presetsToggle = $<HTMLButtonElement>('presets-toggle');
const presetsMenu = $('presets');
const spawnButton = $<HTMLButtonElement>('spawn');
const spawnLabel = $('spawn-label');
const sizeButtons = [...document.querySelectorAll<HTMLButtonElement>('.sizes button')];
const resetButton = $<HTMLButtonElement>('reset');
const retryAllButton = $<HTMLButtonElement>('retry-all');
const guestsToggle = $<HTMLButtonElement>('guests-toggle');
const guestsDialog = $<HTMLDialogElement>('guests');
const guestsClose = $<HTMLButtonElement>('guests-close');
const guestList = $<HTMLOListElement>('guest-list');
const guestsEmpty = $('guests-empty');
const notice = $('notice');
const card = $('card');
const metricsEls = {
  rate: $('m-rate'),
  median: $('m-median'),
  waiting: $('m-waiting'),
  inside: $('m-inside'),
  cap: $('m-cap'),
  out: $('m-out'),
};

// ------------------------------------------------------------------ state

let activePolicy = DEFAULT_POLICY;
let batchSize = 25;
let nextId = 1;
let turnedAway = 0;
const roster = new Map<number, Ticket>();
const metrics = new Metrics();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const world = new World(canvas, {
  onArrive: (ticket) => {
    if (roster.has(ticket.id)) desk.enqueue(ticket);
  },
});
world.reducedMotion = reducedMotion.matches;
reducedMotion.addEventListener('change', () => (world.reducedMotion = reducedMotion.matches));

const desk = new AdmissionDesk({
  getPolicy: () => activePolicy,
  concurrency: 6,
  hooks: {
    onStart: (ticket) => {
      metrics.noteStart(performance.now());
      world.assignLane(ticket);
    },
    onDecision: (ticket) => {
      if (ticket.verdict) metrics.record(ticket.verdict.rttMs, performance.now());
      // Cumulative, so trimming old guests from the roster never lowers the totals.
      if (ticket.status === 'rejected') turnedAway++;
    },
    onError: (ticket) => {
      world.releaseToStreet(ticket);
      const failed = countStatus('error');
      say(`${ticket.profile.name} got no answer: ${ticket.error?.message ?? 'unknown error'}${failed > 1 ? ` (${failed} waiting for retry)` : ''}`, 'warn');
    },
    onPause: () => updateMetrics(),
  },
});

function countStatus(...statuses: TicketStatus[]): number {
  let n = 0;
  for (const t of roster.values()) if (statuses.includes(t.status)) n++;
  return n;
}

function lineCount(): number {
  return countStatus('waiting', 'pending', 'retrying', 'error');
}

function spawnable(): { count: number; reason: 'club' | 'line' | null } {
  const inside = countStatus('admitted');
  const line = lineCount();
  const byLine = LINE_CAPACITY - line;
  const byClub = CLUB_CAPACITY - inside - line;
  if (byClub <= 0) return { count: 0, reason: 'club' };
  if (byLine <= 0) return { count: 0, reason: 'line' };
  return { count: Math.min(byLine, byClub), reason: byClub < byLine ? 'club' : 'line' };
}

// ------------------------------------------------------------------ notices

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function say(text: string, tone: 'info' | 'warn' = 'info', ms = 3200): void {
  notice.textContent = text;
  notice.classList.toggle('warn', tone === 'warn');
  notice.classList.add('show');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.remove('show'), ms);
}

// ------------------------------------------------------------------ spawning

function spawn(requested: number): number {
  const room = spawnable();
  const n = Math.min(requested, room.count);
  if (n <= 0) {
    say(room.reason === 'club' ? `${CLUB_CAPACITY} admitted: the club is full. Reset to start a new night.` : `The line is full at ${LINE_CAPACITY}. Let the door catch up.`, 'warn');
    return 0;
  }
  const gap = Math.min(0.04, 1.4 / n);
  for (let i = 0; i < n; i++) {
    const id = nextId++;
    const ticket: Ticket = {
      id,
      profile: createProfile(Math.random, BOT_COLORS[id % BOT_COLORS.length]!),
      status: 'waiting',
      policy: null,
      attempts: 0,
      deferrals: 0,
      verdict: null,
      error: null,
      version: 0,
    };
    roster.set(ticket.id, ticket);
    world.addBot(ticket, i * gap);
  }
  if (n < requested) say(`Only ${n} more fit ${room.reason === 'club' ? 'in the club' : 'in the line'}.`);
  trimRoster();
  updateControls();
  return n;
}

function trimRoster(): void {
  if (roster.size <= ROSTER_LIMIT) return;
  for (const [id, t] of roster) {
    if (roster.size <= ROSTER_LIMIT) break;
    if (t.status === 'rejected' && !world.byId.has(id)) roster.delete(id);
  }
}

let holdDelay: ReturnType<typeof setTimeout> | undefined;
let holdRepeat: ReturnType<typeof setInterval> | undefined;
let suppressClick = false;

function stopHold(): void {
  clearTimeout(holdDelay);
  clearInterval(holdRepeat);
  holdDelay = undefined;
  holdRepeat = undefined;
  spawnButton.classList.remove('holding');
}

spawnButton.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || spawnButton.disabled) return;
  suppressClick = false;
  stopHold();
  // Capture so a finger drifting off the button does not end the hold early.
  spawnButton.setPointerCapture(event.pointerId);
  holdDelay = setTimeout(() => {
    suppressClick = true;
    spawnButton.classList.add('holding');
    // Keep releasing while held; a full line just skips a beat, a full club ends the hold.
    const tick = () => {
      const room = spawnable();
      if (room.count > 0) spawn(batchSize);
      else if (room.reason === 'club') {
        spawn(batchSize);
        stopHold();
      }
    };
    tick();
    holdRepeat = setInterval(tick, HOLD_INTERVAL_MS);
  }, HOLD_DELAY_MS);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  spawnButton.addEventListener(type, stopHold);
}
window.addEventListener('blur', stopHold);
spawnButton.addEventListener('contextmenu', (event) => event.preventDefault());
spawnButton.addEventListener('click', () => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  spawn(batchSize);
});

for (const button of sizeButtons) {
  button.addEventListener('click', () => setBatch(Number(button.dataset.size)));
  button.addEventListener('keydown', (event) => {
    const i = sizeButtons.indexOf(button);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = sizeButtons[(i + step + sizeButtons.length) % sizeButtons.length]!;
    setBatch(Number(next.dataset.size));
    next.focus();
  });
}

function setBatch(size: number): void {
  batchSize = size;
  for (const b of sizeButtons) {
    const on = Number(b.dataset.size) === size;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  updateControls();
}

// ------------------------------------------------------------------ policy

function draftState(): { value: string; valid: boolean; dirty: boolean } {
  const checked = validatePolicy(policyInput.value);
  const value = checked.ok ? checked.value : policyInput.value;
  return { value, valid: checked.ok, dirty: value !== activePolicy };
}

function updatePolicyUi(): void {
  const { valid, dirty } = draftState();
  applyButton.disabled = !(valid && dirty);
  policyForm.classList.toggle('dirty', dirty);
}

policyInput.value = activePolicy;
customRuleButton.addEventListener('click', () => {
  closePresets();
  policyInput.focus();
  policyInput.select();
});
policyInput.addEventListener('input', updatePolicyUi);
policyInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && draftState().dirty) {
    event.stopPropagation();
    policyInput.value = activePolicy;
    updatePolicyUi();
  }
});
policyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const checked = validatePolicy(policyInput.value);
  if (!checked.ok) {
    say('Door policy needs 3 to 140 characters.', 'warn');
    return;
  }
  if (checked.value === activePolicy) return;
  activePolicy = checked.value;
  policyInput.value = activePolicy;
  updatePolicyUi();
  policyInput.blur();
  const atDoor = desk.inflightCount;
  say(atDoor ? 'Rule applied. Current checks keep their rule.' : 'Rule applied.', 'info', 1800);
});

for (const preset of PRESETS) {
  const item = document.createElement('button');
  item.type = 'button';
  item.setAttribute('role', 'menuitem');
  const small = document.createElement('small');
  small.textContent = preset.label;
  item.append(small, preset.policy);
  item.addEventListener('click', () => {
    policyInput.value = preset.policy;
    updatePolicyUi();
    closePresets();
    (applyButton.disabled ? policyInput : applyButton).focus();
  });
  presetsMenu.append(item);
}

function closePresets(): void {
  presetsMenu.hidden = true;
  presetsToggle.setAttribute('aria-expanded', 'false');
}

presetsToggle.addEventListener('click', () => {
  const open = presetsMenu.hidden;
  presetsMenu.hidden = !open;
  presetsToggle.setAttribute('aria-expanded', String(open));
  if (open) presetsMenu.querySelector('button')?.focus();
});
presetsMenu.addEventListener('keydown', (event) => {
  const items = [...presetsMenu.querySelectorAll('button')];
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    items[(i + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  } else if (event.key === 'Escape') {
    event.stopPropagation();
    closePresets();
    presetsToggle.focus();
  } else if (event.key === 'Tab') {
    closePresets();
  }
});
document.addEventListener('pointerdown', (event) => {
  if (!presetsMenu.hidden && !(event.target as Element).closest('.presets-wrap')) closePresets();
});

// ------------------------------------------------------------------ reset / retry

resetButton.addEventListener('click', () => {
  stopHold();
  desk.reset();
  world.clear();
  roster.clear();
  metrics.reset();
  turnedAway = 0;
  pinned = false;
  setCardTicket(null);
  notice.classList.remove('show');
  renderGuests();
  updateControls();
  updateMetrics();
});

retryAllButton.addEventListener('click', () => {
  let n = 0;
  for (const t of roster.values()) if (desk.retry(t)) n++;
  if (n) say(`Retrying ${n} under the current rule.`);
  updateControls();
});

// ------------------------------------------------------------------ inspect card

let pinned = false;
let cardTicket: Ticket | null = null;
let cardKey = '';
let cardSide: 'right' | 'left' | 'above' | 'below' = 'right';

const cardEls = {
  swatch: $('card-swatch'),
  name: $('card-name'),
  status: $('card-status'),
  meta: $('card-meta'),
  item: $('card-item'),
  intro: $('card-intro'),
  facts: $('card-facts'),
  retry: $<HTMLButtonElement>('card-retry'),
  close: $<HTMLButtonElement>('card-close'),
};

function shownTicket(): Ticket | null {
  const hover = world.hoverId !== null ? roster.get(world.hoverId) : undefined;
  if (hover) return hover;
  return world.selectedId !== null ? (roster.get(world.selectedId) ?? null) : null;
}

function setCardTicket(ticket: Ticket | null): void {
  cardTicket = ticket;
  cardKey = '';
  if (!ticket) {
    card.hidden = true;
    world.cardRect = null;
  }
}

function renderCard(): void {
  const ticket = cardTicket;
  if (!ticket) return;
  const status = world.displayStatus(ticket);
  const key = `${ticket.id}:${ticket.version}:${status}:${pinned}`;
  if (key === cardKey) return;
  cardKey = key;
  const appearance = BOT_APPEARANCE[ticket.profile.color];
  cardEls.swatch.style.background = appearance.hex;
  cardEls.swatch.setAttribute('role', 'img');
  cardEls.swatch.setAttribute('aria-label', `${appearance.description} bot`);
  cardEls.name.textContent = ticket.profile.name;
  cardEls.status.textContent = STATUS_LABEL[status];
  cardEls.status.className = `pill ${status}`;
  cardEls.meta.textContent = `${ticket.profile.species} · ${ticket.profile.job}`;
  cardEls.item.textContent = itemLine(ticket.profile.item);
  cardEls.intro.textContent = `“${ticket.profile.intro}”`;
  cardEls.facts.replaceChildren(
    ...facts(ticket, status).flatMap((f) => {
      const dt = document.createElement('dt');
      dt.textContent = f.label;
      const dd = document.createElement('dd');
      dd.textContent = f.value;
      if (f.tone) dd.className = f.tone;
      return [dt, dd];
    }),
  );
  cardEls.retry.hidden = !(status === 'error' && pinned);
  card.classList.toggle('pinned', pinned && world.selectedId === ticket.id);
  card.hidden = false;
}

function placeCard(): void {
  const ticket = cardTicket;
  if (!ticket) return;
  const anchor = world.anchorOf(ticket.id);
  if (!anchor) {
    // Bot walked off the street: close a hover card, keep nothing dangling.
    if (world.selectedId === ticket.id) world.selectedId = null;
    pinned = false;
    setCardTicket(shownTicket());
    return;
  }
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  const vw = window.innerWidth;
  const maxY = dock.getBoundingClientRect().top - 6;
  // Stay clear of the header when there is room; small screens may need the space.
  const headerBottom = top.getBoundingClientRect().bottom + 4;
  const minY = maxY - headerBottom >= h + 40 ? headerBottom : 8;
  const gap = anchor.r + 16;
  const spots = {
    right: [anchor.x + gap, anchor.y - h / 2],
    left: [anchor.x - gap - w, anchor.y - h / 2],
    above: [anchor.x - w / 2, anchor.y - gap - h],
    below: [anchor.x - w / 2, anchor.y + gap],
  } as const;
  const fits = (x: number, y: number) => x >= 8 && x + w <= vw - 8 && y >= minY && y + h <= maxY;
  const order = [cardSide, 'right', 'left', 'above', 'below'] as const;
  let chosen = order.find((side) => fits(...(spots[side] as [number, number])));
  if (!chosen) chosen = anchor.x < vw / 2 ? 'right' : 'left';
  cardSide = chosen;
  let [x, y] = spots[chosen] as [number, number];
  x = Math.min(Math.max(8, x), vw - w - 8);
  y = Math.min(Math.max(minY, y), Math.max(minY, maxY - h));
  card.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  world.cardRect = new DOMRect(x, y, w, h);
}

cardEls.close.addEventListener('click', () => deselect());
cardEls.retry.addEventListener('click', () => {
  if (cardTicket && desk.retry(cardTicket)) {
    say(`Retrying ${cardTicket.profile.name} under the current rule.`);
    updateControls();
  }
});

function select(id: number | null): void {
  world.selectedId = id;
  pinned = id !== null;
  world.hoverId = null;
  setCardTicket(shownTicket());
}

function deselect(): void {
  select(null);
}

function localPoint(event: PointerEvent | MouseEvent): [number, number] {
  const rect = canvas.getBoundingClientRect();
  return [event.clientX - rect.left, event.clientY - rect.top];
}

canvas.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse') return;
  const id = world.pick(...localPoint(event), 5);
  canvas.style.cursor = id === null ? '' : 'pointer';
  if (id !== world.hoverId) {
    world.hoverId = id;
    setCardTicket(shownTicket());
  }
});
canvas.addEventListener('pointerleave', () => {
  if (world.hoverId === null) return;
  world.hoverId = null;
  setCardTicket(shownTicket());
});
canvas.addEventListener('click', (event) => {
  const pointerType = (event as PointerEvent).pointerType;
  const id = world.pick(...localPoint(event), pointerType === 'mouse' ? 6 : 14);
  if (id === null || id === world.selectedId) deselect();
  else select(id);
});
canvas.addEventListener('keydown', (event) => {
  if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const ids = world.visibleIds();
  if (!ids.length) return;
  const i = world.selectedId === null ? -1 : ids.indexOf(world.selectedId);
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
  select(ids[(i + step + ids.length) % ids.length] ?? null);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!presetsMenu.hidden) {
    closePresets();
    return;
  }
  if (world.selectedId !== null || cardTicket) deselect();
});

// ------------------------------------------------------------------ guests list

const guestRows = new Map<number, { li: HTMLLIElement; key: string }>();

function renderGuests(): void {
  if (!guestsDialog.open) {
    guestRows.clear();
    guestList.replaceChildren();
    return;
  }
  const tickets = [...roster.values()].reverse();
  guestsEmpty.hidden = tickets.length > 0;
  const seen = new Set<number>();
  let previous: HTMLLIElement | null = null;
  for (const ticket of tickets) {
    seen.add(ticket.id);
    const status = world.displayStatus(ticket);
    const present = world.byId.has(ticket.id);
    const key = `${ticket.version}:${status}:${present}`;
    let row = guestRows.get(ticket.id);
    if (!row) {
      row = { li: document.createElement('li'), key: '' };
      guestRows.set(ticket.id, row);
    }
    if (row.key !== key) {
      row.key = key;
      fillGuestRow(row.li, ticket, status, present);
    }
    const expected: Element | null = previous ? previous.nextElementSibling : guestList.firstElementChild;
    if (expected !== row.li) guestList.insertBefore(row.li, expected);
    previous = row.li;
  }
  for (const [id, row] of guestRows) {
    if (!seen.has(id)) {
      row.li.remove();
      guestRows.delete(id);
    }
  }
}

function fillGuestRow(li: HTMLLIElement, ticket: Ticket, status: TicketStatus, present: boolean): void {
  const open = li.querySelector('details')?.open ?? false;
  const details = document.createElement('details');
  details.open = open;
  const summary = document.createElement('summary');
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  const appearance = BOT_APPEARANCE[ticket.profile.color];
  swatch.style.background = appearance.hex;
  swatch.setAttribute('role', 'img');
  swatch.setAttribute('aria-label', `${appearance.description} bot`);
  const name = document.createElement('span');
  name.className = 'g-name';
  name.textContent = ticket.profile.name;
  const species = document.createElement('span');
  species.className = 'g-species';
  species.textContent = ticket.profile.species;
  const pill = document.createElement('span');
  pill.className = `pill ${status}`;
  pill.textContent = STATUS_LABEL[status];
  summary.append(swatch, name, species, pill);

  const body = document.createElement('div');
  body.className = 'g-body';
  const lines = [
    `${ticket.profile.species} · ${ticket.profile.job}. ${itemLine(ticket.profile.item)}.`,
    `“${ticket.profile.intro}”`,
    ...facts(ticket, status).map((f) => `${f.label}: ${f.value}`),
  ];
  for (const text of lines) {
    const p = document.createElement('p');
    p.textContent = text;
    body.append(p);
  }
  if (present) {
    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'ghost';
    show.textContent = 'Show on floor';
    show.addEventListener('click', () => {
      guestsDialog.close();
      select(ticket.id);
      canvas.focus();
    });
    body.append(show);
  }
  if (status === 'error') {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'ghost warn';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => {
      desk.retry(ticket);
      updateControls();
      renderGuests();
    });
    body.append(retry);
  }
  details.append(summary, body);
  li.replaceChildren(details);
}

guestsToggle.addEventListener('click', () => {
  guestsDialog.showModal();
  renderGuests();
});
guestsClose.addEventListener('click', () => guestsDialog.close());
guestsDialog.addEventListener('click', (event) => {
  if (event.target === guestsDialog) guestsDialog.close();
});
guestsDialog.addEventListener('close', () => {
  renderGuests();
  guestsToggle.focus();
});

// ------------------------------------------------------------------ metrics & controls

function updateControls(): void {
  const room = spawnable();
  const n = Math.min(batchSize, room.count);
  const holding = holdRepeat !== undefined;
  // While held, a momentarily full line keeps the button live so the hold continues.
  spawnButton.disabled = room.count <= 0 && !(holding && room.reason === 'line');
  spawnLabel.textContent = room.count <= 0 ? (room.reason === 'club' ? 'Club full' : 'Line full') : `+${n} bots`;
  if (room.count <= 0 && room.reason === 'club') stopHold();
  const failed = countStatus('error');
  retryAllButton.hidden = failed === 0;
  retryAllButton.textContent = `Retry ${failed}`;
}

function updateMetrics(): void {
  const now = performance.now();
  const rate = metrics.rate(now);
  metricsEls.rate.textContent = rate === null ? '–' : rate < 10 ? rate.toFixed(1) : String(Math.round(rate));
  const median = metrics.median();
  metricsEls.median.innerHTML = '';
  if (median === null) metricsEls.median.textContent = '–';
  else {
    const unit = document.createElement('small');
    unit.textContent = 'ms';
    metricsEls.median.append(String(Math.round(median)), unit);
  }
  const waiting = countStatus('waiting', 'pending', 'retrying');
  metricsEls.waiting.textContent = String(waiting);
  const inside = countStatus('admitted');
  metricsEls.inside.textContent = String(inside);
  metricsEls.cap.textContent = `/${CLUB_CAPACITY}`;
  metricsEls.inside.parentElement!.classList.toggle('full', inside >= CLUB_CAPACITY);
  metricsEls.out.textContent = String(turnedAway);

  const pause = desk.pausedUntil - now;
  if (pause > 0) {
    say(`Door is rate limited. Resuming in ${Math.ceil(pause / 1000)}s.`, 'warn', 600);
  }
}

setInterval(() => {
  updateMetrics();
  updateControls();
  if (guestsDialog.open) renderGuests();
}, 250);

// ------------------------------------------------------------------ layout & loop

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const topInset = top.getBoundingClientRect().bottom;
  const bottomInset = h - dock.getBoundingClientRect().top;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  world.resize(w, h, topInset, bottomInset, dpr);
  notice.style.bottom = `${bottomInset + 10}px`;
}

const observer = new ResizeObserver(() => resize());
observer.observe(top);
observer.observe(dock);
window.addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
  for (let i = 0; i < steps; i++) world.step(dt / steps);
  world.render();
  const want = shownTicket();
  if (want !== cardTicket) setCardTicket(want);
  renderCard();
  placeCard();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setBatch(25);
updatePolicyUi();
updateMetrics();
