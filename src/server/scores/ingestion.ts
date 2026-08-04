/**
 * SCORE INGESTION — the seam that de-risks the whole of Phase 2.
 *
 * ===========================================================================
 * WHY THIS IS AN INTERFACE AND NOT A FUNCTION
 *
 * The Brief lists one open decision as existential: "Can the air rifle targeting
 * system attribute and store scores against a named individual over time, and
 * export them? Answer required during the current renovation. It determines
 * whether Leagues is buildable at all."
 *
 * That answer does not exist yet. Building directly against an assumed export
 * format would mean a rewrite if the answer is no — and would make an unanswered
 * hardware question able to strand a software project.
 *
 * So ingestion is an interface with three adapters, and Leagues works with any
 * one of them:
 *
 *   automatic → the targeting system pushes or is polled. Best case. This is
 *               what makes scores "machine-verified" and needs no officiating.
 *   imported  → CSV. Covers a system that can export but not integrate, AND the
 *               manual pilot's shared spreadsheet, which is the first real data
 *               this schema will ever meet.
 *   manual    → typed by named staff. The floor. Slow and it does not scale —
 *               "a human in the loop does not scale and invites disputes" — but
 *               it means a league can run on opening day regardless.
 *
 * If the answer comes back "no", Leagues degrades in QUALITY, not in existence.
 *
 * ===========================================================================
 * VALIDATION IS THE TRUST MODEL
 *
 * "A league collapses the first time a member suspects a friend inflated a
 * score." Every rule below exists to make that harder, and none of them trusts
 * the caller:
 *
 *   · A score outside 0..maxScore is rejected, not clamped. Clamping turns bad
 *     data into plausible data, which is the worst possible outcome for a
 *     figure someone will be judged on.
 *   · A manual score must name who entered it.
 *   · A correction must supersede a specific row and give a reason.
 *   · Nothing is ever updated in place. The history stays visible.
 */

import type { scoreProvenance } from "@/db/schema";

type Provenance = (typeof scoreProvenance.enumValues)[number];

/** One score, as any adapter presents it before it is trusted. */
export type IncomingScore = {
  /** Resolved to a member before ingestion — adapters do not invent members. */
  memberId: string;
  value: number;
  /**
   * Present when the adapter knows it. Compared against the season's declared
   * maximum; a mismatch is a rejection rather than a silent overwrite, because
   * it means the round shot was not the round we think it was.
   */
  maxValue?: number;
};

export type IngestionContext = {
  roundId: string;
  /** From the season. The authority on what a valid score looks like. */
  maxScore: number;
  shotsPerRound: number;
  /** Required for `manual`; the member id of the staff member entering it. */
  actorId?: string;
};

export type RejectedScore = {
  memberId: string;
  value: number;
  reason: string;
};

export type IngestionResult = {
  accepted: Array<{
    memberId: string;
    value: number;
    maxValue: number;
    provenance: Provenance;
    recordedById: string | null;
  }>;
  rejected: RejectedScore[];
  /** Operator-facing summary. Contains no personal data — see log.ts. */
  notes: string;
};

export interface ScoreSource {
  readonly provenance: Provenance;
  /** Human label for the ingestion audit and the operator UI. */
  readonly label: string;
  parse(input: unknown, context: IngestionContext): Promise<IncomingScore[]>;
}

/* ---------------------------------------------------------------------------
   VALIDATION — shared by every adapter, applied after parsing.

   Deliberately separate from parsing: an adapter's job is to turn its own
   format into `IncomingScore[]`, and the trust rules are identical whatever
   the format. A future adapter cannot accidentally opt out of them.
   -------------------------------------------------------------------------- */

export function validateScores(
  incoming: readonly IncomingScore[],
  context: IngestionContext,
  provenance: Provenance,
): IngestionResult {
  const accepted: IngestionResult["accepted"] = [];
  const rejected: RejectedScore[] = [];
  const seen = new Set<string>();

  /* A manual score without an author is not a score, it is an assertion.
     Reject the whole batch rather than writing unattributable rows. */
  if (provenance === "manual" && !context.actorId) {
    return {
      accepted: [],
      rejected: incoming.map((s) => ({
        memberId: s.memberId,
        value: s.value,
        reason: "manual entry requires a named recorder",
      })),
      notes: "Batch rejected: manual ingestion with no actorId.",
    };
  }

  for (const score of incoming) {
    const reject = (reason: string) =>
      rejected.push({ memberId: score.memberId, value: score.value, reason });

    if (!score.memberId) {
      reject("no member");
      continue;
    }

    /* One score per member per round. A second is either a duplicate import or
       an attempt to overwrite — both are corrections, and corrections go
       through supersede(), not through ingestion. */
    if (seen.has(score.memberId)) {
      reject("duplicate member in batch — use a correction to change a score");
      continue;
    }

    if (!Number.isInteger(score.value)) {
      reject(`not a whole number: ${score.value}`);
      continue;
    }

    /* Rejected, never clamped. A clamped score is a wrong score that looks
       right, on a figure a member will be ranked by. */
    if (score.value < 0 || score.value > context.maxScore) {
      reject(`outside 0–${context.maxScore}: ${score.value}`);
      continue;
    }

    /* A different maximum means a different round was shot. Accepting it would
       silently break the comparability the whole league depends on — "the pull
       to return comes from comparability". */
    if (score.maxValue !== undefined && score.maxValue !== context.maxScore) {
      reject(
        `round maximum mismatch: batch says ${score.maxValue}, season says ${context.maxScore}`,
      );
      continue;
    }

    seen.add(score.memberId);
    accepted.push({
      memberId: score.memberId,
      value: score.value,
      maxValue: context.maxScore,
      provenance,
      recordedById: provenance === "manual" ? context.actorId! : null,
    });
  }

  const notes = rejected.length
    ? `${accepted.length} accepted, ${rejected.length} rejected. ` +
      summariseReasons(rejected)
    : `${accepted.length} accepted.`;

  return { accepted, rejected, notes };
}

