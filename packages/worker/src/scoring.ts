/**
 * Score.setScore ported onto D1 (S§10). Same bucketing, sentinels, phantom
 * seeding and clamping as scoring/Score.kt + ScoreDb.kt. All writes for one
 * call go through a single env.DB.batch (D1 serialises writes — risk R9).
 */

import type { Env } from "./islands.js";

// 19 phantom results seeded the first time a game is scored (ScoreDb.seedIfNew).
const PHANTOMS: ReadonlyArray<readonly [number, number]> = [
  [500, 6],
  [2000, 1],
  [2100, 2],
  [2200, 2],
  [2300, 2],
  [2400, 2],
  [2500, 1],
  [2600, 1],
  [2700, 1],
  [2800, 1],
];

const UPSERT =
  "INSERT INTO score_counts (game, score, count) VALUES (?1, ?2, MAX(?3, 0)) " +
  "ON CONFLICT(game, score) DO UPDATE SET count = MAX(count + ?3, 0)";

/** Returns the percent for the response (0 unless bucketed score > 1000). */
export async function setScore(env: Env, game: number, old: number, newScore: number): Promise<number> {
  // All scores below 1000 land in the single 500 "failed expedition" bucket.
  const oldS = old < 1000 ? 500 : old;
  const newS = newScore < 1000 ? 500 : newScore;
  if (oldS !== newS) {
    const statements: D1PreparedStatement[] = [];
    const existing = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM score_counts WHERE game = ?1",
    )
      .bind(game)
      .first<{ c: number }>();
    if (existing === null || existing.c === 0) {
      for (const [score, count] of PHANTOMS) {
        statements.push(env.DB.prepare(UPSERT).bind(game, score, count));
      }
    }
    // 1000 is the "no previous score" sentinel - nothing to remove.
    if (oldS !== 1000) statements.push(env.DB.prepare(UPSERT).bind(game, oldS, -1));
    statements.push(env.DB.prepare(UPSERT).bind(game, newS, 1));
    await env.DB.batch(statements);
  }
  // A percentile is only meaningful for scores above 1000; lower scores are
  // still recorded but report 0.
  if (newS > 1000) {
    const row = await env.DB.prepare(
      "SELECT COALESCE(SUM(count), 0) AS total, " +
        "COALESCE(SUM(CASE WHEN score <= ?1 THEN count ELSE 0 END), 0) AS atOrBelow " +
        "FROM score_counts WHERE game = ?2",
    )
      .bind(newS, game)
      .first<{ total: number; atOrBelow: number }>();
    const total = row?.total ?? 0;
    return total === 0 ? 100 : Math.trunc((100 * (row?.atOrBelow ?? 0)) / total);
  }
  return 0;
}
