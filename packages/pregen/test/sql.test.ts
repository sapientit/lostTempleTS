import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { islandsInsertSql, metaUpsertSql, poolInsertSql, sqlQuote } from "../src/sql.js";
import type { CommRow, MappingRow } from "../src/gen.js";

const SCHEMA = `
CREATE TABLE islands (
  num INTEGER PRIMARY KEY, kind TEXT NOT NULL, seed INTEGER,
  difficulty INTEGER NOT NULL, route TEXT, comm TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (seed IS NOT NULL OR comm IS NOT NULL));
CREATE TABLE pool (level INTEGER NOT NULL, k INTEGER NOT NULL, num INTEGER NOT NULL,
  PRIMARY KEY (level, k)) WITHOUT ROWID;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

function mapping(num: number): MappingRow {
  return {
    num,
    kind: "level",
    seed: num + 20000,
    difficulty: 7,
    route: { startPos: 3, startDir: "se", distance: [4, 2], turn: [2] },
  };
}

describe("sqlQuote", () => {
  it("escapes single quotes", () => {
    expect(sqlQuote("O'Brien")).toBe("'O''Brien'");
    expect(sqlQuote("no quotes")).toBe("'no quotes'");
    expect(sqlQuote("''")).toBe("''''''");
  });

  it("rejects NUL bytes", () => {
    expect(() => sqlQuote("a\0b")).toThrow();
  });
});

describe("emitted SQL round-trips through real SQLite", () => {
  it("islands mapping + comm rows survive load and reload", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(SCHEMA);
    const commRow: CommRow = {
      num: 1000197,
      kind: "daily",
      difficulty: 42,
      // Deliberately awkward JSON: quotes inside strings.
      comm: {
        mapNum: 1000197,
        rows: 6,
        hexes: [],
        obstacles: [],
        rivers: [],
        cliffs: [],
        difficulty: 42,
        roles: [{ role: "arch", cost: 100 }],
        route: { startPos: 1, startDir: "w", distance: [1], turn: [] },
      },
    };
    const sql = islandsInsertSql([mapping(300001), commRow], 1);
    expect(sql.split("INSERT OR REPLACE INTO islands").length - 1).toBe(2); // batch=1 -> 2 stmts
    db.exec(sql);
    // Idempotent: run again, still one row each.
    db.exec(sql);
    const m = db.prepare("SELECT * FROM islands WHERE num = 300001").get() as Record<string, unknown>;
    expect(m["kind"]).toBe("level");
    expect(m["seed"]).toBe(320001);
    expect(m["comm"]).toBeNull();
    expect(JSON.parse(m["route"] as string)).toEqual(mapping(300001).route);
    const d = db.prepare("SELECT * FROM islands WHERE num = 1000197").get() as Record<string, unknown>;
    expect(d["seed"]).toBeNull();
    expect(d["route"]).toBeNull();
    expect(JSON.parse(d["comm"] as string)).toEqual(commRow.comm);
    expect(db.prepare("SELECT COUNT(*) AS c FROM islands").get()).toMatchObject({ c: 2 });
  });

  it("pool rows are dense from the start offset", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(SCHEMA);
    db.exec(poolInsertSql(3, [300010, 300011, 300012], 10, 2));
    const rows = db.prepare("SELECT level, k, num FROM pool ORDER BY k").all();
    expect(rows).toEqual([
      { level: 3, k: 10, num: 300010 },
      { level: 3, k: 11, num: 300011 },
      { level: 3, k: 12, num: 300012 },
    ]);
  });

  it("meta upserts overwrite on re-run", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(SCHEMA);
    db.exec(metaUpsertSql({ daily_counter_1: "1000005", schema_version: "1" }));
    db.exec(metaUpsertSql({ daily_counter_1: "1000009" }));
    const rows = db.prepare("SELECT key, value FROM meta ORDER BY key").all();
    expect(rows).toEqual([
      { key: "daily_counter_1", value: "1000009" },
      { key: "schema_version", value: "1" },
    ]);
  });
});
