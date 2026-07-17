/**
 * Island generation, difficulty search and comm construction, ported from
 * game/Island.kt. The ORDER of PortableRandom draws is part of the island
 * definition (SPEC §4.3-4.6) — every draw below mirrors the Kotlin code
 * draw-for-draw, including draws made by failed placement attempts.
 *
 * One deliberate divergence, documented in SPEC §7: the choice among TIED
 * best routes in testPossible depends on JVM hash iteration order in Kotlin
 * and is explicitly non-canonical. Here beaches iterate in ascending index
 * order (insertion order of the Set) and start directions in the fixed enum
 * order e, w, ne, nw, se, sw. Difficulty is an order-independent sum and
 * matches Kotlin exactly; the tied-route choice is deterministic in TS but
 * may differ from any given JVM run.
 */

import type {
  CommCliff,
  CommHex,
  CommIsland,
  CommLand,
  CommRiver,
  CommRole,
  CommRoute,
} from "./comm.js";
import type { Death, Direction, MapItem, Role, Terrain } from "./enums.js";
import { ALL_DIRECTIONS, ALL_ROLES, isWest, countToWest, turn, REVERSE } from "./enums.js";
import type { IslandModel } from "./model.js";
import { Journey, JState } from "./journey.js";
import {
  Cliff,
  Coast,
  Edge,
  Guardians,
  Jungle,
  Land,
  Mountain,
  Piranhas,
  Sea,
  Temple,
  Trap,
  Tunnel,
} from "./land.js";
import { PortableRandom } from "./random.js";

interface Offset {
  dr: number;
  dc: number;
}

/** Maps a MapItem back to generateObstacle's type number. */
function typeIndex(item: MapItem): number {
  switch (item) {
    case "tunnel":
      return 0;
    case "mountain":
      return 1;
    case "jungle":
      return 2;
    case "guardians":
      return 3;
    case "trap":
      return 4;
    case "piranhas":
      return 5;
    case "temple":
      throw new Error("temple is not a generated obstacle");
  }
}

const EVEN_OFFSETS: ReadonlyArray<[Direction, Offset]> = [
  ["e", { dr: 0, dc: 1 }],
  ["w", { dr: 0, dc: -1 }],
  ["ne", { dr: -1, dc: 0 }],
  ["nw", { dr: -1, dc: -1 }],
  ["se", { dr: 1, dc: 0 }],
  ["sw", { dr: 1, dc: -1 }],
];

const ODD_OFFSETS: ReadonlyArray<[Direction, Offset]> = [
  ["e", { dr: 0, dc: 1 }],
  ["w", { dr: 0, dc: -1 }],
  ["ne", { dr: -1, dc: 1 }],
  ["nw", { dr: -1, dc: 0 }],
  ["se", { dr: 1, dc: 1 }],
  ["sw", { dr: 1, dc: 0 }],
];

export class Island {
  readonly rand: PortableRandom;
  readonly cliffs: Array<[number, Direction]> = [];

  map: Array<Array<Land | null>> = [];
  readonly indexes = new Map<number, Land>();
  readonly beaches = new Set<number>();
  readonly seas = new Set<number>();

  readonly hills: number[] = [];
  readonly forests: number[] = [];
  readonly obstacles: MapItem[] = [];
  readonly rivers: CommRiver[] = [];
  difficulty = 0;
  // The best route testPossible found to the temple: fewest steps walked,
  // then fewest turns. A route that bounces off a mountain walks there and
  // back, so its endpoint is always reachable in fewer steps - minimising
  // steps keeps confusing bounce routes out of the stored route.
  route: CommRoute | null = null;
  private routeSteps = Number.MAX_SAFE_INTEGER;
  private routeTurns = Number.MAX_SAFE_INTEGER;
  commIsland!: CommIsland;
  roles!: CommRole[];

  constructor(readonly num: number) {
    // Portable generator so island numbers survive any future port; the
    // draw order below is part of the island definition - see PortableRandom.
    this.rand = new PortableRandom(num);
  }

