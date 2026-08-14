import {
  evaluate,
  expiries,
  foreseeableBlocks,
  type Decision,
  type WaiverSignatureSnapshot,
} from "@/domain/capability";
import { isLicenceLive } from "@/domain/state-machines";
import { formatDate, formatTime } from "@/lib/time";
import {
  allowanceFor,
  arrivalsFor,
  requiresQualification,
  subjectFor,
  toDate,
  type IndexedDayPack,
} from "./daypack";

/**
 * PERSON DETAIL — §6.4.
 *
 *   "Opened only when the officer needs it. Documents, history, current blocks
 *    with reasons."
 *
 * The same split as today.ts: everything decided here, nothing decided in the
 * component. §4 — "No screen makes its own permission decision."
 *
 * ===========================================================================
 * "OPENED ONLY WHEN THE OFFICER NEEDS IT" IS A DESIGN CONSTRAINT
 *
 * It is the reason this is reached from a row on Today rather than from
 * navigation. Today is "the default and dominant screen" (§6.4) and the desk's
 * budget is fifteen seconds per shooter (§1.2 rule 1); a screen an officer can
 * wander into is a screen they will wander into with a queue behind them.
 *
 * So this exists to answer one question — why is this row not clear, and what do
 * I do about it — and it is built to be closed again.
 *
 * ===========================================================================
 * §10 AND WHAT THE DESK IS NOT ALLOWED TO SEE
 *
 * "Licence scans readable only by the founder role. Not by range officers. Not
 * on the desk or lane surfaces."
 *
 * §6.4 asks Person detail for "documents". §10 says the desk may not have them.
 * Both are satisfied by showing the FACTS of a document and never the document:
 * that a licence exists, that it was verified, which calibres it covers, when it
 * runs out. An officer needs to know whether the member may shoot their own
 * pistol; they do not need to see the scan to know it.
 *
 * This is enforced upstream rather than here — `documentUrl` is not in
 * `PackLicence`, so the desk has never received it and `assertNoRestrictedFields`
 * in daypack.ts fails a pack that tries. This module could not render a scan if
 * it wanted to, which is the right place for that guarantee to live.
 *
 * ===========================================================================
 * WHAT "HISTORY" CAN HONESTLY MEAN OFFLINE
 *
 * §8.1 defines the day pack as "today's and tomorrow's expected arrivals" — it
 * carries no participation history, and it should not: a full visit history for
 * every member is the roster's worth of data again, on a tablet in a public
 * building (§10).
 *
 * So `history` here is what the pack truthfully knows — this person's expected
 * arrivals in the window, and whether they are on the premises now. The screen
 * says so rather than showing an empty list that reads as "this member has never
 * been here". Their full history is a server read, and it belongs on the
 * founder's dashboard (§6.6) where §10 is content for it to live.
 */

export type DocumentKind = "waiver" | "licence" | "qualification";

/** One row in the documents list. Facts only — never a scan (§10). */
export type DocumentLine = {
  readonly kind: DocumentKind;
  readonly label: string;
  /** "Verified", "Awaiting review", "Expired 14 March" — one line, never a code. */
  readonly state: string;
  /**
   * Whether this document currently grants what it is for. Drives the glyph,
   * so the officer reads the answer before reading the words.
   */
  readonly live: boolean;
  /** Rendered Lagos date, or null where the document does not expire. */
  readonly expiresOn: string | null;
};

export type BlockLine = {
  readonly capability: string;
  /** §4.3: one sentence. Never a code, never a stack. */
  readonly message: string;
  readonly remedy: string | null;
  readonly overridable: boolean;
};

export type PersonDetailView = {
  readonly personId: string;
  readonly name: string;
  readonly photoUrl: string | null;
  /** Tier and member number for a member; who is bringing them for a guest. */
  readonly standing: string;
  /** The live check-in decision, as one sentence. Empty when they are clear. */
  readonly line: string;
  readonly onPremises: boolean;
  readonly documents: readonly DocumentLine[];
  readonly blocks: readonly BlockLine[];
  /** §6.2's "anything expiring within 60 days", at the desk. */
  readonly expiring: readonly string[];
  readonly history: readonly string[];
  /** True when the pack has no history to show, so the screen can say so. */
  readonly historyIsPartial: boolean;
};

