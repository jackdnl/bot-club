import { describe, expect, it } from 'vitest';
import { Metrics } from '../../src/metrics';

describe('Metrics', () => {
  it('shows nothing before any real decision', () => {
    expect(new Metrics().median()).toBeNull();
  });

  it('takes the median of recent round trips', () => {
    const m = new Metrics(5);
    [900, 100, 300, 700, 500].forEach((rtt) => m.record(rtt));
    expect(m.median()).toBe(500);
    m.record(200); // drops the oldest (900)
    expect(m.median()).toBe(300); // [100, 200, 300, 500, 700]
  });

  it('averages the middle pair for an even sample', () => {
    const m = new Metrics();
    [100, 300].forEach((rtt) => m.record(rtt));
    expect(m.median()).toBe(200);
  });

  it('reset clears everything', () => {
    const m = new Metrics();
    m.record(100);
    m.reset();
    expect(m.median()).toBeNull();
  });
});
