import './styles.css';
import { AdmissionDesk, type Ticket, type TicketStatus } from './admissions';
import { CLUB_CAPACITY, resolveRuleEdit, roomFor, type Room } from './controls';
import { guestBody, paintPill, paintSwatch } from './guest';
import { Metrics } from './metrics';
import { DEFAULT_POLICY, PRESETS, createProfile } from './profiles';
import { BOT_COLORS } from '../shared/colors';
import { World } from './scene/world';

const ROSTER_LIMIT = 600;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('scene');
const top = $('top');
const dock = $('dock');
const ruleForm = $<HTMLFormElement>('rule-form');
const ruleInput = $<HTMLTextAreaElement>('rule');
const ruleSave = $<HTMLButtonElement>('rule-save');
const rulesToggle = $<HTMLButtonElement>('rules-toggle');
const rulesList = $<HTMLUListElement>('rules');
const sendButtons = [...document.querySelectorAll<HTMLButtonElement>('.send button')];
const sendGroup = sendButtons[0]!.parentElement!;
const sendState = $('send-state');
const retryButton = $<HTMLButtonElement>('retry');
const restartButton = $<HTMLButtonElement>('restart');
const scoreButton = $<HTMLButtonElement>('score');
const guestsDialog = $<HTMLDialogElement>('guests');
const guestsClose = $<HTMLButtonElement>('guests-close');
const guestList = $<HTMLOListElement>('guest-list');
const guestsEmpty = $('guests-empty');
const notice = $('notice');
const card = $('card');
const cardEls = {
  swatch: $('card-swatch'),
  name: $('card-name'),
  status: $('card-status'),
  body: $('card-body'),
  close: $<HTMLButtonElement>('card-close'),
};
const score = { inside: $('n-in'), out: $('n-out'), ms: $('n-ms') };

// ------------------------------------------------------------------ state

let activePolicy = DEFAULT_POLICY;
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
    onStart: (ticket) => world.assignLane(ticket),
    onDecision: (ticket) => {
      if (ticket.verdict) metrics.record(ticket.verdict.rttMs);
      // Cumulative, so trimming old guests from the roster never lowers the totals.
      if (ticket.status === 'rejected') turnedAway++;
    },
    onError: (ticket) => {
      world.releaseToStreet(ticket);
      say(`${ticket.profile.name} got no answer. ${ticket.error?.message ?? ''}`.trim(), 'warn');
      updateControls();
    },
    onPause: () => updateScore(),
  },
});

function countStatus(...statuses: TicketStatus[]): number {
  let n = 0;
  for (const t of roster.values()) if (statuses.includes(t.status)) n++;
  return n;
}

