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

/** Attempts and rate-limit waits, only when there was more than one plain try. */
export function triesLine(ticket: Ticket): string | null {
  if (ticket.attempts <= 1 && ticket.deferrals === 0) return null;
  const parts = [`${ticket.attempts} ${ticket.attempts === 1 ? 'try' : 'tries'}`];
  if (ticket.deferrals) parts.push(`${ticket.deferrals} rate-limit ${ticket.deferrals === 1 ? 'wait' : 'waits'}`);
  return parts.join(' · ');
}
