/** Rolling metrics over successful decisions only. Failed requests never count. */
export class Metrics {
  private times: number[] = [];
  private rtts: number[] = [];
  private firstStart: number | null = null;

  constructor(
    private readonly windowMs = 10_000,
    private readonly sampleSize = 100,
  ) {}

  /** Call when a request leaves the browser; anchors the rate window for the first seconds. */
  noteStart(now: number): void {
    if (this.firstStart === null) this.firstStart = now;
  }

  record(rttMs: number, now: number): void {
    this.times.push(now);
    this.rtts.push(rttMs);
    if (this.rtts.length > this.sampleSize) this.rtts.shift();
    this.prune(now);
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.times.length && this.times[i]! < cutoff) i++;
    if (i) this.times.splice(0, i);
  }

  /** Completed decisions per second over the window, or null before there is a real sample. */
  rate(now: number): number | null {
    this.prune(now);
    if (this.firstStart === null || this.times.length === 0) return this.firstStart === null ? null : 0;
    const span = Math.min(this.windowMs, now - this.firstStart);
    if (span < 1000) return null;
    return (this.times.length * 1000) / span;
  }

  /** Median browser round trip of the last `sampleSize` successful decisions. */
  median(): number | null {
    if (this.rtts.length === 0) return null;
    const sorted = [...this.rtts].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }

  reset(): void {
    this.times = [];
    this.rtts = [];
    this.firstStart = null;
  }
}
