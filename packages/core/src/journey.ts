/**
 * Journey engine, ported from game/Journey.kt.
 */

import type { CommExecute, CommJourney } from "./comm.js";
import type { Death, Direction, Role } from "./enums.js";
import { turn } from "./enums.js";
import type { Land } from "./land.js";
import { Temple } from "./land.js";
import type { Island } from "./island.js";

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

  private doMoves(cState: JState, number: number): void {
    for (let i = 1; i <= number; i++) {
      cState.position.leave(cState);
      if (cState.death !== null) break;
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
    const firstMove = this.moves[0];
    if (firstMove === undefined) {
      // Kotlin `moves[0]` throws on an empty moves array for walking roles;
      // keep the crash parity (the HTTP layer maps it to a 500).
      throw new Error("journey with empty moves for a walking role");
    }
    this.doMoves(current, firstMove);
    if (current.death === null) {
      for (let i = 0; i < this.turns.length; i++) {
        current.direction = turn(current.direction, this.turns[i]!);
        const move = this.moves[i + 1];
        // Kotlin throws IndexOutOfBounds when turns outnumber moves-1.
        if (move === undefined) throw new Error("more turns than moves allow");
        this.doMoves(current, move);
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
    this.finalState = current;
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
}
