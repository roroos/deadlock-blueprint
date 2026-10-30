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
 * Median minute players (normal games) have one, two and three categories at 4,800: rank 81+ and rank 1-40.
 * Measured on 40,000 players per group over 1.5 days of deadlock-api.com data (docs/INVESTMENTS.md).
 * Shown as a range: comparing every player to rank 81+ alone flagged half of them "behind", even at high rank.
 */
export const HIGH_RANK_SPIKE_MINUTES = [10.2, 15.3, 19.9];
export const LOW_RANK_SPIKE_MINUTES = [11.6, 17.4, 23.2];

/**
 * The first two 4,800s are the ones worth bending the order for. After them, the third only when it is a small
 * top-up: an item that adds at most this many souls to the category.
 */
export const CORE_SPIKES = 2;
export const CHEAP_TOP_UP = 800;

/**
 * The player's own commitment wins over the build: a category not yet at 4,800 with at least this many souls,
 * and this far ahead of the build's next category, becomes the target. Replay of a recorded Infernus game
 * (tests/replays/sapphire_infernus_full): vitality at 4,000 against spirit 1,600 at 13 min, weapon at 3,200
 * against spirit 1,600 at 21 min, while the build still pointed at spirit all game. Below 2,400 nothing is
 * committed yet: an 800 or 1,600 item says little about the build.
 */
const COMMIT_MIN_SOULS = 2400;
const COMMIT_LEAD = 1600;

/**
 * A key core item: bought in at least this share of the hero's games (high rank). It always keeps its place:
 * a spike item never moves above one, and a counter never takes its place.
 */
export const KEY_CORE_PICK_RATE = 0.7;

/** A spike item may move to #1 only when players usually buy it this close to the current #1 (seconds). */
const NUDGE_WINDOW_S = 120;

const CATEGORIES: ItemCategory[] = ['weapon', 'spirit', 'vitality'];

/**
 * How long a spike is worth bending the order or warning about. Measured on 534,000 ranked players (deadlock-api.com,
 * Oct 2026), compared at equal spend and team lead: the first 4,800 is worth about +1 point of win rate at 9-12 min
 * and 0 at 15 min, each later one +0.7 to +1 while early and 0 by 30 min. After these minutes (spike 1, 2 and 3) the
 * spike gets no reordering, no badge and no "late" colour.
 */
export const SPIKE_PUSH_UNTIL_MIN = [14, 20, 24];
/** The third spike is pushed like the others before this minute, and only as a cheap top-up until its end. */
export const THIRD_FULL_UNTIL_MIN = 22;
/** A top-up badge: the category sits at this many souls or more, and the item adds at most CHEAP_TOP_UP. */
const NEAR_MISS_FROM = 4000;

/** How hard the target spike is pushed: any item, a cheap top-up only, or not at all. */
export type SpikePush = 'full' | 'top-up' | 'off';

export interface CategoryInvestment {
  category: ItemCategory;
  souls: number;
  done: boolean; // at 4,800 or more
}

export interface InvestmentProgress {
  categories: CategoryInvestment[]; // at 4,800 first, then the target, then the rest (build's spike order)
  target: CategoryInvestment | null; // the next category to take to 4,800, null once all three are there
  fromInventory: boolean; // the target is the category the player committed to, not the build's next one
  spikeNumber: number; // 1-3: which spike the target is (categories already at 4,800 + 1)
  pace: { highRank: number; lowRank: number } | null; // median minute players have that many spikes
  push: SpikePush; // how hard the target is pushed at this point of the game (SPIKE_PUSH_UNTIL_MIN)
}

/**
 * The items the investment counts. An item marked by hand ("Skip" or a click) counts only once the scanner sees
 * it: skipping a 3,200 item filled 3,200 of its category and could fake a spike. Without an inventory read
 * (no scan), the hand-marked items are all there is.
 */
