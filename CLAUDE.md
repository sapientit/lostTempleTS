# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TypeScript port of the Lost Temple game server (a hex-grid island exploration
puzzle game). The Kotlin repo (`~/Documents/kotlin/losttemple1`) is the
frozen reference implementation — its `PORTING.md`/`SPEC.md` define the wire
contract this port must match exactly. This repo is the **backend**; the
client lives in a separate repo (`~/temple-client`) and is out of scope here.

npm-workspaces monorepo, 4 packages:

- **`packages/core`** — pure game engine: `PortableRandom`, island
  generation, journey engine, difficulty search, wire DTO types
  (`comm.ts`), number-space resolution (`numbers.ts`). No `node:` imports, no
  `Date.now`, no `Math.random`, no I/O anywhere in `src/`. Functions take
  values and return values only. Consumed by both `worker` and `pregen`.
- **`packages/worker`** — the live Cloudflare Worker: HTTP routing, D1
  reads, request/response envelopes, share-card (OG image) generation, CORS.
- **`packages/pregen`** — Node CLI (`src/cli.ts`) that is the **sole writer**
  of island rows, emitting idempotent SQL to load into D1. Never write island
  rows any other way.
- **`packages/og-renderer`** — standalone always-on Node HTTP service that
  replaces the Worker's `/og/*` share-image route on the Oracle box, because
  Cloudflare's free-tier per-request CPU ceiling makes that route fail ~40%
  of the time. Reuses `@losttemple/worker`'s `share-tree` module so
  validation/headers match exactly; nginx on the Oracle box proxies `/og/*`
  here instead of to the Worker.

## Commands

```
npm test                    # all workspaces (vitest)
npm run typecheck           # all workspaces (tsc --noEmit)
npm test --workspace=core   # single package
npx vitest run <file>       # single test file (run from the package dir, or use --workspace)
```

Worker dev/deploy (from `packages/worker`):
```
npm run dev       # wrangler dev --persist-to .wrangler/state (local D1, isolated from remote)
npm run deploy    # wrangler deploy
```

Pregen CLI (from `packages/pregen`, or via the `generate.sh` wrapper in the
same directory — run it with no args for its own usage text):
```
npm start -- pool --level L --count N [--start-offset K]
npm start -- dailies --from YYYY-MM-DD --to YYYY-MM-DD
npm start -- import-tutorials
npm start -- number N [N...]
npm start -- verify
npm start -- sql --manifest F.jsonl
```
Every generating subcommand only writes a `.sql`/`.jsonl` artifact under
`artifacts/sql/` — loading into D1 is always a separate, explicit step:
```
npx wrangler d1 execute losttemple --local  --config packages/worker/wrangler.toml --file <f>.sql
npx wrangler d1 execute losttemple --remote --config packages/worker/wrangler.toml --file <f>.sql
```
(`pregen` has no `wrangler.toml` of its own — the D1 binding lives in
`packages/worker/wrangler.toml`, so `--config` must point there explicitly
regardless of cwd.) `--local` and `--remote` are completely isolated
databases — local dev state lives in `packages/worker/.wrangler/state`.

## Porting invariants (do not break)

- `packages/core/src/random.ts` is the determinism kernel — never change it,
  never use any other RNG in generation code.
- The ORDER of random draws in `island.ts` is part of the island definition:
  failed placement attempts consume draws too.
- Wire enum values are the lower-case Kotlin names (`"ne"`, `"sacrificed"`,
  `"arch"`); DTO field names in `comm.ts` are the JSON contract.
- kotlinx omits fields at their declared default: optional (`?:`) fields in
  `comm.ts` must be OMITTED when absent, never emitted as `null`.
- `IslandModel.forNumber()` (`model.ts`) collapses via `num mod
  layouts.length` — this mod-4 behavior is inherited from the Kotlin
  reference and is load-bearing for GATE 6 below; don't "fix" it in the
  shared core even if it looks like a bug (see the dailies salting note in
  `pregen/src/gen.ts` for how that surfaced and was worked around
  layer-locally instead).

## Validation gates (`packages/core/test`)

All green against the frozen Kotlin reference — this is the actual porting
spec, more authoritative than any comment:

