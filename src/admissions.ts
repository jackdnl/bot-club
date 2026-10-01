import {
  parseAdmitSuccess,
  parseApiError,
  type AdmitSuccess,
  type BotProfile,
} from '../shared/contract';

export type TicketStatus = 'waiting' | 'pending' | 'retrying' | 'admitted' | 'rejected' | 'error';

export interface Verdict extends AdmitSuccess {
  /** Browser round trip for the successful attempt, including reading the body. */
  rttMs: number;
}

export interface TicketError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface Ticket {
  id: number;
  profile: BotProfile;
  status: TicketStatus;
  /** Door policy frozen when this bot's first request starts. */
  policy: string | null;
  attempts: number;
  deferrals: number;
  verdict: Verdict | null;
  error: TicketError | null;
  /** Bumped on every change so views can skip redundant work. */
  version: number;
}

export interface DeskHooks {
  onStart?(ticket: Ticket): void;
  onDecision?(ticket: Ticket): void;
  onRetrying?(ticket: Ticket): void;
  onError?(ticket: Ticket): void;
  onPause?(untilMs: number): void;
}

export interface DeskOptions {
  getPolicy: () => string;
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => number;
  endpoint?: string;
  concurrency?: number;
  timeoutMs?: number;
  /** Automatic retries for retryable failures before a bot waits for an explicit retry. */
  maxAutoRetries?: number;
  /** How many times one bot may be pushed back by 429/busy before it is marked failed. */
  maxDeferrals?: number;
  hooks?: DeskHooks;
}

type Outcome =
  | { kind: 'response'; status: number; body: unknown; retryAfter: string | null; rttMs: number }
  | { kind: 'timeout' }
  | { kind: 'network' };

const TIMEOUT = Symbol('timeout');

function retryAfterMs(header: string | null): number {
  const seconds = header === null ? NaN : Number(header);
  const safe = Number.isFinite(seconds) ? seconds : 5;
  return Math.min(30, Math.max(1, safe)) * 1000;
}

/**
 * Sends one bot per request with a hard concurrency bound. Reset cancels every
 * queued, in-flight and scheduled effect; late responses from an older
 * generation are dropped.
 */
export class AdmissionDesk {
  readonly concurrency: number;
  pausedUntil = 0;

  private queue: Ticket[] = [];
  private inflight = new Map<number, AbortController>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxAutoRetries: number;
  private readonly maxDeferrals: number;

