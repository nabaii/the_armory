import type { NearMissKind, StaffGrant } from "./enums";

/**
 * NEAR-MISS REPORTING — Management System §9.2, and S5.
 *
 *   S5: "Near-miss reporting is a culture problem before it is a system feature.
 *    The system can only fail to help. A reporting surface that is slow,
 *    attributive, punitive or visible to the wrong people will produce silence
 *    and the club will conclude, wrongly, that nothing is happening."
 *
 *   §9.2: "Fast, low-ceremony, and not attributive by default. A near-miss
 *    report that takes two minutes and asks who was at fault will not be filed.
 *    The form is short, it can be submitted from a phone in under thirty
 *    seconds, and it asks what happened rather than who did it."
 *
 * ===========================================================================
 * THIS MODULE'S JOB IS MOSTLY TO REFUSE THINGS
 *
 * Almost every rule here is a prohibition, and that is the correct shape for a
 * feature whose failure mode is silence. There is no field for who was at fault,
 * no severity for somebody to argue about, and no path by which a report reaches
 * a commercial screen. Those are not omissions to be filled in later — each one
 * is a decision, and the reasoning is recorded beside it so that a future
 * addition has to argue with it rather than simply not notice.
 */

/* ============================================================================
   WHO MAY FILE, AND WHO MAY READ

   These are deliberately different sets, and the asymmetry is the whole design.
   ========================================================================= */

/**
 * Filing is open to anybody on staff.
 *
 * `safety_report` sits in every role bundle in ROLE_BUNDLES, which is why the
 * grants test asserts it may never be refused alongside any other grant. A
 * reporting surface only the safety holder can reach is a surface that records
 * what the safety holder saw, which is the one perspective already covered.
 */
export const MAY_FILE: StaffGrant = "safety_report";

/**
 * Reading is held tightly, and by two people rather than one.
 *
 * §9.2: "Reports are visible to the safety holder and the founder." The founder
 * is admitted through the read exemption in `panelsFor` rather than through a
 * grant — their bundle deliberately withholds `safety_manage`, so a check
 * against grants alone would hide from them the reports §9 says they must see.
 */
export const MAY_READ: StaffGrant = "safety_manage";

/* ============================================================================
   THE REPORT
   ========================================================================= */

export type NearMissDraft = {
  readonly kind: NearMissKind;
  /** What happened. The only required narrative, and the only one there is. */
  readonly whatHappened: string;
  /**
   * Whether to file it under the reporter's name — the founder's decision of
   * 17 August 2026: the reporter chooses, per report.
   *
   * =========================================================================
   * WHY THE CHOICE IS PER REPORT AND NOT PER PERSON
   *
   * A setting would make the decision once, in a quiet moment, and then apply it
   * to the report somebody files about an evening they would rather not be named
   * in. The choice belongs at the moment of filing, because that is the moment
   * the person knows what it costs them.
   *
   * The panel raised the obvious objection — a named report sitting beside an
   * anonymous one makes the anonymous one conspicuous — and it is real. It is
   * mitigated by never rendering the two differently in a list: `attribution`
   * below returns the same shape for both, and the safety holder sees a name
   * only by opening a report. Conspicuousness comes from the LIST, so the list
   * does not carry it.
   */
  readonly named: boolean;
  /** Which lane or area, where it matters. Never who. */
  readonly location: string | null;
};

export class NearMissError extends Error {}

/**
 * The shortest form that is still worth having.
 *
 * Thirty seconds is the budget §9.2 sets, and the floor below is set against it
 * rather than against a quality bar: twenty characters is roughly "muzzle came
 * off target during a reload", which is a usable report. A longer minimum would
 * buy better prose and fewer reports, and fewer reports is the failure.
 */
export const MINIMUM_NARRATIVE = 20;

export function validateDraft(draft: NearMissDraft): void {
  if (draft.whatHappened.trim().length < MINIMUM_NARRATIVE) {
    throw new NearMissError(
      "A sentence about what happened is enough — but it needs to be a sentence.",
    );
  }

  /**
   * The one content rule, and it is about a word rather than a length.
   *
   * §9.2 asks that the form "asks what happened rather than who did it", which
   * the FIELDS already enforce — there is nowhere to put a name. This catches
   * the other route: a narrative that names somebody anyway.
   *
   * It refuses rather than redacting, because redacting would silently change
   * what somebody wrote about a safety event. The message says why, and the
   * reporter rewrites it. Deliberately narrow — it looks for the shapes of
   * blame, not for names, because a check that guessed at names would refuse
   * "the rifle" on a range where somebody is called Rifle.
   */
  const blame = /\b(fault|blame|to blame|negligen\w*|careless\w*|stupid|idiot)\b/i;
  if (blame.test(draft.whatHappened)) {
    throw new NearMissError(
      "This report reads as an attribution of fault. Describe what happened and " +
        "what nearly followed from it — an incident is where blame belongs, and " +
        "this is not one.",
    );
  }
}

/* ============================================================================
   READING THEM BACK
   ========================================================================= */

export type NearMissRecord = {
  readonly id: string;
  readonly kind: NearMissKind;
  readonly whatHappened: string;
  readonly location: string | null;
  readonly reportedAt: Date;
  /** Null where the reporter filed anonymously. */
  readonly reportedByStaffId: string | null;
  readonly reporterName: string | null;
};

/**
 * How a report is labelled in a LIST.
 *
 * Identical for named and anonymous reports, on purpose — see `named` above. The
 * safety holder learns who filed a report by opening it, which is a deliberate
 * act, rather than by scanning a column, which is not.
 */
export const attribution = (): string => "Reported by a member of staff";

/**
 * THE COUNT IS A POSITIVE SIGNAL, AND THE SURFACE MUST SAY SO — §9.2, §11.3.
 *
 *   "The count of reports is presented as a positive signal of reporting culture
 *    rather than as a negative signal of safety. A club whose near-miss count
 *    falls to zero has almost certainly stopped reporting rather than stopped
 *    having near-misses, and §11.3 should say so on the screen."
 *
 * So this returns the sentence, and it is the sentence rather than a colour or an
 * arrow. A dashboard that rendered a falling count in green would teach the club
 * the opposite of what §9.2 wants, permanently, in one glance.
 */
export function reportingHealth(input: {
  readonly thisPeriod: number;
  readonly previousPeriod: number;
}): { readonly line: string; readonly concerning: boolean } {
  if (input.thisPeriod === 0 && input.previousPeriod === 0) {
    return {
      line:
        "No near-misses reported, in this period or the last. On a working range " +
        "that is far more likely to mean nobody is filing them than that none occurred.",
      concerning: true,
    };
  }

  if (input.thisPeriod === 0) {
    return {
      line:
        `None reported this period, against ${input.previousPeriod} in the last. ` +
        "A count that falls to zero is a reporting problem before it is a safety result.",
      concerning: true,
    };
  }

  if (input.thisPeriod > input.previousPeriod) {
    return {
      line:
        `${input.thisPeriod} reported, up from ${input.previousPeriod}. More reports ` +
        "is the outcome this surface is built for — it reads as candour rather than as risk.",
      concerning: false,
    };
  }

  return {
    line:
      `${input.thisPeriod} reported, against ${input.previousPeriod} in the last period. ` +
      "Counts this small move on one person's habits; read the reports rather than the number.",
    concerning: false,
  };
}
