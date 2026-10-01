import { describe, expect, it } from 'vitest';
import { LIMITS, cleanText, parseAdmitSuccess, validateAdmitRequest, validatePolicy } from '../../shared/contract';

const bot = { name: 'Mina', species: 'Vampire', job: 'Night nurse', item: 'a lantern', intro: 'Been dancing since 1743.' };

describe('cleanText', () => {
  it('collapses whitespace and strips control and invisible characters', () => {
    const zeroWidth = String.fromCharCode(0x200b);
    const bidi = String.fromCharCode(0x202e);
    expect(cleanText(`  a\tb\n\nc${zeroWidth}d${bidi}e\u0000 `)).toBe('a b c d e');
  });
});

describe('validateAdmitRequest', () => {
  it('accepts and normalises a valid request', () => {
    const result = validateAdmitRequest({ policy: '  No   humans. ', bot: { ...bot, name: ' Mina ' } });
    expect(result).toEqual({ ok: true, value: { policy: 'No humans.', bot } });
  });

  it.each([
    ['non-object body', null, 'body'],
    ['array body', [], 'body'],
    ['unknown top-level field', { policy: 'No humans.', bot, model: '@cf/meta/llama' }, 'model'],
    ['missing policy', { bot }, 'policy'],
    ['short policy', { policy: 'no', bot }, 'policy'],
    ['long policy', { policy: 'x'.repeat(LIMITS.policy.max + 1), bot }, 'policy'],
    ['missing bot', { policy: 'No humans.' }, 'bot'],
    ['unknown bot field', { policy: 'No humans.', bot: { ...bot, image: 'data:...' } }, 'bot.image'],
    ['numeric field', { policy: 'No humans.', bot: { ...bot, name: 42 } }, 'bot.name'],
    ['blank after cleaning', { policy: 'No humans.', bot: { ...bot, job: '   ' } }, 'bot.job'],
    ['long intro', { policy: 'No humans.', bot: { ...bot, intro: 'y'.repeat(LIMITS.intro.max + 1) } }, 'bot.intro'],
  ])('rejects %s', (_label, input, field) => {
    const result = validateAdmitRequest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe(field);
  });

  it('counts emoji as single characters', () => {
    const policy = '🦇'.repeat(LIMITS.policy.max);
    expect(validatePolicy(policy).ok).toBe(true);
  });

  it('keeps a maximal request under the body budget', () => {
    const big = {
      policy: 'é'.repeat(LIMITS.policy.max),
      bot: {
        name: 'é'.repeat(LIMITS.name.max),
        species: 'é'.repeat(LIMITS.species.max),
        job: 'é'.repeat(LIMITS.job.max),
        item: 'é'.repeat(LIMITS.item.max),
        intro: 'é'.repeat(LIMITS.intro.max),
      },
    };
    expect(validateAdmitRequest(big).ok).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(big)).byteLength).toBeLessThanOrEqual(LIMITS.bodyBytes);
  });
});

describe('parseAdmitSuccess', () => {
  const ok = { decision: 'admit', confidence: 0.9, probabilities: { admit: 0.9, reject: 0.1 }, modelMs: 300, model: 'clef-flash' };

  it('accepts a well-formed verdict', () => {
    expect(parseAdmitSuccess(ok)).toEqual(ok);
  });

  it.each([
    ['unknown decision', { ...ok, decision: 'maybe' }],
    ['wrong model', { ...ok, model: 'other' }],
    ['negative latency', { ...ok, modelMs: -1 }],
    ['confidence out of range', { ...ok, confidence: 1.5 }],
    ['probability not a number', { ...ok, probabilities: { admit: '0.9', reject: 0.1 } }],
  ])('rejects %s', (_label, body) => {
    expect(parseAdmitSuccess(body)).toBeNull();
  });
});