1. `random.test.ts` — PortableRandom golden vectors (+ BigInt envelope check).
2. `rng-extended.test.ts` — 10×2,000 extended vectors dumped from Kotlin.
3. `golden-islands.test.ts` — four golden island fingerprints (100, 5000,
   7000, 300001), including difficulty.
4. `cliff-roundtrip.test.ts` — comm JSON round trip preserves cliffs/difficulty.
5. `layout-rules.test.ts` — layout pool invariants for all 24 level variants.
6. `route-replay.test.ts` — stored routes replay to `success`.
7. `bulk-diff.test.ts` ("GATE 6") — 395 islands structurally identical to a
   Kotlin dump (`test/fixtures/kotlin-dumps/`, captured 2026-07-17); routes
   compared by replay-to-success and (steps, turns) only — tie-breaks among
   equally good routes are non-canonical by design. This fixture set can
   never be regenerated/updated to match new behavior — it's a frozen
   ground truth. If a change breaks it, the change is wrong.

## Island number space (`packages/core/src/numbers.ts`)

```
1–9000            legacy random maps (simple/medium/hard by sub-range)
10000–19999       tutorial maps (fixed content, not model-generated)
100000–699999     pool/level maps: level = num / 100000
1,000,000–6.9M    dailies: level = num / 1,000,000
```
`levelFor()` maps a number to the certification level (1–6) required to play
it. `modelFor()` maps a number to its `IslandModel`. `genPlayable()` is the
reroll loop (seed, seed+20000, seed+40000, ... capped at +4,000,000) that
finds a seed whose generated island falls in the model's difficulty gate,
then renumbers the result back to the requested key.

## Storage model (`packages/worker/src/islands.ts`)

Two fundamentally different row shapes in the `islands` D1 table, both keyed
by `num`:

- **Dailies/tutorials** — full frozen `CommIsland` JSON stored in the `comm`
  column, written once by `pregen` and never regenerated at serve time
  (`Island.generateFromComm`). Editing a tutorial means editing its source
  JSON under `packages/pregen/resources/maps/`, then
  `import-tutorials` + reload into D1 — the canonical source of truth for
  tutorial content lives in *this* repo, not the retired Kotlin one.
- **Pool/legacy** — only `{num, seed, difficulty, route}` stored; the full
  island is regenerated LIVE on every request via
  `modelFor(num).forNumber(num)` + `Island.gen(seed, model)`
  (`genFromSeedWithoutTest`). Deterministic, so this is safe and avoids
  storing redundant data for the much larger pool number space.

`resolveIsland()` also keeps a per-isolate in-memory LRU (cap 200) in front
of both paths.

## HTTP layer (`packages/worker/src`)

- `index.ts` — routing (`GET /client/getIsland|getDaily|getLevel`,
  `POST /client/execute|explain`, `/og/*` share-image, `/s/*` share pages
  with injected OG meta tags), CORS preflight, 500 envelope.
- `respond.ts` — response envelope + two cache policies: `CACHE_A_DAY`
  (single deterministic `?island=<n>` lookups — a day is safe since the
  content never changes for a given number) vs `NO_STORE` (anything
  randomized per-request, e.g. `?level=` pool picks).
- `cors.ts` — explicit origin allowlist (not a wildcard) — add new client
  origins here before they'll be able to call the API cross-origin.
- `share.ts` / `shareTree.ts` — OG share-card meta injection and image
  generation; mirrored by `og-renderer` for the CPU-ceiling workaround above.

## Deployment topology

Production traffic to `losttemple.duckdns.org` is fronted by nginx on an
Oracle Cloud free-tier VM, which reverse-proxies to the Cloudflare Worker
(setting `X-Forwarded-Host`/`-Proto` so `publicOrigin()` in `index.ts`
builds share URLs under the public domain, not the `*.workers.dev` one) —
except `/og/*`, which nginx routes to the local `og-renderer` service
instead, for the CPU-ceiling reason above. The Worker's D1 binding
(`packages/worker/wrangler.toml`) is the single source of config; `pregen`
and any manual `wrangler` invocation must pass `--config` at it explicitly
since neither `pregen` nor the repo root has its own `wrangler.toml`.

The server was originally written in Kotlin and then ported by Claude.  New code should follow Node/TS patterns not match the Kotlin derived style.
