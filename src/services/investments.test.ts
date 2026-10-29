import { describe, expect, it } from 'vitest';
import { ITEMS_DB } from '../data/deadlockData';
import { investedSouls, investmentProgress, keySpikeReached, nudgeTowardKeySpike, spikeOrder } from './investments';
import { QueueEntry } from './recommendations';

const entry = (id: string): QueueEntry => ({ item: ITEMS_DB[id], reason: '' });
const ids = (queue: QueueEntry[]) => queue.map((e) => e.item.id);

// Weapon to 4,800 first (Healbane on the way), then spirit, then vitality
const BUILD = [
  'extended_magazine',
  'tesla_bullets',
  'healbane',
  'long_range',
  'extra_spirit',
  'slowing_hex',
  'mystic_vulnerability',
  'mystic_slow',
  'metal_skin',
];

describe('investedSouls', () => {
  it('sums the owned items per category', () => {
    expect(investedSouls(['extended_magazine', 'monster_rounds']).weapon).toBe(1600);
  });

  it('counts an upgrade at its full cost and not its consumed component', () => {
    expect(investedSouls(['cultist_sacrifice', 'monster_rounds']).weapon).toBe(3200);
  });
});

describe('spikeOrder', () => {
  it('follows the order the build takes each category to 4,800', () => {
    expect(spikeOrder(BUILD)).toEqual(['weapon', 'spirit', 'vitality']);
  });

  it('puts the categories the build never takes to 4,800 last, most souls first', () => {
    expect(spikeOrder(['mystic_slow', 'healbane', 'extra_regen', 'extended_magazine'])).toEqual([
      'vitality',
      'spirit',
      'weapon',
    ]);
  });
});

describe('investmentProgress', () => {
  const order = spikeOrder(BUILD);

  it('targets the first category of the order that is not at 4,800 yet', () => {
    const progress = investmentProgress(order, ['tesla_bullets']);
    expect(progress.target).toEqual({ category: 'weapon', souls: 3200, done: false });
    expect(progress.spikeNumber).toBe(1);
    expect(progress.minute).toBe(10.2);
  });

  it('moves on to the next category once one is at 4,800', () => {
    const progress = investmentProgress(order, ['tesla_bullets', 'long_range', 'slowing_hex']);
    expect(progress.categories.map((c) => c.done)).toEqual([true, false, false]);
    expect(progress.target?.category).toBe('spirit');
    expect(progress.spikeNumber).toBe(2);
    expect(progress.minute).toBe(15.3);
  });

  it('counts a spike reached out of order', () => {
    const progress = investmentProgress(order, ['metal_skin', 'healbane']);
    expect(progress.target?.category).toBe('weapon');
    expect(progress.spikeNumber).toBe(2);
  });

  it('has no target once all three are at 4,800', () => {
    const progress = investmentProgress(order, BUILD);
    expect(progress.target).toBeNull();
    expect(progress.minute).toBeNull();
  });
});

describe('keySpikeReached', () => {
  it('gives the category the item takes to 4,800', () => {
    expect(keySpikeReached('long_range', ['tesla_bullets'])).toBe('weapon');
    expect(keySpikeReached('extended_magazine', ['tesla_bullets'])).toBeNull();
  });

  it('counts an upgrade minus the component it consumes', () => {
    expect(keySpikeReached('capacitor', ['tesla_bullets'])).toBe('weapon');
  });

  it('is null once the category is already past 4,800', () => {
    expect(keySpikeReached('long_range', ['silencer'])).toBeNull();
  });
});

describe('nudgeTowardKeySpike', () => {
  const owned = ['tesla_bullets'];
  const queue = [entry('extended_magazine'), entry('close_quarters'), entry('long_range'), entry('heroic_aura')];
  const times: Record<string, number> = { extended_magazine: 600, close_quarters: 620, long_range: 700 };

  it('moves an item taking the target to 4,800 from #2 or #3 to #1 when it is usually bought about as early', () => {
    expect(ids(nudgeTowardKeySpike(queue, owned, 'weapon', (id) => times[id]))).toEqual([
      'long_range',
      'extended_magazine',
      'close_quarters',
      'heroic_aura',
    ]);
  });

  it('only nudges toward the target category', () => {
    expect(nudgeTowardKeySpike(queue, owned, 'spirit', (id) => times[id])).toBe(queue);
  });

  it('keeps the order when the spike item is usually bought much later', () => {
    expect(nudgeTowardKeySpike(queue, owned, 'weapon', (id) => ({ ...times, long_range: 900 })[id])).toBe(queue);
  });

  it('never reaches past #3', () => {
    const late = [entry('extended_magazine'), entry('close_quarters'), entry('monster_rounds'), entry('long_range')];
    expect(nudgeTowardKeySpike(late, owned, 'weapon', () => 600)).toBe(late);
  });
});
