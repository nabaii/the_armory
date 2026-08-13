import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { LOCAL_DATABASES } from "./revoke";

/**
 * §10: "A lost or stolen tablet can be revoked server-side, and its cached day
 * pack rendered unusable on next launch."
 *
 * revoke.ts wipes the databases named in `LOCAL_DATABASES`. That is only a
 * complete wipe if the list names every database the application actually
 * creates, and nothing in the language checks a list against reality.
 *
 * These two tests are the check. The first is a source-level tripwire: if
 * `indexedDB.open` appears anywhere but src/offline/db.ts, a database can be
 * created without passing through the typed opener, and revocation can silently
 * fall behind the schema. The second confirms the opener's own type is derived
 * from the wipe list rather than duplicating it.
 *
 * A test that reads source is unusual and worth justifying: the property being
 * enforced is "there is exactly one door", which is a fact about the codebase
 * rather than about a value any function returns. The alternative is a lint rule,
 * which is the same assertion in a place fewer people run.
 */

const SOURCE_ROOT = join(process.cwd(), "src");

/**
 * Every application .ts/.tsx file under src.
 *
 * Tests are excluded: they do not ship, cannot create a database on a tablet,
 * and this file names the call it is looking for.
 */
function sourceFiles(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(path);
  }

  return found;
}

describe("one door onto IndexedDB", () => {
  it("only src/offline/db.ts opens a database", () => {
    const offenders = sourceFiles(SOURCE_ROOT)
      .filter((path) => readFileSync(path, "utf8").includes("indexedDB.open("))
      .map((path) => path.slice(process.cwd().length + 1).replace(/\\/g, "/"));

    assert.deepEqual(
      offenders,
      ["src/offline/db.ts"],
      "a database was opened outside the typed opener, so §10's wipe list can " +
        "no longer be trusted to name every local store",
    );
  });

  it("the wipe list is the source of the openable names", () => {
    /* `LocalDatabaseName` is `(typeof LOCAL_DATABASES)[number]`, so this is a
       check that the list is non-empty and that the names are the ones the
       stores actually pass. If a store is renamed, the compiler rejects it at
       the call site; this catches the list being emptied or replaced. */
    assert.deepEqual(
      [...LOCAL_DATABASES].sort(),
      ["armory-daypack", "armory-device", "armory-outbox", "armory-session"],
      "a local store was added or renamed without updating the wipe list",
    );
  });
});
