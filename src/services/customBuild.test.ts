import { describe, expect, it } from 'vitest';
import {
  ITEMS_DB,
  TacticalRecommendation,
  getApiHeroId,
  getHeroIdByApiHeroId,
  getItemIdByApiId,
  getHeroesDb,
} from '../data/deadlockData';
import { makeTranslate } from '../i18n';
import {
  ANSWER_DEPTH,
  CustomBuild,
  CustomBuildGroup,
  buildCustomPurchaseOrder,
  customBuildAsArchetype,
  getCustomCounters,
  parseBuildId,
  parseCustomBuild,
} from './customBuild';
import { getNextPurchases } from './recommendations';

const t = makeTranslate('en');
type Alert = TacticalRecommendation['matchupAlerts'][number];
type PriorityItem = TacticalRecommendation['priorityItems'][number];

const group = (name: string, itemIds: string[], isSituational = false): CustomBuildGroup => ({ name, itemIds, isSituational });

const customBuild = (groups: CustomBuildGroup[]): CustomBuild => ({
  buildId: 42,
  version: 3,
  name: 'Test build',
  apiHeroId: 1,
  heroId: 'infernus',
  groups,
  unknownItemCount: 0,
  fetchedAt: 0,
});

const alert = (enemyId: string, counterIds: string[], { isInMyLane = false, isFed = false } = {}): Alert => ({
  enemyId,
  enemyName: enemyId,
  enemyColor: '#fff',
  isInMyLane,
  dangerLevel: 'Medium',
  advice: '',
  keyRule: '',
  isFed,
  counters: [],
  counterIds,
});

const priority = (id: string, reasons = [`[LANE] Counters X`]): PriorityItem => ({
  item: ITEMS_DB[id],
  reasons,
  urgency: 'Critique (En Face / Lane)',
});

/** One entry of /v1/builds as the API returns it (only the fields read). */
const rawBuild = (categories: { name: string; mods: number[]; optional?: boolean; description?: string }[]) => ({
  hero_build: {
    hero_id: 1,
    hero_build_id: 478992,
    name: '  Napalm carry ',
    version: 66,
    details: {
      mod_categories: categories.map((c) => ({
        name: c.name,
        description: c.description ?? null,
        optional: c.optional ?? null,
        mods: c.mods.map((ability_id) => ({ ability_id, annotation: null })),
      })),
    },
  },
});

const API = {
  extended_magazine: 1548066885,
  monster_rounds: 1009965641,
  healbane: 2603935618,
  titanic_magazine: 2356412290,
  spirit_resilience: 2163598980,
};

describe('parseBuildId', () => {
  it('reads the first number of what the player pasted', () => {
    expect(parseBuildId('478992')).toBe(478992);
    expect(parseBuildId(' #478992 ')).toBe(478992);
    expect(parseBuildId('Build 478992 v66')).toBe(478992);
  });

  it('refuses text without a usable number', () => {
    expect(parseBuildId('')).toBeNull();
    expect(parseBuildId('abc')).toBeNull();
    expect(parseBuildId('0')).toBeNull();
    expect(parseBuildId('99999999999')).toBeNull();
  });
});

describe('game ids of the generated data', () => {
  it('maps item and hero ids of the API to the local ones', () => {
    expect(getItemIdByApiId(API.extended_magazine)).toBe('extended_magazine');
    expect(getItemIdByApiId(123)).toBeUndefined();
    expect(getHeroIdByApiHeroId(1)).toBe('infernus');
    expect(getApiHeroId('infernus')).toBe(1);
    expect(getHeroIdByApiHeroId(99999)).toBeUndefined();
  });
});

