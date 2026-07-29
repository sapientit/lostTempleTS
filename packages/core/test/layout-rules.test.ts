import { describe, expect, it } from "vitest";
import { Coast, Island, Temple } from "../src/index.js";
import type { IslandModel } from "../src/model.js";
import { forNumber, level1, level2, level3, level4, level5, level6 } from "../src/model.js";
import type { Land } from "../src/land.js";

/**
 * GATE 4 — port of the Kotlin LayoutRulesTest.
 *
 * Validates every layout variant of every level model:
 *  - the island constructs without error
 *  - every beach is at least MIN_BEACH_DISTANCE hexes' walk from the temple
 *  - no two rivers share a hex
 *  - where piranhas can spawn, at least 3 piranha-capable river hexes
 *  - the variant can produce a playable island (difficulty 1..maxDifficulty)
 *    within a reasonable number of seeds
 */
const MIN_BEACH_DISTANCE = 3;

const models: Array<[string, IslandModel]> = [
  ["level1", level1],
  ["level2", level2],
  ["level3", level3],
  ["level4", level4],
  ["level5", level5],
  ["level6", level6],
];

/** Hex walking distance from [from] over the island's edge graph
 *  (sea-sea edges don't exist, so this is the on-foot distance). */
function distances(island: Island, from: Land): Map<number, number> {
  const dist = new Map<number, number>([[from.index, 0]]);
  const queue: Land[] = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const [dir, edge] of current.dirs) {
      const next = edge.getNext(dir);
      if (next === null) continue;
      if (!dist.has(next.index)) {
        dist.set(next.index, dist.get(current.index)! + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

describe("layout rules", () => {
  for (const [name, model] of models) {
    const variants = model.layouts.length === 0 ? 1 : model.layouts.length;
    for (let v = 0; v < variants; v++) {
      it(`${name} variant ${v}`, () => {
        const resolved = forNumber(model, v);
        const island = Island.gen(1000 + v, resolved);
        const label = `${name} variant ${v}`;

        // Beaches at least MIN_BEACH_DISTANCE from the temple.
        const temples = [...island.indexes.values()].filter((l) => l instanceof Temple);
        expect(temples.length).toBe(1);
        const dist = distances(island, temples[0]!);
        for (const beach of [...island.indexes.values()].filter((l) => l instanceof Coast)) {
          const d = dist.get(beach.index);
          expect(
            d !== undefined && d >= MIN_BEACH_DISTANCE,
            `${label}: beach ${beach.index} is ${d ?? "unreachable"} hexes from the temple`,
          ).toBe(true);
        }

        // No two rivers share a hex.
        const riverHexes = island.toComm().rivers.map((r) => new Set([...r.lands, r.startLand]));
        for (let i = 0; i < riverHexes.length; i++) {
          for (let j = i + 1; j < riverHexes.length; j++) {
            const shared = [...riverHexes[i]!].filter((h) => riverHexes[j]!.has(h));
            expect(shared, `${label}: rivers ${i} and ${j} share hexes`).toEqual([]);
          }
        }

        // Where piranhas can spawn, at least 3 river hexes must be able to
        // hold them (all but each river's final, exit -1, hex).
        const piranhasPossible =
          model.allowedObstacles === null || model.allowedObstacles.includes("piranhas");
        if (piranhasPossible) {
          const eligible = resolved.river.reduce((a, r) => a + r.lands.length, 0);
          expect(
            eligible,
            `${label}: only ${eligible} piranha-capable river hexes (need 3)`,
          ).toBeGreaterThanOrEqual(3);
        }

        // The variant can produce a playable island.
        let playable = false;
        for (let s = 0; s < 60 && !playable; s++) {
          const d = Island.gen(v + s * variants, resolved).difficulty;
          playable = d >= 1 && d <= model.maxDifficulty;
        }
        expect(playable, `${label}: no playable island in 60 seeds`).toBe(true);
      });
    }
  }
});
