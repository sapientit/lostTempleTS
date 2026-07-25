# POST /client/explain

Stateless step-by-step replay of a journey, for visually animating exactly
what happened rather than just the final outcome. Unlike `/client/execute`,
this endpoint never calls `setScore` and writes nothing — it's a pure
read/replay query, safe to call as many times as you like for the same
input.

## Request

Identical to `/client/execute`'s request body — `CommExecute`
(`packages/core/src/comm.ts`). Nothing new, nothing renamed. Reuse it as-is:

```ts
export interface CommExecute {
  score: number;
  prevScore: number;
  num: number;
  mapNum: number;
  role: Role;
  startPos: number;
  startDir?: Direction; // defaults to "w" when absent
  moves?: number[]; // defaults to []
  turns?: number[]; // defaults to []
}
```

`score`/`prevScore` are accepted for shape-compatibility with `execute` but
are otherwise unused by `explain` (no score is written).

## Response

`200 {"status": "ok", "journey": CommExplain}` — same envelope shape as
`/client/execute`'s `{"status": "ok", "journey": CommJourney}`, just with a
richer `journey` payload:

```ts
export interface CommJourney {
  num: number;                // echoed request num
  mapNum: number;              // echoed request mapNum
  role: Role;                  // echoed request role
  position: number;            // final hex index the walker ended on
  death?: Death;                // how the journey ended (always set for the walking roles); omitted only if absent
  direction?: Direction;        // final facing direction
  allDeaths?: Death[];          // warrior only: non-fatal hazards survived along the way (order of first occurrence)
  searchArea?: number[];        // researcher only; never set here (explain rejects researcher)
  percent?: number;             // score percentile; never set here (explain never calls setScore)
}

export interface CommTraceStep {
  kind: "move" | "turn";        // "move" = one hex-step; "turn" = a turn-in-place (no position change)
  position: number;             // hex index after this step
  direction: Direction;         // facing direction after this step
  death?: Death;                // only ever present on the trace's last entry, and only if the journey ended in death
}

export interface CommExplain extends CommJourney {
  trace: CommTraceStep[];       // one entry per hex-move and one entry per turn, in chronological order
}
```

`percent` and `searchArea` are structurally part of `CommJourney` but never
populated by `explain` (no scoring, and `researcher` is rejected outright)
— they simply never appear in an `explain` response.

## Unsupported roles

`explain` only supports the three "walking" roles that actually go through
the moves/turn loop: `arch`, `warrior`, `scout`. The other three
(`balloonist`, `magician`, `researcher`) resolve in one shot server-side and
have no meaningful per-step trace, so they are rejected outright:

```
HTTP 400
{"status": "error", "error": "explain is not supported for role balloonist"}
{"status": "error", "error": "explain is not supported for role magician"}
{"status": "error", "error": "explain is not supported for role researcher"}
```

This check happens before island resolution — do not call `/client/explain`
for these three roles; use `/client/execute` for them instead (client-side,
just skip the replay animation and show the final state directly).

Malformed request bodies (missing fields, unknown role/direction) throw and
surface as the usual `500 {"status": "error", "error": "..."}` envelope,
same as `/client/execute`. An invalid `startPos` for the island (not on the
island, or not a beach hex for a walking role) is a `400
{"status": "error", "error": "Invalid start position"}`, also matching
`/client/execute`.

## Trace semantics for the replay UI

- **`position` can repeat across consecutive entries.** A mountain bounce is
  one `"move"` entry where the hex doesn't change but `direction` reverses
  (the walker bounced off the mountain face and is still standing where it
  started).
- **`position` can skip a hex.** A tunnel entry moves the walker two hexes
  in one `"move"` step (the tunnel hex and the hex directly beyond it are
  both bypassed) — do not assume each entry advances exactly one hex from
  the previous one.
- **A `"turn"` entry never changes `position`.** Only `direction` changes.
- **`death` only ever appears on the final entry of `trace`**, and only if
  the journey actually ended (which, for the three walking roles, it always
  does — either a hazard death, `"success"` for `arch` reaching the temple,
  or `"spiders"` if the supplied moves/turns run out anywhere else).
- Warrior hazard-survival (non-drowning hazards accumulate into
  `allDeaths` without stopping the walk) does **not** produce extra trace
  entries for "survived a hazard" — every hex-step/turn is recorded
  identically regardless of role; only the top-level `allDeaths` array
  (unchanged from `CommJourney`) reflects what the warrior survived.

## Worked example

Request (island 300001's stored route, role `arch`):

```json
{
  "score": 350,
  "prevScore": 1000,
  "num": 7,
  "mapNum": 300001,
  "role": "arch",
  "startPos": 31,
  "startDir": "ne",
  "moves": [3, 1],
  "turns": [5]
}
```

Actual response (from the deployed Worker):

```json
{
  "status": "ok",
  "journey": {
    "num": 7,
    "mapNum": 300001,
    "role": "arch",
    "position": 9,
    "death": "success",
    "direction": "nw",
    "allDeaths": [],
    "trace": [
      { "kind": "move", "position": 26, "direction": "ne" },
      { "kind": "move", "position": 21, "direction": "ne" },
      { "kind": "move", "position": 16, "direction": "ne" },
      { "kind": "turn", "position": 16, "direction": "nw" },
      { "kind": "move", "position": 9, "direction": "nw", "death": "success" }
    ]
  }
}
```

Three hex-steps of the first leg (`moves[0] = 3`), one turn to `nw`
(`turns[0] = 5`, i.e. 5 steps of the 60°-clockwise cycle from `ne`), then
one more hex-step (`moves[1] = 1`) landing on the temple hex — `death:
"success"` attached only to that last entry.

Unsupported-role request/response:

```json
// request
{"score": 0, "prevScore": 0, "num": 1, "mapNum": 300001, "role": "balloonist", "startPos": 31}

// response, HTTP 400
{"status": "error", "error": "explain is not supported for role balloonist"}
```

## Implementation notes

- Core: `Journey.explain(island)` (`packages/core/src/journey.ts`) mirrors
  `Journey.execute()`'s control flow via a shared private
  `runWalkingRoles(current, trace?)` helper (also used by `execute()` with
  `trace` omitted) so the two paths cannot diverge. `Journey.doMoves()`
  takes the same optional trace parameter and pushes one `"move"` entry per
  hex-step. `Journey.createForExplain(execute, island)` mirrors
  `Journey.create()` but returns `{ journey, trace }` instead of running
  `execute()`.
- Worker: `packages/worker/src/routes.ts` exports `explain()`, sharing
  `parseCommExecute()` request-body validation with `execute()`. The
  role-rejection check runs before `resolveIsland()`, so a rejected request
  never touches D1. Wired in `packages/worker/src/index.ts` as `POST
  /client/explain`.
