import { describe, expect, it } from "vitest";
import { DAILY_START_MS, DAY_MS, dayNumber, parseIsoDateMs, toIntOrNull, todayUtcMs } from "../src/parse.js";

describe("toIntOrNull (Kotlin String.toIntOrNull parity)", () => {
  it("accepts sign + digits within Int32", () => {
    expect(toIntOrNull("300001")).toBe(300001);
    expect(toIntOrNull("-42")).toBe(-42);
    expect(toIntOrNull("+7")).toBe(7);
    expect(toIntOrNull("2147483647")).toBe(2147483647);
    expect(toIntOrNull("-2147483648")).toBe(-2147483648);
  });

  it("rejects everything else", () => {
    expect(toIntOrNull("12abc")).toBeNull();
    expect(toIntOrNull("")).toBeNull();
    expect(toIntOrNull(" 1")).toBeNull();
    expect(toIntOrNull("1.5")).toBeNull();
    expect(toIntOrNull("2147483648")).toBeNull(); // Int overflow
    expect(toIntOrNull("99999999999999999999")).toBeNull();
    expect(toIntOrNull(null)).toBeNull();
  });
});

describe("parseIsoDateMs (strict LocalDate.parse parity)", () => {
  it("accepts strict ISO calendar dates", () => {
    expect(parseIsoDateMs("2026-01-01")).toBe(DAILY_START_MS);
    expect(parseIsoDateMs("2026-07-17")).toBe(DAILY_START_MS + 197 * DAY_MS);
    expect(parseIsoDateMs("2028-02-29")).not.toBeNull(); // leap year
  });

  it("rejects malformed and non-calendar dates", () => {
    expect(parseIsoDateMs("2026-1-1")).toBeNull();
    expect(parseIsoDateMs("2026-02-30")).toBeNull();
    expect(parseIsoDateMs("2026-13-01")).toBeNull();
    expect(parseIsoDateMs("2027-02-29")).toBeNull(); // not a leap year
    expect(parseIsoDateMs("garbage")).toBeNull();
    expect(parseIsoDateMs("2026-07-17T00:00:00")).toBeNull();
    expect(parseIsoDateMs(null)).toBeNull();
  });
});

describe("day arithmetic", () => {
  it("floors to UTC midnight and counts from the epoch", () => {
    const noon = Date.UTC(2026, 6, 17, 12, 34, 56);
    expect(todayUtcMs(noon)).toBe(Date.UTC(2026, 6, 17));
    expect(dayNumber(Date.UTC(2026, 6, 17))).toBe(197);
    expect(dayNumber(DAILY_START_MS)).toBe(0);
  });
});
