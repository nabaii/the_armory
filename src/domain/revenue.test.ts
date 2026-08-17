import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { naira, type Kobo } from "@/lib/money";
import { serviceCharge } from "./charges";
import {
  MEANINGFUL_CHARGE_COUNT,
  mixCaveat,
  revenueCategoryOf,
  revenueMix,
  type RevenueCharge,
} from "./revenue";

/**
 * Management System Design Specification §11.2, §11.6, §15 — and finding F2.
 *
 * The falsifying number, and the two ways the schema was already arranged to
 * get it wrong.
 */

const at = (iso: string) => new Date(iso);
const WINDOW = { from: at("2026-09-01T00:00:00Z"), to: at("2026-10-01T00:00:00Z") };

const charge = (
  referenceType: RevenueCharge["referenceType"],
  amount: Kobo,
  iso = "2026-09-15T12:00:00Z",
): RevenueCharge => ({
  referenceType,
  totalKobo: amount,
  raisedAt: at(iso),
});

const lineFor = (mix: ReturnType<typeof revenueMix>, category: string) => {
  const found = mix.lines.find((l) => l.category === category);
  assert.ok(found, `no ${category} line`);
  return found;
};

describe("the four lines of the business — §11.2", () => {
  it("maps every reference type without guessing", () => {
    assert.equal(revenueCategoryOf("membership"), "membership");
    assert.equal(revenueCategoryOf("booking"), "range");
    assert.equal(revenueCategoryOf("fnb"), "fnb");
    assert.equal(revenueCategoryOf("guest_visit"), "guest");
    assert.equal(revenueCategoryOf("storage"), "storage");
  });

  it("refuses to classify an adjustment — §15", () => {
    /* The failure this guards: an officer rings a bar tab up by hand, it is
       silently filed as F&B or as range, and the falsifying number reports a
       thesis that is working or failing for reasons nobody can audit. */
    assert.equal(revenueCategoryOf("adjustment"), "uncategorised");
  });

  it("computes the mix an F&B charge makes possible — F1", () => {
    const mix = revenueMix(
      [
        charge("membership", naira(150_000)),
        charge("booking", naira(20_000)),
        charge("fnb", naira(12_400)),
        charge("guest_visit", naira(15_000)),
      ],
      WINDOW,
    );

    assert.equal(lineFor(mix, "fnb").amountKobo, naira(12_400));
    assert.equal(lineFor(mix, "range").amountKobo, naira(20_000));
    assert.equal(mix.totalKobo, naira(197_400));
    assert.equal(mix.count, 4);
  });

  it("emits every category, including the ones with nothing in them", () => {
    /* S2. A line absent because the club sold none of it and a line absent
       because nobody built the screen look identical, and only one is news. */
    const mix = revenueMix([charge("membership", naira(150_000))], WINDOW);
    assert.equal(mix.lines.length, 6);
    assert.equal(lineFor(mix, "fnb").amountKobo, 0);
    assert.equal(lineFor(mix, "fnb").count, 0);
  });

  it("carries a count beside every amount — §11.1", () => {
    const mix = revenueMix(
      [charge("fnb", naira(4_000)), charge("fnb", naira(6_000))],
      WINDOW,
    );
    assert.equal(lineFor(mix, "fnb").count, 2);
    assert.equal(lineFor(mix, "fnb").amountKobo, naira(10_000));
  });
});

describe("a charge raised by serviceCharge lands on the F&B line — F1", () => {
  it("carries the fnb reference type end to end", () => {
    const built = serviceCharge({
      personId: "11111111-1111-4111-8111-111111111111",
      items: [
        { description: "Jollof and chicken", quantity: 2, unitKobo: naira(4_500) },
        { description: "Malt", quantity: 2, unitKobo: naira(1_200) },
      ],
      sessionId: null,
    });

    assert.equal(built.referenceType, "fnb");
    assert.equal(built.totalKobo, naira(11_400));
    assert.equal(revenueCategoryOf(built.referenceType), "fnb");

    /* A member reads these three weeks later and has to recognise the evening. */
    assert.equal(built.lines[0].description, "Jollof and chicken");
  });
});

describe("the period boundary — §2.1", () => {
  it("is half-open, so nothing is counted in two periods", () => {
    const onTheBoundary = charge("fnb", naira(5_000), "2026-10-01T00:00:00Z");
    const justInside = charge("fnb", naira(5_000), "2026-09-30T23:59:59Z");
    const justBefore = charge("fnb", naira(5_000), "2026-08-31T23:59:59Z");

    const mix = revenueMix([onTheBoundary, justInside, justBefore], WINDOW);

    assert.equal(mix.count, 1, "only the charge inside the window counts");
    assert.equal(mix.totalKobo, naira(5_000));
  });
});

describe("the mix says when it cannot be read — §11.1", () => {
  it("refuses a mix drawn from too few charges", () => {
    const mix = revenueMix([charge("fnb", naira(4_000))], WINDOW);
    const caveat = mixCaveat(mix);
    assert.ok(caveat?.includes("too few"));
  });

  it("says so when nothing was traded at all", () => {
    assert.equal(
      mixCaveat(revenueMix([], WINDOW)),
      "No charges have been raised in this period.",
    );
  });

  it("surfaces uncategorised charges above the mix — §15", () => {
    const many = Array.from({ length: MEANINGFUL_CHARGE_COUNT }, () =>
      charge("fnb", naira(1_000)),
    );
    const mix = revenueMix([...many, charge("adjustment", naira(9_000))], WINDOW);

    assert.equal(mix.hasUncategorised, true);
    assert.ok(mixCaveat(mix)?.includes("uncategorised"));
  });

  it("stays quiet when the figure is worth reading", () => {
    const many = Array.from({ length: MEANINGFUL_CHARGE_COUNT }, () =>
      charge("booking", naira(2_000)),
    );
    assert.equal(mixCaveat(revenueMix(many, WINDOW)), null);
  });
});

/**
 * §11.6: "There is no separate reporting pipeline, because two pipelines
 * produce two answers and the first time a report disagrees with a dashboard
 * the founder will stop trusting both."
 *
 * Finding F2 is that the second pipeline already existed in the schema. This is
 * the assertion that keeps it closed — a source check rather than a behavioural
 * one, because the defect it guards against is somebody LATER computing revenue
 * from the payments table, and no amount of arithmetic on this module's outputs
 * would notice that happening in a different file.
 */
describe("revenue is never read from payments — §11.6, F2", () => {
  const source = readFileSync(new URL("./revenue.ts", import.meta.url), "utf8");

  it("does not read payments, whose account_topup is a liability", () => {
    /* Code only. The header explains the account_topup double-count at length
       and must stay free to say the word. */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    assert.ok(
      !/payments/i.test(code),
      "revenue.ts must not reference the payments table — a top-up is money the " +
        "club has not earned, and counting it inflates the mix on arrival and " +
        "again when the tab draws it down",
    );
    assert.ok(!/account_topup|accountTopup/.test(code));
    assert.ok(!/purpose/.test(code));
  });
});
