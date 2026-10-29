import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";

const temporaryDirectories: string[] = [];
const generatorPath = join(dirname(fileURLToPath(import.meta.url)), "..", "generate.sh");

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("dailies ignores legacy level-suffixed files when finding the next batch", () => {
  const directory = mkdtempSync(join(tmpdir(), "losttemple-generate-"));
  temporaryDirectories.push(directory);
  const artifacts = join(directory, "artifacts", "sql");
  const bin = join(directory, "bin");
  mkdirSync(artifacts, { recursive: true });
  mkdirSync(bin);
  copyFileSync(generatorPath, join(directory, "generate.sh"));

  writeFileSync(join(artifacts, "seed-dailies-2026-09-04-2026-09-04-l6.sql"), "-- legacy\n");
  writeFileSync(join(artifacts, "seed-dailies-2026-10-10-2026-10-23.sql"), "-- batch\n");
  writeFileSync(
    join(bin, "npm"),
    "#!/usr/bin/env bash\n" +
      "printf '%s\\n' \"$*\" > npm-arguments.txt\n" +
      "touch artifacts/sql/seed-dailies-2026-10-24-2026-11-06.sql\n",
  );
  chmodSync(join(bin, "npm"), 0o755);

  execFileSync("bash", ["generate.sh", "dailies"], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });

  const argumentsPassed = readFileSync(join(directory, "npm-arguments.txt"), "utf8");
  expect(argumentsPassed).toBe("start -- dailies --from 2026-10-24 --to 2026-11-06\n");
});
