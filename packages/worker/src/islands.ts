/**
 * Island resolution replacing Kotlin's IslandStore (PORTING.md §7.2):
 * per-isolate LRU -> D1 stored comm (dailies/tutorials) -> D1 mapping row
 * (single draw-identical regen WITHOUT testPossible, stamped with the stored
 * difficulty/route) -> last-resort full genPlayable (may exceed the free-tier
 * 10 ms CPU budget; logged, accepted risk R2).
 */

import { Coast, Island, Temple, genPlayable, modelFor } from "@losttemple/core";
import type { CommIsland, CommRoute } from "@losttemple/core";
import type { IslandModel } from "@losttemple/core";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

interface IslandRow {
  num: number;
  seed: number | null;
  difficulty: number;
  route: string | null;
  comm: string | null;
}

// Per-isolate LRU of built islands (Map iterates in insertion order; re-set
// on hit for access order). Best-effort — resets on isolate recycle.
const LRU_CAPACITY = 200;
const lru = new Map<number, Island>();

function lruGet(num: number): Island | undefined {
  const island = lru.get(num);
  if (island !== undefined) {
    lru.delete(num);
    lru.set(num, island);
  }
  return island;
}

function lruPut(num: number, island: Island): void {
  lru.delete(num);
  lru.set(num, island);
  if (lru.size > LRU_CAPACITY) {
    const eldest = lru.keys().next().value;
    if (eldest !== undefined) lru.delete(eldest);
  }
}

/**
 * Island.gen minus testPossible: the identical draw sequence (testPossible
 * draws nothing, so skipping it cannot diverge), with difficulty and route
 * stamped from the stored mapping row instead of searched for. Core is not
 * modified — this replays its public generation steps.
 */
export function genFromSeedWithoutTest(
  seed: number,
  model: IslandModel,
  difficulty: number,
  route: CommRoute | null,
  requestedNum: number,
): Island {
  const island = new Island(seed);
  island.createRand(model.size, model.blanks, model.fixedRoles);
  island.buildIndexes();
  island.addEdges();
  island.replaceLandAt(model.templeX, model.templeY, () => new Temple());
  island.map[model.templeX]![model.templeY]!.terrain = "temple";
  for (let i = 0; i < model.beachesX.length; i++) {
    island.replaceLandAt(model.beachesX[i]!, model.beachesY[i]!, () => new Coast());
  }
  for (const river of model.river) {
    island.addRiverComm(river);
  }
  for (let i = 0; i < model.obstacles; i++) {
    island.generateObstacle(model.allowedObstacles);
  }
  for (let i = 0; i < model.cliffs; i++) {
    island.generateCliff();
  }
  island.finalise();
  island.difficulty = difficulty;
  island.route = route;
  island.finaliseComm();
  if (seed !== requestedNum) {
    island.commIsland = { ...island.commIsland, mapNum: requestedNum };
  }
  return island;
}

/** Resolve an island number to a built Island (graph + comm). */
export async function resolveIsland(env: Env, num: number): Promise<Island> {
  const cached = lruGet(num);
  if (cached !== undefined) return cached;

  const row = await env.DB.prepare(
    "SELECT num, seed, difficulty, route, comm FROM islands WHERE num = ?1",
  )
    .bind(num)
    .first<IslandRow>();

  let island: Island;
  if (row !== null && row.comm !== null) {
    // Stored full CommIsland (daily/tutorial): rebuild the graph from it.
    // mapNum was patched at import time; keep the stored JSON authoritative.
    island = Island.generateFromComm(JSON.parse(row.comm) as CommIsland);
  } else if (row !== null && row.seed !== null) {
    const model = modelFor(num).forNumber(num);
    const route = row.route !== null ? (JSON.parse(row.route) as CommRoute) : null;
    island = genFromSeedWithoutTest(row.seed, model, row.difficulty, route, num);
  } else {
    // Never pregenerated: full genPlayable incl. testPossible. On the free
    // tier this can exceed the 10 ms CPU budget (accepted risk R2).
    console.warn(`island ${num} not in D1 - running full genPlayable inline`);
    island = genPlayable(num).island;
  }
  lruPut(num, island);
  return island;
}

// Per-isolate cache of pool counts (seeded once per level per isolate).
const poolCounts = new Map<number, number>();

/** Uniform random pick from the pregenerated pool for a level (1..6). */
export async function randomPoolNumber(env: Env, level: number): Promise<number> {
  let count = poolCounts.get(level);
  if (count === undefined) {
    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = ?1")
      .bind(`pool_count_${level}`)
      .first<{ value: string }>();
    count = row !== null ? Number(row.value) : 0;
    if (Number.isFinite(count) && count > 0) poolCounts.set(level, count);
  }
  if (!Number.isFinite(count) || count <= 0) {
    // Pool not seeded: fall back to Kotlin's full-range pick (will hit the
    // genPlayable fallback above).
    return level * 100_000 + Math.floor(Math.random() * 100_000);
  }
  const k = Math.floor(Math.random() * count);
  const row = await env.DB.prepare("SELECT num FROM pool WHERE level = ?1 AND k = ?2")
    .bind(level, k)
    .first<{ num: number }>();
  if (row === null) throw new Error(`pool row missing: level ${level} k ${k}`);
  return row.num;
}
