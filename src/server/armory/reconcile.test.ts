import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reconciliationLine } from "./reconcile";

/**
 * §9: "Reconciliation job for webhooks that never arrive."
 *
 * The sweep itself needs Postgres and a live gateway. What is testable without
 * either — and what a founder actually reads — is the sentence it produces, and
 * there is one way for that sentence to be dangerous: a run that could not
 * reach the gateway must not read like a run that found nothing wrong.
 */

const line = (over: Partial<Parameters<typeof reconciliationLine>[0]> = {}) =>
  reconciliationLine({
    recovered: 0,
    unpaid: 0,
    unreachable: 0,
    examined: 0,
    ...over,
  });

describe("the reconciliation summary", () => {
  it("says plainly when there was nothing to do", () => {
    assert.equal(line(), "Nothing was waiting on the gateway.");
  });

  it("reports a recovered payment in the singular", () => {
    assert.equal(
      line({ examined: 1, recovered: 1 }),
      "1 examined — 1 payment recovered.",
    );
  });

  it("reports several", () => {
    assert.equal(
      line({ examined: 3, recovered: 3 }),
      "3 examined — 3 payments recovered.",
    );
  });

  it("never hides a run that could not reach the gateway", () => {
    /**
     * The one dangerous wording. A sweep that examined four payments and could
     * confirm none of them has proved nothing at all, and a summary that said
     * only "4 examined" would be read as a clean bill of health — which is
     * exactly the state §9's job exists to detect.
     */
    const summary = line({ examined: 4, unreachable: 4 });
    assert.match(summary, /could not be confirmed/);
    assert.doesNotMatch(summary, /recovered/);
  });

  it("names every outcome when a run found all three", () => {
    const summary = line({
      examined: 5,
      recovered: 2,
      unpaid: 2,
      unreachable: 1,
    });

    assert.match(summary, /2 payments recovered/);
    assert.match(summary, /2 not paid/);
    assert.match(summary, /1 could not be confirmed/);
  });

  it("does not mention outcomes that did not happen", () => {
    /* A summary that always lists three numbers is a summary where the one
       that matters does not stand out. */
    const summary = line({ examined: 2, unpaid: 2 });
    assert.doesNotMatch(summary, /recovered/);
    assert.doesNotMatch(summary, /could not be confirmed/);
  });
});
