/**
 * THE OWNER DASHBOARD — §6.6, §11 M9.
 *
 *   "Roster against cap with waitlist depth; hosting rate; guest-to-application
 *    conversion; admissions by host; occupancy by day and slot separating
 *    member and guest load; lapse list; revenue by source; reconciliation
 *    exceptions; expiries within 90 days; overrides in the last 7 days."
 *
 * Ten metrics, and the list is not arbitrary. Read alongside §1.1 it is a
 * founder's answer to four questions, in order of how much money each is worth:
 *
 *   Is the club filling?      roster, waitlist, lapse list
 *   Is the funnel working?    hosting rate, conversion, admissions by host
 *   Is the range being used?  occupancy, member against guest load
 *   Is anything wrong?        exceptions, expiries, overrides
 *
 * ===========================================================================
 * PURE, AND THAT IS NOT A STYLE PREFERENCE HERE
 *
 * A dashboard is the surface where wrong numbers survive longest, because
 * nobody can tell by looking. A conversion rate computed with the wrong
 * denominator reads exactly like one computed with the right one, and the
 * founder makes decisions on it for a year.
 *
 * So every ratio below is a function over rows, with a test that states the
 * denominator in English. The SQL that assembles those rows can be wrong in its
 * own way — and is checked separately — but the arithmetic cannot be wrong
 * without a test saying so.
 *
 * ===========================================================================
 * EVERY RATE STATES ITS DENOMINATOR ON SCREEN
 *
 * `hostingRate` is not a number, it is `{ hosts, eligible, rate, line }`, and
 * the line reads "9 of 31 members who can host brought a guest". That is
 * deliberate: "29%" alone invites a founder to compare it against a figure from
 * a different denominator six months later.
 */

/* ============================================================================
   IS THE CLUB FILLING?
   ========================================================================= */

export type RosterMetric = {
  readonly seated: number;
  /** Null while §14 leaves the cap unset — see `clubSettings`. */
  readonly cap: number | null;
  readonly waitlistDepth: number;
  /** Seats left, or null when there is no cap to count against. */
  readonly headroom: number | null;
  readonly line: string;
};

export function rosterMetric(input: {
  readonly seated: number;
  readonly cap: number | null;
  readonly waitlistDepth: number;
}): RosterMetric {
  const { seated, cap, waitlistDepth } = input;
  const headroom = cap === null ? null : Math.max(0, cap - seated);

  const line =
    cap === null
      ? `${seated} members. No roster cap set.`
      : headroom === 0
        ? `${seated} of ${cap} — full. ${waitlistDepth} waiting.`
        : `${seated} of ${cap}. ${headroom} ${headroom === 1 ? "seat" : "seats"} left.`;

  return { seated, cap, waitlistDepth, headroom, line };
}

/* ============================================================================
   IS THE FUNNEL WORKING?
   ========================================================================= */

export type RateMetric = {
  readonly numerator: number;
  readonly denominator: number;
  /** 0–1. Zero when the denominator is zero — never NaN on a screen. */
  readonly rate: number;
  /** States the denominator, always. See the header. */
  readonly line: string;
};

const rateOf = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

/**
 * How many members who CAN host actually did, in the period.
 *
 * ===========================================================================
 * THE DENOMINATOR IS MEMBERS WHO CAN HOST, NOT ALL MEMBERS
 *
 * §3.1 gives tiers a `can_host` column and not every tier has it. Dividing by
 * the whole roster would report a club as having a poor hosting rate when what
 * it actually has is a lot of members on a tier that never had the privilege —
 * and the founder's response to a poor hosting rate is to spend money
 * encouraging hosting, which would do nothing.
 */
export function hostingRate(input: {
  readonly hostsWhoInvited: number;
  readonly membersWhoCanHost: number;
}): RateMetric {
  const { hostsWhoInvited, membersWhoCanHost } = input;

  return {
    numerator: hostsWhoInvited,
    denominator: membersWhoCanHost,
    rate: rateOf(hostsWhoInvited, membersWhoCanHost),
    line: `${hostsWhoInvited} of ${membersWhoCanHost} members who can host brought a guest.`,
  };
}

