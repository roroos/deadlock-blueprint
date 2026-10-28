/**
 * Custom build: a published Deadlock build, loaded by its id from api.deadlock-api.com, drives the purchase
 * queue in place of the meta build. Its author's groups ("lane", "core", "situational"...) keep their names and
 * their order. Against the current enemies, the build's own items come first; an item from outside the build is
 * only suggested for a threat the build has no answer to. Pure functions apart from the two fetches (tested in
 * customBuild.test.ts).
 */
import type { DeadlockItem, HeroBuildArchetype, TacticalRecommendation } from '../data/deadlockData';
import type { Translate } from '../i18n';
import { QueueEntry, getComponentIds, isStrongCounter } from './recommendations';

export const API_BASE = 'https://api.deadlock-api.com';
const FETCH_TIMEOUT_MS = 10000;

export interface CustomBuildGroup {
  name: string;
  description?: string;
  itemIds: string[]; // local item ids, in the author's order
  /** Bought when needed ("situational", "optional", "counter"...): only queued against a matching threat */
  isSituational: boolean;
}

export interface CustomBuild {
  buildId: number;
  version: number;
  name: string;
  apiHeroId: number;
  heroId: string | null; // local hero id, null for a hero the application does not know
  groups: CustomBuildGroup[];
  unknownItemCount: number; // items of the build missing from the catalogue (newer patch)
  fetchedAt: number;
}

export interface CustomBuildStats {
  matches: number;
  wins: number;
}

export type FetchBuildResult =
  | { kind: 'ok'; build: CustomBuild }
  | { kind: 'notFound' }
  | { kind: 'unreachable' };

type Alert = TacticalRecommendation['matchupAlerts'][number];
type PriorityItem = TacticalRecommendation['priorityItems'][number];

