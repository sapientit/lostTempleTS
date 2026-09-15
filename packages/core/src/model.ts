/**
 * IslandModel + layout pools, transcribed mechanically from
 * game/IslandModel.kt. These are pure data tables — every number here is
 * part of the island determinism contract.
 */

import type { CommRiver } from "./comm.js";
import type { MapItem, Role } from "./enums.js";

/** ((n % m) + m) % m — Kotlin Math.floorMod (JS % is wrong for negatives). */
export function floorMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** One beach/temple/river arrangement for a base island shape. Coordinates
 *  are (row, col) in the generated map grid; river hexes are map indexes. */
export interface IslandLayout {
  beachesX: number[];
  beachesY: number[];
  templeX: number;
  templeY: number;
  river: CommRiver[];
}

export interface IslandModel {
  size: number[];
  blanks: number[];
  beachesX: number[];
  beachesY: number[];
  templeX: number;
  templeY: number;
  river: CommRiver[];
  cliffs: number;
  obstacles: number;
  // null = all six obstacle types may be generated (existing behaviour)
  allowedObstacles: MapItem[] | null;
  // null = randomised specialist costs (existing behaviour); otherwise the
  // exact cost per role, with absent roles unavailable (-1)
  fixedRoles: ReadonlyMap<Role, number> | null;
  // Islands generated above this difficulty are rejected and re-rolled.
  maxDifficulty: number;
  // Beach/temple/river variants. Empty = always the fixed layout above.
  layouts: IslandLayout[];
}

/** The model to actually generate island [num] from: the island number
 *  picks a layout variant (mod the pool size), so a given number always
 *  regenerates the same island. No variants = the model itself. */
export function forNumber(model: IslandModel, num: number): IslandModel {
  if (model.layouts.length === 0) return model;
  const l = model.layouts[floorMod(num, model.layouts.length)]!;
  return { ...model, layouts: [], ...l };
}

export const hard: IslandModel = {
  size: [4, 5, 5, 4],
  blanks: [0, 0, 0, 1],
  beachesX: [0, 2],
  beachesY: [4, 1],
  templeX: 4,
  templeY: 5,
  river: [{ startLand: 9, startEntry: 2, lands: [15, 22, 29], exit: [5, 5, 4, -1] }],
  cliffs: 3,
  obstacles: 7,
  allowedObstacles: null,
  fixedRoles: null,
  maxDifficulty: Number.MAX_SAFE_INTEGER,
  layouts: [],
};

export const medium: IslandModel = {
  size: [4, 4, 4, 4],
  blanks: [0, 0, 0, 1],
  beachesX: [0, 3],
  beachesY: [4, 1],
  templeX: 4,
  templeY: 5,
  river: [{ startLand: 9, startEntry: 2, lands: [15, 21, 26], exit: [5, 5, 5, -1] }],
  cliffs: 3,
  obstacles: 6,
  allowedObstacles: null,
  fixedRoles: null,
  maxDifficulty: Number.MAX_SAFE_INTEGER,
  layouts: [],
};

// Tiny 3x3 island for tutorial/sample maps: 23 hexes, land at 6,7,8 /
// 11,12,13 / 16,17,18, beaches 2 (top) and 10 (west), temple 18, river down
// the middle column 7 -> 12 -> 17.
export const sample: IslandModel = {
  size: [3, 3, 3],
  blanks: [0, 0, 0],
  beachesX: [0, 2],
  beachesY: [3, 1],
  templeX: 3,
  templeY: 4,
  river: [{ startLand: 7, startEntry: 2, lands: [12, 17], exit: [5, 0, -1] }],
  cliffs: 2,
  obstacles: 3,
  allowedObstacles: null,
  fixedRoles: null,
  maxDifficulty: Number.MAX_SAFE_INTEGER,
  layouts: [],
};