export function investmentItems(
  ownedItems: string[],
  manualOwned: ReadonlySet<string>,
  scannedItemIds: string[] | null
): string[] {
  if (!scannedItemIds) return ownedItems;
  return ownedItems.filter((id) => !manualOwned.has(id) || scannedItemIds.includes(id));
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
 * The build's items in the order players buy them (itemStats). The phases are tiers (T1 early, T2 mid, T3-4
 * late, scripts/update-builds.mjs), not times: walking them in order counted a 3,200 item usually bought at
 * 10 min after a 1,600 item bought at 22 min, and the spike line disagreed with the queue (ordered by buy time)
 * on 19 of 44 meta builds. An item without a buy time keeps its place after the item before it.
 */
export function inBuyOrder(itemIds: string[], buyTimeS: (itemId: string) => number | undefined): string[] {
  let previous = 0;
  const timed = itemIds.map((id, index) => {
    previous = buyTimeS(id) ?? previous;
    return { id, index, time: previous };
  });
  return timed.sort((a, b) => a.time - b.time || a.index - b.index).map((x) => x.id);
}

/**
 * The order the build takes the categories to 4,800, buying its items in order (inBuyOrder). Categories it never takes
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

/** Without a clock the first two spikes are pushed and the third only as a cheap top-up, as before the windows. */
function spikePush(doneCount: number, hasTarget: boolean, clockS: number | undefined): SpikePush {
  if (!hasTarget) return 'off';
  if (doneCount >= CORE_SPIKES) {
    if (clockS === undefined) return 'top-up';
    if (clockS < THIRD_FULL_UNTIL_MIN * 60) return 'full';
    return clockS < SPIKE_PUSH_UNTIL_MIN[2] * 60 ? 'top-up' : 'off';
  }
  return clockS !== undefined && clockS >= SPIKE_PUSH_UNTIL_MIN[doneCount] * 60 ? 'off' : 'full';
}

export function investmentProgress(order: ItemCategory[], ownedItems: string[], clockS?: number): InvestmentProgress {
  const souls = investedSouls(ownedItems);
  const inOrder = order.map((category) => ({ category, souls: souls[category], done: souls[category] >= KEY_SPIKE }));
  const doneCount = inOrder.filter((c) => c.done).length;
  const buildTarget = inOrder.find((c) => !c.done) ?? null;
  // A category the player clearly committed to replaces the build's next one (COMMIT_MIN_SOULS, COMMIT_LEAD)
  const committed = buildTarget
    ? inOrder
        .filter((c) => !c.done && c.souls >= COMMIT_MIN_SOULS && c.souls - buildTarget.souls >= COMMIT_LEAD)
        .sort((a, b) => b.souls - a.souls)[0]
    : undefined;
  const target = committed ?? buildTarget;
  const categories = [...inOrder.filter((c) => c.done), ...(target ? [target] : []), ...inOrder.filter((c) => !c.done && c !== target)];
  return {
    categories,
    target,
    fromInventory: target !== buildTarget,
    spikeNumber: doneCount + 1,
    pace: target ? { highRank: HIGH_RANK_SPIKE_MINUTES[doneCount], lowRank: LOW_RANK_SPIKE_MINUTES[doneCount] } : null,
    push: spikePush(doneCount, target !== null, clockS),
  };
}

/** The owned items after buying this one, selling `soldId` first (inventory full). */
function afterPurchase(itemId: string, ownedItems: string[], soldId?: string): string[] {
  return [...ownedItems.filter((id) => id !== soldId), itemId];
}

/**
 * Whether selling `soldId` to make room for `itemId` keeps every category that is at 4,800: a sale that drops a
 * finished spike below it (and the new item does not bring it back) throws away the biggest bonus jump. Measured
 * on 1,760 simulated games with a full inventory: 2% of the suggested sales did, in 9% of the games.
 */
export function sellKeepsSpikes(ownedItems: string[], soldId: string, itemId: string): boolean {
  const before = investedSouls(ownedItems);
  const after = investedSouls(afterPurchase(itemId, ownedItems, soldId));
  return CATEGORIES.every((category) => before[category] < KEY_SPIKE || after[category] >= KEY_SPIKE);
}