/** A build id typed or pasted by the player ("478992", "#478992", "Build 478992 v3"): its first number. */
export function parseBuildId(input: string): number | null {
  const match = input.match(/\d{1,10}/);
  const id = match ? Number(match[0]) : NaN;
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

const SITUATIONAL_NAME =
  /situa|option|flex|counter|contre|anti|luxur|extra|altern|if needed|when needed|vs\b|against|si besoin|selon/i;

interface RawMod {
  ability_id?: number;
}
interface RawCategory {
  name?: string;
  description?: string | null;
  mods?: RawMod[] | null;
  optional?: boolean | null;
}
interface RawBuild {
  hero_build?: {
    hero_id?: number;
    hero_build_id?: number;
    name?: string;
    version?: number;
    details?: { mod_categories?: RawCategory[] | null };
  };
}

/**
 * The API's build (one entry of /v1/builds) with local ids. Each item appears once, in its first group;
 * groups left empty (unknown items only, or the author's text boxes) are dropped.
 */
export function parseCustomBuild(
  raw: unknown,
  itemIdOf: (apiId: number) => string | undefined,
  heroIdOf: (apiHeroId: number) => string | undefined,
  now = Date.now()
): CustomBuild | null {
  const hb = (raw as RawBuild | null)?.hero_build;
  if (!hb || typeof hb.hero_build_id !== 'number' || typeof hb.hero_id !== 'number') return null;
  const seen = new Set<string>();
  let unknownItemCount = 0;
  const groups: CustomBuildGroup[] = [];
  for (const category of hb.details?.mod_categories ?? []) {
    const itemIds: string[] = [];
    for (const mod of category.mods ?? []) {
      if (typeof mod.ability_id !== 'number') continue;
      const id = itemIdOf(mod.ability_id);
      if (!id) unknownItemCount++;
      else if (!seen.has(id)) {
        seen.add(id);
        itemIds.push(id);
      }
    }
    if (itemIds.length === 0) continue;
    const name = category.name?.trim() || `#${groups.length + 1}`;
    groups.push({
      name,
      description: category.description?.trim() || undefined,
      itemIds,
      isSituational: category.optional === true || SITUATIONAL_NAME.test(name),
    });
  }
  // A build made of "optional" groups only is still a build to follow in order
  if (groups.length > 0 && groups.every((g) => g.isSituational)) groups.forEach((g) => (g.isSituational = false));
  return {
    buildId: hb.hero_build_id,
    version: hb.version ?? 0,
    name: hb.name?.trim() || `#${hb.hero_build_id}`,
    apiHeroId: hb.hero_id,
    heroId: heroIdOf(hb.hero_id) ?? null,
    groups,
    unknownItemCount,
    fetchedAt: now,
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Latest version of a published build. */
export async function fetchCustomBuild(
  buildId: number,
  itemIdOf: (apiId: number) => string | undefined,
  heroIdOf: (apiHeroId: number) => string | undefined
): Promise<FetchBuildResult> {
  let rows: unknown;
  try {
    rows = await fetchJson(`${API_BASE}/v1/builds?build_id=${buildId}&only_latest=true`);
  } catch {
    return { kind: 'unreachable' };
  }
  const build = Array.isArray(rows) ? parseCustomBuild(rows[0], itemIdOf, heroIdOf) : null;
  return build ? { kind: 'ok', build } : { kind: 'notFound' };
}

/** Matches started with this build (last 30 days, ranked and unranked); null when unreachable. */
export async function fetchCustomBuildStats(apiHeroId: number, buildId: number): Promise<CustomBuildStats | null> {
  try {
    const rows = await fetchJson(`${API_BASE}/v1/analytics/hero-build-stats/${apiHeroId}?hero_build_id=${buildId}`);
    const row = (Array.isArray(rows) ? rows : []).find(
      (r: { hero_build_id?: number }) => r?.hero_build_id === buildId
    ) as { matches?: number; wins?: number } | undefined;
    return { matches: row?.matches ?? 0, wins: row?.wins ?? 0 };
  } catch {
    return null;
  }
}

/** Items of the groups to follow in order, then the situational ones. */
export const orderedItemIds = (build: CustomBuild) => build.groups.filter((g) => !g.isSituational).flatMap((g) => g.itemIds);
const situationalItemIds = (build: CustomBuild) => build.groups.filter((g) => g.isSituational).flatMap((g) => g.itemIds);

export const groupOf = (build: CustomBuild, itemId: string) => build.groups.find((g) => g.itemIds.includes(itemId));

/**
 * The custom build as a build of the application, for what reads phases (items to sell, scanner tie-break):
 * ordered items by tier (1: early, 2-3: mid, 4: late), situational groups as situational. The texts and the
 * ability order are those of `base` (the hero's meta build).
 */
export function customBuildAsArchetype(
  build: CustomBuild,
  base: HeroBuildArchetype,
  items: Record<string, DeadlockItem>,
  subtitle: string
): HeroBuildArchetype {
  const ordered = orderedItemIds(build);
  const tierOf = (id: string) => items[id]?.tier ?? 1;
  return {
    ...base,
    id: `custom_${build.buildId}`,
    name: build.name,
    subtitle,
    phases: {
      early: ordered.filter((id) => tierOf(id) === 1),
      mid: ordered.filter((id) => tierOf(id) === 2 || tierOf(id) === 3),
      late: ordered.filter((id) => tierOf(id) === 4),
      situational: situationalItemIds(build),
    },
  };
}

export interface CounterPick {
  itemId: string;
  enemyIds: string[]; // enemies it answers, lane opponents and fed enemies first
  group?: string; // group of the build holding it; none for an item from outside the build
  strong: boolean; // answers a lane opponent, a fed enemy or several enemies: worth a place in the queue
}

export interface CustomCounters {
  /** Unowned items of the build answering the current enemies, most useful first */
  own: CounterPick[];
  /** For the threats the build has no answer to: the best item from outside the build */
  outside: CounterPick[];
  /** Counters placed in the purchase queue: at most one Tier 1-2 and one Tier 3-4, the build's own first */
  queued: CounterPick[];
}

const isThreat = (a: Alert) => a.isInMyLane || a.isFed;
/** Only an enemy's best counters count as an answer: further down come generic items most builds hold */
export const ANSWER_DEPTH = 5;

/**
 * Counters with a custom build. An enemy is answered when an item of the build (owned or not) or an owned item
 * counters it; then nothing from outside the build is suggested against it. Items the counter engine adds
 * without an enemy (lane economy) are left to the build's author.
 */
export function getCustomCounters(
  build: CustomBuild,
  alerts: Alert[],
  priorityItems: PriorityItem[],
  owned: Set<string>,
  items: Record<string, DeadlockItem>
): CustomCounters {
  const inBuild = new Set(build.groups.flatMap((g) => g.itemIds));
  // The build's upgrades go through their components: those answer too
  const withComponents = new Set([...inBuild].flatMap((id) => [id, ...getComponentIds(id)]));
  const topAnswers = alerts.map((a) => ({ ...a, counterIds: a.counterIds.slice(0, ANSWER_DEPTH) }));
  const enemyOrder = [...topAnswers].sort((a, b) => Number(isThreat(b)) - Number(isThreat(a)));
  const answers = (itemId: string) => enemyOrder.filter((a) => a.counterIds.includes(itemId));
  const toPick = (itemId: string, enemies: Alert[], group?: string): CounterPick => ({
    itemId,
    enemyIds: enemies.map((a) => a.enemyId),
    group,
    strong: enemies.some(isThreat) || enemies.length >= 2,
  });
  const rankOf = (a: Alert, itemId: string) => a.counterIds.indexOf(itemId);
  const bestRank = (itemId: string, enemies: Alert[]) => Math.min(...enemies.map((a) => rankOf(a, itemId)));

  const own = [...inBuild]
    .filter((id) => !owned.has(id))
    .map((id) => ({ id, enemies: answers(id) }))
    .filter((c) => c.enemies.length > 0)
    .sort(
      (a, b) =>
        Number(b.enemies.some(isThreat)) - Number(a.enemies.some(isThreat)) ||
        b.enemies.length - a.enemies.length ||
        bestRank(a.id, a.enemies) - bestRank(b.id, b.enemies)
    )
    .map((c) => toPick(c.id, c.enemies, groupOf(build, c.id)?.name));

  const isAnswered = (a: Alert) => a.counterIds.some((id) => withComponents.has(id) || owned.has(id));
  const unanswered = enemyOrder.filter((a) => !isAnswered(a));
  // Best item for each unanswered enemy (the counter engine's list first, then the enemy's own ranking)
  const outsideIds: string[] = [];
  for (const enemy of unanswered) {
    const fromEngine = priorityItems.find((r) => !inBuild.has(r.item.id) && enemy.counterIds.includes(r.item.id));
    const id = fromEngine?.item.id ?? enemy.counterIds[0];
    if (id && !outsideIds.includes(id)) outsideIds.push(id);
  }
  const outside = outsideIds
    .map((id) => toPick(id, answers(id).filter((a) => unanswered.includes(a))))
    .sort((a, b) => Number(b.strong) - Number(a.strong));

  // Queue: situational items of the build first (ordered items are already in it), then strong outside counters
  // that the counter engine also ranks among its top items, one per tier band
  const ordered = new Set(orderedItemIds(build));
  const engineStrong = new Set(priorityItems.filter(isStrongCounter).map((r) => r.item.id));
  const candidates = [
    ...own.filter((p) => p.strong && !ordered.has(p.itemId)),
    ...outside.filter((p) => p.strong && engineStrong.has(p.itemId)),
  ];
  const tierOf = (p: CounterPick) => items[p.itemId]?.tier ?? 1;
  const queued = [candidates.find((p) => tierOf(p) <= 2), candidates.find((p) => tierOf(p) >= 3)];
  return { own, outside, queued: queued.filter((p): p is CounterPick => p !== undefined) };
}

/**
 * Purchase order of a custom build: its ordered groups in the author's order, each item labelled with its
 * group; the queued Tier 1-2 counter after the first two items, the Tier 3-4 one after the first two items of
 * Tier 2+ (where the meta order puts them). Situational items only enter as counters.
 */
export function buildCustomPurchaseOrder(
  build: CustomBuild,
  { queued, own }: CustomCounters,
  items: Record<string, DeadlockItem>,
  enemyName: (enemyId: string) => string,
  t: Translate
): QueueEntry[] {
  // The counter engine's reasons may name another enemy than the one left unanswered: the picks' own enemies
  const counterReason = (p: CounterPick) => {
    const names = p.enemyIds.slice(0, 2).map(enemyName).join(', ');
    return p.group ? t('reason.buildCounter', p.group, names) : t('reason.outsideCounter', names);
  };
  const entry = (id: string, counter?: CounterPick): QueueEntry | null => {
    const item = items[id];
    if (!item) return null;
    const group = groupOf(build, id)?.name;
    return { item, group, reason: counter ? counterReason(counter) : t('reason.group', group ?? '') };
  };

  const ordered = orderedItemIds(build)
    .map((id) => entry(id))
    .filter((e): e is QueueEntry => e !== null);
  const queue: QueueEntry[] = [];
  const low = queued.find((p) => (items[p.itemId]?.tier ?? 1) <= 2);
  const high = queued.find((p) => (items[p.itemId]?.tier ?? 1) >= 3);
  const push = (e: QueueEntry | null) => {
    if (e && !queue.some((q) => q.item.id === e.item.id)) queue.push(e);
  };
  let tier2Seen = 0;
  ordered.forEach((e, index) => {
    push(e);
    if (e.item.tier >= 2) tier2Seen++;
    if (index === 1 && low) push(entry(low.itemId, low));
    if (tier2Seen === 2 && high) push(entry(high.itemId, high));
  });
  // Short builds: the counters still have a place
  if (low) push(entry(low.itemId, low));
  if (high) push(entry(high.itemId, high));
  // Items of the order that also answer a real threat say so
  const labelled = [...queued, ...own.filter((p) => p.strong)];
  return queue.map((e) => {
    const counter = labelled.find((p) => p.itemId === e.item.id);
    return counter ? { ...e, reason: counterReason(counter) } : e;
  });
}
