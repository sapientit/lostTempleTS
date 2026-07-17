import { describe, expect, it } from "vitest";
import { Cliff, Island } from "../src/index.js";
import { genPlayable } from "../src/numbers.js";

/**
 * GATE 3 — port of the Kotlin CliffRoundTripTest.
 *
 * An island must behave identically after a round trip through its comm
 * JSON (dailies and tutorial maps are served through that path). Cliffs are
 * the risk: the comm form must preserve which side of the edge is down, or
 * reloaded islands contradict their stored difficulty and route.
 */
describe("cliff comm round trip", () => {
  it("cliffs and difficulty survive serialisation", () => {
    for (const num of [42, 100, 5000, 7000, 8888, 100017, 300001, 600004]) {
      const original = genPlayable(num).island;
      // Real JSON round trip (the Kotlin test passes the object; going
      // through JSON.stringify/parse here is strictly stronger).
      const reloaded = Island.generateFromComm(JSON.parse(JSON.stringify(original.toComm())));
      let checked = 0;
      for (const land of original.indexes.values()) {
        for (const [dir, edge] of land.dirs) {
          if (edge.constructor !== Cliff) continue;
          const redge = reloaded.indexes.get(land.index)!.dirs.get(dir)!;
          expect(redge.constructor, `island ${num}: cliff at ${land.index}/${dir} lost on reload`).toBe(
            Cliff,
          );
          expect(
            (redge as Cliff).westDown,
            `island ${num}: cliff at ${land.index}/${dir} fell the other way after reload`,
          ).toBe((edge as Cliff).westDown);
          checked++;
        }
      }
      expect(checked, `island ${num} had no cliffs to check`).toBeGreaterThan(0);
      expect(reloaded.testPossible(), `island ${num}: difficulty drifts after reload`).toBe(
        original.difficulty,
      );
    }
  });
});
