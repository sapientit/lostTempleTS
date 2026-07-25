/**
 * Journey engine, ported from game/Journey.kt.
 */

import type { CommExecute, CommJourney, CommTraceStep } from "./comm.js";
import type { Death, Direction, Role } from "./enums.js";
import { turn } from "./enums.js";
import type { Land } from "./land.js";
import { Temple } from "./land.js";
import type { Island } from "./island.js";

/** Roles that resolve in one shot and have no meaningful per-step trace. */
const EXPLAIN_UNSUPPORTED_ROLES = new Set<Role>(["balloonist", "magician", "researcher"]);

export class JState {
  canEnter = true;
  death: Death | null = null;
  readonly allDeaths = new Set<Death>();
  searchArea: number[] | null = null;

  constructor(
    public role: Role,
    public position: Land,
    public direction: Direction,
  ) {}

  addDeath(death: Death): void {
    if (this.role === "warrior") {
      if (death === "drowning") {
        // Drowning is the only thing that kills the warrior.
        this.death = death;
      } else {
        this.allDeaths.add(death);
      }
    } else if (this.death === null) {
      // First death wins. Within one step deaths arrive in geographic order
      // (river crossing, then the edge, then the hex entered), so a trap in
      // the hex beyond a piranha river must not overwrite the eaten death.
      this.death = death;
    }
  }

  toComm(mapNum: number, jNum: number): CommJourney {
    return {
      num: jNum,
      mapNum,
      role: this.role,
      position: this.position.index,
      ...(this.death !== null ? { death: this.death } : {}),
      direction: this.direction,
      allDeaths: [...this.allDeaths],
      ...(this.searchArea !== null ? { searchArea: this.searchArea } : {}),
    };
  }
}

export class Journey {
  startPoint = -1;
  startDir!: Direction;
  role!: Role;
  moves: number[] = [];
  turns: number[] = [];
  finalState!: JState;

  constructor(
    readonly mapNum: number = 0,
    readonly journeyNum: number = 0,
  ) {}

  getComm(): CommJourney {
    return this.finalState.toComm(this.mapNum, this.journeyNum);
  }

  /**
   * One doMoves() call is one leg of a route: [number] single hex-steps in
   * the current facing. When [trace] is supplied, one CommTraceStep is
   * appended per hex-step (after it completes), recording where the walker
   * ended up and which way it's facing. Warrior hazard-survival (addDeath
   * accumulating into allDeaths without stopping) is not itself traced —
   * only the position/direction/kind of each step is recorded here; the
   * terminal death (if any) is attached by the caller once the whole
   * journey is over.
   */
  private doMoves(cState: JState, number: number, trace?: CommTraceStep[]): void {
    for (let i = 1; i <= number; i++) {
      cState.position.leave(cState);
      trace?.push({ kind: "move", position: cState.position.index, direction: cState.direction });
      if (cState.death !== null) break;
    }
  }

  /**
   * Shared control flow for the three "walking" roles (arch, warrior,
   * scout): the first leg, then one turn + leg per turns[] entry, then the
   * arrival/timeout death. Used by both execute() (no trace) and explain()
   * (accumulates a CommTraceStep[]) so the two never diverge.
   */
  private runWalkingRoles(current: JState, trace?: CommTraceStep[]): void {
    const firstMove = this.moves[0];
    if (firstMove === undefined) {
      // Kotlin `moves[0]` throws on an empty moves array for walking roles;
      // keep the crash parity (the HTTP layer maps it to a 500).
      throw new Error("journey with empty moves for a walking role");
    }
    this.doMoves(current, firstMove, trace);
    if (current.death === null) {
      for (let i = 0; i < this.turns.length; i++) {
        current.direction = turn(current.direction, this.turns[i]!);
        trace?.push({ kind: "turn", position: current.position.index, direction: current.direction });
        const move = this.moves[i + 1];
        // Kotlin throws IndexOutOfBounds when turns outnumber moves-1.
        if (move === undefined) throw new Error("more turns than moves allow");
        this.doMoves(current, move, trace);
        if (current.death !== null) break;
      }
    }
    if (current.death === null) {
      if (this.role === "arch" && current.position instanceof Temple) {
        current.death = "success";
      } else {
        current.death = "spiders";
      }
    }
  }

  execute(island: Island): void {
    const start = island.indexes.get(this.startPoint);
    if (start === undefined) throw new Error(`no hex ${this.startPoint} on island ${island.num}`);
    const current = new JState(this.role, start, this.startDir);
    if (this.role === "balloonist") {
      island.mapStraight(current);
      current.death = "eagles";
      this.finalState = current;
      return;
    }
    if (this.role === "magician") {
      current.position.enter(current);
      if (current.death !== null) {
        current.death = "spiders";
        this.finalState = current;
        return;
      }
    }
    if (this.role === "researcher") {
      current.searchArea = island.research(current.position);
      current.death = "curse";
      this.finalState = current;
      return;
    }
    this.runWalkingRoles(current);
    this.finalState = current;
  }

  /**
   * Full step-by-step replay for the three walking roles only (arch,
   * warrior, scout) — balloonist/magician/researcher resolve in one shot
   * and have no meaningful per-step trace to build (S§ explain design
   * note). Mirrors execute()'s control flow via runWalkingRoles() and
   * attaches the terminal death (if any) to the trace's last entry only.
   */
  explain(island: Island): CommTraceStep[] {
    if (EXPLAIN_UNSUPPORTED_ROLES.has(this.role)) {
      throw new Error(`explain is not supported for role ${this.role}`);
    }
    const start = island.indexes.get(this.startPoint);
    if (start === undefined) throw new Error(`no hex ${this.startPoint} on island ${island.num}`);
    const current = new JState(this.role, start, this.startDir);
    const trace: CommTraceStep[] = [];
    this.runWalkingRoles(current, trace);
    this.finalState = current;
    if (current.death !== null) {
      // Degenerate input (e.g. moves: [0], turns: []) can finish the walk
      // without ever recording a step; synthesize the one entry so the
      // terminal death still surfaces somewhere in the trace.
      const last = trace[trace.length - 1];
      if (last !== undefined) {
        last.death = current.death;
      } else {
        trace.push({
          kind: "move",
          position: current.position.index,
          direction: current.direction,
          death: current.death,
        });
      }
    }
    return trace;
  }

  /**
   * Journey.create minus the IslandStore lookup (the core is pure): the
   * caller resolves the island and passes it in.
   */
  static create(execute: CommExecute, island: Island): Journey {
    const j = new Journey(execute.mapNum, execute.num);
    j.role = execute.role;
    j.startPoint = execute.startPos;
    j.startDir = execute.startDir ?? "w";
    j.moves = execute.moves?.slice() ?? [];
    j.turns = execute.turns?.slice() ?? [];
    j.execute(island);
    return j;
  }

  /** Same field-setting as create(), but runs explain() instead of execute(). */
  static createForExplain(execute: CommExecute, island: Island): { journey: Journey; trace: CommTraceStep[] } {
    const j = new Journey(execute.mapNum, execute.num);
    j.role = execute.role;
    j.startPoint = execute.startPos;
    j.startDir = execute.startDir ?? "w";
    j.moves = execute.moves?.slice() ?? [];
    j.turns = execute.turns?.slice() ?? [];
    const trace = j.explain(island);
    return { journey: j, trace };
  }
}