/** Reasons only — never member ids, which are personal data in a log. */
function summariseReasons(rejected: readonly RejectedScore[]): string {
  const counts = new Map<string, number>();
  for (const r of rejected) {
    const key = r.reason.replace(/: .*$/, "");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([reason, n]) => `${reason} ×${n}`).join("; ");
}

/* ---------------------------------------------------------------------------
   ADAPTER 1 — AUTOMATIC

   The targeting system. Format unknown until the installer answers, so the
   parse step is intentionally the only unwritten part of Phase 2, and it is
   isolated to this one function.

   The questions the founder needs answered, which this adapter's shape makes
   concrete rather than abstract:
     · Can it attribute a score to a named individual, not just a lane?
     · Can it store results over time, or does it display and forget?
     · Can it export — file, API or database — and in what format?
     · Can a lane be bound to a person for the duration of a round?
   -------------------------------------------------------------------------- */

export const automaticSource: ScoreSource = {
  provenance: "automatic",
  label: "Targeting system",
  async parse(): Promise<IncomingScore[]> {
    throw new Error(
      "Automatic ingestion is not implemented: the targeting system's export " +
        "capability and format are unconfirmed (Brief, open decision — " +
        "'determines whether Leagues is buildable at all'). Use the CSV or " +
        "manual adapter until the installer has answered.",
    );
  },
};

/* ---------------------------------------------------------------------------
   ADAPTER 2 — CSV IMPORT

   Covers a system that exports but does not integrate, and the manual pilot's
   shared spreadsheet — which is the first real data this schema will meet, and
   therefore the first honest test of it.

   Expected columns: `member_id,value` with a header row. Deliberately dull.
   -------------------------------------------------------------------------- */

export const csvSource: ScoreSource = {
  provenance: "imported",
  label: "CSV import",
  async parse(input: unknown): Promise<IncomingScore[]> {
    if (typeof input !== "string") {
      throw new Error("CSV ingestion expects a string");
    }

    const lines = input
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) return [];

    const header = lines[0].toLowerCase();
    const hasHeader = header.includes("member") || header.includes("score");
    const rows = hasHeader ? lines.slice(1) : lines;

    return rows.map((line) => {
      const [memberId = "", raw = ""] = line.split(",").map((c) => c.trim());
      return {
        memberId,
        /* NaN for unparseable input, which validation rejects with a readable
           reason rather than this throwing and losing the whole batch. */
        value: Number.parseInt(raw, 10),
      };
    });
  },
};

/* ---------------------------------------------------------------------------
   ADAPTER 3 — MANUAL ENTRY

   The floor. A league can run on opening day with nothing but a member of staff
   and a keyboard.

   Not the long-term answer, and the Brief says why: "a human in the loop does
   not scale and invites disputes." Every score entered this way is stamped
   `manual` and displayed as such — the trust difference must be visible.
   -------------------------------------------------------------------------- */

export const manualSource: ScoreSource = {
  provenance: "manual",
  label: "Entered by staff",
  async parse(input: unknown): Promise<IncomingScore[]> {
    if (!Array.isArray(input)) {
      throw new Error("Manual ingestion expects an array of entries");
    }
    return input.map((entry) => ({
      memberId: String((entry as IncomingScore).memberId ?? ""),
      value: Number((entry as IncomingScore).value),
    }));
  },
};

export const sources = {
  automatic: automaticSource,
  imported: csvSource,
  manual: manualSource,
} as const;

/**
 * Parse and validate in one step. The only entry point callers should use —
 * it makes skipping validation impossible rather than merely discouraged.
 */
export async function ingest(
  source: ScoreSource,
  input: unknown,
  context: IngestionContext,
): Promise<IngestionResult> {
  const parsed = await source.parse(input, context);
  return validateScores(parsed, context, source.provenance);
}

/* ---------------------------------------------------------------------------
   CORRECTIONS

   Scores are immutable. A correction is a new row pointing at the one it
   replaces, with a reason and an author — so an edit is never silent and a
   disputed result has a readable history.
   -------------------------------------------------------------------------- */

export type Correction = {
  supersedesId: string;
  memberId: string;
  roundId: string;
  value: number;
  reason: string;
  actorId: string;
};

export function validateCorrection(
  correction: Correction,
  context: IngestionContext,
): { ok: true } | { ok: false; reason: string } {
  if (!correction.actorId) {
    return { ok: false, reason: "a correction must name who made it" };
  }
  if (!correction.reason?.trim()) {
    return { ok: false, reason: "a correction must give a reason" };
  }
  if (!correction.supersedesId) {
    return { ok: false, reason: "a correction must supersede a specific score" };
  }
  if (!Number.isInteger(correction.value)) {
    return { ok: false, reason: "a score must be a whole number" };
  }
  if (correction.value < 0 || correction.value > context.maxScore) {
    return { ok: false, reason: `outside 0–${context.maxScore}` };
  }
  return { ok: true };
}
