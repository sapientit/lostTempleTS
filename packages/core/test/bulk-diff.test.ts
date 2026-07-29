import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CommIsland, CommRoute } from "../src/comm.js";
import { Island } from "../src/island.js";
import { Journey } from "../src/journey.js";
import { forLevel, forNumber } from "../src/model.js";
import { genPlayable } from "../src/numbers.js";

/**
 * GATE 6 — bulk diff against a Kotlin dump (fixtures/kotlin-dumps/,
 * captured 2026-07-17 from the frozen reference at
 * ~/Documents/kotlin/losttemple1 via a throwaway DumpIslands test).
 *
 * Corpus: islands 1..50, 3000..3010, 6000..6010, 8990..9000, each level
 * range level*100000+0..30, and daily-style seeds 1000000..1000020 per
 * level generated with forLevel(L).forNumber(L*1000000+193).
 *
 * Comparison rules:
 *  - `route` is EXCLUDED from the structural diff (tie-breaks among equally
 *    good routes depend on JVM hash iteration order and are explicitly
 *    non-canonical, SPEC §7). Routes are compared by: exists iff Kotlin's
 *    exists; the TS route replays to success; equal (sum(distance),
 *    turn count).
 *  - The KOTLIN route must also replay to success through the TS engine.
 *  - hexes[].directions is compared as a sorted set (Kotlin emits it in
 *    JVM enum-identity-hash order, which is not even stable across runs).
 *  - null and absent are treated alike (kotlinx omits default-null fields).
 */

const DUMP_DIR = join(__dirname, "fixtures/kotlin-dumps");

/** Recursively drop null/undefined properties so absent == null. */
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined) continue;
      out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}

/** Normalise a CommIsland for the structural diff. */
function normalise(comm: CommIsland): unknown {
  const clone = JSON.parse(JSON.stringify(comm)) as CommIsland;
  delete clone.route;
  for (const hex of clone.hexes) {
    if (hex.directions !== null && hex.directions !== undefined) {
      hex.directions = [...hex.directions].sort();
    }
  }
  return stripNulls(clone);
}

function replaysToSuccess(island: Island, route: CommRoute): boolean {
  const journey = new Journey(island.num, 0);
  journey.role = "arch";
  journey.startPoint = route.startPos;
  journey.startDir = route.startDir;
  journey.moves = route.distance.slice();
  journey.turns = route.turn.slice();
  journey.execute(island);
  return journey.finalState.death === "success";
}

function compareIsland(kotlin: CommIsland, tsIsland: Island, label: string, failures: string[]): void {
  const ts = tsIsland.toComm();
  const normKt = normalise(kotlin);
  const normTs = normalise(ts);
  if (JSON.stringify(normKt) !== JSON.stringify(normTs)) {
    failures.push(`${label}: structural mismatch`);
    // Surface the first difference loudly for debugging.
    expect(normTs, label).toEqual(normKt);
    return;
  }
  const ktRoute = kotlin.route;
  const tsRoute = ts.route;
  if ((ktRoute === undefined) !== (tsRoute === undefined)) {
    failures.push(`${label}: route presence differs (kotlin=${!!ktRoute}, ts=${!!tsRoute})`);
    return;
  }
  if (ktRoute !== undefined && tsRoute !== undefined) {
    const ktSteps = ktRoute.distance.reduce((a, b) => a + b, 0);
    const tsSteps = tsRoute.distance.reduce((a, b) => a + b, 0);
    if (ktSteps !== tsSteps || ktRoute.turn.length !== tsRoute.turn.length) {
      failures.push(
        `${label}: best route quality differs (kotlin ${ktSteps} steps/${ktRoute.turn.length} turns, ` +
          `ts ${tsSteps} steps/${tsRoute.turn.length} turns)`,
      );
    }
    if (!replaysToSuccess(tsIsland, tsRoute)) failures.push(`${label}: TS route does not replay to success`);
    if (!replaysToSuccess(tsIsland, ktRoute)) failures.push(`${label}: KOTLIN route does not replay to success in TS`);
  }
}

describe("bulk diff vs Kotlin dump", () => {
  const files = readdirSync(DUMP_DIR).filter((f) => f.endsWith(".json") && f !== "rng_vectors.json");
  const islandFiles = files.filter((f) => f.startsWith("island_"));
  const dailyFiles = files.filter((f) => f.startsWith("daily_"));

  it(`store-resolved corpus (${islandFiles.length} islands)`, () => {
    const failures: string[] = [];
    for (const file of islandFiles) {
      const num = Number(file.replace("island_", "").replace(".json", ""));
      const kotlin = JSON.parse(readFileSync(join(DUMP_DIR, file), "utf8")) as CommIsland;
      const { island } = genPlayable(num);
      compareIsland(kotlin, island, `island ${num}`, failures);
    }
    expect(failures).toEqual([]);
  });

  it(`daily-style corpus (${dailyFiles.length} islands)`, () => {
    const failures: string[] = [];
    for (const file of dailyFiles) {
      const m = /^daily_(\d+)_(\d+)\.json$/.exec(file);
      if (m === null) throw new Error(`unexpected dump file ${file}`);
      const level = Number(m[1]);
      const seed = Number(m[2]);
      const kotlin = JSON.parse(readFileSync(join(DUMP_DIR, file), "utf8")) as CommIsland;
      const model = forNumber(forLevel(level)!, level * 1_000_000 + 193);
      const island = Island.gen(seed, model);
      compareIsland(kotlin, island, `daily level ${level} seed ${seed}`, failures);
    }
    expect(failures).toEqual([]);
  });
});
