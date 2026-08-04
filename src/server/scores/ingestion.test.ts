/**
 * Score ingestion.
 *
 * "A league collapses the first time a member suspects a friend inflated a
 * score." Every test here defends that sentence.
 *
 * The rejection tests matter more than the acceptance ones: the dangerous
 * failure is not refusing a good score, it is quietly accepting a bad one.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  csvSource,
  ingest,
  manualSource,
  automaticSource,
  validateCorrection,
  validateScores,
  type IngestionContext,
} from "./ingestion";

const ctx: IngestionContext = {
  roundId: "round-1",
  maxScore: 600,
  shotsPerRound: 60,
};

const staffCtx: IngestionContext = { ...ctx, actorId: "staff-1" };

describe("validateScores", () => {
  it("accepts valid scores and stamps provenance", () => {
    const r = validateScores(
      [{ memberId: "m1", value: 542 }, { memberId: "m2", value: 588 }],
      ctx,
      "automatic",
    );
    assert.equal(r.accepted.length, 2);
    assert.equal(r.rejected.length, 0);
    assert.equal(r.accepted[0].provenance, "automatic");
    assert.equal(r.accepted[0].maxValue, 600);
    assert.equal(r.accepted[0].recordedById, null);
  });

  it("accepts the boundaries", () => {
    const r = validateScores(
      [{ memberId: "m1", value: 0 }, { memberId: "m2", value: 600 }],
      ctx,
      "automatic",
    );
    assert.equal(r.accepted.length, 2);
  });

  /* ------------------------------------------------------------ REJECTIONS */

  it("REJECTS an impossible score rather than clamping it", () => {
    // Clamping turns bad data into plausible data, on a figure a member will
    // be ranked by. A rejected score gets looked at; a clamped one does not.
    const r = validateScores([{ memberId: "m1", value: 601 }], ctx, "automatic");
    assert.equal(r.accepted.length, 0);
    assert.equal(r.rejected.length, 1);
    assert.match(r.rejected[0].reason, /outside 0–600/);
  });

  it("rejects a negative score", () => {
    const r = validateScores([{ memberId: "m1", value: -1 }], ctx, "automatic");
    assert.equal(r.accepted.length, 0);
  });

  it("rejects a non-integer score", () => {
    for (const value of [54.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = validateScores([{ memberId: "m1", value }], ctx, "automatic");
      assert.equal(r.accepted.length, 0, `accepted ${value}`);
    }
  });

  it("rejects a score with no member", () => {
    const r = validateScores([{ memberId: "", value: 500 }], ctx, "automatic");
    assert.equal(r.accepted.length, 0);
    assert.match(r.rejected[0].reason, /no member/);
  });

  it("rejects a duplicate member within a batch", () => {
    // A second score for the same member is a correction, and corrections go
    // through supersede(), never through ingestion.
    const r = validateScores(
      [{ memberId: "m1", value: 500 }, { memberId: "m1", value: 590 }],
      ctx,
      "imported",
    );
    assert.equal(r.accepted.length, 1);
    assert.equal(r.accepted[0].value, 500, "the first score should stand");
    assert.match(r.rejected[0].reason, /duplicate/);
  });

  it("rejects a batch whose round maximum disagrees with the season", () => {
    // A different maximum means a different round was shot. Accepting it
    // silently breaks the comparability the league depends on.
    const r = validateScores(
      [{ memberId: "m1", value: 380, maxValue: 400 }],
      ctx,
      "imported",
    );
    assert.equal(r.accepted.length, 0);
    assert.match(r.rejected[0].reason, /maximum mismatch/);
  });

  /* -------------------------------------------------------- MANUAL AUTHORS */

  it("rejects a whole manual batch with no named recorder", () => {
    // An unattributed manual score is an assertion, not a score.
    const r = validateScores([{ memberId: "m1", value: 500 }], ctx, "manual");
    assert.equal(r.accepted.length, 0);
    assert.match(r.rejected[0].reason, /named recorder/);
  });

  it("records the author on a manual score", () => {
    const r = validateScores([{ memberId: "m1", value: 500 }], staffCtx, "manual");
    assert.equal(r.accepted.length, 1);
    assert.equal(r.accepted[0].recordedById, "staff-1");
    assert.equal(r.accepted[0].provenance, "manual");
  });

  it("does not attach an author to a machine score", () => {
    const r = validateScores([{ memberId: "m1", value: 500 }], staffCtx, "automatic");
    assert.equal(r.accepted[0].recordedById, null);
  });

  /* ------------------------------------------------------------ REPORTING */

  it("summarises reasons without leaking member ids", () => {
    // Rejection notes are operator-facing and get logged. Member ids are
    // personal data — see log.ts.
    const r = validateScores(
      [
        { memberId: "m1", value: 900 },
        { memberId: "m2", value: 901 },
        { memberId: "m3", value: 400 },
      ],
      ctx,
      "imported",
    );
    assert.equal(r.accepted.length, 1);
    assert.equal(r.rejected.length, 2);
    assert.equal(r.notes.includes("m1"), false, "notes leaked a member id");
    assert.equal(r.notes.includes("m2"), false, "notes leaked a member id");
    assert.match(r.notes, /×2/);
  });
});

