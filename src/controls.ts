import { validatePolicy } from '../shared/contract';

export const CLUB_CAPACITY = 150;
export const LINE_CAPACITY = 100;

export interface Room {
  count: number;
  /** What runs out first: the club (until Start over) or the line (until the door catches up). */
  limit: 'club' | 'line';
}

/** How many more bots may join, given who is inside and who is still in line (including failed bots). */
export function roomFor(inside: number, line: number): Room {
  const byLine = LINE_CAPACITY - line;
  const byClub = CLUB_CAPACITY - inside - line;
  if (byClub <= 0) return { count: 0, limit: 'club' };
  if (byLine <= 0) return { count: 0, limit: 'line' };
  return { count: Math.min(byLine, byClub), limit: byClub < byLine ? 'club' : 'line' };
}

export type RuleEdit = { kind: 'apply'; value: string } | { kind: 'same'; value: string } | { kind: 'invalid' };

/** What happens when the rule field is committed: a new rule, no change, or too short/long to use. */
export function resolveRuleEdit(draft: string, active: string): RuleEdit {
  const checked = validatePolicy(draft);
  if (!checked.ok) return { kind: 'invalid' };
  return checked.value === active ? { kind: 'same', value: active } : { kind: 'apply', value: checked.value };
}