/**
 * §3.2's acquisition funnel, as one number.
 *
 * ===========================================================================
 * THE DENOMINATOR IS DISTINCT GUESTS, NOT GUEST VISITS
 *
 * §3.2 is explicit that `guest_visit_summary` counts "across all hosts, not per
 * host", and the same person brought four times is one prospect, not four. A
 * conversion rate over VISITS would fall every time a guest enjoyed themselves
 * enough to come back — the club's best signal, reported as a decline.
 */
export function guestConversion(input: {
  readonly guestsWhoApplied: number;
  readonly distinctGuests: number;
}): RateMetric {
  const { guestsWhoApplied, distinctGuests } = input;

  return {
    numerator: guestsWhoApplied,
    denominator: distinctGuests,
    rate: rateOf(guestsWhoApplied, distinctGuests),
    line: `${guestsWhoApplied} of ${distinctGuests} guests went on to apply.`,
  };
}

export type HostAdmissions = {
  readonly hostPersonId: string;
  readonly hostName: string;
  readonly guestsBrought: number;
  readonly applications: number;
  readonly admitted: number;
};

/**
 * §6.6's "admissions by host", ranked by admissions and then by guests brought.
 *
 * This is the club's most commercially useful list and the reason it is on the
 * dashboard rather than in a report: §1.1 makes admission sponsor-led, so the
 * members who bring people who join ARE the growth channel. Ranking by
 * admissions rather than by guests brought is the whole point — a member who
 * brings twelve guests and converts none is a different fact from one who
 * brings three and converts two.
 */
export const rankHosts = (
  hosts: readonly HostAdmissions[],
): readonly HostAdmissions[] =>
  [...hosts].sort(
    (a, b) =>
      b.admitted - a.admitted ||
      b.applications - a.applications ||
      b.guestsBrought - a.guestsBrought ||
      a.hostName.localeCompare(b.hostName),
  );

/* ============================================================================
   IS THE RANGE BEING USED?
   ========================================================================= */

export type OccupancyCell = {
  /** Lagos calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  /** Slot start, `HH:MM` in Lagos. */
  readonly slot: string;
  readonly memberCount: number;
  readonly guestCount: number;
  readonly total: number;
  /** Positions the club had available in that slot, or null when unknown. */
  readonly capacity: number | null;
  /** 0–1 against capacity, or null. */
  readonly utilisation: number | null;
};

/**
 * §6.6: "occupancy by day and slot SEPARATING MEMBER AND GUEST LOAD."
 *
 * ===========================================================================
 * WHY THE SEPARATION IS THE POINT AND NOT A REFINEMENT
 *
 * A full Saturday evening is a good problem or a bad one depending entirely on
 * this split. Full of members is a club that needs more lanes. Full of guests is
 * a club whose members cannot book the range they pay for — and §1.2 rule 5
 * means those guests are also, at the margin, being subsidised by the very
 * members being crowded out.
 *
 * A combined occupancy number cannot tell those apart, and they call for
 * opposite decisions.
 */
