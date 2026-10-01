import type { Ticket, TicketStatus } from './admissions';

export const STATUS_LABEL: Record<TicketStatus, string> = {
  waiting: 'In line',
  pending: 'At the door',
  retrying: 'Retrying',
  admitted: 'Admitted',
  rejected: 'Turned away',
  error: 'No answer',
};

export function percent(p: number): string {
  const v = p * 100;
  if (v > 99.5 && v < 100) return '>99%';
  if (v < 0.5 && v > 0) return '<1%';
  return `${Math.round(v)}%`;
}

export function ms(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} ms`;
}

export function itemLine(item: string): string {
  return `Carrying ${item}`;
}

export interface Fact {
  label: string;
  value: string;
  tone?: 'num' | 'bad';
}

/** Facts shown for a bot once its request has started. Only real values. */
export function facts(ticket: Ticket, shownStatus: TicketStatus): Fact[] {
  const out: Fact[] = [];
  if (ticket.policy) out.push({ label: 'Rule', value: ticket.policy });
  const v = ticket.verdict;
  if (v && (shownStatus === 'admitted' || shownStatus === 'rejected')) {
    // Clef reports a per-option probability and a separate confidence; show both as given.
    const parts: string[] = [v.decision];
    const p = v.probabilities?.[v.decision];
    if (p !== null && p !== undefined) parts.push(`p ${percent(p)}`);
    if (v.confidence !== null) parts.push(`confidence ${percent(v.confidence)}`);
    out.push({ label: 'Clef', value: parts.join(' · ') });
    out.push({ label: 'Time', value: `${ms(v.modelMs)} AI call · ${ms(v.rttMs)} round trip`, tone: 'num' });
  }
  if (ticket.error && (shownStatus === 'error' || shownStatus === 'retrying')) {
    out.push({ label: 'Error', value: ticket.error.message, tone: 'bad' });
  }
  if (ticket.attempts > 1 || ticket.deferrals > 0) {
    const parts = [`${ticket.attempts} ${ticket.attempts === 1 ? 'try' : 'tries'}`];
    if (ticket.deferrals) parts.push(`${ticket.deferrals} rate-limit ${ticket.deferrals === 1 ? 'wait' : 'waits'}`);
    out.push({ label: 'Calls', value: parts.join(' · '), tone: 'num' });
  }
  return out;
}