  createRand(sizes: number[], blanks: number[], fixedRoles: ReadonlyMap<Role, number> | null): void {
    const rows = sizes.length + 2;

    // Find widest row including sea at each end
    let maxCols = 0;
    for (let r = 0; r < sizes.length; r++) {
      const width = blanks[r]! + sizes[r]! + 2;
      maxCols = Math.max(maxCols, width);
    }
    // Top/bottom sea rows are indented relative to row 1
    maxCols++;

    this.map = Array.from({ length: rows }, () =>
      Array.from({ length: maxCols + 2 }, () => null as Land | null),
    );
    this.buildLands(sizes, blanks);
    this.buildSeas();
    // Roughly half the plain land becomes forest. Must happen before
    // obstacles are generated so jungles and traps have forest to spawn on.
    // One nextBoolean per exact-Land cell in row-major order (this includes
    // future temple/beach hexes - they have not been replaced yet).
    for (const row of this.map) {
      for (const cell of row) {
        if (cell !== null && cell.constructor === Land && this.rand.nextBoolean()) {
          cell.terrain = "forest";
        }
      }
    }
    // Level maps fix the roster and costs outright; absent roles are
    // unavailable. This branch draws nothing from rand.
    if (fixedRoles !== null) {
      this.roles = ALL_ROLES.map((role) => ({ role, cost: fixedRoles.get(role) ?? -1 }));
      return;
    }
    // Specialist costs: arch is always 100 and magician always -1 (not in
    // the game yet). On 10% of maps one of the other four is unavailable;
    // the rest cost 50-250, with at least one available non-arch specialist
    // guaranteed <= 100.
    const others = this.rand.shuffled<Role>(["warrior", "balloonist", "researcher", "scout"]);
    const unavailable = this.rand.nextInt(10) === 0 ? others.slice(0, 1) : [];
    const costs = new Map<Role, number>();
    for (const role of others) {
      costs.set(role, unavailable.includes(role) ? -1 : 50 + this.rand.nextInt(201));
    }
    const available = others.filter((r) => costs.get(r) !== -1);
    if (!available.some((r) => costs.get(r)! <= 100)) {
      costs.set(available[this.rand.nextInt(available.length)]!, 50 + this.rand.nextInt(51));
    }
    this.roles = ALL_ROLES.map((role) => ({
      role,
      cost: role === "arch" ? 100 : role === "magician" ? -1 : costs.get(role)!,
    }));
  }

  toComm(): CommIsland {
    return this.commIsland;
  }

  buildLands(sizes: number[], blanks: number[]): void {
    for (let i = 0; i < sizes.length; i++) {
      for (let j = 0; j < sizes[i]!; j++) {
        this.map[i + 1]![j + blanks[i]! + 2] = new Land();
      }
    }
  }

  buildSeas(): void {
    const isLand = (row: number, col: number): boolean => {
      const cell = this.map[row]?.[col];
      return cell != null && cell.constructor === Land;
    };
    for (let i = 0; i < this.map.length; i++) {
      const offset = (i % 2) - 1;
      const row = this.map[i]!;
      for (let j = 1; j < row.length - 1; j++) {
        // 0 and last are definitely empty
        if (isLand(i, j)) continue;
        if (
          isLand(i, j - 1) ||
          isLand(i, j + 1) ||
          (i > 0 && (isLand(i - 1, j + offset) || isLand(i - 1, j + 1 + offset))) ||
          (i < this.map.length - 1 && (isLand(i + 1, j + offset) || isLand(i + 1, j + 1 + offset)))
        ) {
          row[j] = new Sea();
        }
      }
    }
  }

  buildHexes(comm: CommIsland): void {
    this.map = Array.from({ length: comm.rows }, () =>
      Array.from({ length: 15 }, () => null as Land | null),
    );
    for (const hex of comm.hexes) {
      let cell: Land;
      if (hex.terrain === "sea") {
        cell = new Sea();
      } else if (hex.terrain === "coast") {
        cell = new Coast();
      } else {
        // Land defaults to hills; keep the transmitted terrain (forest,
        // temple) rather than losing it on rebuild.
        cell = new Land();
        if (hex.terrain != null) cell.terrain = hex.terrain;
      }
      this.map[hex.x]![hex.y] = cell;
    }
  }

  replaceLandAt(x: number, y: number, newObj: () => Land): void {
    const prev = this.map[x]!;
    const prevObj = prev[y]!;
    const newLand = newObj();
    newLand.terrain = prevObj.terrain;
    prev[y] = newLand;
    for (const [k, v] of prevObj.dirs) {
      newLand.dirs.set(k, v);
      v.replaceLand(k, newLand);
    }
    newLand.index = prevObj.index;
    newLand.x = prevObj.x;
    newLand.y = prevObj.y;
    newLand.entry = prevObj.entry;
    newLand.exit = prevObj.exit;

    this.indexes.set(newLand.index, newLand);
  }

