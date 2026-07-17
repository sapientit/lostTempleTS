/**
 * Hex classes and enter/leave effects, ported from game/Land.kt and
 * game/Edge.kt. The class hierarchy is load-bearing: the Kotlin code makes
 * both exact-class checks (`this::class == Land::class` — plain land only)
 * and subclass checks (`is Sea` — includes Coast). Exact-class checks are
 * ported as `x.constructor === Land`, subclass checks as `instanceof`.
 */

import type { Death, Direction, MapItem, Terrain } from "./enums.js";
import { countToWest, isWest, turn } from "./enums.js";
import type { JState } from "./journey.js";

export class Edge {
  east: Land | null = null;
  west: Land | null = null;

  traverse(state: JState): void {
    const nextLand = this.getNext(state.direction);
    nextLand?.enter(state);
  }

  getNext(direction: Direction): Land | null {
    return isWest(direction) ? this.west : this.east;
  }

  /** Swap this edge for [edge] in both endpoint hexes. */
  replaceEdge(edge: Edge): void {
    edge.west = this.west;
    edge.east = this.east;
    this.west?.replaceEdge(this, edge);
    this.east?.replaceEdge(this, edge);
  }

  /** Rewire the endpoint on the far side of [dir] to [land]. */
  replaceLand(dir: Direction, land: Land): void {
    if (isWest(dir)) {
      this.east = land;
    } else {
      this.west = land;
    }
  }
}

/**
 * One-way cliff edge: traversing in the down direction falls (fatal for all
 * but the warrior, who enters the hex below); the up direction is blocked
 * (the walker stays put). The scout ignores cliffs entirely.
 */
export class Cliff extends Edge {
  constructor(readonly westDown: boolean) {
    super();
  }

  override traverse(state: JState): void {
    if (state.role === "scout") return super.traverse(state);
    if (isWest(state.direction) !== this.westDown) {
      return; // blocked uphill: stay put, remaining steps waste against the wall
    }
    state.position = this.getNext(state.direction)!;
    state.addDeath("falling");
    if (state.role === "warrior") {
      state.position.enter(state);
    }
  }
}

export class Land {
  index = 0;
  terrain: Terrain = "hills";
  entry = -1;
  exit = -1;
  x = -1;
  y = -1;
  readonly dirs = new Map<Direction, Edge>();

  get obstacle(): MapItem | null {
    return null;
  }

  addRiver(enter: number, leave: number): void {
    this.entry = enter;
    this.exit = leave;
  }

  enter(state: JState): void {
    state.position = this;
  }

  leave(state: JState): void {
    const edge = this.dirs.get(state.direction);
    if (edge === undefined) {
      state.addDeath("drowning");
    } else {
      edge.traverse(state);
      if (!state.canEnter) {
        // Mountain bounce: the walker did not enter — reverse-facing was set
        // by Mountain.enter; re-enter the hex he left.
        state.canEnter = true;
        this.enter(state);
      }
    }
  }

  replaceEdge(oldEdge: Edge, newEdge: Edge): void {
    for (const [k, v] of this.dirs) {
      if (v === oldEdge) {
        this.dirs.set(k, newEdge);
        return;
      }
    }
  }
}

export class Temple extends Land {
  override get obstacle(): MapItem | null {
    return "temple";
  }
}

export class Water extends Land {
  override enter(state: JState): void {
    state.position = this;
    // Coast is a Sea subclass but has no cliffs: entering a beach hex wades
    // into the water (drowning). Entering open sea goes over the sea cliffs
    // (falling), except the scout who ignores cliffs.
    if (this instanceof Sea && !(this instanceof Coast)) {
      switch (state.role) {
        case "warrior":
          state.addDeath("falling");
          state.addDeath("drowning");
          break;
        case "scout":
          state.addDeath("drowning");
          break;
        default:
          state.addDeath("falling");
      }
    } else {
      state.addDeath("drowning");
    }
  }
}

export class Sea extends Water {}

export class Coast extends Sea {}

export class Guardians extends Land {
  override get obstacle(): MapItem | null {
    return "guardians";
  }
  override enter(state: JState): void {
    state.position = this;
    state.addDeath("sacrificed");
  }
}

export class Trap extends Land {
  override get obstacle(): MapItem | null {
    return "trap";
  }
  override enter(state: JState): void {
    state.position = this;
    state.addDeath("trap");
  }
}

export class Mountain extends Land {
  override get obstacle(): MapItem | null {
    return "mountain";
  }
  override enter(state: JState): void {
    if (state.role === "scout") {
      super.enter(state);
    } else {
      state.direction = turn(state.direction, 3);
      state.canEnter = false;
    }
  }
}

export class Jungle extends Land {
  constructor(public rotate: number) {
    super();
  }
  override get obstacle(): MapItem | null {
    return "jungle";
  }
  override leave(state: JState): void {
    // All roles are affected (the Kotlin scout exemption is commented out).
    state.direction = turn(state.direction, this.rotate);
    super.leave(state);
  }
}

export class Tunnel extends Land {
  override get obstacle(): MapItem | null {
    return "tunnel";
  }
  override leave(state: JState): void {
    const nextEdge = this.dirs.get(state.direction);
    if (nextEdge === undefined) {
      // Kotlin `dirs[state.direction]!!` throws; keep the engine equally strict.
      throw new Error("tunnel leave: no edge in facing direction");
    }
    const nextLand = nextEdge.getNext(state.direction);
    const followEdge = nextLand!.dirs.get(state.direction);
    const followLand = followEdge?.getNext(state.direction) ?? null;
    if (followLand === null) {
      state.addDeath("drowning");
    } else {
      // Dummy "safe" edge straight to the land after the next: the skipped
      // hex and both intervening edges (cliffs included) are bypassed.
      const edge = new Edge();
      edge.east = followLand;
      edge.west = followLand;
      edge.traverse(state);
      if (!state.canEnter) {
        // Destination was a mountain: the bounce drops the walker in the
        // skipped hex with reversed facing.
        state.canEnter = true;
        nextLand!.enter(state);
      }
    }
  }
}

export class Piranhas extends Land {
  entryDir: Direction | undefined;

  override get obstacle(): MapItem | null {
    return "piranhas";
  }

  override enter(state: JState): void {
    state.position = this;
    this.entryDir = state.direction;
    super.enter(state);
  }

  override leave(state: JState): void {
    if (this.entryDir === undefined) {
      // Kotlin lateinit crash parity: starting a walking journey on a piranha
      // hex without entering it is an error, not a silent pass.
      throw new Error("piranhas leave: entryDir not initialised (journey started on river hex)");
    }
    // Piranha crossing formula, verbatim from Land.kt (S§8.4).
    const enter = (15 - countToWest(this.entryDir) - this.entry) % 6; // anticlock from river entry
    const leave = (12 - countToWest(state.direction) - this.entry) % 6;
    const exitPos = (this.exit - this.entry + 6) % 6; // river exit, anticlock from entry
    if ((2 * (exitPos - enter) - 1) * (2 * (exitPos - leave) - 1) < 0) {
      state.addDeath("eaten");
      // The crossing kills mid-hex: the step does not complete — no edge, no
      // next hex — so the death (and any scout report) is in this river hex.
      // The warrior shrugs it off (death stays null) and wades on.
      if (state.death !== null) return;
    }
    super.leave(state);
  }
}

export type { Death };