/**
 * The category this item takes from below 4,800 to at least 4,800, if any. With a full inventory, the item sold
 * to make room (`soldId`) leaves first: selling a weapon item to buy one could otherwise "reach" a weapon spike.
 */
export function keySpikeReached(itemId: string, ownedItems: string[], soldId?: string): ItemCategory | null {
  const category = ITEMS_DB[itemId]?.category;
  if (!category) return null;
  const before = investedSouls(ownedItems)[category];
  return before < KEY_SPIKE && investedSouls(afterPurchase(itemId, ownedItems, soldId))[category] >= KEY_SPIKE
    ? category
    : null;
}

/**
 * Whether this item is worth pointing out: it takes the target category to 4,800 while that spike is still worth
 * pushing (progress.push): any item for the first two spikes and the third while it is early, a small top-up
 * for the third after that.
 */
export function isSpikeWorthIt(
  itemId: string,
  ownedItems: string[],
  progress: InvestmentProgress,
  soldId?: string
): boolean {
  const target = progress.target?.category;
  if (!target || progress.push === 'off' || keySpikeReached(itemId, ownedItems, soldId) !== target) return false;
  if (progress.push === 'full') return true;
  return (
    investedSouls(afterPurchase(itemId, ownedItems, soldId))[target] - investedSouls(ownedItems)[target] <= CHEAP_TOP_UP
  );
}

/**
 * The souls this item adds to the target category when it finishes the 4,800 from at least 4,000 and adds no more
 * than a top-up (800): the "last 800 souls" badge, shown instead of the plain spike badge. 38% of players spend time
 * at 4,000-4,799 before their first spike (median wait 1.9 min at rank 81+, 2.6 at 1-40; 46% of the crossings add
 * only 800, mostly an 800 to 1,600 upgrade). It never reorders anything.
 */
export function spikeTopUp(
  itemId: string,
  ownedItems: string[],
  progress: InvestmentProgress,
  soldId?: string
): number | null {
  const target = progress.target?.category;
  if (!target || !isSpikeWorthIt(itemId, ownedItems, progress, soldId)) return null;
  const before = investedSouls(ownedItems)[target];
  const added = investedSouls(afterPurchase(itemId, ownedItems, soldId))[target] - before;
  return before >= NEAR_MISS_FROM && added <= CHEAP_TOP_UP ? added : null;
}

/**
 * Gentle nudge: when the #1 is not worth a spike but #2 or #3 is (isSpikeWorthIt) and players usually buy it
 * at about the same time, that item becomes #1. The rest of the queue keeps its order. Never when the target
 * comes from the inventory: the queue follows the build, and the player who left it does not need it reordered.
 * `soldItem` gives the item sold to make room for an item in a queue (inventory full), as the cards will show
 * it: the sales follow the queue order, so it is asked of the queue with the spike item moved to #1.
 * `isKeyCore` marks the items a spike item never moves above.
 */
export function nudgeTowardKeySpike(
  queue: QueueEntry[],
  ownedItems: string[],
  progress: InvestmentProgress,
  buyTimeS: (itemId: string) => number | undefined,
  soldItem: (queue: QueueEntry[], itemId: string) => string | undefined = () => undefined,
  isKeyCore: (itemId: string) => boolean = () => false
): QueueEntry[] {
  const reachesTarget = (q: QueueEntry[]) => isSpikeWorthIt(q[0].item.id, ownedItems, progress, soldItem(q, q[0].item.id));
  if (progress.fromInventory || queue.length < 2 || reachesTarget(queue)) return queue;
  const firstTime = buyTimeS(queue[0].item.id);
  if (firstTime === undefined) return queue;
  for (const [index, spike] of queue.slice(1, 3).entries()) {
    // Never above a key core item: the spike item waits behind it
    if (queue.slice(0, index + 1).some((entry) => isKeyCore(entry.item.id))) break;
    const time = buyTimeS(spike.item.id);
    if (time === undefined || time - firstTime > NUDGE_WINDOW_S) continue;
    const nudged = [spike, ...queue.filter((entry) => entry !== spike)];
    if (reachesTarget(nudged)) return nudged;
  }
  return queue;
}