  replaceLand(land: Land, newObj: () => Land): void {
    this.replaceLandAt(land.x, land.y, newObj);
  }

  addEdges(): void {
    for (let r = 0; r < this.map.length; r++) {
      const row = this.map[r]!;
      for (let c = 0; c < row.length; c++) {
        const from = row[c];
        if (from == null) continue;
        const offsets = r % 2 === 0 ? EVEN_OFFSETS : ODD_OFFSETS;

        for (const [dir, off] of offsets) {
          const nr = r + off.dr;
          const nc = c + off.dc;
          const to = this.map[nr]?.[nc];
          if (to == null) continue;

          // rule: no Sea <-> Sea
          if (from instanceof Sea && to instanceof Sea) continue;

          // CRITICAL: prevent duplicates
          if (isWest(dir)) continue;

          const edge = new Edge();
          edge.west = from;
          edge.east = to;
          from.dirs.set(dir, edge);
          to.dirs.set(REVERSE[dir], edge);
        }
      }
    }
  }

  buildIndexes(): void {
    let nextIndex = 1;
    for (let i = 0; i < this.map.length; i++) {
      const row = this.map[i]!;
      for (let j = 0; j < row.length; j++) {
        const cell = row[j];
        if (cell == null) continue;
        cell.index = nextIndex++;
        this.indexes.set(cell.index, cell);
        cell.x = i;
        cell.y = j;
      }
    }
  }

  finalise(): void {
    // Get beaches and seas. Note: Coast is a Sea subclass, so beach hexes
    // land in BOTH sets, exactly as in Kotlin.
    for (const row of this.map) {
      for (const col of row) {
        if (col == null) continue;
        if (col instanceof Coast) this.beaches.add(col.index);
        if (col instanceof Sea) this.seas.add(col.index);
      }
    }
  }

  finaliseComm(): void {
    const cliffList: CommCliff[] = this.cliffs.map(([land, direction]) => ({ land, direction }));
    const commLand: CommLand[] = [];
    for (const row of this.map) {
      for (const cell of row) {
        if (cell == null || cell instanceof Sea) continue;
        if (cell.terrain === "forest") this.forests.push(cell.index);
        else this.hills.push(cell.index);
        const mapItem = cell.obstacle;
        if (mapItem !== null) {
          this.obstacles.push(mapItem);
          commLand.push({
            index: cell.index,
            type: mapItem,
            ...(cell instanceof Jungle ? { jungleDir: cell.rotate } : {}),
          });
        }
      }
    }
    const hexes: CommHex[] = [];
    for (const row of this.map) {
      for (const hex of row) {
        if (hex == null) continue;
        hexes.push({
          index: hex.index,
          x: hex.x,
          y: hex.y,
          terrain: hex instanceof Sea ? (hex instanceof Coast ? "coast" : "sea") : hex.terrain,
          directions: hex instanceof Sea ? [...hex.dirs.keys()] : null,
        });
      }
    }
    this.commIsland = {
      mapNum: this.num,
      rows: this.map.length,
      hexes,
      obstacles: commLand,
      rivers: this.rivers,
      cliffs: cliffList,
      difficulty: this.difficulty,
      roles: this.roles,
      ...(this.route !== null ? { route: this.route } : {}),
    };
  }

  generateObstacle(allowed: readonly MapItem[] | null): MapItem | null {
    const n = this.indexes.size;
    if (allowed !== null && allowed.length === 0) return null;

    // With no restriction the draw must stay rand.nextInt(6) so that all
    // pre-level islands regenerate identically from their seeds.
    const type =
      allowed === null
        ? this.rand.nextInt(6)
        : typeIndex(allowed[this.rand.nextInt(allowed.length)]!);

    // 0 tunnel / 1 mountain / 2 jungle / 3 guardians / 4 trap / 5 piranhas
    for (let i = 1; i <= 50; i++) {
      const target = this.indexes.get(this.rand.nextInt(n) + 1)!;
      if (target.constructor !== Land) continue;

      switch (type) {
        case 0: {
          if (target.terrain !== "hills") continue;
          this.replaceLand(target, () => new Tunnel());
          return "tunnel";
        }
        case 1: {
          if (target.terrain !== "hills") continue;
          this.replaceLand(target, () => new Mountain());
          return "mountain";
        }
        case 2: {
          if (target.terrain !== "forest") continue;
          const rotate = this.rand.nextBoolean() ? 1 : 5;
          this.replaceLand(target, () => new Jungle(rotate));
          return "jungle";
        }
        case 3: {
          // The direction draw happens on EVERY attempt that reaches this
          // branch, even ones that then fail — draw order is normative.
          const dir = turn("e", this.rand.nextInt(3)); // e, se or sw
          const otherLand = this.dirs(target, dir);
          if (otherLand === null) continue;
          if (otherLand.constructor === Land) {
            this.replaceLand(target, () => new Guardians());
            this.replaceLand(otherLand, () => new Guardians());
            return "guardians";
          }
          break;
        }
        case 4: {
          if (target.terrain !== "forest") continue;
          this.replaceLand(target, () => new Trap());
          return "trap";
        }
        case 5: {
          if (target.entry >= 0 && target.exit >= 0) {
            this.replaceLand(target, () => new Piranhas());
            return "piranhas";
          }
          break;
        }
      }
    }
    return null;
  }

