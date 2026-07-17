/**
 * Number-space resolution and the playability reroll, ported from the pure
 * parts of game/IslandStore.kt (modelFor, levelFor, genPlayable). No cache,
 * no file I/O — pure functions for the Worker and the pregen CLI.
 */

import { Island } from "./island.js";
import type { IslandModel } from "./model.js";
import { forLevel, hard, medium, simple } from "./model.js";

/**
 * Island number ranges:
 *   1-9000            legacy random maps (simple/medium/hard by range)
 *   10000-19999       predefined tutorial resources (not handled here)
 *   100000-699999     level maps: level = number / 100000
 *   1M-6.9M           dailies: level = number / 1000000
 * Fallbacks match Kotlin exactly (out-of-range numbers still generate).
 */
export function modelFor(key: number): IslandModel {
  if (key >= 1_000_000) return forLevel(Math.trunc(key / 1_000_000)) ?? hard;
  if (key >= 100_000) return forLevel(Math.trunc(key / 100_000)) ?? hard;
  if (key > 6000) return hard;
  if (key > 3000) return medium;
  return simple;
}

/** Certification level (1-6) required to play an island number, or null if
 *  the number is not in any known range. Legacy random maps (1-9000) use the
 *  full obstacle set, so they require full qualification (5). Tutorial
 *  resources encode their set in the tens digit (10011 -> 1). */
export function levelFor(num: number): number | null {
  if (num >= 1_000_000 && num <= 6_999_999) return Math.trunc(num / 1_000_000);
  if (num >= 100_000 && num <= 699_999) return Math.trunc(num / 100_000);
  if (num >= 10_000 && num <= 19_999) {
    const tens = Math.trunc(num / 10) % 10;
    return Math.min(Math.max(tens, 1), 6);
  }
  if (num >= 1 && num <= 9000) return 5;
  return null;
}

/** genPlayable reroll step: candidate seeds are key, key+20000, key+40000... */
export function nextCandidate(seed: number): number {
  return seed + 20000;
}

/** genPlayable acceptance: difficulty in 1..maxDifficulty. */
export function isPlayable(difficulty: number, model: IslandModel): boolean {
  return difficulty !== 0 && difficulty <= model.maxDifficulty;
}

export interface PlayableIsland {
  island: Island;
  /** The seed that actually generated the island (key + k*20000). */
  seed: number;
}

/**
 * The model comes from the REQUESTED number's range and the layout variant
 * from the requested number, so retries re-roll forests/cliffs/obstacles but
 * keep the same layout. If the seed produces an impossible island
 * (difficulty 0) or one easier than the model allows, retry with seed+20000
 * (cap: 200 attempts), then renumber the island back to the requested number.
 */
export function genPlayable(key: number): PlayableIsland {
  const model = modelFor(key).forNumber(key);
  let seed = key;
  let island = Island.gen(seed, model);
  while (!isPlayable(island.difficulty, model)) {
    seed = nextCandidate(seed);
    if (seed >= key + 4_000_000) throw new Error(`no playable island found for map ${key}`);
    island = Island.gen(seed, model);
  }
  if (seed !== key) {
    island.commIsland = { ...island.commIsland, mapNum: key };
  }
  return { island, seed };
}
