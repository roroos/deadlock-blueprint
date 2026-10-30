/**
 * "Buy right now" pipeline as one pure function (tested in buyQueue.test.ts on simulated games): the counters worth
 * queueing, the purchase order, what is left to buy, the counters placed by the time they are due, and the gentle
 * 4,800 spike nudge. The priority when two items are due together, first to last:
 * 1. a key core item that is due (bought in 70% or more of the hero's games, never overtaken),
 * 2. a counter against a fed enemy that nothing owned or in the build answers,
 * 3. a lane counter against a real lane threat, after the first two items and gone at 10 min,
 * 4. a spike item (up to 2 min early, only while the spike is worth it),
 * 5. the other build items, by usual buy time,
 * 6. a team counter, once the first spike is done.
 */
import type { DeadlockItem, HeroBuildArchetype, TacticalRecommendation } from '../data/deadlockData';
import type { LaneOutlook } from '../data/matchupStats';
import type { Translate } from '../i18n';
import { SPIKE_PUSH_UNTIL_MIN, InvestmentProgress, investedSouls, nudgeTowardKeySpike, sellKeepsSpikes } from './investments';
import {
  InventoryStatus,
  QueueEntry,
  buildPurchaseOrder,
  dropAnsweredCounters,
  effectiveOwnedSet,
  estimateClockS,
  getNextPurchases,
  getPurchaseCounters,
  getSlotPlans,
  hasLaneThreat,
  laneCounterDueS,
  placeCounters,
} from './recommendations';

export interface BuyQueueInput {
  build: HeroBuildArchetype;
  priorityItems: TacticalRecommendation['priorityItems'];
  matchupAlerts: TacticalRecommendation['matchupAlerts'];
  laneOutlook?: LaneOutlook;
  items: Record<string, DeadlockItem>;
  t: Translate;
  /** Owned items, and the ones the 4,800 spikes count (investmentItems) */
  ownedItems: string[];
  investedItems: string[];
  inventoryStatus: InventoryStatus | null;
  sellCandidates: string[];
  investment: InvestmentProgress;
  /** The hero's statistics of an item: pick rate and usual buy time (getHeroItemStat) */
  stat: (itemId: string) => { pickRate: number; buyTimeS: number } | undefined;
  /** The match clock in seconds when it is read */
  clockS?: number;
  /** Laning is over (isLaneOver, latched for the match) */
  laneOver: boolean;
  /** A pick rate from which an item is a key core item */
  keyCorePickRate: number;
}

export interface BuyQueue {
  /** What to buy, best first (before the locked #1) */
  queue: QueueEntry[];
  /** The counters the queue and the cards highlight */
  counters: TacticalRecommendation['priorityItems'];
}

export function computeBuyQueue(input: BuyQueueInput): BuyQueue {
  const { build, ownedItems, investedItems, inventoryStatus, sellCandidates, investment, stat } = input;
  const buyTimeS = (itemId: string) => stat(itemId)?.buyTimeS || undefined;
  const isKeyCore = (itemId: string) => (stat(itemId)?.pickRate ?? 0) >= input.keyCorePickRate;
  const buildItemIds = [...build.phases.early, ...build.phases.mid, ...build.phases.late];

  // Counters: not against an enemy that an owned or build item already answers, and lane ones only for a lane threat
  const answered = new Set([...effectiveOwnedSet(ownedItems), ...buildItemIds]);
  const priorityItems = dropAnsweredCounters(input.priorityItems, input.matchupAlerts, answered);
  const counterContext = {
    laneThreat: hasLaneThreat(input.matchupAlerts, input.laneOutlook),
    laneOver: input.laneOver,
  };
  const counters = getPurchaseCounters(priorityItems, counterContext);
  const order = buildPurchaseOrder(build, priorityItems, input.items, input.t, counterContext);

  const soulsSpent = Object.values(investedSouls(ownedItems)).reduce((sum, souls) => sum + souls, 0);
  const nowS = input.clockS ?? estimateClockS(soulsSpent);
  const firstSpikeDone = investment.categories.some((c) => c.done);
  const remaining = getNextPurchases(order, ownedItems, inventoryStatus, sellCandidates, (id) => stat(id)?.buyTimeS);
  const placed = placeCounters(remaining, {
    nowS,
    buyTimeS,
    isKeyCore,
    laneDueS: laneCounterDueS(buildItemIds, buyTimeS),
    teamReleased: firstSpikeDone || nowS >= SPIKE_PUSH_UNTIL_MIN[0] * 60,
  });

  // The item each card will say to sell (inventory full) leaves before the spike is counted, and never one that
  // would drop a finished 4,800 spike
  const canSell = (soldId: string, itemId: string) => sellKeepsSpikes(investedItems, soldId, itemId);
  const soldItem = (q: QueueEntry[], itemId: string) => {
    const plan = getSlotPlans(q.slice(0, 6), ownedItems, inventoryStatus, sellCandidates, canSell).get(itemId);
    return plan?.kind === 'sell' ? plan.itemId : undefined;
  };
  return {
    queue: nudgeTowardKeySpike(placed, investedItems, investment, buyTimeS, soldItem, isKeyCore),
    counters,
  };
}
