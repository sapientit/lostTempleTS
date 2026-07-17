import { describe, expect, it } from "vitest";
import { genPlayable } from "../src/numbers.js";

/**
 * GATE 2 — fingerprints of whole generated islands, from the Kotlin
 * PortableRandomTest.goldenIslands (current post-cliff-fix values, which are
 * authoritative over the stale fingerprints printed in SPEC.md §4.1).
 *
 * If this fails, the number -> island mapping has changed and EVERY shipped
 * island number re-rolls. Only update these values as a deliberate,
 * breaking decision.
 */
describe("golden island fingerprints", () => {
  function fingerprint(num: number): string {
    const comm = genPlayable(num).island.toComm();
    const obs = comm.obstacles.map((o) => `${o.index}:${o.type}`).join(",");
    const cl = comm.cliffs.map((c) => `${c.land}:${c.direction}`).join(",");
    return `diff=${comm.difficulty} obstacles=[${obs}] cliffs=[${cl}]`;
  }

  it("island 100", () => {
    expect(fingerprint(100)).toBe(
      "diff=170 obstacles=[6:tunnel,7:tunnel,8:piranhas,23:temple,25:tunnel] " +
        "cliffs=[23:nw,12:ne,6:se,24:ne,12:w]",
    );
  });

  it("island 5000", () => {
    expect(fingerprint(5000)).toBe(
      "diff=95 obstacles=[9:trap,14:guardians,15:guardians,19:tunnel,21:jungle,27:temple] " +
        "cliffs=[13:ne,9:e,27:nw]",
    );
  });

  it("island 7000", () => {
    expect(fingerprint(7000)).toBe(
      "diff=12 obstacles=[7:jungle,8:trap,9:piranhas,10:guardians,14:trap,15:tunnel,16:guardians,28:jungle,29:temple] " +
        "cliffs=[28:e,24:nw,29:ne]",
    );
  });

  it("island 300001", () => {
    expect(fingerprint(300001)).toBe(
      "diff=114 obstacles=[7:trap,9:temple,13:guardians,15:piranhas,19:guardians,22:trap,27:trap] " +
        "cliffs=[7:sw,27:ne,22:nw]",
    );
  });
});
