import {
  describeScore,
  formatById,
  parseScore,
  type ScoreFormat,
} from "@/domain/scoring";
import { uuidv7 } from "@/lib/uuidv7";
import type { IndexedDayPack } from "./daypack";
import type { LocalParticipation } from "./checkin";
import type { LocalRound } from "./relay";

/**
 * CAPTURING A SCORE AT THE LANE — §6.5, step 12 of docs/M1_offline_acceptance.md.
 *
 *   §6.5: "Score — Select shooter, enter total, confirm. No free-text entry in
 *    the normal path. Under twenty seconds. Guests are scored identically to
 *    members."
 *   §8.5: "…record two scores, then pull the power mid-session."
 *
 * The last of the three workflows M1 recorded as defined-but-unoriginated. The
 * write has been in src/sync/contract.ts and replay-tested in
 * src/sync/push.test.ts since the beginning; what did not exist was anything
 * that built one, which is why step 12 of the acceptance protocol has been
 * recorded as skipped rather than passed.
 *
 * Same shape as src/offline/checkin.ts, src/offline/waiver.ts and
 * src/offline/equipment.ts: pure, builds records, returns them. It touches no
 * store and knows nothing about a device.
 *
 * ===========================================================================
 * NO CAPABILITY CHECK, AND THAT IS THE POINT
 *
 * Every other builder in src/offline calls §4's service before writing.
 * This one does not, for the reason `buildFirearmReturn` gives:
 *
 *   "A system that could refuse it would be a system that could leave a firearm
 *    logged as out because a licence expired during the session."
 *
 * The same applies with more force here. A score is a record of something that
 * has already happened — the rounds are downrange, the card is in the officer's
 * hand. Refusing to record it does not un-shoot it; it produces a session whose
 * paperwork says a person was on a lane and shot nothing, which is the exact
 * shape of a record nobody can defend afterwards.
 *
 * MAY_SHOOT_DISCIPLINE and MAY_USE_OWN_FIREARM are evaluated where they can
 * still change an outcome — check-in and the Pair screen (§4.2). By the time
 * there is a total to enter, the decision they gate is in the past.
 *
 * ===========================================================================
 * GUESTS ARE SCORED IDENTICALLY, WHICH MEANS THERE IS NO BRANCH
 *
 * §6.5 says so directly, and the way to honour it is for `role` to appear
 * nowhere in this file. A guest's card is a card. It is also, commercially, the
 * single most valuable artefact the club produces from a visit — §6.3 makes the
 * guest link "their result page — their score, and a route to apply" — so a
 * guest whose score was skipped because the lane treated them as a lesser
 * shooter is a conversion the club will never see.
 */

export type ScoreRefusal = {
  readonly reason: string;
  readonly remedy: string | null;
};

export type QueuedScoreWrite = {
  readonly id: string;
  readonly operation: "rounds.create" | "audit_log.create";
  readonly payload: unknown;
};

export type ScoreWrites = {
  /** Written to `armory-session` before it is queued. See ConsoleApp. */
  readonly round: LocalRound;
  readonly queue: readonly QueuedScoreWrite[];
};

export type ScoreResult =
  | { readonly ok: true; readonly writes: ScoreWrites }
  | { readonly ok: false; readonly refusal: ScoreRefusal };

export type ScoreContext = {
  /** §10. The officer on shift; see src/offline/officer.ts. */
  readonly actorStaffId: string | null;
  readonly now: Date;
  readonly sessionId: string;
};

const refuse = (reason: string, remedy: string | null): ScoreResult => ({
  ok: false,
  refusal: { reason, remedy },
});

/**
 * Record one card.
 *
 * `corrects` carries §1.2 rule 3: "a correction is a new row referencing the
 * old one". It is not an edit and there is no path here that produces one — the
 * table is append-only and drizzle/0002 rejects an UPDATE at the database, so a
 * builder that offered an edit would be building a write the server refuses.
 */