export function personDetail(
  indexed: IndexedDayPack,
  personId: string,
  now: Date,
  checkedIn: ReadonlySet<string>,
  /* Signatures taken at this desk. Threaded through for the same reason the
     Today row takes them: this panel is open in front of the officer while they
     sign, and a screen still listing an unsigned waiver a minute afterwards
     would send them to fix something they had just fixed. */
  locallySigned: ReadonlyMap<string, WaiverSignatureSnapshot> = new Map(),
): PersonDetailView | null {
  const subject = subjectFor(indexed, personId, locallySigned);
  const person = indexed.personById.get(personId);
  if (!subject || !person) return null;

  const pack = indexed.pack;
  const waiver = {
    activeWaiverVersionId: pack.activeWaiverVersionId,
    waiverValidityDays: pack.waiverValidityDays,
  };

  const membership = indexed.membershipByPersonId.get(personId);
  const tier = membership ? indexed.tierById.get(membership.tierId) : undefined;

  const arrivals = arrivalsFor(indexed, pack.windowStart)
    .concat(arrivalsFor(indexed, pack.windowEnd))
    .filter((arrival) => arrival.personId === personId);

  /* The member's own decision. A guest's arrival-time decision depends on their
     host being present, which is an arrival fact rather than a person fact — the
     Today row carries it and this screen deliberately does not re-derive it,
     because two places computing the host-presence rule is exactly the
     duplication §4 forbids. */
  const decision: Decision = evaluate(subject, {
    capability: "MAY_ATTEND",
    now,
    ...waiver,
  });

  const disciplines = [...new Set(arrivals.map((a) => a.discipline))];

  const blocks: BlockLine[] = foreseeableBlocks(subject, {
    now,
    allowance: membership ? allowanceFor(indexed, membership.id) : null,
    disciplines,
    requiresQualification: (discipline) =>
      requiresQualification(indexed, discipline),
    ...waiver,
  }).map((found) => ({
    capability: found.capability,
    message: found.block.message,
    remedy: found.block.remedy,
    overridable: found.block.overridable,
  }));

  return {
    personId,
    name: `${person.firstName} ${person.lastName}`,
    photoUrl: person.photoUrl,
    standing: standingLine(tier?.name ?? null, membership?.memberNumber ?? null),
    line: decision.allowed ? "" : decision.reason.message,
    onPremises: checkedIn.has(personId),
    documents: documentLines(indexed, personId, now, subject.waiver),
    blocks,
    expiring: expiries(subject, now).map(
      (expiry) =>
        `${expiry.label} — ${expiry.daysRemaining === 0 ? "today" : `${expiry.daysRemaining} days`}`,
    ),
    history: arrivals.map(
      (arrival) =>
        `${formatDate(new Date(arrival.slotStart))} ${formatTime(new Date(arrival.slotStart))} · ${arrival.discipline}`,
    ),
    historyIsPartial: true,
  };
}

function standingLine(
  tierName: string | null,
  memberNumber: number | null,
): string {
  /* A guest has neither, and saying "No tier" would read as a fault. §3.1: a
     guest is a state of a person, and the honest description of that state is
     that they are a guest. */
  if (!tierName) return "Guest — no membership on this device's information";
  return memberNumber ? `${tierName} · No. ${memberNumber}` : tierName;
}

/**
 * The documents list.
 *
 * Ordered waiver, licences, qualifications — the order an officer needs them.
 * The waiver is first because it is the one that blocks EVERY arrival including
 * a guest's, and the one most often missing.
 */
function documentLines(
  indexed: IndexedDayPack,
  personId: string,
  now: Date,
  /**
   * The signature the capability service saw — `subject.waiver`, not the pack.
   *
   * Passed in rather than looked up here, because the two are no longer the same
   * thing: a waiver signed at this desk is in local state and not in the pack
   * until the next sync. Reading the pack directly would put this panel's
   * documents list and its blocks list on different information, and they are
   * two paragraphs of the same screen — an officer who has just watched somebody
   * sign would be told, an inch apart, that the waiver is in order and that it
   * is out of date.
   */
  waiver: WaiverSignatureSnapshot | null,
): DocumentLine[] {
  const pack = indexed.pack;
  const lines: DocumentLine[] = [];

  const signedCurrent =
    waiver !== null && waiver.waiverVersionId === pack.activeWaiverVersionId;

  lines.push({
    kind: "waiver",
    label: "Waiver",
    state: !waiver
      ? "Never signed"
      : signedCurrent
        ? `Signed ${formatDate(waiver.signedAt)}`
        : `Signed against an earlier version on ${formatDate(waiver.signedAt)}`,
    live: signedCurrent,
    expiresOn: null,
  });

  for (const licence of indexed.licencesByPersonId.get(personId) ?? []) {
    const expiresOn = toDate(licence.expiresOn);
    const live = isLicenceLive(
      { status: licence.status, expiresOn },
      now,
    );

    lines.push({
      kind: "licence",
      label: `Firearm licence · ${licence.calibres.join(", ") || "no calibres listed"}`,
      state: licenceState(licence.status, expiresOn, now),
      live,
      expiresOn: expiresOn ? formatDate(expiresOn) : null,
    });
  }

  for (const qualification of indexed.qualificationsByPersonId.get(personId) ??
    []) {
    const expiresAt = toDate(qualification.expiresAt);
    const live = expiresAt === null || expiresAt.getTime() > now.getTime();

    lines.push({
      kind: "qualification",
      label: `${qualification.discipline} sign-off · ${qualification.level}`,
      state: live
        ? expiresAt
          ? `Current until ${formatDate(expiresAt)}`
          : "Current"
        : `Lapsed ${formatDate(expiresAt as Date)}`,
      live,
      expiresOn: expiresAt ? formatDate(expiresAt) : null,
    });
  }

  return lines;
}

/**
 * One line describing a licence's state.
 *
 * The clock is checked against the date rather than trusting the status column,
 * for the reason `isLicenceLive` exists: between the expiry date and the sweep
 * running, the column says `verified` and the licence is not. A screen that read
 * the column would tell an officer a licence is live while the capability
 * service refuses it — and the officer would believe the screen.
 */
function licenceState(
  status: string,
  expiresOn: Date | null,
  now: Date,
): string {
  if (status === "revoked") return "Revoked";
  if (status === "pending_review") return "Awaiting review — grants nothing yet";

  if (expiresOn && expiresOn.getTime() <= now.getTime()) {
    return `Expired ${formatDate(expiresOn)}`;
  }

  if (status === "expired") return "Expired";
  return expiresOn ? `Verified until ${formatDate(expiresOn)}` : "Verified";
}
