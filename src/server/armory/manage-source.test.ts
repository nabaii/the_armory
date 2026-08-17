import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { sourceFor } from "./manage-source";

/**
 * THE DEMONSTRATION SWITCH, AND THE ONE THING THAT MUST NEVER HAPPEN.
 *
 * Founder's decision, 17 August 2026: in memory, never written, founder only.
 *
 * The failure this file guards against is not a wrong figure. It is a screen
 * rendering REAL data under a banner that says DEMONSTRATION, or invented data
 * under no banner at all — either of which teaches whoever is watching that the
 * banner means nothing, after which the safeguard is decoration.
 */

const NOW = new Date("2026-08-17T12:00:00.000Z");

/* ============================================================================
   IT WRITES NOTHING

   The decisive constraint: participations, charges, custody_events,
   staff_grants, operating_level_events and near_miss_reports are append-only
   with triggers that REFUSE DELETE. A seeded demonstration would be permanent.
   ========================================================================= */

describe("demonstration data never touches the database", () => {
  const source = readFileSync(new URL("./manage-demo.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("imports no database client", () => {
    assert.ok(!/from "@\/db\//.test(code), "manage-demo.ts must not import a db client");
    assert.ok(!/drizzle-orm/.test(code));
  });

  it("contains no write of any kind", () => {
    for (const forbidden of ["insert(", "update(", "delete(", "transaction("]) {
      assert.ok(
        !code.includes(forbidden),
        `manage-demo.ts must not call ${forbidden} — the append-only tables refuse DELETE`,
      );
    }
  });

  it("takes no reader, so it could not query even if asked", () => {
    assert.ok(!/ArmoryReader|ArmoryDb|getArmoryDb/.test(code));
  });
});

/* ============================================================================
   IT IS STABLE

   The management surface is force-dynamic, so every request re-renders. A
   generator using Math.random would reshuffle the roster mid-read and make the
   whole product feel broken.
   ========================================================================= */

describe("the same club every time it is opened", () => {
  const demo = sourceFor(true);

  it("uses no unseeded randomness", () => {
    const source = readFileSync(new URL("./manage-demo.ts", import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/Math\.random/.test(code), "a re-rolling roster reads as a broken product");
  });

  it("returns an identical roster on two reads", async () => {
    const first = await demo.roster();
    const second = await demo.roster();
    assert.deepEqual(first, second);
  });

  it("returns an identical arrivals list within the same day", async () => {
    const first = await demo.arrivals(NOW);
    const second = await demo.arrivals(new Date("2026-08-17T19:30:00.000Z"));
    assert.deepEqual(
      first.map((row) => row.name),
      second.map((row) => row.name),
      "the day's arrivals must not re-sort while somebody is reading them",
    );
  });

  it("moves on to a different day tomorrow", async () => {
    const today = await demo.arrivals(NOW);
    const tomorrow = await demo.arrivals(new Date("2026-08-18T12:00:00.000Z"));
    assert.notDeepEqual(
      today.map((row) => row.name),
      tomorrow.map((row) => row.name),
      "a demonstration frozen on one day looks broken in a different way",
    );
  });
});

/* ============================================================================
   IT IS VISIBLY NOT REAL
   ========================================================================= */

describe("nothing in it can be mistaken for a record", () => {
  const demo = sourceFor(true);

  it("marks every id, so one that escapes finds nothing", async () => {
    const roster = await demo.roster();
    for (const row of roster) {
      assert.ok(
        row.personId.startsWith("demo-"),
        `${row.personId} is not visibly a demonstration id`,
      );
    }
  });

  it("resolves a demonstration person and refuses a real-looking id", async () => {
    const roster = await demo.roster();
    assert.ok(await demo.person(roster[0].personId));
    assert.equal(await demo.person("11111111-1111-4111-8111-111111111111"), null);
  });
});

/* ============================================================================
   IT DOES NOT ANSWER THE FOUNDER'S QUESTION FOR THEM

   §11.2's two numbers exist to falsify a strategy. A demonstration that showed
   F&B dominating would show the founder a club they do not have, and quietly
   answer the question the surface was built to ask.
   ========================================================================= */

describe("the demonstration stays neutral on the strategy", () => {
  const demo = sourceFor(true);

  it("gives F&B a real line without letting it dominate", async () => {
    const charges = await demo.charges(new Date("2026-05-19T00:00:00.000Z"));
    const fnb = charges.filter((row) => row.referenceType === "fnb").length;
    const range = charges.filter((row) => row.referenceType === "booking").length;

    assert.ok(fnb > 0, "the F&B line must not be empty — that is F1's whole point");
    assert.ok(fnb < charges.length / 2, "nor may it dominate");
    assert.ok(range > 0);
  });

  it("shows a non-shooting share that is neither zero nor most of it", async () => {
    const evidence = await demo.visitEvidence(new Date("2026-05-19T00:00:00.000Z"));
    assert.ok(evidence.visits.length > 0);
    assert.ok(evidence.service.length > 0);

    const fired = evidence.visits.filter((row) => row.firedRound).length;
    const share = fired / evidence.visits.length;
    assert.ok(share > 0.5 && share < 0.85, `shooting share was ${share}`);
  });

  it("puts a tail on the check-in clock, so the number can be bad news", async () => {
    const durations = await demo.checkInDurations(NOW);
    assert.ok(durations.some((seconds) => seconds > 15));
    assert.ok(durations.filter((seconds) => seconds > 15).length < durations.length / 2);
  });

  it("reports the club at normal, and never invents a degradation", async () => {
    /* The one value on this surface a staff member might ACT on — telling members
       the range is shut. A demonstration that fabricated it could send somebody
       home. The HISTORY is invented freely, because a history is read. */
    assert.equal(await demo.currentLevel(), "normal");
    assert.ok((await demo.levelHistory(new Date("2026-05-19T00:00:00.000Z"))).length > 0);
  });

  it("leaves applications unowned, which is the state §8.2 is about", async () => {
    const applications = await demo.applications(NOW);
    assert.ok(applications.some((row) => row.ownerStaffId === null));
    assert.ok(applications.some((row) => row.ageDays > 14), "and some of them old");
  });

  it("puts lapsed items in the expiry register, which is what §9.3 is for", async () => {
    const expiries = await demo.expiries(NOW, 90);
    assert.ok(expiries.some((row) => row.daysRemaining < 0));
  });

  it("files near-misses both named and anonymous", async () => {
    const reports = await demo.nearMisses(new Date("2026-05-19T00:00:00.000Z"));
    assert.ok(reports.some((row) => row.reportedByStaffId !== null));
    assert.ok(reports.some((row) => row.reportedByStaffId === null));
  });
});

/* ============================================================================
   NO SCREEN MAY READ PAST THE RESOLVER

   The structural safeguard. A page holding a database client can render real
   data under the demonstration banner, and the banner is the only thing
   standing between a founder and a board meeting held on invented figures.
   ========================================================================= */

describe("every management screen reads through the source", () => {
  const root = new URL("../../app/(manage)/", import.meta.url).pathname;

  const pages = (function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return walk(path);
      return path.endsWith(".tsx") ? [path] : [];
    });
  })(root);

  it("finds the screens", () => {
    assert.ok(pages.length >= 7, `found only ${pages.length} files under (manage)`);
  });

  for (const page of pages) {
    const name = page.slice(root.length);

    it(`${name} holds no database client`, () => {
      const code = readFileSync(page, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");

      assert.ok(
        !/getArmoryDb|ArmoryReader|drizzle-orm/.test(code),
        `${name} reaches for a database directly, bypassing the demonstration switch`,
      );
    });
  }
});