describe("csv adapter", () => {
  it("parses a file with a header", async () => {
    const csv = "member_id,value\nm1,542\nm2,588\n";
    const r = await ingest(csvSource, csv, ctx);
    assert.equal(r.accepted.length, 2);
    assert.equal(r.accepted[0].provenance, "imported");
  });

  it("parses a file without a header", async () => {
    const r = await ingest(csvSource, "m1,542\nm2,588", ctx);
    assert.equal(r.accepted.length, 2);
  });

  it("tolerates blank lines and whitespace", async () => {
    const r = await ingest(csvSource, "member_id,value\n\n m1 , 542 \n\n", ctx);
    assert.equal(r.accepted.length, 1);
    assert.equal(r.accepted[0].value, 542);
  });

  it("rejects unparseable values without losing the rest of the batch", async () => {
    // One bad row must not cost the operator the other 39.
    const r = await ingest(csvSource, "member_id,value\nm1,abc\nm2,588", ctx);
    assert.equal(r.accepted.length, 1);
    assert.equal(r.rejected.length, 1);
  });

  it("handles an empty file", async () => {
    const r = await ingest(csvSource, "", ctx);
    assert.equal(r.accepted.length, 0);
    assert.equal(r.rejected.length, 0);
  });
});

describe("manual adapter", () => {
  it("ingests typed entries with an author", async () => {
    const r = await ingest(
      manualSource,
      [{ memberId: "m1", value: 500 }],
      staffCtx,
    );
    assert.equal(r.accepted.length, 1);
    assert.equal(r.accepted[0].recordedById, "staff-1");
  });

  it("rejects a non-array input", async () => {
    await assert.rejects(() => ingest(manualSource, "nope", staffCtx));
  });
});

describe("automatic adapter", () => {
  it("throws a message naming the unanswered question", async () => {
    // Deliberately unimplemented: the targeting system's export capability is
    // the Brief's open decision that "determines whether Leagues is buildable
    // at all". An adapter that silently returned [] would hide that.
    await assert.rejects(
      () => ingest(automaticSource, {}, ctx),
      /not implemented|unconfirmed/i,
    );
  });
});

describe("validateCorrection", () => {
  const base = {
    supersedesId: "score-1",
    memberId: "m1",
    roundId: "round-1",
    value: 545,
    reason: "misread lane assignment",
    actorId: "staff-1",
  };

  it("accepts a well-formed correction", () => {
    assert.equal(validateCorrection(base, ctx).ok, true);
  });

  it("requires an author", () => {
    const r = validateCorrection({ ...base, actorId: "" }, ctx);
    assert.equal(r.ok, false);
  });

  it("requires a reason", () => {
    for (const reason of ["", "   "]) {
      assert.equal(validateCorrection({ ...base, reason }, ctx).ok, false);
    }
  });

  it("requires a specific score to supersede", () => {
    // A correction that supersedes nothing is just another score, and the
    // history stops being readable.
    assert.equal(validateCorrection({ ...base, supersedesId: "" }, ctx).ok, false);
  });

  it("applies the same range rule as ingestion", () => {
    assert.equal(validateCorrection({ ...base, value: 601 }, ctx).ok, false);
    assert.equal(validateCorrection({ ...base, value: -1 }, ctx).ok, false);
  });
});
