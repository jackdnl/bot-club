import { describe, expect, it, vi } from 'vitest';
import type { Ticket } from '../../src/admissions';
import { Bot, World } from '../../src/scene/world';

const fakeCanvas = { getContext: () => ({}) } as unknown as HTMLCanvasElement;
let nextId = 1;
const ticket = (): Ticket => ({
  id: nextId++,
  profile: { name: 'Nico', species: 'Werewolf', job: 'Barista', item: 'a torch', intro: 'Hi.', color: 'green' as const },
  status: 'waiting',
  policy: null,
  attempts: 0,
  deferrals: 0,
  verdict: null,
  error: null,
  version: 0,
});

describe('World spawning', () => {
  it.each([
    ['red', '#ff6b5b', 0], ['green', '#c4f04a', 1],
    ['purple', '#b49cff', 2], ['blue', '#45dde6', 3],
  ] as const)('draws the profile color %s regardless of ticket ID', (color, hex, hue) => {
    const t = ticket();
    t.id = 99;
    t.profile.color = color;
    const bot = new Bot(t, 0);
    expect(bot.color).toBe(hex);
    expect(bot.hue).toBe(hue);
  });

  it('calls onArrive exactly once for every bot, including zero-delay ones', () => {
    const onArrive = vi.fn();
    const world = new World(fakeCanvas, { onArrive });
    const tickets = [ticket(), ticket(), ticket()];
    tickets.forEach((t, i) => world.addBot(t, i * 0.04)); // first bot has delay 0
    for (let i = 0; i < 30; i++) world.step(1 / 60);
    expect(onArrive).toHaveBeenCalledTimes(3);
    expect(onArrive.mock.calls.map(([t]) => t.id)).toEqual(tickets.map((t) => t.id));
  });

  it('does not arrive bots that are still waiting out their spawn delay', () => {
    const onArrive = vi.fn();
    const world = new World(fakeCanvas, { onArrive });
    world.addBot(ticket(), 1);
    world.step(0.5);
    expect(onArrive).not.toHaveBeenCalled();
    world.step(0.6);
    expect(onArrive).toHaveBeenCalledOnce();
  });

  it('reports the real verdict immediately, without waiting for the door animation', () => {
    const world = new World(fakeCanvas, { onArrive: () => {} });
    const t = ticket();
    world.addBot(t, 0);
    world.step(1 / 60);
    t.status = 'admitted';
    expect(world.displayStatus(t)).toBe('admitted');
  });
});
