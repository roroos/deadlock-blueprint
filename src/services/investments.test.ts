import { describe, expect, it } from 'vitest';
import { ITEMS_DB } from '../data/deadlockData';
import {
  investedSouls,
  investmentItems,
  investmentProgress,
  isSpikeWorthIt,
  keySpikeReached,
  nudgeTowardKeySpike,
  spikeOrder,
} from './investments';
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

describe('investmentItems', () => {
  const manual = new Set(['tesla_bullets']);

  it('counts a hand-marked item ("Skip") only once the scanner sees it', () => {
    expect(investmentItems(['tesla_bullets', 'extended_magazine'], manual, ['extended_magazine'])).toEqual([
      'extended_magazine',
    ]);
    expect(investmentItems(['tesla_bullets'], manual, ['tesla_bullets'])).toEqual(['tesla_bullets']);
  });

  it('keeps the hand-marked items without an inventory read', () => {
    expect(investmentItems(['tesla_bullets'], manual, null)).toEqual(['tesla_bullets']);
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
    expect(progress.pace).toEqual({ highRank: 10.2, lowRank: 11.6 });
  });

  it('moves on to the next category once one is at 4,800', () => {
    const progress = investmentProgress(order, ['tesla_bullets', 'long_range', 'slowing_hex']);
    expect(progress.categories.map((c) => c.done)).toEqual([true, false, false]);
    expect(progress.target?.category).toBe('spirit');
    expect(progress.spikeNumber).toBe(2);
    expect(progress.pace).toEqual({ highRank: 15.3, lowRank: 17.4 });
  });

  it('counts a spike reached out of order', () => {
    const progress = investmentProgress(order, ['metal_skin', 'healbane']);
    expect(progress.target?.category).toBe('weapon');
    expect(progress.spikeNumber).toBe(2);
  });

  it('has no target once all three are at 4,800', () => {
    const progress = investmentProgress(order, BUILD);
    expect(progress.target).toBeNull();
    expect(progress.pace).toBeNull();
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

  it('takes out the item sold to make room first', () => {
    expect(keySpikeReached('monster_rounds', ['tesla_bullets', 'extended_magazine'])).toBe('weapon');
    expect(keySpikeReached('monster_rounds', ['tesla_bullets', 'extended_magazine'], 'extended_magazine')).toBeNull();
    expect(keySpikeReached('monster_rounds', ['tesla_bullets', 'extended_magazine', 'extra_spirit'], 'extra_spirit')).toBe(
      'weapon'
    );
  });

  it('is null once the category is already past 4,800', () => {
    expect(keySpikeReached('long_range', ['silencer'])).toBeNull();
  });
});

describe('isSpikeWorthIt', () => {
  const order = spikeOrder(BUILD);
  const worthIt = (itemId: string, owned: string[]) => isSpikeWorthIt(itemId, owned, investmentProgress(order, owned));

  it('points out an item finishing the first or second spike', () => {
    expect(worthIt('long_range', ['tesla_bullets'])).toBe(true);
    expect(worthIt('slowing_hex', ['tesla_bullets', 'long_range', 'mystic_slow', 'mystic_vulnerability'])).toBe(true);
  });

  it('ignores a spike outside the target category', () => {
    expect(worthIt('metal_skin', ['tesla_bullets', 'healbane'])).toBe(false);
  });

  it('points out the third spike only for a top-up of 800 souls or less', () => {
    const twoSpikes = ['tesla_bullets', 'long_range', 'slowing_hex', 'mystic_slow', 'mystic_vulnerability'];
    expect(worthIt('metal_skin', [...twoSpikes, 'healbane'])).toBe(false);
    expect(worthIt('extra_health', [...twoSpikes, 'metal_skin', 'extra_regen'])).toBe(true);
  });
});

describe('nudgeTowardKeySpike', () => {
  const owned = ['tesla_bullets'];
  const progress = investmentProgress(spikeOrder(BUILD), owned);
  const spiritFirst = investmentProgress(['spirit', 'weapon', 'vitality'], owned);
  const queue = [entry('extended_magazine'), entry('close_quarters'), entry('long_range'), entry('heroic_aura')];
  const times: Record<string, number> = { extended_magazine: 600, close_quarters: 620, long_range: 700 };

  it('moves an item taking the target to 4,800 from #2 or #3 to #1 when it is usually bought about as early', () => {
    expect(ids(nudgeTowardKeySpike(queue, owned, progress, (id) => times[id]))).toEqual([
      'long_range',
      'extended_magazine',
      'close_quarters',
      'heroic_aura',
    ]);
  });

  it('only nudges toward the target category', () => {
    expect(nudgeTowardKeySpike(queue, owned, spiritFirst, (id) => times[id])).toBe(queue);
  });

  it('keeps the order when the spike item is usually bought much later', () => {
    expect(nudgeTowardKeySpike(queue, owned, progress, (id) => ({ ...times, long_range: 900 })[id])).toBe(queue);
  });

  it('does not nudge an item whose spike the sale it needs takes back', () => {
    const full = ['tesla_bullets', 'extended_magazine'];
    const fullProgress = investmentProgress(spikeOrder(BUILD), full);
    const q = [entry('extra_spirit'), entry('monster_rounds')];
    const at = () => 600;
    expect(ids(nudgeTowardKeySpike(q, full, fullProgress, at))).toEqual(['monster_rounds', 'extra_spirit']);
    // The #1 sells the weakest item: once moved to #1, the spike item would sell Extended Magazine
    const sold = (queue: QueueEntry[], id: string) => (queue[0].item.id === id ? 'extended_magazine' : undefined);
    expect(nudgeTowardKeySpike(q, full, fullProgress, at, sold)).toBe(q);
  });

  it('never reaches past #3', () => {
    const late = [entry('extended_magazine'), entry('close_quarters'), entry('monster_rounds'), entry('long_range')];
    expect(nudgeTowardKeySpike(late, owned, progress, () => 600)).toBe(late);
  });
});
