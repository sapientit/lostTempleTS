/**
 * Wire enums, ported from comms/enum.kt. Enums serialize as the lower-case
 * Kotlin names, so they are TS string-literal unions with exactly those
 * spellings. Declaration order matters where the Kotlin code iterates
 * `values()` (Role, in role-cost assembly) — the ALL_* arrays preserve it.
 */

export const ALL_API_STATUSES = ["ok", "duplicate", "conflict", "error", "cancelled"] as const;
export type ApiStatus = (typeof ALL_API_STATUSES)[number];

/** Kotlin declaration order: e, w, ne, nw, se, sw. */
export const ALL_DIRECTIONS = ["e", "w", "ne", "nw", "se", "sw"] as const;
export type Direction = (typeof ALL_DIRECTIONS)[number];

/** Direction.west: w, nw, sw are the "west" directions. */
const WEST: Record<Direction, boolean> = {
  e: false,
  w: true,
  ne: false,
  nw: true,
  se: false,
  sw: true,
};

export function isWest(dir: Direction): boolean {
  return WEST[dir];
}

/** One step of the turn cycle e -> se -> sw -> w -> nw -> ne -> e (60° clockwise). */
const TURN_ONE: Record<Direction, Direction> = {
  e: "se",
  w: "nw",
  ne: "e",
  nw: "ne",
  se: "sw",
  sw: "w",
};

/** Direction.turn(number): number steps of the 60°-clockwise cycle. */
export function turn(dir: Direction, number: number): Direction {
  let d = dir;
  for (let i = 0; i < number; i++) d = TURN_ONE[d];
  return d;
}

/** Direction.countToWest(): steps of turn(1) to reach w. w=0, sw=1, se=2, e=3, ne=4, nw=5. */
export function countToWest(dir: Direction): number {
  let count = 0;
  let d = dir;
  while (d !== "w") {
    d = TURN_ONE[d];
    count++;
  }
  return count;
}

/** Opposite direction (Island.addEdges reverse table). */
export const REVERSE: Record<Direction, Direction> = {
  e: "w",
  w: "e",
  ne: "sw",
  sw: "ne",
  nw: "se",
  se: "nw",
};

export const ALL_DEATHS = [
  "drowning",
  "sacrificed",
  "eaten",
  "trap",
  "falling",
  "spiders",
  "eagles",
  "curse",
  "success",
] as const;
export type Death = (typeof ALL_DEATHS)[number];

/** Kotlin declaration order: arch, warrior, balloonist, magician, researcher, scout. */
export const ALL_ROLES = ["arch", "warrior", "balloonist", "magician", "researcher", "scout"] as const;
export type Role = (typeof ALL_ROLES)[number];

export const ALL_TERRAINS = ["forest", "hills", "sea", "coast", "temple"] as const;
export type Terrain = (typeof ALL_TERRAINS)[number];

export const ALL_MAP_ITEMS = [
  "guardians",
  "trap",
  "mountain",
  "tunnel",
  "jungle",
  "piranhas",
  "temple",
] as const;
export type MapItem = (typeof ALL_MAP_ITEMS)[number];
