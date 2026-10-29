# Item investment (normal mode)

Owned items in one shop category (weapon, vitality, spirit) give a bonus at fixed soul thresholds: 800, 1,600,
2,400, 3,200, 4,800, 6,400 and up. The jump at **4,800** is the largest one in every category. Good builds take
one category to 4,800, then the next, then the last, and the buy tab follows that.

## What the app shows

- **Spike line** above the buy cards: the three categories in the build's spike order, the souls in each
  (✓ at 4,800), and when players usually have that many spikes, as a range from rank 81+ to rank 1-40
  ("by 10–12 min"). It turns amber only once the match clock is past the slower median: comparing everyone to
  rank 81+ alone flagged half of the high-rank players themselves. The overlay shows the next spike only, with a
  short pace line.
- **"Reaches the 4,800 … spike"** on a shown item that takes the *next* spike's category to 4,800. A neutral chip
  with the tab colour on its icon: amber stays for "late", violet for imbue hints. With a full inventory, the item
  the card says to sell leaves first, so a sale in the same category never promises a spike it takes back.
- **Gentle nudge**: when #2 or #3 has that badge, the #1 does not, and players usually buy the two within
  2 minutes of each other, that item becomes #1. Nothing else is reordered, and a locked #1 stays locked.
- **Only the first two spikes are pushed.** Once two categories are at 4,800, the third gets no pace to keep, and
  the badge and nudge only point out a small top-up (an item adding 800 souls or less to it).
- **What counts**: the owned items, except those marked by hand ("Skip" or a click) that the scanner does not see
  in the inventory: skipping an item is not buying it. Without an inventory read, the hand-marked items count.

- **The player's own build wins.** A category not at 4,800 yet, with at least 2,400 souls and 1,600 more than the
  build's next category, becomes the target: the line lists it after the finished spikes, its items get the badge,
  and the queue is not reordered (it follows the build the player left). In a recorded Infernus game the build went
  spirit first, the player vitality then weapon, with spirit at 1,600 most of the game.

The spike order comes from the build: buying its early, mid and late items **in the order players usually buy them**
(`itemStats` buy times), the order the categories reach 4,800 (categories it never takes there come last, most souls
first). The phases are tiers, not times: walking them in order changed the first spike of 18 of 44 meta builds
(Vindicta: weapon instead of spirit, while players buy Rapid Recharge at ~11 min). An upgrade counts at its full price
and its consumed component does not count again (`src/services/investments.ts`).

## Where the numbers come from

**Published builds**: the 15 most-favourited builds of the week per hero, updated in the last 60 days
(654 builds, deadlock-api.com `/v1/builds`), bought in their order:

- the first category reaches 4,800 at a median 7,200 souls spent, with 70% of them in it;
- the second at 12,800, with only 1,600 in the third category by then;
- 67% take all three to 4,800. No fixed order: spirit first in 53%, weapon 33%, vitality 14%.

**Players**: deadlock-api.com `/v1/sql`, table `match_player_latest`, normal games, 40,000 players per group over
1.5 days. Median minute players have one, two and three categories at 4,800:

| Categories at 4,800 | Rank 81+ | Rank 1-40 |
|---|---|---|
| 1 | 10.2 min (75% of the souls in it) | 11.6 min (70%) |
| 2 | 15.3 min (third category: 800) | 17.4 min (third category: 1,600) |
| 3 | 19.9 min (55% get there) | 23.2 min (49%) |

At the same total spend and time, the first 4,800 goes with about +2.7 points of win rate at high rank, the
third with +0.7 to +3. The second is neutral at high rank and +1.5 to +2 at low rank. These are correlations, not
proof, which is why the app nudges rather than reorders the build.