  /** target.dirs[dir]?.getNext(dir) */
  private dirs(target: Land, dir: Direction): Land | null {
    return this.mapEdge(target, dir)?.getNext(dir) ?? null;
  }

  private mapEdge(target: Land, dir: Direction): Edge | undefined {
    return target.dirs.get(dir);
  }

  generateCliff(): void {
    const n = this.indexes.size;
    // A cliff is 3 long and a fixed zigzag. It cannot go out to sea and
    // cannot cross a river (but can be partially on the coast).
    for (let i = 1; i <= 50; i++) {
      // Try a fixed number of times in case the map makes it impossible.
      const target = this.indexes.get(this.rand.nextInt(n) + 1)!;
      if (target instanceof Sea) continue;
      const dir = turn("w", this.rand.nextInt(6));
      const edge1 = target.dirs.get(dir);
      if (edge1 === undefined) throw new Error("cliff target missing edge"); // Kotlin !! parity
      const otherLand = edge1.getNext(dir);
      if (otherLand === null) throw new Error("cliff edge missing endpoint"); // Kotlin !! parity
      if (otherLand instanceof Sea) continue;
      if (edge1.constructor !== Edge) continue; // already a cliff
      const count1 = countToWest(dir);
      if (count1 === target.entry || count1 === target.exit) continue; // crosses river
      edge1.replaceEdge(new Cliff(isWest(dir)));

      // Comm form is (high hex, downhill direction): the hex you fall FROM
      // and the way you fall. generateFromComm rebuilds westDown from the
      // direction, so the cliff falls the same way after a round trip
      // through JSON.
      this.cliffs.push([target.index, dir]);
      return;
    }
  }

  addRiverComm(river: CommRiver): void {
    this.addRiver(river.startLand, river.startEntry, river.lands, river.exit);
  }

  addRiver(startLand: number, startEntry: number, lands: number[], exits: number[]): void {
    let current = this.indexes.get(startLand)!;
    current.entry = startEntry;
    current.exit = exits[0]!;
    for (let i = 0; i < lands.length; i++) {
      const next = lands[i]!;
      // Each exit gives 2 possible next lands; look at the right-hand option.
      const dir = turn("w", exits[i]!);
      const tryLand = this.dirs(current, dir);
      if (tryLand === null) throw new Error("river runs off the map"); // Kotlin !! parity
      // 5 exit becomes 3 entry or 1 entry; 4 exit becomes 2 entry or 0 entry etc.
      const entry = (tryLand.index === next ? exits[i]! + 4 : exits[i]! + 2) % 6;
      current = this.indexes.get(next)!;
      current.entry = entry;
      current.exit = exits[i + 1]!;
    }
    this.rivers.push({ startLand, startEntry, lands, exit: exits.slice() });
  }

  testPossible(): number {
    let result = 0;
    const journey = new Journey();
    journey.role = "arch";
    // Beaches iterate in ascending-index insertion order; start directions
    // in the fixed enum order e, w, ne, nw, se, sw. Kotlin's HashSet/HashMap
    // order here is non-canonical (route tie-breaks only; the difficulty sum
    // is order-independent).
    for (const beach of this.beaches) {
      const start = this.indexes.get(beach)!;
      journey.startPoint = beach;
      for (const dir of ALL_DIRECTIONS) {
        if (!start.dirs.has(dir)) continue;
        journey.startDir = dir;
        result += this.testPossStart(journey);
      }
    }
    return result;
  }

  testPossStart(journey: Journey): number {
    return this.testMoves(journey, [], []);
  }

