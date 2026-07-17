/**
 * Pregeneration logic (pure of I/O): pool mapping rows, daily islands, and
 * tutorial imports, exactly mirroring the Kotlin reference behaviour:
 *
 * - pool/legacy rows: IslandStore.genPlayable (core `genPlayable`) — model
 *   and layout from the REQUESTED number, seeds n, n+20000, ... until
 *   difficulty in 1..maxDifficulty; row = (num, seed, difficulty, route).
 * - dailies: DailyIslands.generateFor — per-level seed counter starting at
 *   FIRST_SEED (1,000,000), retry seed+1 until difficulty in 1..100 (hard
 *   cap 5000 attempts), layout from the map number, full CommIsland JSON
 *   with mapNum patched to base+day.
 * - tutorials: resource JSON imported verbatim, mapNum patched to the
 *   filename number (the filename is authoritative).
 */

import {
  Island,
  Journey,
  forLevel,
  genPlayable,
  modelFor,
} from "@losttemple/core";
import type { CommExecute, CommIsland, CommRoute, Death } from "@losttemple/core";

export const START_DATE_MS = Date.UTC(2026, 0, 1);
export const FIRST_SEED = 1_000_000;
export const LEVELS = [1, 2, 3, 4, 5, 6] as const;
export const DAY_MS = 86_400_000;

/** Tutorial resources shipped with the Kotlin server (S§11). */
export const TUTORIAL_NUMS = [
  10000, 10001, 10002, 10003, 10004, 10005, 10011, 10012, 10013, 10014, 10021,
  10022, 10023, 10024, 10031, 10032, 10033, 10034,
] as const;

/** Strict YYYY-MM-DD -> day number since 2026-01-01, or null if invalid. */
export function dayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return Math.round((ms - START_DATE_MS) / DAY_MS);
}

export function isoDate(day: number): string {
  return new Date(START_DATE_MS + day * DAY_MS).toISOString().slice(0, 10);
}

export interface MappingRow {
  num: number;
  kind: "level" | "legacy";
  seed: number;
  difficulty: number;
  route: CommRoute | null;
}

export interface CommRow {
  num: number;
  kind: "daily" | "tutorial";
  difficulty: number;
  comm: CommIsland;
}

export type Row = MappingRow | CommRow;

export function isCommRow(row: Row): row is CommRow {
  return row.kind === "daily" || row.kind === "tutorial";
}

/** One pool/legacy/ad-hoc mapping row via the genPlayable reroll (S§4.8). */
export function genMapping(num: number): MappingRow {
  const { island, seed } = genPlayable(num);
  return {
    num,
    kind: num >= 100_000 ? "level" : "legacy",
    seed,
    difficulty: island.difficulty,
    route: island.route,
  };
}

export type Counters = Record<number, number>;

export function freshCounters(): Counters {
  const c: Counters = {};
  for (const level of LEVELS) c[level] = FIRST_SEED;
  return c;
}

export interface DailiesResult {
  rows: CommRow[];
  counters: Counters;
}

/**
 * Dailies for days fromDay..toDay inclusive (days since 2026-01-01), from
 * the given per-level seed counters. Days ascending, levels 1..6 within a
 * day — the same order as Kotlin's catchUp, so counter sequences match.
 */
export function genDailies(fromDay: number, toDay: number, counters: Counters): DailiesResult {
  const rows: CommRow[] = [];
  const next: Counters = { ...counters };
  for (let day = fromDay; day <= toDay; day++) {
    for (const level of LEVELS) {
      const num = level * 1_000_000 + day;
      // The daily's map number picks the layout variant, so the layout
      // cycles day by day and regenerates identically.
      const model = forLevel(level)!.forNumber(num);
      let seed = next[level] ?? FIRST_SEED;
      let island = Island.gen(seed, model);
      let attempts = 0;
      while (!(island.difficulty >= 1 && island.difficulty <= 100)) {
        attempts++;
        if (attempts >= 5000) {
          throw new Error(`no island with difficulty 1..100 in 5000 seeds from ${next[level]}`);
        }
        seed++;
        island = Island.gen(seed, model);
      }
      rows.push({
        num,
        kind: "daily",
        difficulty: island.difficulty,
        comm: { ...island.commIsland, mapNum: num },
      });
      next[level] = seed + 1;
    }
  }
  return { rows, counters: next };
}

/** Tutorial resource JSON -> row; the filename number is authoritative. */
export function importTutorial(num: number, text: string): CommRow {
  const parsed = JSON.parse(text) as CommIsland;
  const comm: CommIsland = { ...parsed, mapNum: num };
  return { num, kind: "tutorial", difficulty: comm.difficulty, comm };
}

/** Replay a stored route (always role arch) and return the final death. */
export function replayRoute(island: Island, route: CommRoute, mapNum: number): Death | null {
  const exec: CommExecute = {
    score: 0,
    prevScore: 1000,
    num: 0,
    mapNum,
    role: "arch",
    startPos: route.startPos,
    startDir: route.startDir,
    moves: route.distance,
    turns: route.turn,
  };
  const journey = Journey.create(exec, island);
  return journey.finalState.death;
}

/**
 * Verify one row: regenerate from its seed (mapping rows) or rebuild from
 * its comm (daily/tutorial rows), check the stored difficulty (mapping and
 * daily rows only — tutorial files carry historical difficulties served
 * verbatim), and replay the stored route to success. Null = OK.
 */
export function verifyRow(row: Row): string | null {
  if (isCommRow(row)) {
    const island = Island.generateFromComm(row.comm);
    if (row.comm.mapNum !== row.num) return `comm mapNum ${row.comm.mapNum} != num ${row.num}`;
    if (row.comm.difficulty !== row.difficulty) {
      return `stored difficulty ${row.difficulty} != comm difficulty ${row.comm.difficulty}`;
    }
    if (row.comm.route) {
      const death = replayRoute(island, row.comm.route, row.num);
      if (death !== "success") return `stored route replays to ${death}`;
    } else if (row.kind === "daily") {
      return "daily without a route";
    }
    return null;
  }
  const model = modelFor(row.num).forNumber(row.num);
  const island = Island.gen(row.seed, model);
  if (island.difficulty !== row.difficulty) {
    return `regen difficulty ${island.difficulty} != stored ${row.difficulty}`;
  }
  if (row.route === null) return "mapping row without a route";
  const death = replayRoute(island, row.route, row.num);
  if (death !== "success") return `stored route replays to ${death}`;
  return null;
}
