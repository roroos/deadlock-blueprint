# Item investment (normal mode)

Owned items in one shop category (weapon, vitality, spirit) give a bonus at fixed soul thresholds: 800, 1,600,
2,400, 3,200, 4,800, 6,400 and up. The jump at **4,800** is the largest one in every category, so the buy tab
tracks it.

## What the app shows

- **Investment line** above the buy cards (and in the overlay): souls in the build's main category, the next
  milestone, and the minute high-rank players usually reach it. It turns amber when the match clock is past
  that minute.
- **"Reaches the 4,800 spike"** on any shown item that takes the main category from below 4,800 to 4,800 or more.
- **Gentle nudge**: when #2 or #3 reaches 4,800, the #1 does not, and players usually buy the two within
  2 minutes of each other, the spike item becomes #1. Nothing else is reordered, and a locked #1 stays locked.

The main category is the one with the most souls among the build's early and mid items. An upgrade counts at its
full price and its consumed component does not count again (`src/services/investments.ts`).

## Where the timings come from

deadlock-api.com `/v1/sql`, table `match_player_latest`, normal games, 40,000 players per group over 1.5 days.
The table below gives the median minute players reach each main-category threshold, with the share of players
who reach it.

| Main category | Rank 81+ | Rank 1-40 |
|---|---|---|
| 1,600 | 5.6 min (99%) | 6.1 min (97%) |
| 3,200 | 10.3 min (98%) | 11.2 min (95%) |
| 4,800 | 12.3 min (96%) | 14.1 min (93%) |
| 6,400 | 17.8 min (86%) | 18.6 min (87%) |
| 8,000 | 19.9 min (79%) | 21.1 min (81%) |
| 11,200 | 23.1 min (66%) | 24.4 min (70%) |

High-rank players also put more of their early souls in the main category (50% at 8 minutes against 40%).
At the same total spend and time, being at 4,800 in the main category goes with about +0.5 to +0.8 points of win
rate. That gain is small next to the noise (about ±0.6), which is why the app nudges rather than reorders the
build.
