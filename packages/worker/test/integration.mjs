/**
 * Contract validation suite, run against a live endpoint (wrangler dev or
 * the deployed Worker):
 *
 *   BASE_URL=http://127.0.0.1:8787 node test/integration.mjs
 *   BASE_URL=https://losttemple-api.losttemple.workers.dev node test/integration.mjs
 *
 * Env:
 *   BASE_URL      required
 *   STRICT_SCORE=1  assert the exact phantom-seeded 70% percentile (only
 *                   valid against a fresh score_counts table)
 *   ARTIFACTS_DIR   dir with pregen .jsonl manifests (default artifacts/sql;
 *                   daily deep-compare is skipped when absent)
 *   KOTLIN_MAPS     tutorial resource dir for byte-content comparison
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL;
if (!BASE) {
  console.error("BASE_URL is required");
  process.exit(2);
}
const STRICT_SCORE = process.env.STRICT_SCORE === "1";
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR ?? "artifacts/sql";
const KOTLIN_MAPS =
  process.env.KOTLIN_MAPS ??
  join(
    process.env.HOME ?? "",
    "Documents/kotlin/losttemple1/server/src/main/resources/maps",
  );

let passed = 0;
let failed = 0;
const timings = {};

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.error(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

function deepEqual(a, b) {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  }
  return v;
}

async function get(path, headers = {}) {
  const t0 = performance.now();
  const res = await fetch(BASE + path, { headers });
  const ms = performance.now() - t0;
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { res, body, text, ms };
}

async function post(path, jsonBody, headers = {}) {
  const t0 = performance.now();
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(jsonBody),
  });
  const ms = performance.now() - t0;
  const body = await res.json().catch(() => null);
  return { res, body, ms };
}

function todayIsoUtc() {
  return new Date().toISOString().slice(0, 10);
}
function isoPlusDays(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- health
console.log("health");
{
  const { res, text } = await get("/");
  check("GET / is 200 text", res.status === 200 && text === "Hello, Ktor!", text);
}

// ------------------------------------------------- golden island 300001
console.log("getIsland?island (mapping row)");
{
  const { res, body, ms } = await get("/client/getIsland?island=300001");
  timings["getIsland?island=300001 (1st)"] = ms;
  check("status 200 ok", res.status === 200 && body?.status === "ok");
  check("mapNum 300001", body?.island?.mapNum === 300001);
  check("difficulty 114 (golden)", body?.island?.difficulty === 114, `got ${body?.island?.difficulty}`);
  check("route present", body?.island?.route != null);
  check(
    "Cache-Control day",
    res.headers.get("Cache-Control") === "public, max-age=86400",
    res.headers.get("Cache-Control"),
  );
  const again = await get("/client/getIsland?island=300001");
  timings["getIsland?island=300001 (2nd, LRU)"] = again.ms;
  check("deterministic repeat", deepEqual(body.island, again.body.island));
}

// A cold mapping island (unlikely to be in any isolate LRU): random offset.
{
  const n = 400000 + Math.floor(Math.random() * 5000);
  const { res, body, ms } = await get(`/client/getIsland?island=${n}`);
  timings[`getIsland?island=${n} (cold mapping)`] = ms;
  check("cold mapping island 200", res.status === 200 && body?.island?.mapNum === n);
}

// ------------------------------------------------------------- tutorial
console.log("getIsland?island=10005 (tutorial, stored JSON)");
{
  const { res, body } = await get("/client/getIsland?island=10005");
  check("status 200 ok", res.status === 200 && body?.status === "ok");
  check("mapNum 10005", body?.island?.mapNum === 10005);
  check("stored difficulty 18 served verbatim", body?.island?.difficulty === 18, `got ${body?.island?.difficulty}`);
  const file = join(KOTLIN_MAPS, "map_10005.json");
  if (existsSync(file)) {
    const stored = JSON.parse(readFileSync(file, "utf8"));
    stored.mapNum = 10005; // filename authoritative (equal here anyway)
    check("byte-content equals resource JSON (parsed)", deepEqual(body.island, stored));
  } else {
    console.log("  SKIP resource comparison (Kotlin maps dir not found)");
  }
}

// --------------------------------------------------------------- levels
console.log("getIsland?level (random pool pick)");
{
  const { res, body } = await get("/client/getIsland?level=3");
  check("status 200 ok", res.status === 200 && body?.status === "ok");
  const num = body?.island?.mapNum;
  check("mapNum in level-3 pool range", num >= 300000 && num <= 304999, String(num));
  check("Cache-Control no-store", res.headers.get("Cache-Control") === "no-store");
}

console.log("getLevel");
{
  const { res, body } = await get("/client/getLevel?island=300001");
  check("300001 -> 3", res.status === 200 && body?.number === 3);
  check("Cache-Control day", res.headers.get("Cache-Control") === "public, max-age=86400");
  const t = await get("/client/getLevel?island=10011");
  check("10011 -> 1 (tens digit)", t.body?.number === 1);
  const l = await get("/client/getLevel?island=42");
  check("42 -> 5 (legacy)", l.body?.number === 5);
}

// --------------------------------------------------------------- daily
console.log("getDaily + daily islands");
const today = todayIsoUtc();
let dailyNumbers = null;
{
  const { res, body } = await get(`/client/getDaily?date=${today}`);
  check("status 200 ok", res.status === 200 && body?.status === "ok");
  check("six numbers", Array.isArray(body?.numbers) && body.numbers.length === 6);
  check("Cache-Control day", res.headers.get("Cache-Control") === "public, max-age=86400");
  dailyNumbers = body?.numbers ?? [];
  const day = Math.round((Date.parse(today) - Date.UTC(2026, 0, 1)) / 86400000);
  check(
    "arithmetic numbers",
    deepEqual(dailyNumbers, [1, 2, 3, 4, 5, 6].map((l) => l * 1000000 + day)),
    JSON.stringify(dailyNumbers),
  );
  const tomorrow = await get(`/client/getDaily?date=${isoPlusDays(1)}`);
  check("tomorrow valid", tomorrow.res.status === 200);
}

// Manifest deep-compare of every daily served today.
let dailyManifest = new Map();
if (existsSync(ARTIFACTS_DIR)) {
  for (const f of readdirSync(ARTIFACTS_DIR).filter((f) => f.startsWith("seed-dailies") && f.endsWith(".jsonl"))) {
    for (const line of readFileSync(join(ARTIFACTS_DIR, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      dailyManifest.set(row.num, row);
    }
  }
}
for (const num of dailyNumbers ?? []) {
  const { res, body } = await get(`/client/getIsland?island=${num}`);
  check(`daily ${num} served`, res.status === 200 && body?.island?.mapNum === num);
  const stored = dailyManifest.get(num);
  if (stored) {
    check(`daily ${num} equals stored comm`, deepEqual(body.island, stored.comm));
  } else {
    console.log(`  SKIP stored-comm comparison for ${num} (no manifest)`);
  }
}

// -------------------------------------------------------------- execute
console.log("execute");
{
  // Use golden island 300001's served route: stored at pregen time and
  // guaranteed to replay to success.
  const { body: islandBody } = await get("/client/getIsland?island=300001");
  const route = islandBody.island.route;
  const exec = {
    score: 350,
    prevScore: 1000,
    num: 7,
    mapNum: 300001,
    role: "arch",
    startPos: route.startPos,
    startDir: route.startDir,
    moves: route.distance,
    turns: route.turn,
  };
  const { res, body, ms } = await post("/client/execute", exec);
  timings["execute (stored route, scored)"] = ms;
  check("status 200 ok", res.status === 200 && body?.status === "ok", JSON.stringify(body).slice(0, 200));
  check("death success", body?.journey?.death === "success");
  check("num echoed", body?.journey?.num === 7);
  check("mapNum echoed", body?.journey?.mapNum === 300001);
  check("direction present", typeof body?.journey?.direction === "string");
  const percent = body?.journey?.percent;
  check("percent in 1..100", typeof percent === "number" && percent >= 1 && percent <= 100, String(percent));
  if (STRICT_SCORE) {
    // Fresh distribution: 19 phantoms + own 2350 -> 14/20 = 70%.
    check("percent exactly 70 (phantom seeding)", percent === 70, String(percent));
  }
  check("no Cache-Control on execute", res.headers.get("Cache-Control") === null, res.headers.get("Cache-Control"));

  // Failed journey (walk 8 off the beach in a silly direction is very
  // unlikely to win; just assert the score path: prevScore sentinel, low
  // score -> percent 0/omitted).
  const fail = await post("/client/execute", {
    score: 200,
    prevScore: 1000,
    num: 8,
    mapNum: 300001,
    role: "arch",
    startPos: route.startPos,
    startDir: route.startDir,
    moves: [1],
    turns: [],
  });
  check("losing journey 200", fail.res.status === 200 && fail.body?.status === "ok");
  check(
    "losing journey percent omitted (kotlinx default-0 omission)",
    fail.body?.journey?.percent === undefined,
    JSON.stringify(fail.body?.journey),
  );

  // Invalid start position: hex 1 is sea (never a beach) for a walking role.
  const bad = await post("/client/execute", { ...exec, startPos: 1 });
  check("invalid start -> 400", bad.res.status === 400);
  check('error "Invalid start position"', bad.body?.error === "Invalid start position");
  check("no Cache-Control on execute 400", bad.res.headers.get("Cache-Control") === null);

  // Nonexistent hex for a flying role too.
  const badFly = await post("/client/execute", { ...exec, role: "balloonist", startPos: 9999 });
  check("nonexistent hex -> 400 (flying)", badFly.res.status === 400 && badFly.body?.error === "Invalid start position");
}

// ------------------------------------------------------------ 400 cases
console.log("400 contract");
{
  const noParams = await get("/client/getIsland");
  check(
    "getIsland no params -> 400 exact string",
    noParams.res.status === 400 && noParams.body?.error === "Invalid island number or level",
    JSON.stringify(noParams.body),
  );
  check("getIsland 400 no-store", noParams.res.headers.get("Cache-Control") === "no-store");
  const badLevel = await get("/client/getIsland?level=7");
  check("level=7 -> 400", badLevel.res.status === 400 && badLevel.body?.error === "Invalid island number or level");
  const notInt = await get("/client/getIsland?island=12abc");
  check("island=12abc -> 400 (toIntOrNull parity)", notInt.res.status === 400);
  const hugeNum = await get("/client/getIsland?island=99999999999999999999");
  check("island > Int32 -> 400", hugeNum.res.status === 400);

  const badDate = await get("/client/getDaily?date=garbage");
  check(
    'getDaily garbage -> 400 "Invalid Date"',
    badDate.res.status === 400 && badDate.body?.error === "Invalid Date",
  );
  check("getDaily 400 no-store", badDate.res.headers.get("Cache-Control") === "no-store");
  const early = await get("/client/getDaily?date=2025-12-31");
  check("before epoch -> 400", early.res.status === 400 && early.body?.error === "Invalid Date");
  const far = await get(`/client/getDaily?date=${isoPlusDays(2)}`);
  check("day after tomorrow -> 400", far.res.status === 400 && far.body?.error === "Invalid Date");
  const nonCal = await get("/client/getDaily?date=2026-02-30");
  check("2026-02-30 -> 400 (calendar-validated)", nonCal.res.status === 400);

  const badIsland = await get("/client/getLevel?island=7000000");
  check(
    'getLevel out of range -> 400 "Invalid island number"',
    badIsland.res.status === 400 && badIsland.body?.error === "Invalid island number",
    JSON.stringify(badIsland.body),
  );
  check("getLevel 400 no-store", badIsland.res.headers.get("Cache-Control") === "no-store");
  const noIsland = await get("/client/getLevel");
  check("getLevel no param -> 400", noIsland.res.status === 400);
}

// ----------------------------------------------------------------- CORS
console.log("CORS");
{
  const origin = "https://losttemple.duckdns.org";
  const { res } = await get("/client/getLevel?island=300001", { Origin: origin });
  check("ACAO echoed for allowed origin", res.headers.get("Access-Control-Allow-Origin") === origin);
  check("Vary: Origin", (res.headers.get("Vary") ?? "").includes("Origin"));
  const err = await get("/client/getIsland", { Origin: origin });
  check("ACAO present on 400 too", err.res.headers.get("Access-Control-Allow-Origin") === origin);
  const other = await get("/client/getLevel?island=300001", { Origin: "https://evil.example" });
  check("no ACAO for disallowed origin", other.res.headers.get("Access-Control-Allow-Origin") === null);
  const localhost = await get("/", { Origin: "http://localhost:5173" });
  check("localhost:5173 allowed", localhost.res.headers.get("Access-Control-Allow-Origin") === "http://localhost:5173");

  const pre = await fetch(BASE + "/client/execute", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  check("preflight 2xx", pre.status === 204 || pre.status === 200, String(pre.status));
  check(
    "preflight allows POST",
    (pre.headers.get("Access-Control-Allow-Methods") ?? "").includes("POST"),
  );
  check(
    "preflight allows Content-Type",
    (pre.headers.get("Access-Control-Allow-Headers") ?? "").toLowerCase().includes("content-type"),
  );
  check("preflight ACAO", pre.headers.get("Access-Control-Allow-Origin") === origin);
}

// ---------------------------------------------------------------- report
console.log("\ntimings (ms):");
for (const [k, v] of Object.entries(timings)) console.log(`  ${k}: ${v.toFixed(1)}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
