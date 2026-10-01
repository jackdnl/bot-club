import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdmissionDesk, type Ticket } from '../../src/admissions';

const profile = { name: 'Mina', species: 'Vampire', job: 'Night nurse', item: 'a lantern', intro: 'Hi.' };
let nextId = 1;
const ticket = (): Ticket => ({
  id: nextId++,
  profile,
  status: 'waiting',
  policy: null,
  attempts: 0,
  deferrals: 0,
  verdict: null,
  error: null,
  version: 0,
});

const verdict = (decision: 'admit' | 'reject') =>
  new Response(JSON.stringify({ decision, confidence: 0.8, probabilities: { admit: 0.8, reject: 0.2 }, modelMs: 100, model: 'clef-flash' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const apiError = (status: number, code: string, retryable: boolean, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code, message: code, retryable } }), { status, headers });

/** A fetch whose responses are released by the test. */
function controlledFetch() {
  const calls: { body: { policy: string }; resolve: (r: Response) => void; reject: (e: unknown) => void; signal: AbortSignal }[] = [];
  const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      const signal = init!.signal!;
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      calls.push({ body: JSON.parse(String(init!.body)), resolve, reject, signal });
    });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AdmissionDesk', () => {
  it('never exceeds the concurrency bound and sends one bot per request', async () => {
    const { fetch, calls } = controlledFetch();
    const desk = new AdmissionDesk({ getPolicy: () => 'No humans.', fetch, concurrency: 6, now: () => Date.now() });
    const tickets = Array.from({ length: 20 }, ticket);
    tickets.forEach((t) => desk.enqueue(t));
    expect(calls).toHaveLength(6);
    expect(desk.inflightCount).toBe(6);
    expect(desk.queuedCount).toBe(14);
    calls[0]!.resolve(verdict('admit'));
    await flush();
    expect(calls).toHaveLength(7);
    expect(desk.inflightCount).toBe(6);
  });

  it('freezes the policy when a request starts, so later rule changes only affect queued bots', async () => {
    const { fetch, calls } = controlledFetch();
    let policy = 'Old rule.';
    const desk = new AdmissionDesk({ getPolicy: () => policy, fetch, concurrency: 1, now: () => Date.now() });
    const a = ticket();
    const b = ticket();
    desk.enqueue(a);
    desk.enqueue(b);
    policy = 'New rule.';
    expect(a.policy).toBe('Old rule.');
    expect(b.policy).toBeNull();
    calls[0]!.resolve(verdict('reject'));
    await flush();
    expect(a.status).toBe('rejected');
    expect(a.policy).toBe('Old rule.');
    expect(calls[1]!.body.policy).toBe('New rule.');
    expect(b.policy).toBe('New rule.');
  });

  it('records the verdict and round trip only for real successes', async () => {
    const { fetch, calls } = controlledFetch();
    let now = 0;
    const onDecision = vi.fn();
    const desk = new AdmissionDesk({ getPolicy: () => 'P.', fetch, now: () => now, hooks: { onDecision } });
    const t = ticket();
    desk.enqueue(t);
    now = 640;
    calls[0]!.resolve(verdict('admit'));
    await flush();
    expect(t.status).toBe('admitted');
    expect(t.verdict?.rttMs).toBe(640);
    expect(onDecision).toHaveBeenCalledOnce();
  });

  it('reset cancels in-flight requests and drops late responses', async () => {
    const { fetch, calls } = controlledFetch();
    const onDecision = vi.fn();
    const onError = vi.fn();
    const desk = new AdmissionDesk({ getPolicy: () => 'P.', fetch, concurrency: 2, now: () => Date.now(), hooks: { onDecision, onError } });
    const tickets = Array.from({ length: 5 }, ticket);
    tickets.forEach((t) => desk.enqueue(t));
    const first = calls[0]!;
    desk.reset();
    expect(calls.every((c) => c.signal.aborted)).toBe(true);
    expect(desk.inflightCount).toBe(0);
    expect(desk.queuedCount).toBe(0);
    first.resolve(verdict('admit'));
    await flush();
    await vi.runAllTimersAsync();
    expect(onDecision).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);
  });

  it('pauses politely on 429 using Retry-After and keeps the bot first in line', async () => {
    const { fetch, calls } = controlledFetch();
    const onPause = vi.fn();
    const desk = new AdmissionDesk({ getPolicy: () => 'P.', fetch, concurrency: 1, now: () => Date.now(), hooks: { onPause } });
    const a = ticket();
    const b = ticket();
    desk.enqueue(a);
    desk.enqueue(b);
    calls[0]!.resolve(apiError(429, 'rate_limited', true, { 'retry-after': '3' }));
    await flush();
    expect(onPause).toHaveBeenCalledOnce();
    expect(a.status).toBe('pending');
    expect(a.deferrals).toBe(1);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2900);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toEqual(calls[0]!.body); // same bot, same frozen rule
  });

  it('treats a limiter outage 503 as a polite wait, not a verdict', async () => {
    const { fetch, calls } = controlledFetch();
    const desk = new AdmissionDesk({ getPolicy: () => 'P.', fetch, concurrency: 1, now: () => Date.now() });
    const t = ticket();
    desk.enqueue(t);
    calls[0]!.resolve(apiError(503, 'limiter_unavailable', true, { 'retry-after': '2' }));
    await flush();
    expect(t.status).toBe('pending');
    expect(t.verdict).toBeNull();
    await vi.advanceTimersByTimeAsync(2100);
    expect(calls).toHaveLength(2);
  });

  it('gives up after repeated rate limits instead of looping forever', async () => {
    const { fetch, calls } = controlledFetch();
    const onError = vi.fn();
    const desk = new AdmissionDesk({ getPolicy: () => 'P.', fetch, concurrency: 1, maxDeferrals: 2, now: () => Date.now(), hooks: { onError } });
    const t = ticket();
    desk.enqueue(t);
    for (let i = 0; i < 3; i++) {
      calls[i]!.resolve(apiError(429, 'rate_limited', true, { 'retry-after': '1' }));
      await flush();
      await vi.advanceTimersByTimeAsync(1100);
    }
    expect(t.status).toBe('error');
    expect(t.error?.code).toBe('rate_limited');
    expect(onError).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(3);
  });

  it('retries a retryable failure once, then waits for an explicit retry', async () => {
    const { fetch, calls } = controlledFetch();
    const onError = vi.fn();
    const onRetrying = vi.fn();
    const desk = new AdmissionDesk({ getPolicy: () => 'P.', fetch, random: () => 0, now: () => Date.now(), hooks: { onError, onRetrying } });
    const t = ticket();
    desk.enqueue(t);
    calls[0]!.resolve(apiError(504, 'upstream_timeout', true));
    await flush();
    expect(t.status).toBe('retrying');
    expect(onRetrying).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(600);
    expect(calls).toHaveLength(2);
    calls[1]!.resolve(apiError(502, 'upstream_error', true));
    await flush();
    expect(t.status).toBe('error');
    expect(t.error?.code).toBe('upstream_error');
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(2);

    expect(desk.retry(t)).toBe(true);
    expect(calls).toHaveLength(3);
    calls[2]!.resolve(verdict('reject'));
    await flush();
    expect(t.status).toBe('rejected');
    expect(t.error).toBeNull();
  });

  it('does not auto-retry client errors', async () => {
    const { fetch, calls } = controlledFetch();
    const desk = new AdmissionDesk({ getPolicy: () => 'P.', fetch, now: () => Date.now() });
    const t = ticket();
    desk.enqueue(t);
    calls[0]!.resolve(apiError(400, 'invalid_request', false));
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.status).toBe('error');
    expect(calls).toHaveLength(1);
  });

  it('treats a malformed 200 as an error, never as a decision', async () => {
    const { fetch, calls } = controlledFetch();
    const desk = new AdmissionDesk({ getPolicy: () => 'P.', fetch, maxAutoRetries: 0, now: () => Date.now() });
    const t = ticket();
    desk.enqueue(t);
    calls[0]!.resolve(new Response(JSON.stringify({ decision: 'admit' }), { status: 200 }));
    await flush();
    expect(t.status).toBe('error');
    expect(t.verdict).toBeNull();
    expect(t.error?.code).toBe('malformed_response');
  });

  it('times out a hung request as an error distinct from rejection', async () => {
    const { fetch } = controlledFetch();
    const desk = new AdmissionDesk({ getPolicy: () => 'P.', fetch, timeoutMs: 1000, maxAutoRetries: 0, now: () => Date.now() });
    const t = ticket();
    desk.enqueue(t);
    await vi.advanceTimersByTimeAsync(1001);
    await flush();
    expect(t.status).toBe('error');
    expect(t.error?.code).toBe('timeout');
    expect(t.verdict).toBeNull();
  });

  it('reports network failures as errors', async () => {
    const { fetch, calls } = controlledFetch();
    const desk = new AdmissionDesk({ getPolicy: () => 'P.', fetch, maxAutoRetries: 0, now: () => Date.now() });
    const t = ticket();
    desk.enqueue(t);
    calls[0]!.reject(new TypeError('Failed to fetch'));
    await flush();
    expect(t.status).toBe('error');
    expect(t.error?.code).toBe('network');
  });
});
