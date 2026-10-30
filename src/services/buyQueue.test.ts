import { describe, expect, it } from 'vitest';
import { HEROES_DB, ITEMS_DB, generateTacticalPlan, getHeroItemStat } from '../data/deadlockData';
import { makeTranslate } from '../i18n';
import { BuyQueue, computeBuyQueue, estimateClockS, isLaneOver } from './buyQueue';
import {
  KEY_CORE_PICK_RATE,
  KEY_SPIKE,
  SPIKES,
  inBuyOrder,
  investedSouls,
  investmentProgress,
  sellKeepsSpikes,
  spikeOrder,
} from './investments';
import { getComponentIds, getSellCandidates, getSlotPlans } from './recommendations';

const t = makeTranslate('en');

/** A deterministic random generator (mulberry32) so the simulated lineups never change. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const median = (values: number[]) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

interface Tally {
  games: number;
  keyCoreBehindCounter: number; // a counter ahead of a key core item that is already due
  laneCounterAfterLaning: number;
  teamCounterBeforeFirstSpike: number;
  unansweredEnemyMissing: number; // a counter queued although every enemy it answers is answered
  laneBuySouls: number[];
  sells: number;
  sellsBreakingSpike: number;
}

/**
 * Plays every hero's meta build against random lineups (one of them with the lane opponent marked fed), always buying
 * the #1 with the inventory limit of 12, and checks the queue's rules at every step.
 */
function simulate(lineupsPerHero: number): Tally {
  const random = rng(5);
  const ids = HEROES_DB.map((h) => h.id);
  const tally: Tally = {
    games: 0,
    keyCoreBehindCounter: 0,
    laneCounterAfterLaning: 0,
    teamCounterBeforeFirstSpike: 0,
    unansweredEnemyMissing: 0,
    laneBuySouls: [],
    sells: 0,
    sellsBreakingSpike: 0,
  };
  for (const fedMode of [false, true]) {
    for (const heroId of ids) {
      const hero = HEROES_DB.find((h) => h.id === heroId)!;
      const build = hero.builds[0];
      const buildIds = [...build.phases.early, ...build.phases.mid, ...build.phases.late];
      const stat = (id: string) => getHeroItemStat(heroId, id);
      const buyTimeS = (id: string) => stat(id)?.buyTimeS || undefined;
      const isKeyCore = (id: string) => (stat(id)?.pickRate ?? 0) >= KEY_CORE_PICK_RATE;
      const order = spikeOrder(inBuyOrder(buildIds, buyTimeS));
      for (let k = 0; k < lineupsPerHero; k++) {
        const team = ids.filter((e) => e !== heroId).sort(() => random() - 0.5).slice(0, 6);
        const lane = team.slice(0, 2);
        const plan = generateTacticalPlan(heroId, build.id, 'yellow', 'duo', lane, team, null, 'en', fedMode ? [lane[0]] : []);
        const counterIds = new Set(plan.priorityItems.map((r) => r.item.id));
        tally.games++;
        let owned: string[] = [];
        let spent = 0;
        let laneOverLatched = false;
        const seenLane = new Set<string>();
        for (let step = 0; step < 40 && spent < 45000; step++) {
          const laneOver: boolean = laneOverLatched || isLaneOver(undefined, spent);
          laneOverLatched = laneOver;
          const status = { itemIds: owned, occupied: owned.length, locked: 0, unmatched: 0 };
          const sellCandidates = getSellCandidates(status, build, counterIds);
          const investment = investmentProgress(order, owned);
          const { queue }: BuyQueue = computeBuyQueue({
            build,
            priorityItems: plan.priorityItems,
            matchupAlerts: plan.matchupAlerts,
            laneOutlook: plan.laneStrategy.outlook?.outlook,
            items: ITEMS_DB,
            t,
            ownedItems: owned,
            investedItems: owned,
            inventoryStatus: status,
            sellCandidates,
            investment,
            stat,
            laneOver,
          });
          if (queue.length === 0) break;

          const nowS = estimateClockS(spent);
          const firstSpikeDone = investment.categories.some((c) => c.done);
          queue.forEach((entry, index) => {
            if (!entry.role) return;
            if (entry.role === 'lane' && laneOver) tally.laneCounterAfterLaning++;
            if (entry.role === 'team' && !firstSpikeDone && nowS < SPIKES[0].pushUntilMin * 60) tally.teamCounterBeforeFirstSpike++;
            // A key core item that is due stays ahead of every counter
            const dueBehind = queue.some(
              (other, j) => j > index && !other.role && isKeyCore(other.item.id) && (buyTimeS(other.item.id) ?? Infinity) <= nowS
            );
            if (dueBehind) tally.keyCoreBehindCounter++;
          });

          const item = queue[0].item;
          const components = getComponentIds(item.id);
          const isUpgrade = [...components].some((c) => owned.includes(c));
          let next = owned.filter((o) => !components.has(o));
          if (!isUpgrade && owned.length >= 12) {
            const slotPlan = getSlotPlans(queue.slice(0, 6), owned, status, sellCandidates, (sold, bought) =>
              sellKeepsSpikes(owned, sold, bought)
            ).get(item.id);
            if (slotPlan?.kind !== 'sell') break;
            tally.sells++;
            const before = investedSouls(owned);
            next = next.filter((o) => o !== slotPlan.itemId);
            const after = investedSouls([...next, item.id]);
            if ((['weapon', 'spirit', 'vitality'] as const).some((c) => before[c] >= KEY_SPIKE && after[c] < KEY_SPIKE)) {
              tally.sellsBreakingSpike++;
            }
          }
          const refund = owned.filter((o) => components.has(o)).reduce((sum, o) => sum + ITEMS_DB[o].cost, 0);
          if (queue[0].role === 'lane' && !seenLane.has(item.id)) {
            seenLane.add(item.id);
            tally.laneBuySouls.push(spent);
          }
          spent += item.cost - refund;
          owned = [...next, item.id];
        }
      }
    }
  }
  return tally;
}

describe('the buy queue on simulated games', () => {
  // 44 heroes x 3 lineups, each also with the lane opponent marked fed: 264 games
  const tally = simulate(3);

  it('never puts a counter ahead of a key core item that is already due', () => {
    expect(tally.games).toBe(264);
    expect(tally.keyCoreBehindCounter).toBe(0);
  });

  it('keeps team counters out of the queue until the first spike is done (or 14 min)', () => {
    expect(tally.teamCounterBeforeFirstSpike).toBe(0);
  });

  it('buys a lane counter right after the first items, never once laning is over', () => {
    expect(tally.laneCounterAfterLaning).toBe(0);
    expect(tally.laneBuySouls.length).toBeGreaterThan(0);
    expect(Math.max(...tally.laneBuySouls)).toBeLessThan(6400);
    expect(median(tally.laneBuySouls)).toBeLessThanOrEqual(3200);
  });

  it('never suggests a sale that drops a finished 4,800 spike', () => {
    expect(tally.sells).toBeGreaterThan(0);
    expect(tally.sellsBreakingSpike).toBe(0);
  });
});
