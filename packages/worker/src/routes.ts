/**
 * The four /client handlers, contract-frozen against route/ClientReq.kt
 * (normative) and S§2. Exact status codes, error strings and Cache-Control.
 */

import { ALL_DIRECTIONS, ALL_ROLES, Journey, levelFor } from "@losttemple/core";
import type { CommExecute, CommExplain } from "@losttemple/core";
import { randomPoolNumber, resolveIsland } from "./islands.js";
import type { Env } from "./islands.js";
import {
  DAILY_START_MS,
  DAY_MS,
  dayNumber,
  parseIsoDateMs,
  toIntOrNull,
  todayUtcMs,
} from "./parse.js";
import { CACHE_A_DAY, NO_STORE, respond } from "./respond.js";
import { setScore } from "./scoring.js";

const LEVELS = [1, 2, 3, 4, 5, 6] as const;

export async function getIsland(url: URL, env: Env, cors: Record<string, string>): Promise<Response> {
  const num = toIntOrNull(url.searchParams.get("island"));
  const level = toIntOrNull(url.searchParams.get("level"));
  if (num !== null) {
    // A specific island: deterministic, safe to cache for a day.
    const island = await resolveIsland(env, num);
    return respond(200, { status: "ok", island: island.commIsland }, CACHE_A_DAY, cors);
  }
  if (level !== null && level >= 1 && level <= 6) {
    // A fresh random pick every time - must never be cached.
    const picked = await randomPoolNumber(env, level);
    const island = await resolveIsland(env, picked);
    return respond(200, { status: "ok", island: island.commIsland }, NO_STORE, cors);
  }
  return respond(400, { status: "error", error: "Invalid island number or level" }, NO_STORE, cors);
}

export function getDaily(url: URL, cors: Record<string, string>): Response {
  const dateMs = parseIsoDateMs(url.searchParams.get("date"));
  // Islands exist up to tomorrow (UTC): generated a day ahead so timezones
  // in front of UTC always find their date.
  const lastAvailable = todayUtcMs(Date.now()) + DAY_MS;
  if (dateMs === null || dateMs < DAILY_START_MS || dateMs > lastAvailable) {
    // A date invalid today (e.g. day after tomorrow) becomes valid later -
    // never cache the rejection.
    return respond(400, { status: "error", error: "Invalid Date" }, NO_STORE, cors);
  }
  const day = dayNumber(dateMs);
  const numbers = LEVELS.map((l) => l * 1_000_000 + day);
  return respond(200, { status: "ok", numbers }, CACHE_A_DAY, cors);
}

export function getLevel(url: URL, cors: Record<string, string>): Response {
  const num = toIntOrNull(url.searchParams.get("island"));
  const level = num === null ? null : levelFor(num);
  if (level === null) {
    return respond(400, { status: "error", error: "Invalid island number" }, NO_STORE, cors);
  }
  return respond(200, { status: "ok", number: level }, CACHE_A_DAY, cors);
}

const WALKING_EXEMPT = new Set(["balloonist", "researcher", "magician"]);

/**
 * Shared CommExecute body parsing for /client/execute and /client/explain
 * (both take the identical request shape). Malformed JSON / missing
 * required fields throw -> 500 envelope, the same class of failure as
 * Ktor's receive<CommExecute>() (S§2.4).
 */
async function parseCommExecute(request: Request): Promise<CommExecute> {
  const body = (await request.json()) as Partial<CommExecute>;
  if (
    typeof body.score !== "number" ||
    typeof body.prevScore !== "number" ||
    typeof body.num !== "number" ||
    typeof body.mapNum !== "number" ||
    typeof body.startPos !== "number" ||
    !ALL_ROLES.includes(body.role as never) ||
    (body.startDir !== undefined && !ALL_DIRECTIONS.includes(body.startDir as never))
  ) {
    throw new Error("Invalid CommExecute body");
  }
  return body as CommExecute;
}

export async function execute(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const exec = await parseCommExecute(request);

  const island = await resolveIsland(env, exec.mapNum);
  // Walking roles must start on a beach (the difficulty search only ever
  // starts there); flying/consulting roles may name any existing hex.
  const walking = !WALKING_EXEMPT.has(exec.role);
  if (
    !island.indexes.has(exec.startPos) ||
    (walking && !island.beaches.has(exec.startPos))
  ) {
    // Ktor sets no Cache-Control on this 400 - neither do we.
    return respond(400, { status: "error", error: "Invalid start position" }, null, cors);
  }

  const journey = Journey.create(exec, island);
  const death = journey.finalState.death;
  const newScore = death === "success" ? exec.score + 2000 : exec.score;
  const percent = await setScore(env, exec.mapNum, exec.prevScore, newScore);
  let comm = journey.getComm();
  // kotlinx omits percent at its default 0 (journey.copy(percent = percent)).
  if (percent !== 0) comm = { ...comm, percent };
  return respond(200, { status: "ok", journey: comm }, null, cors);
}

/**
 * POST /client/explain: a stateless step-by-step replay of a journey for
 * the three "walking" roles (arch, warrior, scout) — no setScore call, no
 * write of any kind, purely a visualization query. balloonist/magician/
 * researcher resolve in one shot and have no meaningful per-step trace, so
 * they're rejected with a clean 400 rather than attempting to fake one.
 */
export async function explain(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const exec = await parseCommExecute(request);

  if (WALKING_EXEMPT.has(exec.role)) {
    // Checked before any island resolution: no D1 access for a request we
    // are going to reject regardless of island/start position.
    return respond(400, { status: "error", error: `explain is not supported for role ${exec.role}` }, null, cors);
  }

  const island = await resolveIsland(env, exec.mapNum);
  if (!island.indexes.has(exec.startPos) || !island.beaches.has(exec.startPos)) {
    return respond(400, { status: "error", error: "Invalid start position" }, null, cors);
  }

  const { journey, trace } = Journey.createForExplain(exec, island);
  const comm: CommExplain = { ...journey.getComm(), trace };
  return respond(200, { status: "ok", journey: comm }, null, cors);
}
