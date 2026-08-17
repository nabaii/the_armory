import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STAFF_GRANTS, type StaffGrant } from "./enums";
import {
  DAY_PANELS,
  GrantError,
  MANAGEMENT_SURFACES,
  ROLE_BUNDLES,
  SEPARATIONS,
  admitsSurface,
  crossings,
  decideGrant,
  grantsForRole,
  heldGrants,
  panelsFor,
  refuseCombination,
  surfacesFor,
  type HeldGrant,
} from "./grants";

/**
 * Management System Design Specification §5, §6.1, §15, §18.
 *
 * S3: "Armoury custody and payment are never in the same hands. Structural,
 *      non-negotiable, and the single most important thing this document has to
 *      enforce."
 * S4: "The safety veto holder is never measured on commercial outcomes."
 * §5.1: forbidden combinations "refused at assignment, not warned about".
 */

const NOW = new Date("2026-08-17T18:00:00.000Z");
const FOUNDER = "11111111-1111-4111-8111-111111111111";

const hand = (...grants: StaffGrant[]) => new Set<StaffGrant>(grants);

const standing = (grant: StaffGrant): HeldGrant => ({
  grant,
  grantedByStaffId: FOUNDER,
  reason: "Appointed at opening, per the charter.",
  expiresAt: null,
  revokedAt: null,
});

/* ============================================================================
   THE SEPARATIONS
   ========================================================================= */

describe("custody and payment are never in the same hands — S3", () => {
  it("refuses the combination", () => {
    const refusal = refuseCombination(hand("custody", "ledger"));
    assert.ok(refusal);
    assert.equal(refusal.separation.id, "custody-and-payment");
    assert.match(refusal.message, /never in the same hands/);
  });

  it("permits either one alone", () => {
    assert.equal(refuseCombination(hand("custody", "desk", "safety_report")), null);
    assert.equal(refuseCombination(hand("ledger", "intelligence_commercial")), null);
  });
});

describe("the safety veto is never measured on commerce — S4", () => {
  it("refuses the combination", () => {
    const refusal = refuseCombination(hand("safety_manage", "intelligence_commercial"));
    assert.ok(refusal);
    assert.equal(refusal.separation.id, "safety-and-commerce");
  });

  it("leaves the safety officer their own operational evidence", () => {
    /* Reporting health, utilisation and coverage are the safety officer's case
       for staffing. Revenue is not. Collapsing the two would have cost them the
       evidence, which is how S4 gets quietly repealed. */
    assert.equal(
      refuseCombination(hand("safety_manage", "intelligence_operational")),
      null,
    );
  });

  it("lets any member of staff report, which S5 requires", () => {
    /* A near-miss form open only to the veto holder is a form nobody fills in.
       `safety_report` must be free to sit beside anything. */
    for (const grant of STAFF_GRANTS) {
      const refusal = refuseCombination(hand("safety_report", grant));
      assert.equal(
        refusal,
        null,
        `safety_report may not be refused alongside ${grant}`,
      );
    }
  });
});

/* ============================================================================
   THE FAILURE §15 PREDICTS
   ========================================================================= */

describe("a forbidden pair assembled over two appointments — §15", () => {
  it("is refused on the resulting hand, not on the change", () => {
    /* The case that actually happens. Somebody is made armourer in August. In
       March a different manager — who was not there in August, looking at a
       screen showing a person with no ledger access — gives them the ledger.
       Each action is individually reasonable. There is no moment at which
       anybody could have noticed. */
    const inAugust = decideGrant({
      current: hand("desk"),
      adding: ["custody"],
      reason: "Covering the armoury from the first of the month.",
      expiresAt: null,
      now: NOW,
    });
    assert.equal(inAugust.ok, true);

    const inMarch = decideGrant({
      current: inAugust.ok ? inAugust.resulting : hand(),
      adding: ["ledger"],
      reason: "Taking over reconciliation while Finance is on leave.",
      expiresAt: null,
      now: NOW,
    });

    assert.equal(inMarch.ok, false);
    assert.equal(
      inMarch.ok === false && inMarch.refusal.separation.id,
      "custody-and-payment",
    );
  });

  it("catches a self-grant, because the hand is the hand either way", () => {
    /* The obvious hole in the first two rules: whoever holds `grants` can give
       themselves anything. Evaluating the resulting set closes it without a
       special case for self-assignment. */
    const decision = decideGrant({
      current: hand("grants", "custody"),
      adding: ["ledger"],
      reason: "Settling the month end myself this once.",
      expiresAt: null,
      now: NOW,
    });

    assert.equal(decision.ok, false);
  });

  it("refuses a role bundle exactly as it refuses a hand-picked pair", () => {
    /* There must be no path by which naming a role avoids the check. */
    const decision = decideGrant({
      current: hand("custody"),
      adding: [...grantsForRole("finance")],
      reason: "Also picking up the books from September.",
      expiresAt: null,
      now: NOW,
    });

    assert.equal(decision.ok, false);
  });
});

