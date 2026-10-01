import { describe, expect, it } from 'vitest';
import { MalformedUpstream, buildInput, buildState, parseAdmission } from '../../worker/clef';

const request = {
  policy: 'Supernatural creatures only. No humans.',
  bot: { name: 'Mina', species: 'Vampire', job: 'Night nurse', item: 'a lantern', intro: 'Been dancing since 1743.' },
};

describe('buildInput', () => {
  it('uses the fixed clef-flash model and a single admit/reject choice question', () => {
    const input = buildInput(request);
    expect(input.model).toBe('clef-flash');
    expect(Object.keys(input.questions)).toEqual(['admission']);
    expect(input.questions.admission.type).toBe('choice');
    expect(Object.keys(input.questions.admission.criteria)).toEqual(['admit', 'reject']);
  });

  it('puts the policy and every profile field in the state', () => {
    const state = buildState(request);
    expect(state).toContain('DOOR POLICY: Supernatural creatures only. No humans.');
    for (const value of Object.values(request.bot)) expect(state).toContain(value);
  });
});

describe('parseAdmission', () => {
  it('reads choice with probabilities', () => {
    expect(
      parseAdmission({ answers: { admission: { choice: 'admit', probabilities: { admit: 0.83, reject: 0.17 } } } }),
    ).toEqual({ decision: 'admit', confidence: null, probabilities: { admit: 0.83, reject: 0.17 } });
  });

  it('reads the live Clef shape and keeps confidence distinct from the chosen probability', () => {
    const live = { result: { answers: { admission: { type: 'choice', choice: 'admit', probabilities: { admit: 0.9289, reject: 0.0711 }, confidence: 0.7358 } } } };
    expect(parseAdmission(live)).toEqual({ decision: 'admit', confidence: 0.7358, probabilities: { admit: 0.9289, reject: 0.0711 } });
  });

  it('prefers an explicit confidence', () => {
    const out = parseAdmission({ answers: { admission: { choice: 'reject', confidence: 0.7, probabilities: { admit: 0.2, reject: 0.8 } } } });
    expect(out.decision).toBe('reject');
    expect(out.confidence).toBe(0.7);
  });

  it('accepts a bare string answer', () => {
    expect(parseAdmission({ answers: { admission: 'Reject' } })).toEqual({ decision: 'reject', confidence: null, probabilities: null });
  });

  it('accepts a REST-style result wrapper', () => {
    expect(parseAdmission({ result: { answers: { admission: { choice: 'admit' } } } }).decision).toBe('admit');
  });

  it('accepts an array of option probabilities', () => {
    const out = parseAdmission({
      answers: { admission: { choice: 'admit', probabilities: [{ choice: 'admit', probability: 0.6 }, { option: 'reject', p: 0.4 }] } },
    });
    expect(out.probabilities).toEqual({ admit: 0.6, reject: 0.4 });
  });

  it('falls back to the most probable option when no choice is named', () => {
    expect(parseAdmission({ answers: { admission: { probabilities: { admit: 0.3, reject: 0.7 } } } }).decision).toBe('reject');
  });

  it('ignores out-of-range probabilities instead of trusting them', () => {
    const out = parseAdmission({ answers: { admission: { choice: 'admit', probabilities: { admit: 3, reject: -1 } } } });
    expect(out).toEqual({ decision: 'admit', confidence: null, probabilities: null });
  });

  it.each([
    ['null', null],
    ['string', 'admit'],
    ['no answers', { model: 'clef-flash' }],
    ['no admission', { answers: { other: { choice: 'admit' } } }],
    ['unknown choice', { answers: { admission: { choice: 'maybe' } } }],
    ['unknown string', { answers: { admission: 'yes' } }],
    ['tied probabilities', { answers: { admission: { probabilities: { admit: 0.5, reject: 0.5 } } } }],
    ['empty object', { answers: { admission: {} } }],
    ['array answer', { answers: { admission: ['admit'] } }],
  ])('fails closed on %s', (_label, raw) => {
    expect(() => parseAdmission(raw)).toThrow(MalformedUpstream);
  });
});