describe('parseCustomBuild', () => {
  it('keeps the groups, their names and order, with local item ids', () => {
    const build = parseCustomBuild(
      rawBuild([
        { name: 'lane', mods: [API.extended_magazine, API.monster_rounds], description: 'Push the wave' },
        { name: 'core', mods: [API.titanic_magazine] },
        { name: 'situational', mods: [API.healbane, API.spirit_resilience] },
      ]),
      getItemIdByApiId,
      getHeroIdByApiHeroId,
      1000
    )!;
    expect(build).toMatchObject({ buildId: 478992, version: 66, name: 'Napalm carry', apiHeroId: 1, heroId: 'infernus' });
    expect(build.fetchedAt).toBe(1000);
    expect(build.groups).toEqual([
      { name: 'lane', description: 'Push the wave', itemIds: ['extended_magazine', 'monster_rounds'], isSituational: false },
      { name: 'core', description: undefined, itemIds: ['titanic_magazine'], isSituational: false },
      { name: 'situational', description: undefined, itemIds: ['healbane', 'spirit_resilience'], isSituational: true },
    ]);
  });

  it('counts unknown items, keeps each item in its first group and drops empty groups', () => {
    const build = parseCustomBuild(
      rawBuild([
        { name: 'lane', mods: [API.extended_magazine, 111, 222] },
        { name: 'text box', mods: [] },
        { name: 'again', mods: [API.extended_magazine, API.healbane] },
        { name: 'new patch', mods: [333] },
      ]),
      getItemIdByApiId,
      getHeroIdByApiHeroId
    )!;
    expect(build.unknownItemCount).toBe(3);
    expect(build.groups.map((g) => [g.name, g.itemIds])).toEqual([
      ['lane', ['extended_magazine']],
      ['again', ['healbane']],
    ]);
  });

  it('marks situational groups by name or by the optional flag', () => {
    const names = ['Optional lane items', 'Counter picks', 'If needed', 'vs heal', 'Late game', 'fed asf'];
    const build = parseCustomBuild(
      rawBuild([
        ...names.map((name, i) => ({ name, mods: [Object.values(API)[i % 5]] })),
        { name: 'flagged', mods: [API.monster_rounds], optional: true },
      ]),
      (apiId) => `item_${apiId}_${Math.random()}`, // every mod a distinct item
      getHeroIdByApiHeroId
    )!;
    expect(build.groups.map((g) => [g.name, g.isSituational])).toEqual([
      ['Optional lane items', true],
      ['Counter picks', true],
      ['If needed', true],
      ['vs heal', true],
      ['Late game', false],
      ['fed asf', false],
      ['flagged', true],
    ]);
  });

  it('follows a build made of situational groups only in order', () => {
    const build = parseCustomBuild(
      rawBuild([{ name: 'Situational 1', mods: [API.healbane] }]),
      getItemIdByApiId,
      getHeroIdByApiHeroId
    )!;
    expect(build.groups[0].isSituational).toBe(false);
  });

  it('keeps a build of an unknown hero (to say so) and refuses what is not a build', () => {
    const raw = rawBuild([{ name: 'lane', mods: [API.healbane] }]);
    raw.hero_build.hero_id = 4242;
    expect(parseCustomBuild(raw, getItemIdByApiId, getHeroIdByApiHeroId)!.heroId).toBeNull();
    expect(parseCustomBuild(undefined, getItemIdByApiId, getHeroIdByApiHeroId)).toBeNull();
    expect(parseCustomBuild({ hero_build: { name: 'x' } }, getItemIdByApiId, getHeroIdByApiHeroId)).toBeNull();
  });
});