/* ============================================================================
   ACTING GRANTS — Management §4.3, the gap the specification left
   ========================================================================= */

describe("a grant that lapses by clock, not by session", () => {
  const evening = (expiresAt: Date | null): HeldGrant => ({
    grant: "programme",
    grantedByStaffId: FOUNDER,
    reason: "Acting duty manager for tonight only.",
    expiresAt,
    revokedAt: null,
  });

  it("is held while it runs", () => {
    const held = heldGrants(
      [standing("desk"), evening(new Date("2026-08-18T05:00:00.000Z"))],
      NOW,
    );
    assert.ok(held.has("programme"));
  });

  it("stops being held the moment it lapses, mid-session", () => {
    /* §15: "A departed staff member retains a surface until their session
       expires." An acting grant makes that requirement sharper — "expires at
       06:00" must not mean "expires whenever they next sign in", which for a
       tablet nobody signs out of means never. */
    const sixAm = new Date("2026-08-18T05:00:00.000Z");
    const held = heldGrants([standing("desk"), evening(sixAm)], sixAm);

    assert.ok(!held.has("programme"), "the evening is over");
    assert.ok(held.has("desk"), "and the standing grant is untouched");
  });

  it("drops a revoked grant without waiting for an expiry", () => {
    const held = heldGrants(
      [
        {
          ...standing("ledger"),
          revokedAt: new Date("2026-08-17T09:00:00.000Z"),
        },
      ],
      NOW,
    );
    assert.equal(held.size, 0);
  });

  it("refuses to issue one that has already lapsed", () => {
    assert.throws(
      () =>
        decideGrant({
          current: hand(),
          adding: ["programme"],
          reason: "Covering the evening shift tonight.",
          expiresAt: new Date("2026-08-17T09:00:00.000Z"),
          now: NOW,
        }),
      GrantError,
    );
  });
});

describe("every grant carries a reason — §12.1", () => {
  it("refuses a reflex tap", () => {
    assert.throws(
      () =>
        decideGrant({
          current: hand(),
          adding: ["ledger"],
          reason: "ok",
          expiresAt: null,
          now: NOW,
        }),
      GrantError,
    );
  });

  it("refuses a request that grants nothing", () => {
    assert.throws(
      () =>
        decideGrant({
          current: hand(),
          adding: [],
          reason: "A perfectly good reason, at length.",
          expiresAt: null,
          now: NOW,
        }),
      GrantError,
    );
  });
});

/* ============================================================================
   THE FOUNDER EXCEPTION — read exempt, write-write refused
   ========================================================================= */

describe("the founder exception is made expensive, not invisible", () => {
  const founderHand = new Set(grantsForRole("founder"));

  it("gives the founder every surface, because reading is not the separation", () => {
    /* S3 separates hands on the record, not eyes on it. A founder refused a
       screen asks somebody to read it to them — which produces the information
       without producing the record that it was looked at. */
    assert.deepEqual(
      surfacesFor({ role: "founder", grants: founderHand }),
      [...MANAGEMENT_SURFACES],
    );
    assert.ok(admitsSurface({ role: "founder", grants: founderHand }, "ledger"));
  });

  it("drops one side of each separation, so the standing hand is clean", () => {
    assert.ok(founderHand.has("ledger"), "the business cannot run without it");
    assert.ok(!founderHand.has("custody"), "S3 — the armourer's record");
    assert.ok(!founderHand.has("safety_manage"), "S4 — the veto, read forwards");
    assert.ok(
      founderHand.has("safety_report"),
      "anybody may report, including the founder",
    );
    assert.equal(refuseCombination(founderHand), null);
  });

  it("still sees every near-miss, which §9.2 requires", () => {
    /* The trap this closes: the founder's bundle deliberately withholds
       `safety_manage` to honour S4, so a composition consulting grants alone
       would hide from the founder the exact reports §9 says they must see.
       Seeing an open safety item and closing one are different acts. */
    const panels = panelsFor({ role: "founder", grants: founderHand }).map((p) => p.id);
    assert.ok(panels.includes("open-safety"));
    assert.ok(!founderHand.has("safety_manage"));
  });

  it("lets the founder cross a separation deliberately, and only deliberately", () => {
    /* A founder who needs to move a firearm on an evening the armourer is away
       issues themselves an acting grant and gives a reason. What they cannot do
       is hold both by accident. */
    const both = decideGrant({
      current: founderHand,
      adding: ["custody"],
      reason: "Armourer away; issuing club rifles myself tonight.",
      expiresAt: new Date("2026-08-18T05:00:00.000Z"),
      now: NOW,
    });

    assert.equal(both.ok, false, "not while they still hold the ledger");

    const withoutLedger = new Set(
      [...founderHand].filter((grant) => grant !== "ledger"),
    );
    const swapped = decideGrant({
      current: withoutLedger,
      adding: ["custody"],
      reason: "Armourer away; issuing club rifles myself tonight.",
      expiresAt: new Date("2026-08-18T05:00:00.000Z"),
      now: NOW,
    });

    assert.equal(swapped.ok, true);
  });

  it("reports every crossing, not just the first, for the register", () => {
    const crossed = crossings(
      hand("custody", "ledger", "safety_manage", "intelligence_commercial"),
    );
    assert.equal(crossed.length, 2);

    /* Whereas a person being refused gets one sentence, never a stack. */
    assert.ok(refuseCombination(hand("custody", "ledger")));
  });

  it("finds no crossing in a clean hand", () => {
    assert.deepEqual(crossings(hand("desk", "custody", "safety_report")), []);
  });
});

