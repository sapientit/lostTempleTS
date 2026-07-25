import { describe, expect, it } from "vitest";
import { Journey } from "../src/journey.js";
import { genPlayable } from "../src/numbers.js";
import type { Island } from "../src/island.js";
import type { Role } from "../src/enums.js";

/**
 * GATE — /client/explain internal consistency: for the three walking roles
 * (arch, warrior, scout), Journey.explain()'s trace must describe exactly
 * the same terminal outcome as Journey.execute() for identical input, and
 * its length must be bounded by the moves/turns the caller supplied. The
 * three one-shot roles (balloonist, magician, researcher) must be rejected
 * rather than produce a fake/empty trace.
 */

const WALKING_ROLES: Role[] = ["arch", "warrior", "scout"];
const ONE_SHOT_ROLES: Role[] = ["balloonist", "magician", "researcher"];

function stubIsland(num: number): { island: Island; startPos: number; startDir: "e" | "w" | "ne" | "nw" | "se" | "sw"; moves: number[]; turns: number[] } {
  const { island } = genPlayable(num);
  const route = island.toComm().route;
  if (route === undefined) throw new Error(`island ${num} has no stored route`);
  return { island, startPos: route.startPos, startDir: route.startDir, moves: route.distance, turns: route.turn };
}

describe("Journey.explain — consistency with execute", () => {
  const numbers = [1, 2, 3, 3001, 3002, 6001, 6002, 100000, 200000, 300000];

  for (const num of numbers) {
    for (const role of WALKING_ROLES) {
      it(`role ${role} on island ${num}: explain trace matches execute's final state`, () => {
        const { island, startPos, startDir, moves, turns } = stubIsland(num);

        const executed = new Journey(num, 0);
        executed.role = role;
        executed.startPoint = startPos;
        executed.startDir = startDir;
        executed.moves = moves.slice();
        executed.turns = turns.slice();
        executed.execute(island);

        const explained = new Journey(num, 0);
        explained.role = role;
        explained.startPoint = startPos;
        explained.startDir = startDir;
        explained.moves = moves.slice();
        explained.turns = turns.slice();
        const trace = explained.explain(island);

        // Same terminal state regardless of which entry point was used.
        expect(explained.finalState.position.index).toBe(executed.finalState.position.index);
        expect(explained.finalState.direction).toBe(executed.finalState.direction);
        expect(explained.finalState.death).toBe(executed.finalState.death);
        expect([...explained.finalState.allDeaths].sort()).toEqual([...executed.finalState.allDeaths].sort());

        // The trace's last entry carries the same death as the terminal state.
        expect(trace.length).toBeGreaterThan(0);
        const last = trace[trace.length - 1]!;
        expect(last.death).toBe(executed.finalState.death ?? undefined);
        expect(last.position).toBe(executed.finalState.position.index);
        expect(last.direction).toBe(executed.finalState.direction);

        // Only the last entry ever carries a death.
        for (const step of trace.slice(0, -1)) {
          expect(step.death).toBeUndefined();
        }
      });
    }
  }

  it("trace length is bounded by the supplied moves/turns (success case, island 300000, role arch)", () => {
    const { island, startPos, startDir, moves, turns } = stubIsland(300000);
    const j = new Journey(300000, 0);
    j.role = "arch";
    j.startPoint = startPos;
    j.startDir = startDir;
    j.moves = moves.slice();
    j.turns = turns.slice();
    const trace = j.explain(island);

    expect(j.finalState.death).toBe("success");
    // No early death: every supplied move-step and turn produced exactly one
    // entry (upper bound in general; equality holds when nothing cuts the
    // walk short).
    const totalMoveSteps = moves.reduce((a, b) => a + b, 0);
    expect(trace.length).toBe(totalMoveSteps + turns.length);
    expect(trace.filter((s) => s.kind === "move").length).toBe(totalMoveSteps);
    expect(trace.filter((s) => s.kind === "turn").length).toBe(turns.length);
  });
});

describe("Journey.explain — unsupported roles", () => {
  for (const role of ONE_SHOT_ROLES) {
    it(`rejects role ${role} with a clear error instead of crashing or faking a trace`, () => {
      const { island, startPos, startDir } = stubIsland(1);
      const j = new Journey(1, 0);
      j.role = role;
      j.startPoint = startPos;
      j.startDir = startDir;
      j.moves = [];
      j.turns = [];
      expect(() => j.explain(island)).toThrow(`explain is not supported for role ${role}`);
    });
  }
});
