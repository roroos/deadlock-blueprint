/**
 * Item investment: the souls of the owned items in one shop category give a growing bonus at fixed thresholds,
 * the biggest jump at 4,800. Builds and high-rank players take one category to 4,800, then the next, then the
 * last. Pure functions of the build order and the owned items (tested in investments.test.ts).
 */
import { ITEMS_DB, ItemCategory } from '../data/deadlockData';
import { getComponentIds, QueueEntry } from './recommendations';

/** The key spike: the largest bonus jump of every category. */
export const KEY_SPIKE = 4800;

/**
 * Median minute high-rank players (rank 81+, normal games) have one, two and three categories at 4,800.
 * Measured on 40,000 players over 1.5 days of deadlock-api.com data (docs/INVESTMENTS.md).
 */
export const HIGH_RANK_SPIKE_MINUTES = [10.2, 15.3, 19.9];

/**
 * The first two 4,800s are the ones worth bending the order for. After them, the third only when it is a small
 * top-up: an item that adds at most this many souls to the category.
 */
export const CORE_SPIKES = 2;
const CHEAP_TOP_UP = 800;

/** A spike item may move to #1 only when players usually buy it this close to the current #1 (seconds). */
const NUDGE_WINDOW_S = 120;

const CATEGORIES: ItemCategory[] = ['weapon', 'spirit', 'vitality'];

export interface CategoryInvestment {
  category: ItemCategory;
  souls: number;
  done: boolean; // at 4,800 or more
}

export interface InvestmentProgress {
  categories: CategoryInvestment[]; // in the build's spike order
  target: CategoryInvestment | null; // the next category to take to 4,800, null once all three are there
  spikeNumber: number; // 1-3: which spike the target is (categories already at 4,800 + 1)
  minute: number | null; // when high-rank players have that many spikes
}

/** Souls invested per category. An upgrade counts its full cost, the components it consumed do not count again. */
export function investedSouls(ownedItems: string[]): Record<ItemCategory, number> {
  const consumed = new Set(ownedItems.flatMap((id) => [...getComponentIds(id)]));
  const souls: Record<ItemCategory, number> = { weapon: 0, vitality: 0, spirit: 0 };
  for (const id of new Set(ownedItems)) {
    const item = ITEMS_DB[id];
    if (item && !consumed.has(id)) souls[item.category] += item.cost;
  }
  return souls;
}

/**
 * The order the build takes the categories to 4,800, buying its items in order. Categories it never takes
 * there follow, most souls first.
 */
export function spikeOrder(buildItemIds: string[]): ItemCategory[] {
  const order: ItemCategory[] = [];
  const bought: string[] = [];
  for (const id of buildItemIds) {
    bought.push(id);
    const souls = investedSouls(bought);
    for (const category of CATEGORIES) if (souls[category] >= KEY_SPIKE && !order.includes(category)) order.push(category);
  }
  const souls = investedSouls(buildItemIds);
  const rest = CATEGORIES.filter((c) => !order.includes(c)).sort((a, b) => souls[b] - souls[a]);
  return [...order, ...rest];
}

export function investmentProgress(order: ItemCategory[], ownedItems: string[]): InvestmentProgress {
  const souls = investedSouls(ownedItems);
  const categories = order.map((category) => ({ category, souls: souls[category], done: souls[category] >= KEY_SPIKE }));
  const doneCount = categories.filter((c) => c.done).length;
  const target = categories.find((c) => !c.done) ?? null;
  return {
    categories,
    target,
    spikeNumber: doneCount + 1,
    minute: target ? HIGH_RANK_SPIKE_MINUTES[doneCount] : null,
  };
}

/** The category this item takes from below 4,800 to at least 4,800, if any. */
export function keySpikeReached(itemId: string, ownedItems: string[]): ItemCategory | null {
  const category = ITEMS_DB[itemId]?.category;
  if (!category) return null;
  const before = investedSouls(ownedItems)[category];
  return before < KEY_SPIKE && investedSouls([...ownedItems, itemId])[category] >= KEY_SPIKE ? category : null;
}

/**
 * Whether this item is worth pointing out: it takes the target category to 4,800, and that is one of the first
 * two spikes or, for the third, a small top-up.
 */
export function isSpikeWorthIt(itemId: string, ownedItems: string[], progress: InvestmentProgress): boolean {
  const target = progress.target?.category;
  if (!target || keySpikeReached(itemId, ownedItems) !== target) return false;
  if (progress.spikeNumber <= CORE_SPIKES) return true;
  return investedSouls([...ownedItems, itemId])[target] - investedSouls(ownedItems)[target] <= CHEAP_TOP_UP;
}

/**
 * Gentle nudge: when the #1 is not worth a spike but #2 or #3 is (isSpikeWorthIt) and players usually buy it
 * at about the same time, that item becomes #1. The rest of the queue keeps its order.
 */
export function nudgeTowardKeySpike(
  queue: QueueEntry[],
  ownedItems: string[],
  progress: InvestmentProgress,
  buyTimeS: (itemId: string) => number | undefined
): QueueEntry[] {
  const reachesTarget = (id: string) => isSpikeWorthIt(id, ownedItems, progress);
  if (queue.length < 2 || reachesTarget(queue[0].item.id)) return queue;
  const firstTime = buyTimeS(queue[0].item.id);
  if (firstTime === undefined) return queue;
  const idx = queue.slice(1, 3).findIndex((entry) => {
    const time = buyTimeS(entry.item.id);
    return time !== undefined && time - firstTime <= NUDGE_WINDOW_S && reachesTarget(entry.item.id);
  });
  if (idx < 0) return queue;
  const spike = queue[idx + 1];
  return [spike, ...queue.filter((entry) => entry !== spike)];
}