describe('getCustomCounters', () => {
  const build = customBuild([
    group('lane', ['extended_magazine', 'monster_rounds', 'extra_regen']),
    group('core', ['slowing_bullets', 'tesla_bullets', 'quicksilver_reload', 'lucky_shot']),
    group('situational', ['healbane', 'spirit_resilience', 'debuff_remover'], true),
  ]);

  it("prefers the build's own items, and suggests nothing from outside for an answered enemy", () => {
    const counters = getCustomCounters(
      build,
      [alert('ivy', ['healbane', 'knockdown'], { isInMyLane: true })],
      [priority('knockdown')],
      new Set(),
      ITEMS_DB
    );
    expect(counters.own).toEqual([
      { itemId: 'healbane', enemyIds: ['ivy'], group: 'situational', strong: true },
    ]);
    expect(counters.outside).toEqual([]);
    expect(counters.queued.map((p) => p.itemId)).toEqual(['healbane']);
  });

  it('suggests an outside counter only for a threat the build has no answer to', () => {
    const counters = getCustomCounters(
      build,
      [alert('ivy', ['healbane'], { isInMyLane: true }), alert('paige', ['reactive_barrier', 'spirit_shielding'], { isInMyLane: true })],
      [priority('reactive_barrier', ["[LANE] Blocks Solomon's CC"])],
      new Set(),
      ITEMS_DB
    );
    expect(counters.outside.map((p) => [p.itemId, p.enemyIds])).toEqual([['reactive_barrier', ['paige']]]);
    // Both Tier 2: the build's own counter takes the only Tier 1-2 place of the queue
    expect(counters.queued.map((p) => p.itemId)).toEqual(['healbane']);
  });

  it('queues an outside counter in a tier band the build leaves free', () => {
    const counters = getCustomCounters(
      build,
      [alert('ivy', ['healbane'], { isInMyLane: true }), alert('mcginnis', ['metal_skin'], { isInMyLane: true })],
      [priority('metal_skin')],
      new Set(),
      ITEMS_DB
    );
    expect(counters.queued.map((p) => p.itemId)).toEqual(['healbane', 'metal_skin']);
  });

  it('lists but does not queue an outside counter against a single team enemy', () => {
    const counters = getCustomCounters(build, [alert('seven', ['metal_skin'])], [priority('metal_skin')], new Set(), ITEMS_DB);
    expect(counters.outside.map((p) => [p.itemId, p.strong])).toEqual([['metal_skin', false]]);
    expect(counters.queued).toEqual([]);
  });

  it('leaves out lane-economy items the counter engine adds without an enemy', () => {
    const counters = getCustomCounters(build, [], [priority('high_velocity_mag')], new Set(), ITEMS_DB);
    expect(counters).toEqual({ own: [], outside: [], queued: [] });
  });

  it('counts an owned item, or a component of a build upgrade, as an answer', () => {
    const owned = getCustomCounters(build, [alert('ivy', ['knockdown'], { isInMyLane: true })], [], new Set(['knockdown']), ITEMS_DB);
    expect(owned.outside).toEqual([]);
    const withUpgrade = customBuild([group('core', ['reactive_barrier'])]);
    const component = getCustomCounters(withUpgrade, [alert('paige', ['grit'], { isInMyLane: true })], [], new Set(), ITEMS_DB);
    expect(component.outside).toEqual([]);
  });

  it("only counts an enemy's best counters as answers", () => {
    const deep = [...Array(ANSWER_DEPTH)].map((_, i) => ['knockdown', 'metal_skin', 'unstoppable', 'toxic_bullets', 'reactive_barrier'][i]);
    const counters = getCustomCounters(build, [alert('ivy', [...deep, 'healbane'], { isInMyLane: true })], [], new Set(), ITEMS_DB);
    expect(counters.own).toEqual([]);
    expect(counters.outside.map((p) => p.itemId)).toEqual(['knockdown']);
  });

  it('skips owned build items and ranks lane threats, then items answering more enemies', () => {
    const counters = getCustomCounters(
      build,
      [
        alert('seven', ['spirit_resilience']),
        alert('yamato', ['spirit_resilience']),
        alert('ivy', ['debuff_remover', 'healbane'], { isFed: true }),
      ],
      [],
      new Set(['healbane']),
      ITEMS_DB
    );
    expect(counters.own.map((p) => [p.itemId, p.enemyIds])).toEqual([
      ['debuff_remover', ['ivy']],
      ['spirit_resilience', ['seven', 'yamato']],
    ]);
  });
});