function room(): Room {
  return roomFor(countStatus('admitted'), countStatus('waiting', 'pending', 'retrying', 'error'));
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

// ------------------------------------------------------------------ sending bots

function send(requested: number): void {
  const space = room();
  const n = Math.min(requested, space.count);
  if (n <= 0) return;
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
  if (n < requested) say(`Only ${n} more fit.`);
  trimRoster();
  updateControls();
}

function trimRoster(): void {
  if (roster.size <= ROSTER_LIMIT) return;
  for (const [id, t] of roster) {
    if (roster.size <= ROSTER_LIMIT) break;
    if (t.status === 'rejected' && !world.byId.has(id)) roster.delete(id);
  }
}

for (const button of sendButtons) {
  button.addEventListener('click', () => send(Number(button.dataset.count)));
}

// ------------------------------------------------------------------ door rule

let highlighted = -1;

function rulesOpen(): boolean {
  return !rulesList.hidden;
}

function syncRule(): void {
  const edit = resolveRuleEdit(ruleInput.value, activePolicy);
  ruleSave.hidden = edit.kind !== 'apply';
  ruleForm.classList.toggle('editing', edit.kind !== 'same');
  if (edit.kind !== 'invalid') ruleInput.removeAttribute('aria-invalid');
}

function highlight(i: number): void {
  const items = [...rulesList.children] as HTMLLIElement[];
  highlighted = i < 0 || !items.length ? -1 : i % items.length;
  items.forEach((li, k) => li.classList.toggle('active', k === highlighted));
  const current = items[highlighted];
  if (current) {
    ruleInput.setAttribute('aria-activedescendant', current.id);
    current.scrollIntoView({ block: 'nearest' });
  } else ruleInput.removeAttribute('aria-activedescendant');
}

function openRules(): void {
  if (rulesOpen()) return;
  PRESETS.forEach((preset, i) => rulesList.children[i]!.setAttribute('aria-selected', String(preset === activePolicy)));
  rulesList.hidden = false;
  ruleInput.setAttribute('aria-expanded', 'true');
  rulesToggle.setAttribute('aria-expanded', 'true');
  highlight(-1);
}

function closeRules(): void {
  if (!rulesOpen()) return;
  rulesList.hidden = true;
  ruleInput.setAttribute('aria-expanded', 'false');
  rulesToggle.setAttribute('aria-expanded', 'false');
  highlight(-1);
}

/** The field wraps so the whole rule stays readable; it grows with the text. */
function fitRule(): void {
  ruleInput.style.height = 'auto';
  ruleInput.style.height = `${ruleInput.scrollHeight + ruleInput.offsetHeight - ruleInput.clientHeight}px`;
}

function useRule(value: string): void {
  activePolicy = value;
  ruleInput.value = value;
  closeRules();
  syncRule();
  fitRule();
}

/** Enter, ✓ or leaving the field. A too-short rule keeps focus when submitted and reverts on blur. */
function commitRule(leaving: boolean): boolean {
  const edit = resolveRuleEdit(ruleInput.value, activePolicy);
  if (edit.kind === 'invalid') {
    if (leaving) {
      useRule(activePolicy);
      return true;
    }
    ruleInput.setAttribute('aria-invalid', 'true');
    say('A rule needs 3 to 140 characters.', 'warn');
    return false;
  }
  useRule(edit.value);
  return true;
}

PRESETS.forEach((preset, i) => {
  const li = document.createElement('li');
  li.id = `rule-${i}`;
  li.setAttribute('role', 'option');
  li.textContent = preset;
  // Keep focus in the field so the pick doesn't look like leaving it.
  li.addEventListener('pointerdown', (event) => event.preventDefault());
  li.addEventListener('click', () => {
    useRule(preset);
    ruleInput.blur();
  });
  rulesList.append(li);
});

ruleInput.value = activePolicy;
// Focusing or clicking the unchanged rule offers the ready-made ones.
for (const type of ['focus', 'click'] as const) {
  ruleInput.addEventListener(type, () => {
    if (resolveRuleEdit(ruleInput.value, activePolicy).kind === 'same') openRules();
  });
}
ruleInput.addEventListener('input', () => {
  fitRule();
  // Writing your own rule hides the ready-made ones; clearing the field brings them back.
  if (ruleInput.value.trim() === '' || resolveRuleEdit(ruleInput.value, activePolicy).kind === 'same') openRules();
  else closeRules();
  syncRule();
});
ruleInput.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  // Arrows move the caret in a wrapped rule; they walk the list only while it is open (or with Alt).
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && (rulesOpen() || event.altKey)) {
    event.preventDefault();
    const n = PRESETS.length;
    const step = event.key === 'ArrowDown' ? 1 : -1;
    openRules();
    highlight(highlighted === -1 ? (step > 0 ? 0 : n - 1) : (highlighted + step + n) % n);
  } else if (event.key === 'Enter') {
    // One line of rule: Enter uses it rather than adding a newline.
    event.preventDefault();
    if (rulesOpen() && highlighted >= 0) {
      useRule(PRESETS[highlighted]!);
      ruleInput.blur();
    } else ruleForm.requestSubmit();
  } else if (event.key === 'Escape') {
    event.stopPropagation();
    if (rulesOpen()) closeRules();
    else {
      useRule(activePolicy);
      ruleInput.blur();
    }
  }
});
ruleForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (commitRule(false)) ruleInput.blur();
});
ruleForm.addEventListener('focusout', (event) => {
  if (ruleForm.contains(event.relatedTarget as Node | null)) return;
  commitRule(true);
});
rulesToggle.addEventListener('pointerdown', (event) => event.preventDefault());
rulesToggle.addEventListener('click', () => {
  if (rulesOpen()) closeRules();
  else {
    ruleInput.focus();
    openRules();
  }
});
ruleSave.addEventListener('pointerdown', (event) => event.preventDefault());

// ------------------------------------------------------------------ start over / retry

function startOver(): void {
  desk.reset();
  world.clear();
  roster.clear();
  metrics.reset();
  turnedAway = 0;
  select(null);
  notice.classList.remove('show');
  renderGuests();
  updateControls();
  updateScore();
}

restartButton.addEventListener('click', () => {
  startOver();
  sendButtons.find((b) => !b.disabled)?.focus();
});

retryButton.addEventListener('click', () => {
  for (const t of roster.values()) desk.retry(t);
  updateControls();
});

// ------------------------------------------------------------------ bot card

let cardTicket: Ticket | null = null;
let cardKey = '';
let cardSide: 'right' | 'left' | 'above' | 'below' = 'right';
const cardRetry = document.createElement('button');
cardRetry.type = 'button';
cardRetry.className = 'btn warn';
cardRetry.textContent = 'Retry';
cardRetry.addEventListener('click', () => {
  if (cardTicket && desk.retry(cardTicket)) updateControls();
});

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
  const key = `${ticket.id}:${ticket.version}:${status}:${activePolicy}`;
  if (key === cardKey) return;
  const hadFocus = card.contains(document.activeElement);
  cardKey = key;
  paintSwatch(cardEls.swatch, ticket);
  cardEls.name.textContent = ticket.profile.name;
  paintPill(cardEls.status, status);
  cardEls.body.replaceChildren(...guestBody(ticket, status, activePolicy));
  if (status === 'error') cardEls.body.append(cardRetry);
  card.hidden = false;
  if (hadFocus && !card.contains(document.activeElement)) cardEls.close.focus();
}

