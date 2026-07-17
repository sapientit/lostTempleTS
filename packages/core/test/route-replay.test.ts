import { describe, expect, it } from "vitest";
import { Journey } from "../src/journey.js";
import { genPlayable } from "../src/numbers.js";
import type { Island } from "../src/island.js";

/**
 * GATE 5 — stored-route replay: for generated islands across all levels and
 * legacy ranges, the route in toComm() must replay through the journey
 * engine to death="success". This is the internal-consistency oracle for
 * the difficulty search + journey engine pair.
 */
function replayRoute(island: Island): string | null {
  const route = island.toComm().route;
  if (route === undefined) return "no route stored";
  const journey = new Journey(island.num, 0);
  journey.role = "arch";
  journey.startPoint = route.startPos;
  journey.startDir = route.startDir;
  journey.moves = route.distance.slice();
  journey.turns = route.turn.slice();
  journey.execute(island);
  const death = journey.finalState.death;
  return death === "success" ? null : `died of ${death}`;
}

describe("stored-route replay", () => {
  // ~120 islands: legacy simple/medium/hard plus every level range, spread
  // across all four layout variants of each pool.
  const numbers: number[] = [];
  for (let n = 1; n <= 20; n++) numbers.push(n); // legacy simple
  for (let n = 3001; n <= 3010; n++) numbers.push(n); // legacy medium
  for (let n = 6001; n <= 6010; n++) numbers.push(n); // legacy hard
  for (let level = 1; level <= 6; level++) {
    for (let k = 0; k < 13; k++) numbers.push(level * 100000 + k);
  }

  it(`replays the stored route to success on ${numbers.length} islands`, () => {
    const failures: string[] = [];
    for (const num of numbers) {
      const { island } = genPlayable(num);
      const problem = replayRoute(island);
      if (problem !== null) failures.push(`island ${num}: ${problem}`);
    }
    expect(failures).toEqual([]);
  });
});
