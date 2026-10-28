import { describe, expect, it } from 'vitest';
import { HeroBuildArchetype, ITEMS_DB } from '../data/deadlockData';
import {
  investedSouls,
  investmentProgress,
  mainCategory,
  nudgeTowardKeySpike,
  reachesKeySpike,
} from './investments';
import { QueueEntry } from './recommendations';

const build = (phases: Partial<HeroBuildArchetype['phases']>): HeroBuildArchetype => ({
  id: 'test',
  name: 'test',
  subtitle: '',
  playstyle: '',
  recommendedForLanes: ['solo', 'duo'],
  abilitiesOrder: ['1', '2', '3', '4'],
  abilitiesDetails: [],
  phases: { early: [], mid: [], late: [], situational: [], ...phases },
  laneTips: { solo: '', duo: '', yellow_purple: '', orange_blue: '' },
});

const entry = (id: string): QueueEntry => ({ item: ITEMS_DB[id], reason: '' });
const ids = (queue: QueueEntry[]) => queue.map((e) => e.item.id);

describe('investedSouls', () => {
  it('sums the owned items per category', () => {
    expect(investedSouls(['extended_magazine', 'monster_rounds']).weapon).toBe(1600);
  });

  it('counts an upgrade at its full cost and not its consumed component', () => {
    expect(investedSouls(['cultist_sacrifice', 'monster_rounds']).weapon).toBe(3200);
  });
});

describe('mainCategory and investmentProgress', () => {
  const weaponBuild = build({ early: ['extended_magazine', 'high_velocity_mag'], mid: ['tesla_bullets'] });

  it('takes the category with the most souls among the early and mid items', () => {
    expect(mainCategory(weaponBuild)).toBe('weapon');
  });

  it('gives the next high-rank milestone above the invested souls', () => {
    const progress = investmentProgress(weaponBuild, ['tesla_bullets']);
    expect(progress).toEqual({ category: 'weapon', souls: 3200, next: { souls: 4800, minute: 12.3 } });
  });

  it('has no next milestone past the last one', () => {
    const owned = ['silencer', 'capacitor', 'hollow_point'];
    expect(investmentProgress(weaponBuild, owned).next).toBeNull();
  });
});

describe('reachesKeySpike', () => {
  it('is true for the item that takes the category to 4,800', () => {
    expect(reachesKeySpike('long_range', ['tesla_bullets'], 'weapon')).toBe(true);
    expect(reachesKeySpike('extended_magazine', ['tesla_bullets'], 'weapon')).toBe(false);
  });

  it('counts an upgrade minus the component it consumes', () => {
    expect(reachesKeySpike('capacitor', ['tesla_bullets'], 'weapon')).toBe(true);
  });

  it('is false once the category is already past 4,800', () => {
    expect(reachesKeySpike('long_range', ['silencer'], 'weapon')).toBe(false);
  });
});

describe('nudgeTowardKeySpike', () => {
  const owned = ['tesla_bullets'];
  const queue = [entry('extended_magazine'), entry('close_quarters'), entry('long_range'), entry('heroic_aura')];

  it('moves a spike item from #2 or #3 to #1 when it is usually bought about as early', () => {
    const times: Record<string, number> = { extended_magazine: 600, close_quarters: 620, long_range: 700 };
    expect(ids(nudgeTowardKeySpike(queue, owned, 'weapon', (id) => times[id]))).toEqual([
      'long_range',
      'extended_magazine',
      'close_quarters',
      'heroic_aura',
    ]);
  });

  it('keeps the order when the spike item is usually bought much later', () => {
    const times: Record<string, number> = { extended_magazine: 600, close_quarters: 620, long_range: 900 };
    expect(nudgeTowardKeySpike(queue, owned, 'weapon', (id) => times[id])).toBe(queue);
  });

  it('never reaches past #3', () => {
    const late = [entry('extended_magazine'), entry('close_quarters'), entry('monster_rounds'), entry('long_range')];
    expect(nudgeTowardKeySpike(late, owned, 'weapon', () => 600)).toBe(late);
  });
});
