/** Median browser round trip over recent successful decisions. Failed requests never count. */
export class Metrics {
  private rtts: number[] = [];

  constructor(private readonly sampleSize = 100) {}

  record(rttMs: number): void {
    this.rtts.push(rttMs);
    if (this.rtts.length > this.sampleSize) this.rtts.shift();
  }

  /** Median of the last `sampleSize` successful round trips, or null before the first one. */
  median(): number | null {
    if (this.rtts.length === 0) return null;
    const sorted = [...this.rtts].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }

  reset(): void {
    this.rtts = [];
  }
}
