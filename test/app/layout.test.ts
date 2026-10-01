import { describe, expect, it } from 'vitest';
import { LANE_COUNT, computeLayout } from '../../src/scene/layout';

describe('computeLayout', () => {
  it.each([
    ['square 1080', 1080, 1080, 120, 90],
    ['phone portrait', 390, 844, 118, 120],
    ['desktop', 1440, 900, 80, 80],
    ['phone landscape', 844, 390, 52, 56],
  ])('%s keeps the club, doors and street consistent', (_label, w, h, top, bottom) => {
    const L = computeLayout(w, h, top, bottom);
    expect(L.lanes).toHaveLength(LANE_COUNT);
    expect(L.shell.y0).toBeGreaterThanOrEqual(top);
    expect(L.street.y1).toBeLessThanOrEqual(h - bottom);
    expect(L.room.x0).toBeGreaterThan(L.shell.x0);
    expect(L.room.x1).toBeLessThan(L.shell.x1);
    // Each door fits a bot and doors do not overlap.
    for (let i = 0; i < L.lanes.length; i++) {
      const lane = L.lanes[i]!;
      expect(lane.half).toBeGreaterThan(L.r * 1.2);
      expect(lane.x - lane.half).toBeGreaterThan(L.room.x0);
      expect(lane.x + lane.half).toBeLessThan(L.room.x1);
      const next = L.lanes[i + 1];
      if (next) expect(next.x - next.half).toBeGreaterThan(lane.x + lane.half);
    }
    // The line stands below the wall; the dance floor sits inside the room below the booth.
    expect(L.queueY - L.r).toBeGreaterThanOrEqual(L.shell.y1);
    expect(L.waitArea.y1).toBeLessThanOrEqual(L.street.y1);
    expect(L.waitArea.y0).toBeLessThan(L.waitArea.y1);
    expect(L.floor.y0).toBeGreaterThan(L.booth.y1);
    expect(L.floor.y1).toBeLessThan(L.room.y1);
  });
});
