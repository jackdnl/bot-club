// Request/response contract shared by the browser and the Worker.
// The Worker owns the model and question schema; the browser only sends a
// short door policy and one guest profile per request.

export const LIMITS = {
  /** Hard cap on the raw request body, in bytes. */
  bodyBytes: 2048,
  policy: { min: 3, max: 140 },
  name: { min: 1, max: 40 },
  species: { min: 1, max: 40 },
  job: { min: 1, max: 48 },
  item: { min: 1, max: 48 },
  intro: { min: 1, max: 160 },
} as const;

export const PROFILE_FIELDS = ['name', 'species', 'job', 'item', 'intro'] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export type BotProfile = Record<ProfileField, string>;

export interface AdmitRequest {
  policy: string;
  bot: BotProfile;
}

export type Decision = 'admit' | 'reject';

export interface AdmitSuccess {
  decision: Decision;
  /** Clef's own confidence field, when reported. Distinct from the option probabilities. */
  confidence: number | null;
  probabilities: { admit: number | null; reject: number | null } | null;
  /** Worker-observed duration of the Workers AI call (includes binding/service overhead). */
  modelMs: number;
  model: 'clef-flash';
}

export type ErrorCode =
  | 'method_not_allowed'
  | 'forbidden_origin'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'invalid_json'
  | 'invalid_request'
  | 'rate_limited'
  | 'limiter_unavailable'
  | 'upstream_timeout'
  | 'upstream_busy'
  | 'upstream_error'
  | 'upstream_malformed'
  | 'not_found'
  | 'internal_error';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; retryable: boolean };
}

export type Validation<T> = { ok: true; value: T } | { ok: false; field: string; message: string };

// C0/C1 controls, zero-width marks, bidi overrides and BOM, built from code points
// so no invisible characters live in the source.
const STRIP_RANGES: [number, number][] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
];
const CONTROL_CHARS = new RegExp(
  `[${STRIP_RANGES.map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`,
  'g',
);

/** Strip control/invisible characters, collapse whitespace, trim. */
export function cleanText(value: string): string {
  return value.normalize('NFC').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkText(
  raw: unknown,
  field: string,
  limit: { min: number; max: number },
): Validation<string> {
  if (typeof raw !== 'string') return { ok: false, field, message: `${field} must be a string` };
  const value = cleanText(raw);
  // Count code points, not UTF-16 units, so emoji are not double-counted.
  const length = [...value].length;
  if (length < limit.min) {
    const message = limit.min === 1 ? `${field} must not be empty` : `${field} must be at least ${limit.min} characters`;
    return { ok: false, field, message };
  }
  if (length > limit.max) {
    return { ok: false, field, message: `${field} must be at most ${limit.max} characters` };
  }
  return { ok: true, value };
}

export function validatePolicy(raw: unknown): Validation<string> {
  return checkText(raw, 'policy', LIMITS.policy);
}

export function validateAdmitRequest(input: unknown): Validation<AdmitRequest> {
  if (!isPlainObject(input)) return { ok: false, field: 'body', message: 'body must be a JSON object' };
  for (const key of Object.keys(input)) {
    if (key !== 'policy' && key !== 'bot') {
      return { ok: false, field: key, message: `unexpected field "${key.slice(0, 24)}"` };
    }
  }
  const policy = validatePolicy(input.policy);
  if (!policy.ok) return policy;

  const bot = input.bot;
  if (!isPlainObject(bot)) return { ok: false, field: 'bot', message: 'bot must be an object' };
  for (const key of Object.keys(bot)) {
    if (!(PROFILE_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, field: `bot.${key.slice(0, 24)}`, message: `unexpected field "bot.${key.slice(0, 24)}"` };
    }
  }
  const profile = {} as BotProfile;
  for (const field of PROFILE_FIELDS) {
    const checked = checkText(bot[field], `bot.${field}`, LIMITS[field]);
    if (!checked.ok) return checked;
    profile[field] = checked.value;
  }
  return { ok: true, value: { policy: policy.value, bot: profile } };
}

/** Browser-side guard: make sure a 200 body really is an AdmitSuccess. */
export function parseAdmitSuccess(input: unknown): AdmitSuccess | null {
  if (!isPlainObject(input)) return null;
  const { decision, confidence, probabilities, modelMs, model } = input;
  if (decision !== 'admit' && decision !== 'reject') return null;
  if (model !== 'clef-flash') return null;
  if (typeof modelMs !== 'number' || !Number.isFinite(modelMs) || modelMs < 0) return null;
  if (confidence !== null && !isProbability(confidence)) return null;
  let probs: AdmitSuccess['probabilities'] = null;
  if (probabilities !== null) {
    if (!isPlainObject(probabilities)) return null;
    const admit = probabilities.admit ?? null;
    const reject = probabilities.reject ?? null;
    if (admit !== null && !isProbability(admit)) return null;
    if (reject !== null && !isProbability(reject)) return null;
    probs = { admit, reject };
  }
  return { decision, confidence, probabilities: probs, modelMs, model };
}

export function parseApiError(input: unknown): ApiErrorBody['error'] | null {
  if (!isPlainObject(input) || !isPlainObject(input.error)) return null;
  const { code, message, retryable } = input.error;
  if (typeof code !== 'string' || typeof message !== 'string' || typeof retryable !== 'boolean') return null;
  return { code: code as ErrorCode, message: message.slice(0, 200), retryable };
}

export function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