export const simple: IslandModel = {
  size: [3, 4, 4, 3],
  blanks: [0, 0, 0, 1],
  beachesX: [0, 2],
  beachesY: [4, 1],
  templeX: 4,
  templeY: 3,
  river: [
    { startLand: 8, startEntry: 2, lands: [13, 18], exit: [5, 0, -1] },
    { startLand: 11, startEntry: 5, lands: [12], exit: [3, -1] },
  ],
  cliffs: 5,
  obstacles: 4,
  allowedObstacles: null,
  fixedRoles: null,
  maxDifficulty: Number.MAX_SAFE_INTEGER,
  layouts: [],
};

// ---- Layout variant pools, one per base shape ----
// Variant 0 is the classic fixed layout of that shape. Only LEVEL models use
// these pools; legacy islands 1-9000 keep their single fixed layout.

// Simple shape (3,4,4,3): lands idx 6-8 / 11-14 / 17-20 / 23-25.
const SIMPLE_LAYOUTS: IslandLayout[] = [
  { beachesX: [0, 2], beachesY: [4, 1], templeX: 4, templeY: 3, river: simple.river },
  // Temple top-centre, beaches south and east, river from the west.
  {
    beachesX: [5, 3],
    beachesY: [3, 6],
    templeX: 1,
    templeY: 3,
    river: [{ startLand: 17, startEntry: 0, lands: [18, 24, 25], exit: [3, 4, 3, -1] }],
  },
  // Temple east, beaches top-west and south-west, river from the north-west.
  {
    beachesX: [0, 5],
    beachesY: [2, 2],
    templeX: 3,
    templeY: 5,
    river: [{ startLand: 6, startEntry: 0, lands: [12, 18, 24], exit: [4, 4, 4, -1] }],
  },
  // Temple west, beaches east and south, river from the north-east.
  {
    beachesX: [2, 5],
    beachesY: [6, 4],
    templeX: 2,
    templeY: 2,
    river: [{ startLand: 14, startEntry: 2, lands: [13, 18, 23], exit: [0, 5, 5, -1] }],
  },
];

// Medium shape (4,4,4,4): lands idx 7-10 / 13-16 / 19-22 / 25-28.
const MEDIUM_LAYOUTS: IslandLayout[] = [
  { beachesX: [0, 3], beachesY: [4, 1], templeX: 4, templeY: 5, river: medium.river },
  // Temple top, beaches south and east, river up from the south-west.
  {
    beachesX: [5, 3],
    beachesY: [3, 6],
    templeX: 1,
    templeY: 4,
    river: [{ startLand: 25, startEntry: 5, lands: [20, 15, 16], exit: [2, 2, 3, -1] }],
  },
  // Temple west, beaches top-east and south, river from the east.
  {
    beachesX: [0, 5],
    beachesY: [6, 5],
    templeX: 3,
    templeY: 2,
    river: [{ startLand: 16, startEntry: 3, lands: [15, 20, 25], exit: [0, 5, 5, -1] }],
  },
  // Temple south-west, beaches top and east, two rivers.
  {
    beachesX: [0, 2],
    beachesY: [3, 6],
    templeX: 4,
    templeY: 3,
    river: [
      { startLand: 8, startEntry: 2, lands: [15, 21], exit: [4, 4, -1] },
      { startLand: 13, startEntry: 0, lands: [19], exit: [4, -1] },
    ],
  },
];

// Hard shape (4,5,5,4): lands idx 7-10 / 13-17 / 20-24 / 27-30.
const HARD_LAYOUTS: IslandLayout[] = [
  { beachesX: [0, 2], beachesY: [4, 1], templeX: 4, templeY: 5, river: hard.river },
  // Temple top-west, beaches south and east, river up from the south.
  {
    beachesX: [5, 3],
    beachesY: [4, 7],
    templeX: 1,
    templeY: 3,
    river: [{ startLand: 28, startEntry: 5, lands: [21, 15, 16], exit: [1, 2, 3, -1] }],
  },
  // Temple east, beaches west and south-west, two rivers.
  {
    beachesX: [2, 5],
    beachesY: [1, 2],
    templeX: 3,
    templeY: 6,
    river: [
      { startLand: 10, startEntry: 2, lands: [16, 22], exit: [5, 5, -1] },
      { startLand: 20, startEntry: 0, lands: [27], exit: [4, -1] },
    ],
  },
  // Temple centre-north, beaches south-east and south-west, river from the east.
  {
    beachesX: [4, 5],
    beachesY: [7, 2],
    templeX: 2,
    templeY: 3,
    river: [{ startLand: 24, startEntry: 3, lands: [23, 22, 21], exit: [0, 0, 0, -1] }],
  },
];

