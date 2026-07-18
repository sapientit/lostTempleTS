/**
 * pregen CLI — the only writer of island rows. All generating subcommands
 * emit a .sql artefact (idempotent INSERT OR REPLACE batches) plus a .jsonl
 * manifest used by `verify`. Loading into D1 is always a separate, explicit
 * step:
 *
 *   npx wrangler d1 execute losttemple --local  --file artifacts/sql/<f>.sql
 *   npx wrangler d1 execute losttemple --remote --file artifacts/sql/<f>.sql
 *
 * Subcommands:
 *   pool --level L --count N [--start-offset K] [--out DIR]
 *   dailies --from YYYY-MM-DD --to YYYY-MM-DD [--counters-file F] [--out DIR]
 *   import-tutorials [--dir DIR] [--out DIR]
 *   number N [N...] [--out DIR]
 *   verify [--sample N] [--dir DIR]
 *   sql --manifest F.jsonl [--out F.sql]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  TUTORIAL_NUMS,
  dayNumber,
  freshCounters,
  genDailies,
  genMapping,
  importTutorial,
  isoDate,
  verifyRow,
} from "./gen.js";
import type { Counters, Row } from "./gen.js";
import { islandsInsertSql, metaUpsertSql, poolInsertSql } from "./sql.js";

const DEFAULT_OUT = "artifacts/sql";
const DEFAULT_COUNTERS = "artifacts/counters.json";
// Canonical home of the tutorial map content is THIS repo
// (resources/maps, copied from the retired Kotlin server 2026-07-18);
// edit here, then import-tutorials + d1 execute to publish.
const DEFAULT_TUTORIAL_DIR = path.join(__dirname, "../resources/maps");

interface Args {
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        flags[a.slice(2)] = "true";
      } else {
        flags[a.slice(2)] = value;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function requireInt(args: Args, name: string): number {
  const raw = args.flags[name];
  if (raw === undefined || !/^-?\d+$/.test(raw)) {
    throw new Error(`missing or invalid --${name}`);
  }
  return Number(raw);
}

function writeArtifacts(outDir: string, name: string, sql: string, rows: Row[]): void {
  fs.mkdirSync(outDir, { recursive: true });
  const sqlPath = path.join(outDir, `${name}.sql`);
  const manifestPath = path.join(outDir, `${name}.jsonl`);
  fs.writeFileSync(sqlPath, sql + "\n");
  fs.writeFileSync(manifestPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`wrote ${sqlPath} (${rows.length} island rows) and manifest`);
}

function cmdPool(args: Args): void {
  const level = requireInt(args, "level");
  if (level < 1 || level > 6) throw new Error("--level must be 1..6");
  const count = requireInt(args, "count");
  const startOffset = args.flags["start-offset"] !== undefined ? requireInt(args, "start-offset") : 0;
  const outDir = args.flags["out"] ?? DEFAULT_OUT;

  const rows: Row[] = [];
  const nums: number[] = [];
  const t0 = Date.now();
  for (let i = 0; i < count; i++) {
    const num = level * 100_000 + startOffset + i;
    rows.push(genMapping(num));
    nums.push(num);
    if ((i + 1) % 500 === 0) {
      console.log(`  level ${level}: ${i + 1}/${count} (${Date.now() - t0}ms)`);
    }
  }
  const sql = [
    islandsInsertSql(rows),
    poolInsertSql(level, nums, startOffset),
    metaUpsertSql({ [`pool_count_${level}`]: String(startOffset + count) }),
  ].join("\n");
  const name = `seed-pool-l${level}-${startOffset}-${startOffset + count - 1}`;
  writeArtifacts(outDir, name, sql, rows);
}

function loadCounters(file: string): Counters {
  if (!fs.existsSync(file)) return freshCounters();
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, number>;
  const counters = freshCounters();
  for (const [k, v] of Object.entries(parsed)) counters[Number(k)] = v;
  return counters;
}

function cmdDailies(args: Args): void {
  const from = dayNumber(args.flags["from"] ?? "");
  const to = dayNumber(args.flags["to"] ?? "");
  if (from === null || to === null || to < from) {
    throw new Error("need valid --from/--to YYYY-MM-DD with from <= to");
  }
  if (from < 0) throw new Error("--from is before the 2026-01-01 epoch");
  const outDir = args.flags["out"] ?? DEFAULT_OUT;
  const countersFile = args.flags["counters-file"] ?? DEFAULT_COUNTERS;

  const counters = loadCounters(countersFile);
  console.log(`dailies days ${from}..${to} (${isoDate(from)}..${isoDate(to)}), counters ${JSON.stringify(counters)}`);
  const result = genDailies(from, to, counters);
  const metaEntries: Record<string, string> = {};
  for (const [level, seed] of Object.entries(result.counters)) {
    metaEntries[`daily_counter_${level}`] = String(seed);
  }
  const sql = [islandsInsertSql(result.rows), metaUpsertSql(metaEntries)].join("\n");
  writeArtifacts(outDir, `seed-dailies-${isoDate(from)}-${isoDate(to)}`, sql, result.rows);
  fs.mkdirSync(path.dirname(countersFile), { recursive: true });
  fs.writeFileSync(countersFile, JSON.stringify(result.counters, null, 2) + "\n");
  console.log(`updated ${countersFile}: ${JSON.stringify(result.counters)}`);
}

function cmdImportTutorials(args: Args): void {
  const dir = args.flags["dir"] ?? DEFAULT_TUTORIAL_DIR;
  const outDir = args.flags["out"] ?? DEFAULT_OUT;
  const rows: Row[] = [];
  for (const num of TUTORIAL_NUMS) {
    const file = path.join(dir, `map_${num}.json`);
    rows.push(importTutorial(num, fs.readFileSync(file, "utf8")));
  }
  writeArtifacts(outDir, "seed-tutorials", islandsInsertSql(rows), rows);
}

function cmdNumber(args: Args): void {
  const outDir = args.flags["out"] ?? DEFAULT_OUT;
  const nums = args.positional.map((s) => {
    if (!/^-?\d+$/.test(s)) throw new Error(`invalid island number ${s}`);
    return Number(s);
  });
  if (nums.length === 0) throw new Error("number: give at least one island number");
  const rows: Row[] = nums.map((n) => genMapping(n));
  writeArtifacts(outDir, `seed-number-${nums.join("-")}`, islandsInsertSql(rows), rows);
}

function cmdVerify(args: Args): void {
  const dir = args.flags["dir"] ?? DEFAULT_OUT;
  const sample = args.flags["sample"] !== undefined ? requireInt(args, "sample") : null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  if (files.length === 0) throw new Error(`no .jsonl manifests in ${dir}`);
  let total = 0;
  let failures = 0;
  for (const file of files) {
    const rows = fs
      .readFileSync(path.join(dir, file), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Row);
    // Deterministic spread sample: every ceil(n/sample)-th row.
    const step = sample !== null && rows.length > sample ? Math.ceil(rows.length / sample) : 1;
    let checked = 0;
    for (let i = 0; i < rows.length; i += step) {
      const row = rows[i]!;
      const err = verifyRow(row);
      checked++;
      total++;
      if (err !== null) {
        failures++;
        console.error(`FAIL ${file} num=${row.num}: ${err}`);
      }
    }
    console.log(`${file}: ${checked}/${rows.length} rows checked`);
  }
  console.log(failures === 0 ? `verify OK (${total} rows)` : `verify FAILED (${failures}/${total})`);
  if (failures > 0) process.exitCode = 1;
}

function cmdSql(args: Args): void {
  const manifest = args.flags["manifest"];
  if (manifest === undefined) throw new Error("sql: need --manifest F.jsonl");
  const out = args.flags["out"] ?? manifest.replace(/\.jsonl$/, ".sql");
  const rows = fs
    .readFileSync(manifest, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Row);
  fs.writeFileSync(out, islandsInsertSql(rows) + "\n");
  console.log(`wrote ${out} (${rows.length} island rows; pool/meta statements not re-emitted)`);
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  switch (cmd) {
    case "pool":
      return cmdPool(args);
    case "dailies":
      return cmdDailies(args);
    case "import-tutorials":
      return cmdImportTutorials(args);
    case "number":
      return cmdNumber(args);
    case "verify":
      return cmdVerify(args);
    case "sql":
      return cmdSql(args);
    default:
      console.error(
        "usage: pregen <pool|dailies|import-tutorials|number|verify|sql> [options]",
      );
      process.exitCode = 2;
  }
}

main();
