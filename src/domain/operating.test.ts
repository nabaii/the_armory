import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPERATING_LEVELS, type StaffGrant } from "./enums";
import { grantsForRole } from "./grants";
import {
  LEVEL_DEFINITIONS,
  OperatingLevelError,
  consequences,
  definitionOf,
  degradationSummary,
  maySetLevel,
  rankOf,
  validateChange,
} from "./operating";

/**
 * Management System §6.2, §11.3, §12.1, and the founder's decision of
 * 17 August 2026: the operating level is held by the duty manager and above.
 */

const hand = (...grants: StaffGrant[]) => new Set<StaffGrant>(grants);

describe("the ladder is an order, not a set of options — §6.2", () => {
  it("comes down in the club's declared sequence", () => {
    assert.deepEqual(
      [...OPERATING_LEVELS],
      ["normal", "guests_capped", "live_fire_closed", "range_closed"],
    );
    assert.ok(rankOf("guests_capped") < rankOf("live_fire_closed"));
  });

  it("keeps the clubhouse trading at every rung, including the last", () => {
    /* The ladder ends at "the clubhouse trades only" rather than at "closed".
       A club closing its range is not a club closing — the hospitality-first
       principle surviving a bad evening. */
    for (const definition of LEVEL_DEFINITIONS) {
      assert.equal(
        definition.hospitality,
        true,
        `${definition.level} closes the clubhouse`,
      );
    }
    assert.equal(definitionOf("range_closed").liveFire, false);
  });

  it("gives a member a sentence written for them, not for the club", () => {
    /* A member reads this on WhatsApp. "live_fire_closed" is not a sentence. */
    assert.match(definitionOf("live_fire_closed").memberLine, /deck and kitchen are open/i);
    assert.ok(!definitionOf("live_fire_closed").memberLine.includes("_"));
  });
});

describe("who may move it — the founder's decision", () => {
  it("admits the duty manager", () => {
    assert.ok(maySetLevel(new Set(grantsForRole("duty_manager"))));
  });

  it("admits the safety officer, who holds no programme grant", () => {
    /* A safety veto that cannot stop anything is not a veto. S4 guarantees they
       can make this refusal, so the control must reach them by a second grant. */
    const officer = new Set(grantsForRole("safety_officer"));
    assert.ok(!officer.has("programme"));
    assert.ok(maySetLevel(officer));
  });

  it("refuses the range officer and front of house", () => {
    assert.ok(!maySetLevel(new Set(grantsForRole("range_officer"))));
    assert.ok(!maySetLevel(new Set(grantsForRole("front_of_house"))));
  });

  it("refuses a move outright rather than warning about it", () => {
    assert.throws(
      () =>
        validateChange({
          from: "normal",
          to: "range_closed",
          cause: "staffing",
          note: "Nobody senior on site this evening.",
          grants: hand("desk", "safety_report"),
        }),
      OperatingLevelError,
    );
  });
});

describe("moving it does the work rather than describing it — §6.2", () => {
  it("caps guests, closes slots, tells members and refreshes the desk", () => {
    const effects = consequences({ from: "normal", to: "live_fire_closed" });
    const kinds = effects.map((effect) => effect.kind);

    assert.ok(kinds.includes("cap_guest_bookings"));
    assert.ok(kinds.includes("close_shooting_slots"));
    assert.ok(kinds.includes("notify_affected_members"));
    assert.ok(
      kinds.includes("refresh_day_pack"),
      "the desk is offline-first; a level it never hears about admits guests the club just stopped taking",
    );
  });

  it("does not close the line when only guests are capped", () => {
    const kinds = consequences({ from: "normal", to: "guests_capped" }).map((e) => e.kind);
    assert.ok(kinds.includes("cap_guest_bookings"));
    assert.ok(!kinds.includes("close_shooting_slots"));
  });

  it("does not re-close slots on a move further down that has already closed them", () => {
    const kinds = consequences({
      from: "live_fire_closed",
      to: "range_closed",
    }).map((e) => e.kind);
    assert.ok(!kinds.includes("close_shooting_slots"), "the line is already shut");
  });

  it("recovers without reinstating anything it cancelled", () => {
    /* Recovery is not the mirror of degradation. Reopening live fire cannot
       un-tell the members whose bookings were cancelled, and must not silently
       reinstate a booking somebody has made other plans around. */
    const kinds = consequences({ from: "range_closed", to: "normal" }).map((e) => e.kind);

    assert.ok(kinds.includes("reopen_availability"));
    assert.ok(kinds.includes("notify_affected_members"));
    assert.ok(!kinds.includes("close_shooting_slots"));
    assert.ok(!kinds.includes("cap_guest_bookings"));
  });
});

describe("every move carries a reason — §12.1", () => {
  const ok = {
    from: "normal" as const,
    to: "guests_capped" as const,
    cause: "staffing" as const,
    grants: new Set(grantsForRole("duty_manager")),
  };

  it("refuses a reflex tap", () => {
    assert.throws(() => validateChange({ ...ok, note: "busy" }), OperatingLevelError);
  });

  it("accepts a note somebody can read next quarter", () => {
    const effects = validateChange({
      ...ok,
      note: "Two officers off sick, one on the floor.",
    });
    assert.ok(effects.length > 0);
  });

  it("refuses a move to where the club already is", () => {
    assert.throws(
      () =>
        validateChange({
          ...ok,
          from: "guests_capped",
          note: "Two officers off sick, one on the floor.",
        }),
      OperatingLevelError,
    );
  });
});

describe("the staffing argument, made from evidence — §11.3", () => {
  it("counts degradations by cause, commonest first", () => {
    const summary = degradationSummary([
      { cause: "staffing", to: "guests_capped" },
      { cause: "staffing", to: "live_fire_closed" },
      { cause: "weather", to: "range_closed" },
      { cause: "staffing", to: "guests_capped" },
    ]);

    assert.deepEqual(summary, [
      { cause: "staffing", count: 3 },
      { cause: "weather", count: 1 },
    ]);
  });

  it("does not count recovery as degradation", () => {
    /* A move back to normal has a cause recorded against it, and counting it
       would double every episode. */
    const summary = degradationSummary([
      { cause: "staffing", to: "live_fire_closed" },
      { cause: "staffing", to: "normal" },
    ]);

    assert.deepEqual(summary, [{ cause: "staffing", count: 1 }]);
  });

  it("reports counts rather than a rate — §11.1", () => {
    const summary = degradationSummary([{ cause: "equipment", to: "range_closed" }]);
    assert.equal(typeof summary[0].count, "number");
    assert.ok(!("share" in summary[0]));
  });
});