  constructor(private readonly options: DeskOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => performance.now());
    this.random = options.random ?? Math.random;
    this.endpoint = options.endpoint ?? '/api/admit';
    this.concurrency = options.concurrency ?? 6;
    this.timeoutMs = options.timeoutMs ?? 25_000;
    this.maxAutoRetries = options.maxAutoRetries ?? 1;
    this.maxDeferrals = options.maxDeferrals ?? 4;
  }

  get inflightCount(): number {
    return this.inflight.size;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  enqueue(ticket: Ticket): void {
    ticket.status = 'waiting';
    ticket.version++;
    this.queue.push(ticket);
    this.pump();
  }

  /** Explicit retry for a failed bot. It re-joins the back of the line under the current rule. */
  retry(ticket: Ticket): boolean {
    if (ticket.status !== 'error') return false;
    ticket.error = null;
    ticket.attempts = 0;
    ticket.deferrals = 0;
    ticket.policy = null;
    this.enqueue(ticket);
    return true;
  }

  reset(): void {
    this.generation++;
    for (const controller of this.inflight.values()) controller.abort();
    this.inflight.clear();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.pumpTimer = null;
    this.queue = [];
    this.pausedUntil = 0;
  }

  private later(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }

  private pump(): void {
    const wait = this.pausedUntil - this.now();
    if (wait > 0) {
      if (!this.pumpTimer) {
        this.pumpTimer = setTimeout(() => {
          this.pumpTimer = null;
          this.pump();
        }, wait);
      }
      return;
    }
    while (this.inflight.size < this.concurrency && this.queue.length > 0) {
      void this.run(this.queue.shift()!);
    }
  }

  private async run(ticket: Ticket): Promise<void> {
    const generation = this.generation;
    const firstStart = ticket.status === 'waiting';
    if (ticket.policy === null) ticket.policy = this.options.getPolicy();
    ticket.status = 'pending';
    ticket.attempts++;
    ticket.version++;
    if (firstStart) this.options.hooks?.onStart?.(ticket);

    const controller = new AbortController();
    this.inflight.set(ticket.id, controller);
    const timer = setTimeout(() => controller.abort(TIMEOUT), this.timeoutMs);
    const started = this.now();

    let outcome: Outcome;
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ policy: ticket.policy, bot: ticket.profile }),
        signal: controller.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      outcome = {
        kind: 'response',
        status: response.status,
        body,
        retryAfter: response.headers.get('retry-after'),
        rttMs: this.now() - started,
      };
    } catch {
      outcome = controller.signal.reason === TIMEOUT ? { kind: 'timeout' } : { kind: 'network' };
    } finally {
      clearTimeout(timer);
    }

    // Reset happened while we were waiting: this bot no longer exists.
    if (generation !== this.generation) return;
    this.inflight.delete(ticket.id);
    this.settle(ticket, outcome, generation);
    this.pump();
  }

  private settle(ticket: Ticket, outcome: Outcome, generation: number): void {
    if (outcome.kind === 'timeout') {
      return this.fail(ticket, { code: 'timeout', message: 'No answer within 25 seconds.', retryable: true }, generation);
    }
    if (outcome.kind === 'network') {
      return this.fail(ticket, { code: 'network', message: 'Network error before Clef-flash answered.', retryable: true }, generation);
    }

    const { status, body } = outcome;
    if (status === 200) {
      const success = parseAdmitSuccess(body);
      if (!success) {
        return this.fail(ticket, { code: 'malformed_response', message: 'The server sent an unreadable verdict.', retryable: true }, generation);
      }
      ticket.verdict = { ...success, rttMs: Math.round(outcome.rttMs) };
      ticket.error = null;
      ticket.status = success.decision === 'admit' ? 'admitted' : 'rejected';
      ticket.version++;
      this.options.hooks?.onDecision?.(ticket);
      return;
    }

    const apiError = parseApiError(body);
    const busy =
      status === 429 || (status === 503 && (apiError?.code === 'upstream_busy' || apiError?.code === 'limiter_unavailable'));
    if (busy) {
      ticket.deferrals++;
      if (ticket.deferrals > this.maxDeferrals) {
        return this.fail(ticket, { code: 'rate_limited', message: 'Still rate limited after several polite waits.', retryable: true }, generation, false);
      }
      this.pausedUntil = Math.max(this.pausedUntil, this.now() + retryAfterMs(outcome.retryAfter));
      ticket.attempts--; // a deferral is not a failed attempt
      ticket.version++;
      this.queue.unshift(ticket);
      this.options.hooks?.onPause?.(this.pausedUntil);
      return;
    }

    this.fail(
      ticket,
      apiError ?? {
        code: status >= 500 ? 'server_error' : 'bad_response',
        message: `Unexpected HTTP ${status}.`,
        retryable: status >= 500,
      },
      generation,
    );
  }

  private fail(ticket: Ticket, error: TicketError, generation: number, allowAuto = true): void {
    if (allowAuto && error.retryable && ticket.attempts <= this.maxAutoRetries) {
      ticket.status = 'retrying';
      ticket.error = error;
      ticket.version++;
      this.options.hooks?.onRetrying?.(ticket);
      this.later(600 + this.random() * 600, () => {
        if (generation !== this.generation) return;
        this.queue.unshift(ticket);
        this.pump();
      });
      return;
    }
    ticket.status = 'error';
    ticket.error = error;
    ticket.version++;
    this.options.hooks?.onError?.(ticket);
  }
}
