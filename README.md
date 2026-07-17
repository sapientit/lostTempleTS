# losttemple-ts

TypeScript port of the Lost Temple server. The Kotlin repo
(`~/Documents/kotlin/losttemple1`) is the frozen reference implementation;
see its `PORTING.md` for the plan and `SPEC.md` for the server spec.

## Layout

npm-workspaces monorepo:

- `packages/core` — the PURE game core: PortableRandom, island generation,
  journey engine, difficulty search, wire DTO types, number-space functions.
  No `node:` imports, no `Date.now`, no `Math.random`, no I/O anywhere in
  `src/`. Functions take values and return values.
- `packages/worker` (future) — Cloudflare Worker serving the API from D1.
- `packages/pregen` (future) — Node CLI that pregenerates island mapping rows.

## Validation

`packages/core/test` carries the porting gates, all green against the frozen
Kotlin reference:

1. `random.test.ts` — PortableRandom golden vectors (+ BigInt envelope check).
2. `rng-extended.test.ts` — 10×2,000 extended vectors dumped from Kotlin.
3. `golden-islands.test.ts` — the four golden island fingerprints
   (islands 100, 5000, 7000, 300001), including difficulty.
4. `cliff-roundtrip.test.ts` — comm JSON round trip preserves cliffs and
   difficulty.
5. `layout-rules.test.ts` — layout pool invariants for all 24 level variants.
6. `route-replay.test.ts` — stored routes replay to `success`.
7. `bulk-diff.test.ts` — 395 islands structurally identical to a Kotlin dump
   (`test/fixtures/kotlin-dumps/`, captured 2026-07-17); routes compared by
   replay-to-success and (steps, turns) only — tie-breaks among equally good
   routes are non-canonical by design (SPEC §7).

Run with:

```
npm test            # all workspaces
npm run typecheck
```

## Porting invariants (do not break)

- `src/random.ts` is the determinism kernel — never change it, never use any
  other RNG in generation code.
- The ORDER of random draws in `island.ts` is part of the island definition:
  failed placement attempts consume draws too.
- Wire enum values are the lower-case Kotlin names (`"ne"`, `"sacrificed"`,
  `"arch"`); DTO field names in `comm.ts` are the JSON contract.
- kotlinx omits fields at their declared default: optional (`?:`) fields in
  `comm.ts` must be OMITTED when absent, never emitted as `null`.