// ---- Adventurer levels (random maps: island number = level*100000 + n) ----
// Curriculum: 1 cliffs / 2 +traps,piranhas / 3 +guardians,balloonist /
// 4 +tunnel,jungle,scout / 5 full game, randomised costs / 6 insane.
const ARCH_ONLY: ReadonlyMap<Role, number> = new Map([["arch", 100]]);

export const level1: IslandModel = {
  ...simple,
  river: [], // pure cliff maze
  cliffs: 12,
  obstacles: 0,
  allowedObstacles: [],
  fixedRoles: ARCH_ONLY,
  maxDifficulty: 100, // no straight/one-turn walk to the temple
  layouts: SIMPLE_LAYOUTS.map((l) => ({ ...l, river: [] })),
};

export const level2: IslandModel = {
  ...simple,
  river: simple.river, // piranhas need rivers
  cliffs: 3,
  obstacles: 4,
  allowedObstacles: ["trap", "piranhas"],
  fixedRoles: ARCH_ONLY,
  maxDifficulty: Number.MAX_SAFE_INTEGER,
  layouts: SIMPLE_LAYOUTS,
};

export const level3: IslandModel = {
  ...medium,
  cliffs: 3,
  obstacles: 5,
  allowedObstacles: ["trap", "piranhas", "guardians"],
  // Gold is not introduced until level 5: every available adventurer costs
  // a flat 100, giving exactly 10 attempts.
  fixedRoles: new Map<Role, number>([
    ["arch", 100],
    ["balloonist", 100],
  ]),
  maxDifficulty: Number.MAX_SAFE_INTEGER,
  layouts: MEDIUM_LAYOUTS,
};

export const level4: IslandModel = {
  ...medium,
  cliffs: 3,
  obstacles: 6,
  allowedObstacles: ["trap", "piranhas", "guardians", "tunnel", "jungle"],
  fixedRoles: new Map<Role, number>([
    ["arch", 100],
    ["balloonist", 100],
    ["scout", 100],
  ]),
  maxDifficulty: Number.MAX_SAFE_INTEGER,
  layouts: MEDIUM_LAYOUTS,
};

// Level 5 is the full game: all obstacles (adds mountain), all roles,
// randomised costs - the hard model plus layout variety. Kept as a separate
// instance so legacy hard islands (6001-9000) never vary.
export const level5: IslandModel = {
  ...hard,
  allowedObstacles: null,
  fixedRoles: null,
  maxDifficulty: Number.MAX_SAFE_INTEGER,
  layouts: HARD_LAYOUTS,
};

// Insane: hard layout drowning in obstacles and cliffs.
export const level6: IslandModel = {
  ...hard,
  cliffs: 5,
  obstacles: 9,
  allowedObstacles: null,
  fixedRoles: null,
  maxDifficulty: Number.MAX_SAFE_INTEGER,
  layouts: HARD_LAYOUTS,
};

// ---- Daily-only shape variants for levels 5 & 6 --------------------------
// A daily is generated fresh every single day, so the 4-entry HARD_LAYOUTS
// pool above - shared with the 500000-699999/600000-699999 pool number
// space and gated by GATE 6 against the frozen Kotlin dump - cycles far too
// fast to feel varied (pregen/src/gen.ts's level-salted forNumber() call
// still collapses to a 4-day repeat within a level). This wider pool is for
// the dailies path ONLY: pool/legacy islands never look at it, so adding to
// it cannot change any Kotlin-parity comparison for an already-generated
// number. Same beach/temple/river authoring pattern as HARD_LAYOUTS - land
// indices verified by construction (walked from real Island.gen adjacency,
// see the shape's layout comment) - plus four new base grid shapes, each
// with the same 18-land total as `hard` so obstacle/cliff counts still fit.
export interface DailyShapeVariant extends IslandLayout {
  size: number[];
  blanks: number[];
}

