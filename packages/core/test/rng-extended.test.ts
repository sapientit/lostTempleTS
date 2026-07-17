import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PortableRandom } from "../src/random.js";

/**
 * Extended golden vectors dumped fresh from the Kotlin PortableRandom
 * (fixtures/kotlin-dumps/rng_vectors.json): 1,000 next() draws and 1,000
 * nextInt(3..201) draws for 10 seeds including negative and extreme seeds.
 * Catches nextInt 64-bit-product mistakes the short gate-1 vectors miss.
 */
describe("PortableRandom extended vectors (Kotlin dump)", () => {
  const fixture = JSON.parse(
    readFileSync(join(__dirname, "fixtures/kotlin-dumps/rng_vectors.json"), "utf8"),
  ) as Record<string, { next: number[]; nextInt: number[] }>;

  for (const [seedStr, vectors] of Object.entries(fixture)) {
    it(`seed ${seedStr}`, () => {
      const seed = Number(seedStr);
      const r = new PortableRandom(seed);
      const next = Array.from({ length: 1000 }, () => r.next());
      expect(next).toEqual(vectors.next);
      // Bounds cycle 3 + (i % 199), exactly as in the Kotlin dump.
      const ints = Array.from({ length: 1000 }, (_, i) => r.nextInt(3 + (i % 199)));
      expect(ints).toEqual(vectors.nextInt);
    });
  }
});