function placeCard(): void {
  const ticket = cardTicket;
  if (!ticket) return;
  const anchor = world.anchorOf(ticket.id);
  if (!anchor) {
    // The bot walked off the street.
    select(null);
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

function select(id: number | null): void {
  world.selectedId = id;
  setCardTicket(id === null ? null : (roster.get(id) ?? null));
}

cardEls.close.addEventListener('click', () => {
  select(null);
  canvas.focus();
});

function localPoint(event: PointerEvent | MouseEvent): [number, number] {
  const rect = canvas.getBoundingClientRect();
  return [event.clientX - rect.left, event.clientY - rect.top];
}

// Hover only rings a bot; a click opens its card.
canvas.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse') return;
  const id = world.pick(...localPoint(event), 5);
  canvas.style.cursor = id === null ? '' : 'pointer';
  world.hoverId = id;
});
canvas.addEventListener('pointerleave', () => (world.hoverId = null));
canvas.addEventListener('click', (event) => {
  const pointerType = (event as PointerEvent).pointerType;
  const id = world.pick(...localPoint(event), pointerType === 'mouse' ? 6 : 14);
  select(id === null || id === world.selectedId ? null : id);
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
  if (event.key === 'Escape' && cardTicket && !guestsDialog.open) {
    const inCard = card.contains(document.activeElement);
    select(null);
    if (inCard) canvas.focus();
  }
});

// ------------------------------------------------------------------ guest list

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
    const key = `${ticket.version}:${status}:${present}:${activePolicy}`;
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
  const old = li.querySelector('details');
  const details = document.createElement('details');
  details.open = old?.open ?? false;
  const summary = document.createElement('summary');
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  paintSwatch(swatch, ticket);
  const name = document.createElement('span');
  name.className = 'g-name';
  name.textContent = ticket.profile.name;
  const species = document.createElement('span');
  species.className = 'g-species';
  species.textContent = ticket.profile.species;
  const pill = document.createElement('span');
  paintPill(pill, status);
  summary.append(swatch, name, species, pill);

  const body = document.createElement('div');
  body.className = 'g-body';
  body.append(...guestBody(ticket, status, activePolicy, false));
  const actions = document.createElement('div');
  actions.className = 'g-actions';
  if (present) {
    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'btn';
    show.textContent = 'Show on floor';
    show.addEventListener('click', () => {
      guestsDialog.close();
      select(ticket.id);
      canvas.focus();
    });
    actions.append(show);
  }
  if (status === 'error') {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn warn';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => {
      desk.retry(ticket);
      updateControls();
      renderGuests();
    });
    actions.append(retry);
  }
  if (actions.childElementCount) body.append(actions);
  details.append(summary, body);
  // Keep keyboard focus on the row that is being rebuilt under it.
  const focused = old?.contains(document.activeElement) ? document.activeElement : null;
  li.replaceChildren(details);
  if (focused) summary.focus();
}

scoreButton.addEventListener('click', () => {
  guestsDialog.showModal();
  renderGuests();
});
guestsClose.addEventListener('click', () => guestsDialog.close());
guestsDialog.addEventListener('click', (event) => {
  if (event.target === guestsDialog) guestsDialog.close();
});
guestsDialog.addEventListener('close', () => {
  renderGuests();
  if (!cardTicket) scoreButton.focus();
});

// ------------------------------------------------------------------ score & controls

function updateControls(): void {
  const space = room();
  const blocked = space.count <= 0;
  for (const b of sendButtons) b.disabled = blocked;
  sendGroup.classList.toggle('blocked', blocked);
  sendState.hidden = !blocked;
  sendState.textContent = space.limit === 'club' ? 'Club full' : 'Line full';
  const full = blocked && space.limit === 'club';
  restartButton.hidden = roster.size === 0;
  restartButton.classList.toggle('primary', full);
  const failed = countStatus('error');
  retryButton.hidden = failed === 0;
  retryButton.textContent = `Retry ${failed}`;
  retryButton.setAttribute('aria-label', `Retry ${failed} ${failed === 1 ? 'bot' : 'bots'} with no answer`);
}

function updateScore(): void {
  const inside = countStatus('admitted');
  score.inside.textContent = String(inside);
  score.out.textContent = String(turnedAway);
  scoreButton.classList.toggle('full', inside >= CLUB_CAPACITY);
  scoreButton.setAttribute('aria-label', `Guests: ${inside} of ${CLUB_CAPACITY} admitted, ${turnedAway} turned away`);
  scoreButton.title = `${inside} admitted · ${turnedAway} turned away`;
  const median = metrics.median();
  score.ms.textContent = median === null ? '–' : String(Math.round(median));

  const pause = desk.pausedUntil - performance.now();
  if (pause > 0) say(`Rate limited. Resuming in ${Math.ceil(pause / 1000)}s.`, 'warn', 600);
}

setInterval(() => {
  updateScore();
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
window.addEventListener('resize', () => {
  fitRule();
  resize();
});
fitRule();
resize();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
  for (let i = 0; i < steps; i++) world.step(dt / steps);
  world.render();
  // The world drops a selection when its bot leaves; follow it.
  if (cardTicket && world.selectedId !== cardTicket.id) select(world.selectedId);
  renderCard();
  placeCard();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

syncRule();
updateControls();
updateScore();