const HARD_SHAPE_VARIANTS: DailyShapeVariant[] = HARD_LAYOUTS.map((l) => ({
  ...l,
  size: hard.size,
  blanks: hard.blanks,
}));

// Shape (5,5,4,4): lands idx 8-12 / 15-19 / 23-26 / 29-32.
const SHAPE_5544: { size: number[]; blanks: number[] } = { size: [5, 5, 4, 4], blanks: [0, 0, 1, 1] };
const SHAPE_5544_VARIANTS: DailyShapeVariant[] = [
  {
    ...SHAPE_5544,
    beachesX: [0, 4],
    beachesY: [2, 7],
    templeX: 4,
    templeY: 4,
    river: [{ startLand: 8, startEntry: 1, lands: [16, 23, 30], exit: [4, 4, 4, -1] }],
  },
  {
    ...SHAPE_5544,
    beachesX: [0, 4],
    beachesY: [7, 2],
    templeX: 4,
    templeY: 5,
    river: [{ startLand: 12, startEntry: 2, lands: [19, 25, 31], exit: [5, 5, 5, -1] }],
  },
  {
    ...SHAPE_5544,
    beachesX: [1, 3],
    beachesY: [1, 7],
    templeX: 2,
    templeY: 5,
    river: [{ startLand: 15, startEntry: 0, lands: [16, 17, 18], exit: [3, 3, 3, -1] }],
  },
  {
    ...SHAPE_5544,
    beachesX: [0, 5],
    beachesY: [4, 5],
    templeX: 3,
    templeY: 4,
    river: [{ startLand: 9, startEntry: 2, lands: [17, 24], exit: [4, 4, -1] }],
  },
];

// Shape (4,6,4,4): lands idx 8-11 / 14-19 / 23-26 / 29-32.
const SHAPE_4644: { size: number[]; blanks: number[] } = { size: [4, 6, 4, 4], blanks: [1, 0, 1, 1] };
const SHAPE_4644_VARIANTS: DailyShapeVariant[] = [
  {
    ...SHAPE_4644,
    beachesX: [0, 3],
    beachesY: [3, 7],
    templeX: 4,
    templeY: 5,
    river: [{ startLand: 8, startEntry: 1, lands: [16, 24, 31], exit: [4, 4, 4, -1] }],
  },
  {
    ...SHAPE_4644,
    beachesX: [0, 4],
    beachesY: [7, 2],
    templeX: 3,
    templeY: 5,
    river: [{ startLand: 11, startEntry: 2, lands: [18, 25], exit: [5, 5, -1] }],
  },
  {
    ...SHAPE_4644,
    beachesX: [2, 2],
    beachesY: [1, 8],
    templeX: 2,
    templeY: 5,
    river: [{ startLand: 14, startEntry: 0, lands: [15, 16, 17], exit: [3, 3, 3, -1] }],
  },
  {
    ...SHAPE_4644,
    beachesX: [0, 5],
    beachesY: [4, 6],
    templeX: 4,
    templeY: 6,
    river: [{ startLand: 9, startEntry: 1, lands: [17, 25, 32], exit: [4, 4, 4, -1] }],
  },
];

