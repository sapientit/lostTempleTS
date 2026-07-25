/**
 * Wire DTO types, ported from comms/GameInterface.kt and comms/ApiReponse.kt.
 * Field names are the JSON contract — do not rename.
 *
 * kotlinx.serialization omits fields that are at their declared default
 * (encodeDefaults = false); fields without a default are always emitted, even
 * when null. Nullable-with-default fields are typed `?:` here (emit by
 * omission), nullable-without-default fields are typed `| null` (emit null).
 */

import type { ApiStatus, Death, Direction, MapItem, Role, Terrain } from "./enums.js";

export interface CommJourney {
  num: number;
  mapNum: number;
  role: Role;
  position: number;
  death?: Death; // default null -> omitted when absent
  direction?: Direction;
  allDeaths?: Death[]; // Kotlin Set<Death>; serialized as a JSON array
  searchArea?: number[];
  percent?: number; // default 0 -> omitted when 0
}

export interface CommExecute {
  score: number;
  prevScore: number;
  num: number;
  mapNum: number;
  role: Role;
  startPos: number;
  startDir?: Direction; // defaults to "w" when absent
  moves?: number[]; // defaults to []
  turns?: number[]; // defaults to []
}

/** One step of a replayed journey: either a single hex-move or a turn-in-place. */
export interface CommTraceStep {
  kind: "move" | "turn";
  position: number;
  direction: Direction;
  death?: Death; // only ever set on the last entry, if the journey ended in death
}

/** POST /client/explain response: the usual CommJourney plus the full step trace. */
export interface CommExplain extends CommJourney {
  trace: CommTraceStep[];
}

export interface CommIsland {
  mapNum: number;
  rows: number;
  hexes: CommHex[];
  obstacles: CommLand[];
  rivers: CommRiver[];
  cliffs: CommCliff[];
  difficulty: number;
  roles: CommRole[];
  route?: CommRoute; // default null -> omitted when absent
}

export interface CommRoute {
  startPos: number;
  startDir: Direction;
  distance: number[];
  turn: number[];
}

export interface CommBeach {
  index: number;
  directions: Direction[];
}

export interface CommHex {
  index: number;
  x: number;
  y: number;
  terrain: Terrain | null; // no default -> always emitted
  directions: Direction[] | null; // no default -> always emitted; non-null only for sea/coast
}

export interface CommLand {
  index: number;
  type: MapItem | null; // no default -> always emitted
  jungleDir?: number; // default null -> omitted when absent
}

export interface CommRiver {
  startLand: number;
  startEntry: number;
  lands: number[];
  exit: number[];
}

export interface CommCliff {
  land: number;
  direction: Direction;
}

export interface CommRole {
  role: Role;
  cost: number;
}

/** Envelope type (comms/ApiReponse.kt). All optional fields default null. */
export interface ApiResponse {
  status: ApiStatus;
  error?: string;
  number?: number;
  numbers?: number[];
  string?: string;
  bool?: boolean;
  island?: CommIsland;
  journey?: CommJourney;
}
