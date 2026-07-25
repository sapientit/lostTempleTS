import { describe, expect, it } from "vitest";
import { explain } from "../src/routes.js";
import type { Env } from "../src/islands.js";

/**
 * POST /client/explain — the unsupported-role rejection must happen before
 * any island/D1 access (a fully unit-testable path with no real Env), and
 * must return the same {status:"error", error} envelope as execute()'s
 * existing validation failures, not a 500 crash.
 *
 * The supported-role happy path needs a real D1-backed island, which this
 * package's plain-node vitest setup doesn't provide (see integration.mjs
 * for that, run against wrangler dev / the deployed Worker).
 */
function req(body: unknown): Request {
  return new Request("https://example.invalid/client/explain", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Never touched for the unsupported-role rejection: the role check runs
// before resolveIsland(), so this deliberately-broken Env would throw if it
// were ever reached.
const UNREACHABLE_ENV = {
  get DB(): never {
    throw new Error("DB should not be accessed for a rejected role");
  },
} as unknown as Env;

const BASE = {
  score: 0,
  prevScore: 0,
  num: 1,
  mapNum: 300001,
  startPos: 1,
  moves: [1],
  turns: [],
};

describe("POST /client/explain — unsupported roles", () => {
  for (const role of ["balloonist", "magician", "researcher"] as const) {
    it(`rejects role ${role} with a clean 400 envelope, no D1 access`, async () => {
      const res = await explain(req({ ...BASE, role }), UNREACHABLE_ENV, {});
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({ status: "error", error: `explain is not supported for role ${role}` });
    });
  }
});

describe("POST /client/explain — malformed body", () => {
  it("throws on an invalid CommExecute body (500 envelope upstream, same as execute())", async () => {
    await expect(explain(req({ ...BASE, role: "not-a-role" }), UNREACHABLE_ENV, {})).rejects.toThrow(
      "Invalid CommExecute body",
    );
  });
});
