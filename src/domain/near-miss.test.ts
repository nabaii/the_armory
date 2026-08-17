import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { STAFF_GRANTS } from "./enums";
import { ROLE_BUNDLES } from "./grants";
import {
  MAY_FILE,
  MAY_READ,
  MINIMUM_NARRATIVE,
  NearMissError,
  attribution,
  reportingHealth,
  validateDraft,
  type NearMissDraft,
} from "./near-miss";

/**
 * Management System §9.2, S4 and S5.
 *
 * S5: "A reporting surface that is slow, attributive, punitive or visible to the
 *      wrong people will produce silence and the club will conclude, wrongly,
 *      that nothing is happening."
 */

const draft = (overrides: Partial<NearMissDraft> = {}): NearMissDraft => ({
  kind: "line_discipline",
  whatHappened: "Muzzle came off target during a reload on lane three.",
  named: false,
  location: "Lane 3",
  ...overrides,
});

describe("anybody on staff may file it — S5", () => {
  it("is carried by every role that works at the club", () => {
    /* A reporting surface only the safety holder can reach records what the
       safety holder saw, which is the one perspective already covered.

       This assertion caught a real omission on its first run: front of house had
       no `safety_report`, so the person who spends the whole evening watching
       people arrive could not file a report about what they saw. */
    for (const [role, grants] of Object.entries(ROLE_BUNDLES)) {
      if (role === "read_only") continue; /* visibility without writes — below */
      assert.ok(
        (grants as readonly string[]).includes(MAY_FILE),
        `${role} cannot file a near-miss`,
      );
    }
  });

  it("withholds it from read_only, deliberately", () => {
    /* That role exists so the club can grant visibility WITHOUT the ability to
       change the record — an accountant, an auditor. Filing is a write, and
       "read only" meaning "reads and writes a bit" is how a dormant account
       becomes the one that leaks. */
    assert.ok(!(ROLE_BUNDLES.read_only as readonly string[]).includes(MAY_FILE));
  });

  it("holds reading separately, and more tightly", () => {
    assert.notEqual(MAY_FILE, MAY_READ);
    assert.equal(MAY_READ, "safety_manage");
    /* And the founder reaches them by the read exemption rather than this grant,
       because their bundle deliberately withholds it. */
    assert.ok(!(ROLE_BUNDLES.founder as readonly string[]).includes("safety_manage"));
  });
});

describe("the form asks what happened, never who — §9.2", () => {
  it("accepts a one-sentence report", () => {
    assert.doesNotThrow(() => validateDraft(draft()));
  });

  it("refuses something too short to be a report", () => {
    assert.throws(() => validateDraft(draft({ whatHappened: "close one" })), NearMissError);
  });

  it("keeps the floor low, because fewer reports is the failure", () => {
    /* Twenty characters is roughly "muzzle came off target during a reload".
       A longer minimum buys better prose and fewer reports. */
    assert.ok(MINIMUM_NARRATIVE <= 20);
  });

  it("refuses a narrative that attributes fault", () => {
    /* The FIELDS already make this hard — there is nowhere to put a name. This
       catches the other route in. It refuses rather than redacting, because
       redacting would silently change what somebody wrote about a safety event. */
    for (const text of [
      "Bode was careless with the muzzle on lane three again.",
      "This was entirely the range officer's fault, as usual.",
      "Negligent handling of a loaded rifle at the bench.",
    ]) {
      assert.throws(
        () => validateDraft(draft({ whatHappened: text })),
        NearMissError,
        `should refuse: ${text}`,
      );
    }
  });

  it("does not refuse an ordinary report that happens to mention equipment", () => {
    assert.doesNotThrow(() =>
      validateDraft(
        draft({
          whatHappened: "The rifle failed to eject and the shooter turned to ask for help.",
        }),
      ),
    );
  });

  it("has nowhere to record a subject, and that is the design", () => {
    const keys = Object.keys(draft());
    assert.ok(!keys.some((key) => /person|subject|fault|blame|severity/i.test(key)));
  });
});

describe("a named report is not conspicuous in a list", () => {
  it("labels named and anonymous reports identically", () => {
    /* The panel's objection to per-report choice was that a named report beside
       an anonymous one makes the anonymous one conspicuous. Conspicuousness
       comes from the LIST, so the list does not carry it — the safety holder
       learns who filed a report by opening it, which is a deliberate act. */
    assert.equal(attribution(), "Reported by a member of staff");
  });
});

describe("the count is a positive signal — §9.2, §11.3", () => {
  it("says so when a count falls to zero", () => {
    /* "A club whose near-miss count falls to zero has almost certainly stopped
       reporting rather than stopped having near-misses, and §11.3 should say so
       on the screen." */
    const health = reportingHealth({ thisPeriod: 0, previousPeriod: 4 });
    assert.equal(health.concerning, true);
    assert.match(health.line, /reporting problem before it is a safety result/);
  });

  it("treats a rise as candour rather than as risk", () => {
    const health = reportingHealth({ thisPeriod: 9, previousPeriod: 4 });
    assert.equal(health.concerning, false);
    assert.match(health.line, /candour/);
  });

  it("is most concerned by two silent periods running", () => {
    const health = reportingHealth({ thisPeriod: 0, previousPeriod: 0 });
    assert.equal(health.concerning, true);
    assert.match(health.line, /nobody is filing them/);
  });

  it("refuses to read a small movement as a trend", () => {
    const health = reportingHealth({ thisPeriod: 3, previousPeriod: 4 });
    assert.equal(health.concerning, false);
    assert.match(health.line, /read the reports rather than the number/);
  });
});

/**
 * S4: "A person who can stop the range must never appear on a screen that
 * attributes revenue to them."
 *
 * §15 lists "near-miss surfacing on a commercial screen → reporting stops,
 * silence read as safety" as a release gate. A source assertion, because the
 * failure is a FUTURE screen importing this module next to a revenue figure.
 */
describe("near-misses never meet a commercial figure — S4, §15", () => {
  it("does not import anything that computes revenue", () => {
    const source = readFileSync(new URL("./near-miss.ts", import.meta.url), "utf8");
    const imports = source.match(/^import[\s\S]*?from\s+"[^"]+";/gm) ?? [];

    for (const line of imports) {
      assert.ok(
        !/revenue|charges|money|intelligence/i.test(line),
        `near-miss.ts must not import ${line}`,
      );
    }
  });

  it("exposes no grant that could put it on a commercial panel", () => {
    assert.ok(!(STAFF_GRANTS as readonly string[]).includes("near_miss"));
    assert.notEqual(MAY_READ, "intelligence_commercial");
  });
});
