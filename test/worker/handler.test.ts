import { describe, expect, it, vi } from 'vitest';
import { handleRequest, type AppEnv } from '../../worker/index';

const ORIGIN = 'https://bot-club.example';
const bot = { name: 'Mina', species: 'Vampire', job: 'Night nurse', item: 'a lantern', intro: 'Been dancing since 1743.' };
const goodBody = { policy: 'Supernatural creatures only. No humans.', bot };

function makeEnv(run: AppEnv['AI']['run'], limiter?: AppEnv['ADMIT_LIMITER']) {
  const assets = vi.fn(async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
  const env: AppEnv = { AI: { run: vi.fn(run) }, ASSETS: { fetch: assets }, ADMIT_LIMITER: limiter };
  return { env, assets, run: env.AI.run as ReturnType<typeof vi.fn> };
}

function admit(body: unknown, init: RequestInit & { headers?: Record<string, string> } = {}) {
  return new Request(`${ORIGIN}/api/admit`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': '203.0.113.7', ...init.headers },
  });
}

async function errorOf(response: Response) {
  const body = (await response.json()) as { error: { code: string; message: string; retryable: boolean } };
  return body.error;
}

const clefAdmit = async () => ({ answers: { admission: { choice: 'admit', probabilities: { admit: 0.91, reject: 0.09 } } } });

