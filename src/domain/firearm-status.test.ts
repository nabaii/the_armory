import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CUSTODY_EVENT_TYPES, FIREARM_STATUSES } from "./enums";
import { deriveFirearmStatus, isIssuable } from "./state-machines";

/**
 * §3.4, quoted because it is where the specification raises its voice:
 *
 *   "custody_events is append-only and is the sole source of truth for where any
 *    firearm is. Firearm status is derived from it, not maintained independently
 *    — IF THE TWO CAN DISAGREE, THEY EVENTUALLY WILL."
 *
 * ===========================================================================
 * THE DERIVATION EXISTS TWICE AND NOTHING WAS CHECKING THAT THEY AGREE
 *
 * src/domain/state-machines.ts carries a warning above `STATUS_BY_EVENT`:
 *
 *   "⚠ THIS FUNCTION IS IMPLEMENTED TWICE, ON PURPOSE. Here in TypeScript, so
 *    the desk can show a firearm's status offline from the day pack; and in
 *    PL/pgSQL in drizzle/0002_armory_enforcement.sql, so the database maintains
 *    firearms.status itself and no application code can write it. The two must
 *    agree."
 *
 * drizzle/0002 carries the same warning pointing back. Two comments asking
 * future authors to remember something is not a mechanism — it is a hope, and
 * §3.4's sentence is precisely about what happens to two things that can
 * disagree.
 *
 * So this test reads the migration and compares the mapping. It fails if either
 * side gains, loses or changes a row. That turns "the two must agree" from an
 * instruction into a property of the build.
 */

const MIGRATION = join(
  process.cwd(),
  "drizzle",
  "0002_armory_enforcement.sql",
);

/**
 * Pull the CASE arms out of `armory.derive_firearm_status`.
 *
 * Deliberately narrow: it reads only inside that function, so an unrelated CASE
 * elsewhere in a 700-line migration cannot satisfy or break this test.
 */
function sqlMapping(): Map<string, string> {
  const sql = readFileSync(MIGRATION, "utf8");

  const start = sql.indexOf("CREATE OR REPLACE FUNCTION armory.derive_firearm_status");
  assert.notEqual(
    start,
    -1,
    "derive_firearm_status is gone from drizzle/0002 — the database is no longer deriving status, which §3.4 forbids",
  );

  const body = sql.slice(start, sql.indexOf("$$;", start));
  const mapping = new Map<string, string>();

  for (const [, event, status] of body.matchAll(
    /WHEN\s+'([a-z_]+)'\s+THEN\s+'([a-z_]+)'/g,
  )) {
    mapping.set(event, status);
  }

  return mapping;
}

describe("the derivation agrees with the database", () => {
  it("maps every event type the same way in both implementations", () => {
    const sql = sqlMapping();

    for (const eventType of CUSTODY_EVENT_TYPES) {
      /* A correction is not a state — §1.2 rule 3 makes it a row that withdraws
         another, and both implementations exclude it from the derivation rather
         than mapping it to a status. */
      if (eventType === "correction") continue;

      const fromTypeScript = deriveFirearmStatus([
        {
          id: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
          eventType,
          occurredAt: new Date("2026-08-13T10:00:00.000Z"),
          correctsEventId: null,
        },
      ]);

      assert.equal(
        fromTypeScript,
        sql.get(eventType),
        `'${eventType}' derives differently in TypeScript and in drizzle/0002 — ` +
          "the desk and the database would disagree about where a firearm is",
      );
    }
  });

  it("covers every event type the schema allows", () => {
    /* The failure this catches: someone adds a custody event type to the enum
       and to one derivation but not the other. The new type would then read as
       `in_service` on whichever side forgot it — which for a firearm that has
       just left the building is the most dangerous possible default. */
    const sql = sqlMapping();
    const expected = CUSTODY_EVENT_TYPES.filter((type) => type !== "correction");

    assert.deepEqual(
      [...sql.keys()].sort(),
      [...expected].sort(),
      "drizzle/0002 and CUSTODY_EVENT_TYPES have drifted apart",
    );
  });

  it("produces only statuses the schema allows", () => {
    const sql = sqlMapping();

    for (const [event, status] of sql) {
      assert.ok(
        (FIREARM_STATUSES as readonly string[]).includes(status),
        `drizzle/0002 maps '${event}' to '${status}', which is not a firearm status`,
      );
    }
  });
});

describe("what the derivation does with corrections", () => {
  const at = (iso: string) => new Date(iso);

  it("ignores an event that a later correction withdrew", () => {
    /* §1.2 rule 3: "a correction is a new row referencing the old one." Both
       implementations exclude corrected events, and this is the case where
       getting it wrong leaves a firearm reading as issued to somebody who never
       had it. */
    const status = deriveFirearmStatus([
      {
        id: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
        eventType: "issued",
        occurredAt: at("2026-08-13T10:00:00.000Z"),
        correctsEventId: null,
      },
      {
        id: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c",
        eventType: "correction",
        occurredAt: at("2026-08-13T10:05:00.000Z"),
        correctsEventId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      },
    ]);

    /* Nothing left to derive from, so the default — which both sides spell
       `in_service`. */
    assert.equal(status, "in_service");
  });

  it("takes the latest surviving event", () => {
    const status = deriveFirearmStatus([
      {
        id: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
        eventType: "issued",
        occurredAt: at("2026-08-13T10:00:00.000Z"),
        correctsEventId: null,
      },
      {
        id: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c",
        eventType: "returned",
        occurredAt: at("2026-08-13T12:00:00.000Z"),
        correctsEventId: null,
      },
    ]);

    assert.equal(status, "in_service");
  });

  it("defaults to in_service for a firearm with no custody history", () => {
    /* A newly registered firearm. Both implementations COALESCE to the same
       value, and the test exists because a null here would make `isIssuable`
       throw on the first firearm the club ever adds. */
    assert.equal(deriveFirearmStatus([]), "in_service");
  });
});

describe("what may be handed over", () => {
  it("refuses a firearm that is already out, off site or decommissioned", () => {
    assert.equal(isIssuable("issued"), false);
    assert.equal(isIssuable("off_site"), false);
    assert.equal(isIssuable("decommissioned"), false);
  });

  it("allows one that is on the premises", () => {
    assert.equal(isIssuable("in_service"), true);
  });
});