  execJourney(journey: Journey, moves: number[], turns: number[]): Death | null {
    journey.moves = moves.slice();
    journey.turns = turns.slice();
    journey.execute(this);
    return journey.finalState.death;
  }

  testTurn(journey: Journey, moves: number[], turns: number[]): number {
    let result = 0;
    if (turns.length === 3) return 0;
    for (const t of [1, 2, 4, 5]) {
      turns.push(t);
      result += this.testMoves(journey, moves, turns);
      turns.pop();
    }
    return result;
  }

  testMoves(journey: Journey, moves: number[], turns: number[]): number {
    let result = 0;
    for (let i = 1; i <= 8; i++) {
      moves.push(i);
      const death = this.execJourney(journey, moves, turns);
      if (death === "success") {
        const steps = moves.reduce((a, b) => a + b, 0);
        if (steps < this.routeSteps || (steps === this.routeSteps && turns.length < this.routeTurns)) {
          this.routeSteps = steps;
          this.routeTurns = turns.length;
          this.route = {
            startPos: journey.startPoint,
            startDir: journey.startDir,
            distance: moves.slice(),
            turn: turns.slice(),
          };
        }
        result += turns.length === 0 ? 100 : turns.length === 1 ? 50 : turns.length === 2 ? 8 : 1;
        moves.pop();
        break;
      }
      if (death !== "spiders") {
        moves.pop();
        break;
      }
      result += this.testTurn(journey, moves, turns);
      moves.pop();
    }
    return result;
  }

  mapStraight(state: JState): void {
    let current = state.position;
    const result = [state.position.index];
    let edge = current.dirs.get(state.direction);
    while (edge !== undefined) {
      current = edge.getNext(state.direction)!;
      result.push(current.index);
      edge = current.dirs.get(state.direction);
    }
    state.searchArea = result;
  }

  research(centre: Land): number[] {
    const result = [centre.index];
    for (const [dir, edge] of centre.dirs) {
      const next = edge.getNext(dir);
      if (next !== null) result.push(next.index);
    }
    return result;
  }

  static gen(mapNum: number, model: IslandModel): Island {
    const island = new Island(mapNum);
    island.createRand(model.size, model.blanks, model.fixedRoles);
    island.buildIndexes();
    island.addEdges();
    island.replaceLandAt(model.templeX, model.templeY, () => new Temple());
    // replaceLand keeps the previous terrain, so mark the temple hex
    // explicitly for the client's terrain rendering.
    island.map[model.templeX]![model.templeY]!.terrain = "temple";
    for (let i = 0; i < model.beachesX.length; i++) {
      island.replaceLandAt(model.beachesX[i]!, model.beachesY[i]!, () => new Coast());
    }
    for (const river of model.river) {
      island.addRiverComm(river);
    }
    for (let i = 0; i < model.obstacles; i++) {
      island.generateObstacle(model.allowedObstacles);
    }
    for (let i = 0; i < model.cliffs; i++) {
      island.generateCliff();
    }
    island.finalise();
    island.difficulty = island.testPossible();
    island.finaliseComm();
    return island;
  }

  static generateFromComm(comm: CommIsland): Island {
    const island = new Island(comm.mapNum);
    island.roles = comm.roles;
    island.buildHexes(comm);
    island.buildIndexes();
    island.addEdges();
    for (const river of comm.rivers) {
      island.addRiverComm(river);
    }
    for (const cliff of comm.cliffs) {
      const land = island.indexes.get(cliff.land);
      if (land === undefined) throw new Error(`cliff on missing hex ${cliff.land}`);
      const edge = land.dirs.get(cliff.direction);
      if (edge === undefined) throw new Error(`cliff on missing edge ${cliff.land}/${cliff.direction}`);
      edge.replaceEdge(new Cliff(isWest(cliff.direction)));
    }
    for (const obstacle of comm.obstacles) {
      const land = island.indexes.get(obstacle.index)!;
      island.replaceLand(land, () => {
        switch (obstacle.type) {
          case "trap":
            return new Trap();
          case "tunnel":
            return new Tunnel();
          case "piranhas":
            return new Piranhas();
          case "temple":
            return new Temple();
          case "jungle":
            return new Jungle(obstacle.jungleDir!);
          case "guardians":
            return new Guardians();
          case "mountain":
            return new Mountain();
          default:
            return new Land();
        }
      });
    }
    island.finalise();
    island.difficulty = comm.difficulty;
    island.commIsland = comm;
    return island;
  }
}