/* ============================================================================
   NAVIGATION IS THE ORG CHART — §5
   ========================================================================= */

describe("the navigation is generated, never written down twice", () => {
  it("gives front of house two surfaces", () => {
    assert.deepEqual(
      surfacesFor({
        role: "front_of_house",
        grants: new Set(grantsForRole("front_of_house")),
      }),
      ["day", "people"],
    );
  });

  it("gives the duty manager four", () => {
    assert.deepEqual(
      surfacesFor({
        role: "duty_manager",
        grants: new Set(grantsForRole("duty_manager")),
      }),
      ["day", "diary", "people", "safety"],
    );
  });

  it("keeps the armourer out of the ledger — S3, as a fact rather than a promise", () => {
    const armourer = {
      role: "armourer" as const,
      grants: new Set(grantsForRole("armourer")),
    };
    assert.ok(!admitsSurface(armourer, "ledger"));
    assert.ok(admitsSurface(armourer, "safety"));
  });

  it("keeps finance out of everything but the money", () => {
    assert.deepEqual(
      surfacesFor({ role: "finance", grants: new Set(grantsForRole("finance")) }),
      ["day", "ledger", "intelligence"],
    );
  });

  it("shows a person with no grants nothing at all", () => {
    assert.deepEqual(surfacesFor({ role: "read_only", grants: hand() }), []);
  });
});

/* ============================================================================
   THE DAY IS PANELS — §6.1
   ========================================================================= */

describe("THE DAY composes from the hand, not from the role", () => {
  it("never renders a panel whose grant is not held", () => {
    /* The whole composition test, and the reason the panel is the unit: this is
       one assertion rather than one fixture per role, and it holds for the
       sixth role the founder invents in November. */
    for (const role of Object.keys(ROLE_BUNDLES) as (keyof typeof ROLE_BUNDLES)[]) {
      if (role === "founder") continue; /* read is exempt — asserted above */
      const grants = new Set(grantsForRole(role));
      for (const panel of panelsFor({ role, grants })) {
        assert.ok(
          grants.has(panel.grant),
          `${role} was shown ${panel.id} without holding ${panel.grant}`,
        );
      }
    }
  });

  it("gives front of house the desk panels and no money", () => {
    const panels = panelsFor({ role: "front_of_house", grants: new Set(grantsForRole("front_of_house")) }).map((p) => p.id);
    assert.ok(panels.includes("arrivals"));
    assert.ok(!panels.includes("takings"));
    assert.ok(!panels.includes("business-strip"));
  });

  it("gives finance the money and nothing on the floor", () => {
    const panels = panelsFor({ role: "finance", grants: new Set(grantsForRole("finance")) }).map((p) => p.id);
    assert.deepEqual(panels, ["takings", "unreconciled", "business-strip"]);
  });

  it("keeps the panel order fixed, so a screen read at speed does not move", () => {
    const all = panelsFor({ role: "founder", grants: new Set(STAFF_GRANTS) }).map((p) => p.id);
    assert.deepEqual(all, DAY_PANELS.map((p) => p.id));
  });

  it("never puts a safety item on a commercial panel — S4, S5", () => {
    /* "Near-miss surfacing on a commercial screen → reporting stops. Silence
       read as safety." Enforced here as a property of the composition: no panel
       requiring a commercial grant may be a safety panel. */
    const commercial = DAY_PANELS.filter(
      (panel) => panel.grant === "intelligence_commercial",
    );
    for (const panel of commercial) {
      assert.ok(
        !/safety|near-miss|incident/i.test(panel.title),
        `${panel.id} puts safety on a commercial panel`,
      );
    }
  });
});

/* ============================================================================
   THE BUNDLES THEMSELVES
   ========================================================================= */

describe("the draft role model the founder is asked to ratify — §18", () => {
  it("contains no bundle that breaks a separation on its own", () => {
    /* A bundle that could never be assigned would be a role that exists on
       paper and refuses at the point somebody tries to use it. */
    for (const [role, grants] of Object.entries(ROLE_BUNDLES)) {
      assert.equal(
        refuseCombination(new Set(grants)),
        null,
        `the ${role} bundle crosses a separation`,
      );
    }
  });

  it("names both separations, and only the two the club has", () => {
    assert.deepEqual(
      SEPARATIONS.map((s) => s.id),
      ["custody-and-payment", "safety-and-commerce"],
    );
  });
});