export function buildScore(
  indexed: IndexedDayPack,
  input: {
    readonly participation: LocalParticipation;
    readonly formatId: string;
    /** Exactly what was keyed. See `parseScore` on why this is a string. */
    readonly keyed: string;
    readonly corrects: {
      readonly roundId: string;
      readonly reason: string;
    } | null;
  },
  context: ScoreContext,
): ScoreResult {
  const format = formatById(input.formatId);

  if (!format) {
    return refuse(
      "That course of fire is not one this device knows.",
      "Choose a format from the list.",
    );
  }

  /**
   * The card has to match the bay.
   *
   * The lane is the physical truth of what was shot — a 10m pistol card cannot
   * have been fired on a 10m air rifle bay, whatever the booking said. Checked
   * against the lane rather than against the booking's discipline for exactly
   * that reason: a shooter moved to a different bay mid-session has a booking
   * that is now wrong and a lane that is right.
   *
   * A participation with no lane skips the check rather than failing it. Lane
   * assignment arrived at M5 and rows written before it carry null, and a
   * device holding those must still be able to record what happened on them.
   */
  const lane = input.participation.laneId
    ? indexed.pack.lanes.find((row) => row.id === input.participation.laneId)
    : null;

  if (lane && lane.discipline !== format.discipline) {
    return refuse(
      `${format.label} is not shot on ${lane.discipline} ${lane.number}.`,
      "Choose the course of fire for this bay.",
    );
  }

  const entry = parseScore(format, input.keyed);
  if (!entry.ok) {
    return { ok: false, refusal: entry.refusal };
  }

  /* §1.2 rule 3 again, and src/sync/operations.ts refuses this server-side too.
     Caught here so the officer hears it while the card is still in their hand
     rather than as a queued rejection an hour later. */
  if (input.corrects && input.corrects.reason.trim() === "") {
    return refuse(
      "A corrected score has to say why it was changed.",
      "Add a short reason — a misread card, a wrong shooter.",
    );
  }

  const roundId = uuidv7();
  const capturedAt = context.now.toISOString();

  const round: LocalRound = {
    id: roundId,
    participationId: input.participation.id,
    sessionId: context.sessionId,
    discipline: format.discipline,
    format: format.id,
    totalScore: entry.totalScore,
    capturedAt: context.now,
    correctsRoundId: input.corrects?.roundId ?? null,
    capturedByStaffId: context.actorStaffId,
  };

  const queue: QueuedScoreWrite[] = [
    {
      id: roundId,
      operation: "rounds.create",
      payload: {
        participationId: input.participation.id,
        discipline: format.discipline,
        format: format.id,
        totalScore: entry.totalScore,
        /* §3.3 makes `shot_detail` nullable and §9 makes the targeting system an
           adapter that has not been selected. Manual capture carries no per-shot
           detail and says so, rather than sending an empty object that would
           read later as a system that reported nothing. */
        shotDetail: null,
        captureMethod: "manual",
        sourceReference: null,
        capturedAt,
        correctsRoundId: input.corrects?.roundId ?? null,
        correctionReason: input.corrects?.reason.trim() ?? null,
      },
    },
  ];

  /**
   * §3.6 lists scores among the things the audit log covers, and a CORRECTION is
   * the one worth having there.
   *
   * An ordinary card needs no audit row: the round itself is append-only, is
   * attributed, and carries both clocks — an audit entry would restate it. A
   * correction is different because it changes what the club believes about a
   * card that has already been read, and the before/after is the record.
   */
  if (input.corrects) {
    queue.push({
      id: uuidv7(),
      operation: "audit_log.create",
      payload: {
        action: "score.correct",
        entityType: "round",
        entityId: roundId,
        before: { roundId: input.corrects.roundId },
        after: {
          totalScore: entry.totalScore,
          reads: describeScore(format, entry.totalScore),
        },
        isOverride: false,
        overrideReason: null,
        occurredAt: capturedAt,
      },
    });
  }

  return { ok: true, writes: { round, queue } };
}

/**
 * What the officer confirms before tapping through — §6.5's "confirm".
 *
 * One line, assembled here rather than in the component, so the twenty-second
 * budget is spent reading a sentence instead of parsing a form. The score reads
 * as it was keyed, which is the only thing the officer can actually check.
 */
export const confirmationLine = (
  format: ScoreFormat,
  shooterName: string,
  totalScore: number,
): string =>
  `${shooterName} — ${format.label}, ${describeScore(format, totalScore)}.`;