export function occupancy(input: {
  readonly participations: readonly {
    readonly date: string;
    readonly slot: string;
    readonly isGuest: boolean;
  }[];
  /** Positions available per (date, slot). Absent entries render as null. */
  readonly capacityBySlot?: ReadonlyMap<string, number>;
}): OccupancyCell[] {
  const cells = new Map<string, { member: number; guest: number }>();

  for (const row of input.participations) {
    const key = `${row.date} ${row.slot}`;
    const cell = cells.get(key) ?? { member: 0, guest: 0 };
    if (row.isGuest) cell.guest += 1;
    else cell.member += 1;
    cells.set(key, cell);
  }

  return [...cells.entries()]
    .map(([key, cell]) => {
      const [date, slot] = key.split(" ");
      const total = cell.member + cell.guest;
      const capacity = input.capacityBySlot?.get(key) ?? null;

      return {
        date,
        slot,
        memberCount: cell.member,
        guestCount: cell.guest,
        total,
        capacity,
        /* Capped at 1. A slot can legitimately hold more people than its
           recorded capacity — an officer moves somebody, a lane takes two — and
           a chart with a 140% bar reads as a bug rather than as a busy night. */
        utilisation:
          capacity === null || capacity === 0
            ? null
            : Math.min(1, total / capacity),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot));
}

/* ============================================================================
   IS ANYTHING WRONG?
   ========================================================================= */

export type LapseRow = {
  readonly personId: string;
  readonly name: string;
  readonly memberNumber: number;
  readonly lapsedOn: Date;
  readonly line: string;
};

/**
 * §6.6's "lapse list", newest first.
 *
 * Newest first because a membership that lapsed last week is recoverable with a
 * phone call and one that lapsed in March is a different conversation. A list
 * sorted by member number would bury this week's under two years of history.
 */
export const lapseList = (
  rows: readonly Omit<LapseRow, "line">[],
  now: Date,
): LapseRow[] =>
  [...rows]
    .sort((a, b) => b.lapsedOn.getTime() - a.lapsedOn.getTime())
    .map((row) => ({
      ...row,
      line: `${row.name} — lapsed ${describeAge(row.lapsedOn, now)}.`,
    }));

export type OverrideRow = {
  readonly id: string;
  readonly action: string;
  readonly reason: string;
  readonly actorName: string;
  readonly occurredAt: Date;
};

/**
 * §12: an override "appears on the founder's dashboard THE SAME DAY".
 *
 * §6.6 asks for the last seven days, and the window is a parameter rather than a
 * constant so the two requirements can both hold: the dashboard shows seven
 * days, and a same-day check reads the same function with a different window.
 */
export const recentOverrides = (
  rows: readonly OverrideRow[],
  since: Date,
): readonly OverrideRow[] =>
  rows
    .filter((row) => row.occurredAt.getTime() >= since.getTime())
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

/* ============================================================================
   THE ONE LINE AT THE TOP
   ========================================================================= */

/**
 * What the founder reads before anything else.
 *
 * Ordered by what would ruin a week, not by what is interesting. An integrity
 * problem in the firearm register outranks a full roster; a full roster
 * outranks everything else.
 *
 * The quiet case says "Nothing needs you" rather than listing what is fine —
 * the same rule the exception list follows, and for the same reason: a
 * dashboard that always says something is a dashboard nobody reads.
 */
export function dashboardHeadline(input: {
  readonly integrityExceptions: number;
  readonly attentionExceptions: number;
  readonly overrides: number;
  readonly expiringSoon: number;
  readonly roster: RosterMetric;
}): string {
  if (input.integrityExceptions > 0) {
    return `${input.integrityExceptions} ${
      input.integrityExceptions === 1 ? "record disagrees" : "records disagree"
    } with the log.`;
  }

  if (input.attentionExceptions > 0) {
    return `${input.attentionExceptions} ${
      input.attentionExceptions === 1 ? "thing is" : "things are"
    } unaccounted for.`;
  }

  if (input.roster.headroom === 0) {
    return `The roster is full. ${input.roster.waitlistDepth} waiting.`;
  }

  if (input.overrides > 0) {
    return `${input.overrides} ${
      input.overrides === 1 ? "override" : "overrides"
    } in the last seven days.`;
  }

  if (input.expiringSoon > 0) {
    return `${input.expiringSoon} ${
      input.expiringSoon === 1 ? "document expires" : "documents expire"
    } within ninety days.`;
  }

  return "Nothing needs you today.";
}

/** "three days ago", "last month". Plain, and never a bare date. */
function describeAge(at: Date, now: Date): string {
  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);

  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}
