/**
 * Item investment: the souls of the owned items in one shop category give a growing bonus at fixed thresholds
 * (the biggest jump at 4,800). Pure functions of the build and the owned items (tested in investments.test.ts).
 */
import { HeroBuildArchetype, ITEMS_DB, ItemCategory } from '../data/deadlockData';
import { getComponentIds, QueueEntry } from './recommendations';

/** The key spike: the largest bonus jump of every category. */
export const KEY_SPIKE = 4800;

/**
 * Main-category thresholds and the median minute high-rank players (rank 81+, normal games) reach them.
 * Measured on 40,000 players over 1.5 days of deadlock-api.com data (docs/INVESTMENTS.md).
 */
export const HIGH_RANK_MILESTONES: { souls: number; minute: number }[] = [
  { souls: 1600, minute: 5.6 },
  { souls: 3200, minute: 10.3 },
  { souls: 4800, minute: 12.3 },
  { souls: 6400, minute: 17.8 },
  { souls: 8000, minute: 19.9 },
  { souls: 11200, minute: 23.1 },
];

/** A spike item may move to #1 only when players usually buy it this close to the current #1 (seconds). */
const NUDGE_WINDOW_S = 120;

export interface InvestmentProgress {
  category: ItemCategory;
  souls: number;
  next: { souls: number; minute: number } | null; // null once past the last milestone
}

/** The build's main category: the most souls among its early and mid items. */
export function mainCategory(build: HeroBuildArchetype): ItemCategory {
  const souls: Record<ItemCategory, number> = { weapon: 0, vitality: 0, spirit: 0 };
  for (const id of [...build.phases.early, ...build.phases.mid]) {
    const item = ITEMS_DB[id];
    if (item) souls[item.category] += item.cost;
  }
  return (Object.keys(souls) as ItemCategory[]).reduce((a, b) => (souls[b] > souls[a] ? b : a));
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

export function investmentProgress(build: HeroBuildArchetype, ownedItems: string[]): InvestmentProgress {
  const category = mainCategory(build);
  const souls = investedSouls(ownedItems)[category];
  return { category, souls, next: HIGH_RANK_MILESTONES.find((m) => m.souls > souls) ?? null };
}

/** Whether buying this item takes the category from below the key spike to at least it. */
export function reachesKeySpike(itemId: string, ownedItems: string[], category: ItemCategory): boolean {
  if (ITEMS_DB[itemId]?.category !== category) return false;
  return investedSouls(ownedItems)[category] < KEY_SPIKE && investedSouls([...ownedItems, itemId])[category] >= KEY_SPIKE;
}

/**
 * Gentle nudge: when the #1 does not reach the key spike but #2 or #3 does and players usually buy it at
 * about the same time, that item becomes #1. The rest of the queue keeps its order.
 */
export function nudgeTowardKeySpike(
  queue: QueueEntry[],
  ownedItems: string[],
  category: ItemCategory,
  buyTimeS: (itemId: string) => number | undefined
): QueueEntry[] {
  if (queue.length < 2 || reachesKeySpike(queue[0].item.id, ownedItems, category)) return queue;
  const firstTime = buyTimeS(queue[0].item.id);
  if (firstTime === undefined) return queue;
  const idx = queue.slice(1, 3).findIndex((entry) => {
    const time = buyTimeS(entry.item.id);
    return (
      time !== undefined &&
      time - firstTime <= NUDGE_WINDOW_S &&
      reachesKeySpike(entry.item.id, ownedItems, category)
    );
  });
  if (idx < 0) return queue;
  const spike = queue[idx + 1];
  return [spike, ...queue.filter((entry) => entry !== spike)];
}
