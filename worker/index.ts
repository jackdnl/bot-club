import {
  LIMITS,
  validateAdmitRequest,
  type AdmitSuccess,
  type ApiErrorBody,
  type ErrorCode,
} from '../shared/contract';
import { MODEL, MalformedUpstream, buildInput, parseAdmission } from './clef';

/** The subset of the Workers AI binding this Worker uses. */
export interface AiRunner {
  run(model: string, inputs: Record<string, unknown>, options?: { signal?: AbortSignal; tags?: string[] }): Promise<unknown>;
}

export interface AppEnv {
  AI: AiRunner;
  ASSETS: { fetch(request: Request): Promise<Response> };
  ADMIT_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export interface HandlerOptions {
  /** Upper bound on one Workers AI call. */
  upstreamTimeoutMs?: number;
  now?: () => number;
}

const UPSTREAM_TIMEOUT_MS = 15_000;
/** Matches the limiter's 10 second window. */
const RATE_LIMIT_RETRY_AFTER_S = 10;
const UPSTREAM_BUSY_RETRY_AFTER_S = 5;

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extra } });
}

function fail(
  status: number,
  code: ErrorCode,
  message: string,
  retryable: boolean,
  extra: Record<string, string> = {},
): Response {
  const body: ApiErrorBody = { error: { code, message, retryable } };
  return json(body, status, extra);
}

class BodyTooLarge extends Error {}

/** Reads at most `limit` bytes; throws BodyTooLarge beyond that even without Content-Length. */
async function readLimited(request: Request, limit: number): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > limit) throw new BodyTooLarge();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
}

function isSameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== url.origin) return false;
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none') return false;
  return true;
}

class UpstreamTimeout extends Error {}

function looksBusy(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /\b429\b|rate.?limit|too many|capacity|overloaded/i.test(text);
}

async function runWithTimeout(env: AppEnv, inputs: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new UpstreamTimeout());
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      env.AI.run(MODEL, inputs, { signal: controller.signal, tags: ['bot-club'] }),
      timeout,
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export async function handleAdmit(request: Request, env: AppEnv, options: HandlerOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'POST') {
    return fail(405, 'method_not_allowed', 'Use POST.', false, { allow: 'POST' });
  }
  if (!isSameOrigin(request, url)) {
    return fail(403, 'forbidden_origin', 'Cross-origin requests are not accepted.', false);
  }
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(type)) {
    return fail(415, 'unsupported_media_type', 'Send application/json.', false);
  }

  let text: string;
  try {
    text = await readLimited(request, LIMITS.bodyBytes);
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      return fail(413, 'payload_too_large', `Body must be at most ${LIMITS.bodyBytes} bytes.`, false);
    }
    return fail(400, 'invalid_json', 'Body is not valid UTF-8.', false);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail(400, 'invalid_json', 'Body is not valid JSON.', false);
  }
  const checked = validateAdmitRequest(parsed);
  if (!checked.ok) return fail(400, 'invalid_request', checked.message, false);

  if (env.ADMIT_LIMITER) {
    const key = request.headers.get('cf-connecting-ip') ?? 'unknown';
    let allowed: boolean;
    try {
      allowed = (await env.ADMIT_LIMITER.limit({ key })).success;
    } catch (error) {
      // Fail closed: without a working limiter, do not spend model calls.
      console.error('rate limiter failed', error);
      return fail(503, 'limiter_unavailable', 'Door is briefly unavailable. Try again shortly.', true, {
        'retry-after': String(UPSTREAM_BUSY_RETRY_AFTER_S),
      });
    }
    if (!allowed) {
      return fail(429, 'rate_limited', 'Too many requests. Slow down a little.', true, {
        'retry-after': String(RATE_LIMIT_RETRY_AFTER_S),
      });
    }
  }

  const now = options.now ?? Date.now;
  const started = now();
  let raw: unknown;
  try {
    raw = await runWithTimeout(env, buildInput(checked.value), options.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof UpstreamTimeout) {
      return fail(504, 'upstream_timeout', 'Clef-flash did not answer in time.', true);
    }
    console.error('clef-flash call failed', error);
    if (looksBusy(error)) {
      return fail(503, 'upstream_busy', 'Clef-flash is busy. Try again shortly.', true, {
        'retry-after': String(UPSTREAM_BUSY_RETRY_AFTER_S),
      });
    }
    return fail(502, 'upstream_error', 'Clef-flash call failed.', true);
  }
  const modelMs = Math.max(0, Math.round(now() - started));

  try {
    const admission = parseAdmission(raw);
    const body: AdmitSuccess = { ...admission, modelMs, model: 'clef-flash' };
    return json(body);
  } catch (error) {
    if (error instanceof MalformedUpstream) {
      console.error(error.message, JSON.stringify(raw)?.slice(0, 500));
      return fail(502, 'upstream_malformed', 'Clef-flash returned an unexpected answer.', true);
    }
    throw error;
  }
}

/** Social crawlers need absolute image URLs; the origin is only known at request time. */
function absolutizeSocialImage(response: Response, requestUrl: string): Response {
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.includes('text/html') || typeof HTMLRewriter === 'undefined') return response;
  const origin = new URL(requestUrl).origin;
  return new HTMLRewriter()
    .on('meta[property="og:image"], meta[name="twitter:image"]', {
      element(el) {
        const content = el.getAttribute('content');
        if (content?.startsWith('/')) el.setAttribute('content', origin + content);
      },
    })
    .transform(response);
}

export async function handleRequest(request: Request, env: AppEnv, options: HandlerOptions = {}): Promise<Response> {
  const { pathname } = new URL(request.url);
  try {
    if (pathname === '/api/admit') return await handleAdmit(request, env, options);
    if (pathname === '/api/health') {
      return request.method === 'GET' || request.method === 'HEAD'
        ? json({ ok: true, model: 'clef-flash' })
        : fail(405, 'method_not_allowed', 'Use GET.', false, { allow: 'GET, HEAD' });
    }
    if (pathname.startsWith('/api/')) return fail(404, 'not_found', 'No such endpoint.', false);
    const asset = await env.ASSETS.fetch(request);
    return pathname === '/' ? absolutizeSocialImage(asset, request.url) : asset;
  } catch (error) {
    console.error('unhandled error', error);
    return fail(500, 'internal_error', 'Something went wrong.', true);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env as unknown as AppEnv);
  },
} satisfies ExportedHandler<Env>;