// Shape (4,4,5,5): lands idx 7-10 / 13-16 / 19-23 / 26-30.
const SHAPE_4455: { size: number[]; blanks: number[] } = { size: [4, 4, 5, 5], blanks: [1, 1, 0, 0] };
const SHAPE_4455_VARIANTS: DailyShapeVariant[] = [
  {
    ...SHAPE_4455,
    beachesX: [0, 4],
    beachesY: [3, 7],
    templeX: 4,
    templeY: 4,
    river: [{ startLand: 7, startEntry: 1, lands: [14, 21, 28], exit: [4, 4, 4, -1] }],
  },
  {
    ...SHAPE_4455,
    beachesX: [0, 4],
    beachesY: [6, 1],
    templeX: 4,
    templeY: 5,
    river: [{ startLand: 10, startEntry: 2, lands: [16, 22, 29], exit: [5, 5, 5, -1] }],
  },
  {
    ...SHAPE_4455,
    beachesX: [2, 2],
    beachesY: [2, 7],
    templeX: 2,
    templeY: 6,
    river: [{ startLand: 13, startEntry: 0, lands: [14, 15, 16], exit: [3, 3, 3, -1] }],
  },
  {
    ...SHAPE_4455,
    beachesX: [0, 5],
    beachesY: [4, 6],
    templeX: 4,
    templeY: 6,
    river: [{ startLand: 8, startEntry: 1, lands: [15, 22, 30], exit: [4, 4, 4, -1] }],
  },
];

// Shape (3,4,6,5): lands idx 6-8 / 11-14 / 18-23 / 26-30.
const SHAPE_3465: { size: number[]; blanks: number[] } = { size: [3, 4, 6, 5], blanks: [1, 1, 0, 0] };
const SHAPE_3465_VARIANTS: DailyShapeVariant[] = [
  {
    ...SHAPE_3465,
    beachesX: [0, 4],
    beachesY: [3, 8],
    templeX: 4,
    templeY: 5,
    river: [{ startLand: 6, startEntry: 1, lands: [12, 20, 29], exit: [4, 4, 4, -1] }],
  },
  {
    ...SHAPE_3465,
    beachesX: [0, 4],
    beachesY: [6, 1],
    templeX: 4,
    templeY: 4,
    river: [{ startLand: 8, startEntry: 2, lands: [13, 20, 28], exit: [5, 5, 5, -1] }],
  },
  {
    ...SHAPE_3465,
    beachesX: [2, 2],
    beachesY: [2, 8],
    templeX: 3,
    templeY: 6,
    river: [{ startLand: 18, startEntry: 0, lands: [19, 20, 21, 22], exit: [3, 3, 3, 3, -1] }],
  },
  {
    ...SHAPE_3465,
    beachesX: [0, 5],
    beachesY: [4, 6],
    templeX: 4,
    templeY: 6,
    river: [{ startLand: 7, startEntry: 1, lands: [13, 21, 30], exit: [4, 4, 4, -1] }],
  },
];

/** 20 shape+layout variants for daily levels 5/6 only: the classic hard
 *  body's 4 arrangements plus 4 new 18-land bodies with 4 arrangements
 *  each. Never used by genPlayable/pool numbers. */
export const DAILY_HARD_VARIANTS: DailyShapeVariant[] = [
  ...HARD_SHAPE_VARIANTS,
  ...SHAPE_5544_VARIANTS,
  ...SHAPE_4644_VARIANTS,
  ...SHAPE_4455_VARIANTS,
  ...SHAPE_3465_VARIANTS,
];

/** Like forNumber(), but picks from DAILY_HARD_VARIANTS (shape included)
 *  instead of model.layouts - dailies-only, so widening the pool never
 *  touches pool-number/Kotlin-parity behaviour. */
export function forDailyVariant(model: IslandModel, num: number): IslandModel {
  const v = DAILY_HARD_VARIANTS[floorMod(num, DAILY_HARD_VARIANTS.length)]!;
  const { size, blanks, ...layout } = v;
  return { ...model, layouts: [], size, blanks, ...layout };
}

/** Model for a level number 1-6, or null if out of range. */
export function forLevel(level: number): IslandModel | null {
  switch (level) {
    case 1:
      return level1;
    case 2:
      return level2;
    case 3:
      return level3;
    case 4:
      return level4;
    case 5:
      return level5;
    case 6:
      return level6;
    default:
      return null;
  }
}
