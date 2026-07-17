/**
 * SQL emission for D1 seeding. Idempotent INSERT OR REPLACE statements,
 * batched a few hundred rows per statement so wrangler's file upload stays
 * well under statement-size limits and failures are re-runnable.
 */

import type { Row } from "./gen.js";
import { isCommRow } from "./gen.js";

export const DEFAULT_BATCH = 250;

// D1 caps a single SQL statement at ~100KB; stay well under it (comm rows
// for dailies/tutorials run ~3KB each).
export const MAX_STATEMENT_BYTES = 80_000;

/** Single-quoted SQL string literal ('' escaping — JSON never needs more). */
export function sqlQuote(s: string): string {
  if (s.includes("\0")) throw new Error("NUL byte in SQL string");
  return `'${s.replaceAll("'", "''")}'`;
}

function islandValues(row: Row): string {
  if (isCommRow(row)) {
    const comm = sqlQuote(JSON.stringify(row.comm));
    return `(${row.num},'${row.kind}',NULL,${row.difficulty},NULL,${comm})`;
  }
  const route = row.route === null ? "NULL" : sqlQuote(JSON.stringify(row.route));
  return `(${row.num},'${row.kind}',${row.seed},${row.difficulty},${route},NULL)`;
}

/**
 * INSERT OR REPLACE batches for the islands table. Batches are capped both
 * by row count and by statement size (D1 rejects statements over ~100KB).
 */
export function islandsInsertSql(
  rows: Row[],
  batch = DEFAULT_BATCH,
  maxBytes = MAX_STATEMENT_BYTES,
): string {
  const head = "INSERT OR REPLACE INTO islands (num, kind, seed, difficulty, route, comm) VALUES\n";
  const out: string[] = [];
  let values: string[] = [];
  let size = head.length;
  const flush = (): void => {
    if (values.length > 0) out.push(head + values.join(",\n") + ";");
    values = [];
    size = head.length;
  };
  for (const row of rows) {
    const v = islandValues(row);
    if (values.length > 0 && (values.length >= batch || size + v.length + 2 > maxBytes)) {
      flush();
    }
    values.push(v);
    size += v.length + 2;
  }
  flush();
  return out.join("\n");
}

/** Dense pool rows k -> num for one level, starting at startOffset. */
export function poolInsertSql(
  level: number,
  nums: number[],
  startOffset = 0,
  batch = DEFAULT_BATCH,
): string {
  const out: string[] = [];
  for (let i = 0; i < nums.length; i += batch) {
    const values = nums
      .slice(i, i + batch)
      .map((num, j) => `(${level},${startOffset + i + j},${num})`)
      .join(",\n");
    out.push(`INSERT OR REPLACE INTO pool (level, k, num) VALUES\n${values};`);
  }
  return out.join("\n");
}

/** Upserts into the meta key/value table. */
export function metaUpsertSql(entries: Record<string, string>): string {
  return Object.entries(entries)
    .map(
      ([key, value]) =>
        `INSERT INTO meta (key, value) VALUES (${sqlQuote(key)}, ${sqlQuote(value)}) ` +
        `ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    )
    .join("\n");
}
