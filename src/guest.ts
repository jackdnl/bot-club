import type { Ticket, TicketStatus } from './admissions';
import { BOT_APPEARANCE } from '../shared/colors';
import { STATUS_LABEL, ms, percent, triesLine } from './describe';

const SVG = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function bolt(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M13.5 2 4.5 13.5h6.5L10 22l9-11.5h-6.5z');
  svg.append(path);
  return svg;
}

/** The bot's own colour; the same profile colour the scene draws and the model reads. */
export function paintSwatch(swatch: HTMLElement, ticket: Ticket): void {
  const appearance = BOT_APPEARANCE[ticket.profile.color];
  swatch.style.background = appearance.hex;
  swatch.setAttribute('role', 'img');
  swatch.setAttribute('aria-label', `${appearance.description} bot`);
}

export function paintPill(pill: HTMLElement, status: TicketStatus): void {
  pill.className = `pill ${status}`;
  pill.textContent = STATUS_LABEL[status];
}

/**
 * Profile and, once there is one, the real Clef-flash result or error.
 * The guest list already shows the species in its row, so it passes `withSpecies: false`.
 */
export function guestBody(ticket: Ticket, status: TicketStatus, activePolicy: string, withSpecies = true): HTMLElement[] {
  const { profile } = ticket;
  const out: HTMLElement[] = [
    el('p', 'g-who', withSpecies ? `${profile.species} · ${profile.job}` : profile.job),
    el('p', 'g-item', `Carrying ${profile.item}`),
    el('p', 'g-intro', `“${profile.intro}”`),
  ];

  const v = ticket.verdict;
  if (v && (status === 'admitted' || status === 'rejected')) {
    const result = el('div', 'g-result');
    const admit = v.probabilities?.admit;
    const reject = v.probabilities?.reject;
    if (typeof admit === 'number' && typeof reject === 'number' && admit + reject > 0) {
      const share = admit / (admit + reject);
      const odds = el('div', `g-odds ${v.decision}`);
      const bar = el('span', 'g-bar');
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', `Admit ${percent(admit)}, reject ${percent(reject)}`);
      const fill = el('span', 'g-bar-admit');
      fill.style.width = `${(share * 100).toFixed(1)}%`;
      bar.append(fill);
      odds.append(bar, el('b', '', percent(v.decision === 'admit' ? admit : reject)));
      result.append(odds);
    }
    const time = el('p', 'g-time');
    time.append(bolt(), el('b', '', ms(v.rttMs)), el('span', '', `Clef-flash ${ms(v.modelMs)}`));
    result.append(time);
    out.push(result);
  }

  if (ticket.policy && ticket.policy !== activePolicy) {
    out.push(el('p', 'g-rule', `Earlier rule: “${ticket.policy}”`));
  }
  if (ticket.error && (status === 'error' || status === 'retrying')) {
    out.push(el('p', 'g-error', ticket.error.message));
  }
  const tries = triesLine(ticket);
  if (tries) out.push(el('p', 'g-tries', tries));
  return out;
}
