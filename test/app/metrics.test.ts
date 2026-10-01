import { describe, expect, it } from 'vitest';
import { Metrics } from '../../src/metrics';

describe('Metrics', () => {
  it('shows nothing before any real request', () => {
    const m = new Metrics();
    expect(m.rate(5000)).toBeNull();
    expect(m.median()).toBeNull();
  });

  it('computes decisions per second over the elapsed time while the window fills', () => {
    const m = new Metrics(10_000);
    m.noteStart(0);
    for (let i = 1; i <= 8; i++) m.record(500, i * 250);
    expect(m.rate(2000)).toBeCloseTo(4);
  });

  it('uses a rolling window once enough time has passed', () => {
    const m = new Metrics(10_000);
    m.noteStart(0);
    for (let i = 0; i < 50; i++) m.record(400, 1000 + i * 100); // 1s..5.9s
    expect(m.rate(20_000)).toBe(0);
  });

  it('takes the median of recent round trips', () => {
    const m = new Metrics(10_000, 5);
    m.noteStart(0);
    [900, 100, 300, 700, 500].forEach((rtt, i) => m.record(rtt, i));
    expect(m.median()).toBe(500);
    m.record(200, 10); // drops the oldest (900)
    expect(m.median()).toBe(300); // [100, 200, 300, 500, 700]
  });

  it('reset clears everything', () => {
    const m = new Metrics();
    m.noteStart(0);
    m.record(100, 10);
    m.reset();
    expect(m.median()).toBeNull();
    expect(m.rate(5000)).toBeNull();
  });
});