describe('POST /api/admit', () => {
  it('returns the real model decision with latency', async () => {
    let t = 1000;
    const { env, run } = makeEnv(async () => {
      t += 420;
      return clefAdmit();
    });
    const res = await handleRequest(admit(goodBody), env, { now: () => t });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      decision: 'admit',
      confidence: null,
      probabilities: { admit: 0.91, reject: 0.09 },
      modelMs: 420,
      model: 'clef-flash',
    });
    expect(run).toHaveBeenCalledTimes(1);
    const [model, input] = run.mock.calls[0]!;
    expect(model).toBe('@cf/cloudflare/clef-flash');
    expect(input.model).toBe('clef-flash');
    expect(input.state).toContain('Supernatural creatures only. No humans.');
    expect(input.questions.admission.criteria).toHaveProperty('admit');
  });

  it('reports a rejection as a rejection, not an error', async () => {
    const { env } = makeEnv(async () => ({ answers: { admission: { choice: 'reject', probabilities: { admit: 0.2, reject: 0.8 } } } }));
    const res = await handleRequest(admit(goodBody), env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { decision: string }).decision).toBe('reject');
  });

  it('rejects other methods', async () => {
    const { env, run } = makeEnv(clefAdmit);
    const res = await handleRequest(new Request(`${ORIGIN}/api/admit`), env);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects cross-origin callers', async () => {
    const { env, run } = makeEnv(clefAdmit);
    const res = await handleRequest(admit(goodBody, { headers: { origin: 'https://evil.example' } }), env);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('forbidden_origin');
    const site = await handleRequest(admit(goodBody, { headers: { 'sec-fetch-site': 'cross-site' } }), env);
    expect(site.status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it('requires JSON', async () => {
    const { env } = makeEnv(clefAdmit);
    const res = await handleRequest(admit(goodBody, { headers: { 'content-type': 'text/plain' } }), env);
    expect(res.status).toBe(415);
  });

  it('refuses oversized bodies without calling the model', async () => {
    const { env, run } = makeEnv(clefAdmit);
    const res = await handleRequest(admit({ ...goodBody, pad: 'x'.repeat(5000) }), env);
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe('payload_too_large');
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses oversized streamed bodies with no content-length', async () => {
    const { env, run } = makeEnv(clefAdmit);
    const chunk = new TextEncoder().encode('x'.repeat(1024));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const req = new Request(`${ORIGIN}/api/admit`, {
      method: 'POST',
      body: stream,
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      // @ts-expect-error duplex is required by Node for streaming bodies
      duplex: 'half',
    });
    const res = await handleRequest(req, env);
    expect(res.status).toBe(413);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and invalid fields with a useful message', async () => {
    const { env, run } = makeEnv(clefAdmit);
    const bad = await handleRequest(admit('{"policy":'), env);
    expect(bad.status).toBe(400);
    expect((await errorOf(bad)).code).toBe('invalid_json');

    const invalid = await handleRequest(admit({ policy: 'No humans.', bot: { ...bot, name: '' } }), env);
    expect(invalid.status).toBe(400);
    const err = await errorOf(invalid);
    expect(err.code).toBe('invalid_request');
    expect(err.message).toContain('bot.name');
    expect(err.retryable).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not let callers pick the model', async () => {
    const { env, run } = makeEnv(clefAdmit);
    const res = await handleRequest(admit({ ...goodBody, model: '@cf/meta/llama-3' }), env);
    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After when the per-IP limiter says no', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const { env, run } = makeEnv(clefAdmit, { limit });
    const res = await handleRequest(admit(goodBody), env);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('10');
    expect((await errorOf(res)).retryable).toBe(true);
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.7' });
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed with a retryable 503 when the limiter errors', async () => {
    const limit = vi.fn(async () => {
      throw new Error('limiter down');
    });
    const { env, run } = makeEnv(clefAdmit, { limit });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handleRequest(admit(goodBody), env);
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    const err = await errorOf(res);
    expect(err.code).toBe('limiter_unavailable');
    expect(err.retryable).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it('times out slow model calls as 504, distinct from a rejection', async () => {
    const { env } = makeEnv(() => new Promise(() => {}));
    const res = await handleRequest(admit(goodBody), env, { upstreamTimeoutMs: 20 });
    expect(res.status).toBe(504);
    const err = await errorOf(res);
    expect(err.code).toBe('upstream_timeout');
    expect(err.retryable).toBe(true);
  });

  it('passes an abort signal so a timed-out call is cancelled', async () => {
    let signal: AbortSignal | undefined;
    const { env } = makeEnv((_m, _i, options) => {
      signal = options?.signal;
      return new Promise(() => {});
    });
    await handleRequest(admit(goodBody), env, { upstreamTimeoutMs: 10 });
    expect(signal?.aborted).toBe(true);
  });

  it('maps model failures to 502 without leaking details', async () => {
    const { env } = makeEnv(async () => {
      throw new Error('InferenceUpstreamError: internal-host-17 secret stack');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handleRequest(admit(goodBody), env);
    spy.mockRestore();
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('secret');
    expect(text).not.toContain('internal-host');
    expect(JSON.parse(text).error.code).toBe('upstream_error');
  });

  it('maps upstream capacity errors to 503 busy with Retry-After', async () => {
    const { env } = makeEnv(async () => {
      throw new Error('3040: Capacity temporarily exceeded, please try again.');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handleRequest(admit(goodBody), env);
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect((await errorOf(res)).code).toBe('upstream_busy');
  });

  it('fails closed on a malformed model answer', async () => {
    const { env } = makeEnv(async () => ({ answers: { admission: { choice: 'perhaps' } } }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handleRequest(admit(goodBody), env);
    spy.mockRestore();
    expect(res.status).toBe(502);
    expect((await errorOf(res)).code).toBe('upstream_malformed');
  });
});

describe('routing', () => {
  it('serves a health check without touching the model', async () => {
    const { env, run } = makeEnv(clefAdmit);
    const res = await handleRequest(new Request(`${ORIGIN}/api/health`), env);
    expect(await res.json()).toEqual({ ok: true, model: 'clef-flash' });
    expect(run).not.toHaveBeenCalled();
  });

  it('404s unknown API paths as JSON', async () => {
    const { env } = makeEnv(clefAdmit);
    const res = await handleRequest(new Request(`${ORIGIN}/api/proxy?model=x`), env);
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('not_found');
  });

  it('hands everything else to static assets', async () => {
    const { env, assets } = makeEnv(clefAdmit);
    const res = await handleRequest(new Request(`${ORIGIN}/`), env);
    expect(res.status).toBe(200);
    expect(assets).toHaveBeenCalledTimes(1);
  });
});
