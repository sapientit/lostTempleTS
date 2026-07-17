import { describe, expect, it } from "vitest";
import { PortableRandom } from "../src/random.js";

/**
 * GATE 1 — golden vectors from the Kotlin PortableRandomTest.goldenVectors.
 * These values are part of the game's definition: the port must reproduce
 * them exactly.
 */
describe("PortableRandom golden vectors", () => {
  it("next() from seed 1", () => {
    const r = new PortableRandom(1);
    const got = Array.from({ length: 8 }, () => r.next());
    expect(got).toEqual([
      -1601705229, 11749833, -2029599509, -81385475, -135815893, 1207330352, -1662844432,
      -1199399076,
    ]);
  });

  it("nextInt(6) from seed 12345", () => {
    const r = new PortableRandom(12345);
    const got = Array.from({ length: 12 }, () => r.nextInt(6));
    expect(got).toEqual([5, 1, 2, 4, 3, 2, 0, 4, 5, 4, 2, 5]);
  });

  it("nextBoolean() from seed -42", () => {
    const r = new PortableRandom(-42);
    const got = Array.from({ length: 10 }, () => r.nextBoolean());
    expect(got).toEqual([false, false, false, true, false, false, true, false, true, true]);
  });

  it("shuffled([1..8]) from seed 2026", () => {
    const r = new PortableRandom(2026);
    expect(r.shuffled([1, 2, 3, 4, 5, 6, 7, 8])).toEqual([7, 2, 5, 1, 6, 8, 3, 4]);
  });

  it("nextInt is exact for bounds up to the documented 2^21 envelope", () => {
    // (u32 * bound) must stay < 2^53 for the double formula to be exact.
    // Check the formula against BigInt arithmetic near the envelope edge.
    const r1 = new PortableRandom(999);
    const r2 = new PortableRandom(999);
    for (const bound of [201, 65536, 1 << 20, 1 << 21]) {
      for (let i = 0; i < 200; i++) {
        const viaDouble = r1.nextInt(bound);
        const raw = BigInt(r2.next() >>> 0);
        const viaBigInt = Number((raw * BigInt(bound)) >> 32n);
        expect(viaDouble).toBe(viaBigInt);
      }
    }
  });
});