describe('buildCustomPurchaseOrder', () => {
  const build = customBuild([
    group('lane', ['extended_magazine', 'monster_rounds', 'extra_regen']),
    group('core', ['slowing_bullets', 'tesla_bullets', 'quicksilver_reload', 'lucky_shot']),
    group('situational', ['healbane', 'spirit_resilience', 'debuff_remover'], true),
  ]);
  const enemyName = (id: string) => id.toUpperCase();

  it("follows the author's groups in order, labelled with their names, without the situational items", () => {
    const order = buildCustomPurchaseOrder(build, { own: [], outside: [], queued: [] }, ITEMS_DB, enemyName, t);
    expect(order.map((e) => e.item.id)).toEqual([
      'extended_magazine',
      'monster_rounds',
      'extra_regen',
      'slowing_bullets',
      'tesla_bullets',
      'quicksilver_reload',
      'lucky_shot',
    ]);
    expect(order[0]).toMatchObject({ group: 'lane', reason: 'Build: lane' });
    expect(order[3]).toMatchObject({ group: 'core', reason: 'Build: core' });
  });

  it('places the Tier 1-2 counter after the first group, the Tier 3-4 one after two Tier 2+ items', () => {
    const counters = getCustomCounters(
      build,
      [alert('ivy', ['healbane'], { isInMyLane: true }), alert('seven', ['spirit_resilience'], { isFed: true })],
      [],
      new Set(),
      ITEMS_DB
    );
    const order = buildCustomPurchaseOrder(build, counters, ITEMS_DB, enemyName, t);
    expect(order.map((e) => e.item.id)).toEqual([
      'extended_magazine',
      'monster_rounds',
      'extra_regen',
      'healbane',
      'slowing_bullets',
      'tesla_bullets',
      'spirit_resilience',
      'quicksilver_reload',
      'lucky_shot',
    ]);
    expect(order[3]).toMatchObject({ group: 'situational', reason: "Build's situational, vs IVY" });
  });

  it('places a counter by when players usually buy it, never among the first group', () => {
    const counters = getCustomCounters(
      build,
      [alert('ivy', ['healbane'], { isInMyLane: true }), alert('seven', ['spirit_resilience'], { isFed: true })],
      [],
      new Set(),
      ITEMS_DB
    );
    const times: Record<string, number> = {
      extended_magazine: 150,
      healbane: 200, // usually early, still after the lane group
      slowing_bullets: 500,
      tesla_bullets: 700,
      quicksilver_reload: 900,
      spirit_resilience: 1400, // usually late: after everything bought before it
      lucky_shot: 1200,
    };
    const order = buildCustomPurchaseOrder(build, counters, ITEMS_DB, enemyName, t, (id) => times[id]);
    expect(order.map((e) => e.item.id)).toEqual([
      'extended_magazine',
      'monster_rounds',
      'extra_regen',
      'healbane',
      'slowing_bullets',
      'tesla_bullets',
      'quicksilver_reload',
      'lucky_shot',
      'spirit_resilience',
    ]);
  });

  it('labels an outside counter and an ordered item that answers a threat', () => {
    const counters = getCustomCounters(
      build,
      [alert('mcginnis', ['metal_skin'], { isInMyLane: true }), alert('ivy', ['tesla_bullets'], { isInMyLane: true })],
      [priority('metal_skin')],
      new Set(),
      ITEMS_DB
    );
    const order = buildCustomPurchaseOrder(build, counters, ITEMS_DB, enemyName, t);
    expect(order.find((e) => e.item.id === 'metal_skin')).toMatchObject({
      group: undefined,
      reason: 'Outside the build: nothing in it vs MCGINNIS',
    });
    expect(order.find((e) => e.item.id === 'tesla_bullets')!.reason).toBe("Build's core, vs IVY");
  });

  it('keeps its order in the next purchases (no buy-time sorting given)', () => {
    const order = buildCustomPurchaseOrder(build, { own: [], outside: [], queued: [] }, ITEMS_DB, enemyName, t);
    const next = getNextPurchases(order, ['extended_magazine'], null, []);
    expect(next.map((e) => e.item.id)).toEqual(order.slice(1).map((e) => e.item.id));
  });
});

describe('customBuildAsArchetype', () => {
  it('spreads the ordered items over the phases by tier, with the meta build texts', () => {
    const base = getHeroesDb('en').find((h) => h.id === 'infernus')!.builds[0];
    const build = customBuild([
      group('lane', ['extended_magazine', 'healbane']),
      group('late', ['lucky_shot', 'tesla_bullets']),
      group('situational', ['debuff_remover'], true),
    ]);
    const archetype = customBuildAsArchetype(build, base, ITEMS_DB, 'subtitle');
    expect(archetype).toMatchObject({ id: 'custom_42', name: 'Test build', subtitle: 'subtitle' });
    expect(archetype.phases).toEqual({
      early: ['extended_magazine'],
      mid: ['healbane', 'tesla_bullets'],
      late: ['lucky_shot'],
      situational: ['debuff_remover'],
    });
    expect(archetype.abilitiesOrder).toEqual(base.abilitiesOrder);
    expect(archetype.laneTips).toEqual(base.laneTips);
  });
});
