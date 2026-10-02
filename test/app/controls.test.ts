import { describe, expect, it } from 'vitest';
import { CLUB_CAPACITY, LINE_CAPACITY, resolveRuleEdit, roomFor } from '../../src/controls';

describe('roomFor', () => {
  it('lets a full line through when the club is empty', () => {
    expect(roomFor(0, 0)).toEqual({ count: LINE_CAPACITY, limit: 'line' });
  });

  it('stops at the line before the club', () => {
    expect(roomFor(10, LINE_CAPACITY)).toEqual({ count: 0, limit: 'line' });
  });

  it('counts the line against the club so it never overfills', () => {
    expect(roomFor(120, 20)).toEqual({ count: 10, limit: 'club' });
    expect(roomFor(100, 50)).toEqual({ count: 0, limit: 'club' });
    expect(roomFor(CLUB_CAPACITY, 0)).toEqual({ count: 0, limit: 'club' });
  });
});

describe('resolveRuleEdit', () => {
  const active = 'No humans. Everyone else is welcome.';

  it('applies a new rule, cleaned', () => {
    expect(resolveRuleEdit('  Only   green dots. ', active)).toEqual({ kind: 'apply', value: 'Only green dots.' });
  });

  it('treats the same rule with stray spacing as unchanged', () => {
    expect(resolveRuleEdit(` ${active}  `, active)).toEqual({ kind: 'same', value: active });
  });

  it('refuses rules that are too short', () => {
    expect(resolveRuleEdit('no', active)).toEqual({ kind: 'invalid' });
    expect(resolveRuleEdit('   ', active)).toEqual({ kind: 'invalid' });
  });
});
