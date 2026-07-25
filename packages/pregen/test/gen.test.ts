import { describe, expect, it } from "vitest";
import { Island, forLevel, modelFor } from "@losttemple/core";
import {
  FIRST_SEED,
  dayNumber,
  freshCounters,
  genDailies,
  genMapping,
  importTutorial,
  isoDate,
  verifyRow,
} from "../src/gen.js";

describe("day arithmetic", () => {
  it("computes days since the 2026-01-01 epoch", () => {
    expect(dayNumber("2026-01-01")).toBe(0);
    expect(dayNumber("2026-01-02")).toBe(1);
    expect(dayNumber("2026-07-17")).toBe(197);
    expect(dayNumber("2025-12-31")).toBe(-1);
  });

  it("rejects malformed and non-calendar dates", () => {
    expect(dayNumber("2026-1-1")).toBeNull();
    expect(dayNumber("2026-02-30")).toBeNull();
    expect(dayNumber("2026-13-01")).toBeNull();
    expect(dayNumber("garbage")).toBeNull();
    expect(dayNumber("2026-07-17T00:00:00")).toBeNull();
  });

  it("round-trips through isoDate", () => {
    for (const d of ["2026-01-01", "2026-07-17", "2027-02-28"]) {
      expect(isoDate(dayNumber(d)!)).toBe(d);
    }
  });
});

describe("pool mapping rows (genPlayable seed selection)", () => {
  it("golden island 300001 needs no reroll and has difficulty 114", () => {
    const row = genMapping(300001);
    expect(row).toMatchObject({ num: 300001, kind: "level", seed: 300001, difficulty: 114 });
    expect(row.route).not.toBeNull();
    expect(verifyRow(row)).toBeNull();
  });

  it("seeds step by 20000 and land inside the model's difficulty gate", () => {
    for (const num of [100000, 100007, 200003, 400001, 500002, 600004]) {
      const row = genMapping(num);
      expect((row.seed - num) % 20000).toBe(0);
      expect(row.seed).toBeGreaterThanOrEqual(num);
      const model = modelFor(num).forNumber(num);
      expect(row.difficulty).toBeGreaterThanOrEqual(1);
      expect(row.difficulty).toBeLessThanOrEqual(model.maxDifficulty);
      // Every candidate seed before the accepted one must have been
      // rejected by the gate — that is what made genPlayable step on.
      for (let s = num; s < row.seed; s += 20000) {
        const d = Island.gen(s, model).difficulty;
        expect(d === 0 || d > model.maxDifficulty).toBe(true);
      }
      expect(verifyRow(row)).toBeNull();
    }
  });

  it("legacy numbers are kind legacy", () => {
    const row = genMapping(42);
    expect(row.kind).toBe("legacy");
    expect(verifyRow(row)).toBeNull();
  });
});

describe("dailies", () => {
  it("generates six gated islands per day and advances counters", () => {
    const day = 197; // 2026-07-17
    const { rows, counters } = genDailies(day, day, freshCounters());
    expect(rows).toHaveLength(6);
    for (const [i, row] of rows.entries()) {
      const level = i + 1;
      expect(row.num).toBe(level * 1_000_000 + day);
      expect(row.kind).toBe("daily");
      expect(row.comm.mapNum).toBe(row.num);
      expect(row.difficulty).toBeGreaterThanOrEqual(1);
      expect(row.difficulty).toBeLessThanOrEqual(100);
      expect(counters[level]!).toBeGreaterThan(FIRST_SEED);
      // The accepted seed is counters[level]-1; the comm must regenerate
      // identically from it with the layout picked by the MAP NUMBER,
      // salted by level so levels sharing a layout pool (1&2, 3&4, 5&6)
      // diverge instead of always matching on the same day.
      const seed = counters[level]! - 1;
      const model = forLevel(level)!.forNumber(row.num + level);
      const regen = Island.gen(seed, model);
      expect({ ...regen.commIsland, mapNum: row.num }).toEqual(row.comm);
      // Every seed skipped along the way failed the 1..100 gate.
      for (let s = FIRST_SEED; s < seed; s++) {
        const d = Island.gen(s, model).difficulty;
        expect(d < 1 || d > 100).toBe(true);
      }
      expect(verifyRow(row)).toBeNull();
    }
  });

  it("is deterministic and continues counters across days", () => {
    const a = genDailies(197, 198, freshCounters());
    const b1 = genDailies(197, 197, freshCounters());
    const b2 = genDailies(198, 198, b1.counters);
    expect(a.rows).toEqual([...b1.rows, ...b2.rows]);
    expect(a.counters).toEqual(b2.counters);
  });
});

describe("tutorial import", () => {
  it("patches mapNum to the filename number (filename authoritative)", () => {
    const row = importTutorial(
      10005,
      JSON.stringify({ mapNum: 1, rows: 0, hexes: [], obstacles: [], rivers: [], cliffs: [], difficulty: 18, roles: [] }),
    );
    expect(row.comm.mapNum).toBe(10005);
    expect(row.difficulty).toBe(18);
    expect(row.kind).toBe("tutorial");
  });
});

describe("verifyRow failure detection", () => {
  it("flags a tampered difficulty", () => {
    const row = genMapping(300001);
    expect(verifyRow({ ...row, difficulty: row.difficulty + 1 })).toMatch(/difficulty/);
  });

  it("flags a route that no longer succeeds", () => {
    const row = genMapping(300001);
    const broken = { ...row, route: { ...row.route!, distance: [1], turn: [] } };
    expect(verifyRow(broken)).toMatch(/replays to/);
  });
});
