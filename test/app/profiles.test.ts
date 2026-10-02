import { describe, expect, it } from 'vitest';
import { validateAdmitRequest, validatePolicy } from '../../shared/contract';
import { DEFAULT_POLICY, PRESETS, createProfile } from '../../src/profiles';
import { BOT_COLORS } from '../../shared/colors';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

describe('profiles', () => {
  it('puts an explicitly assigned appearance into the profile sent to the Worker', () => {
    for (const color of BOT_COLORS) {
      const bot = createProfile(seeded(7), color);
      expect(bot.color).toBe(color);
      expect(validateAdmitRequest({ policy: 'Only green dots.', bot })).toEqual({
        ok: true, value: { policy: 'Only green dots.', bot },
      });
    }
  });

  it('always produces profiles the Worker accepts', () => {
    const rng = seeded(7);
    for (let i = 0; i < 2000; i++) {
      const bot = createProfile(rng);
      const result = validateAdmitRequest({ policy: DEFAULT_POLICY, bot });
      expect(result.ok, JSON.stringify(bot)).toBe(true);
    }
  });

  it('mixes humans and supernatural guests so the default rule gets both outcomes', () => {
    const rng = seeded(11);
    const species = Array.from({ length: 400 }, () => createProfile(rng).species);
    const humans = species.filter((s) => s.startsWith('Human')).length;
    const monsters = species.filter((s) => ['Vampire', 'Ghost', 'Werewolf', 'Witch', 'Banshee', 'Kitsune', 'Zombie'].includes(s)).length;
    expect(humans).toBeGreaterThan(40);
    expect(monsters).toBeGreaterThan(40);
    expect(new Set(species).size).toBeGreaterThan(20);
  });

  it('ships valid presets', () => {
    expect(PRESETS[0]!.policy).toBe(DEFAULT_POLICY);
    for (const preset of PRESETS) expect(validatePolicy(preset.policy).ok).toBe(true);
  });
});
