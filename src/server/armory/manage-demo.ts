import { naira, type Kobo } from "@/lib/money";
import { addDays, lagosDateKey } from "@/lib/time";
import type { DegradationCause, NearMissKind, OperatingLevel } from "@/domain/enums";
import type { NearMissRecord } from "@/domain/near-miss";
import type { RevenueCharge } from "@/domain/revenue";
import type { ServiceRecord, VisitRecord } from "@/domain/intelligence";
import type {
  ApplicationRow,
  ArrivalRow,
  BalanceRow,
  ExpiryRow,
  FailedPaymentRow,
  LevelEvent,
  PersonRecord,
  RosterRow,
} from "./manage-reads";

/**
 * DEMONSTRATION DATA — a club that does not exist.
 *
 * Founder's decision, 17 August 2026: generated in memory and NEVER written.
 *
 * ===========================================================================
 * WHY IT CANNOT BE SEEDED INTO THE DATABASE, WHICH WAS THE OTHER OPTION
 *
 * `participations`, `charges`, `custody_events`, `staff_grants`,
 * `operating_level_events` and `near_miss_reports` are append-only, and 0002,
 * 0011 and 0012 enforce that with triggers that REFUSE DELETE. Seeding a
 * demonstration into them would put fake entries in the club's attendance
 * record, its ledger and its safety register permanently — surviving the demo,
 * the launch and the season, with no supported way to remove them.
 *
 * A TRUNCATE would not help either: every one of those tables carries a
 * statement-level guard precisely so the append-only guarantee has no one-word
 * bypass.
 *
 * So this module writes nothing. Toggling demonstration mode off is instant and
 * leaves no trace, because there was never anything to clean up.
 *
 * ===========================================================================
 * DETERMINISTIC, BECAUSE THE MANAGEMENT SURFACE IS force-dynamic
 *
 * Every request re-renders. A generator using Math.random would reshuffle the
 * roster on every navigation, move a member's balance while somebody read it,
 * and make the whole surface feel broken in a way that would be blamed on the
 * real product.
 *
 * So the PRNG is seeded from a constant, and anything dated is derived from the
 * Lagos date rather than from the instant — the club's demonstration day is
 * stable from midnight to midnight and the arrivals list does not re-sort while
 * a duty manager is looking at it.
 *
 * ===========================================================================
 * IT IS NOT AN IMITATION OF THIS CLUB'S REAL MEMBERS
 *
 * Names below are invented. None is a real member, and nothing here is derived
 * from the live database — this module does not take a reader and could not read
 * one if it wanted to. That matters for the same reason the CMS is forbidden
 * personal data: a demonstration built from real people is a copy of the roster
 * living somewhere nobody is auditing.
 */

/* ============================================================================
   THE SEED
   ========================================================================= */

/**
 * mulberry32 — small, fast, and good enough for arranging a demonstration.
 *
 * Not for anything else. Every secret in this codebase comes from a CSPRNG
 * (`randomBytes` in staff-session.ts, Web Crypto in device-auth.ts) and this is
 * deliberately not one, so it must never be reached for by something that needs
 * unpredictability. It is here because a demonstration needs the opposite of
 * unpredictability.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The demonstration is the same club every time it is opened. */
const SEED = 0x41524d59; /* "ARMY" — the club's own initials, as a number. */

type Rng = {
  readonly next: () => number;
  readonly int: (min: number, max: number) => number;
  readonly pick: <T>(from: readonly T[]) => T;
  readonly chance: (probability: number) => boolean;
};

function rng(offset: number): Rng {
  const next = mulberry32(SEED + offset);
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    pick: <T>(from: readonly T[]) => from[int(0, from.length - 1)],
    chance: (probability: number) => next() < probability,
  };
}

/* ============================================================================
   THE PEOPLE

   Invented, and deliberately plausible for Abuja rather than generic. A
   demonstration full of "John Smith" tells a founder nothing about how the
   roster will read, and name length is what actually breaks a table layout.
   ========================================================================= */

const FIRST_NAMES = [
  "Adaeze", "Bode", "Chika", "Dele", "Emeka", "Fatima", "Gbenga", "Halima",
  "Ifeoma", "Jide", "Kemi", "Lawal", "Maryam", "Nnamdi", "Obiageli", "Paul",
  "Ramat", "Segun", "Tunde", "Uche", "Victor", "Yemi", "Zainab", "Aisha",
  "Chinedu", "Damilola", "Ebele", "Folake", "Godwin", "Hauwa", "Ikenna",
];

const LAST_NAMES = [
  "Abiodun", "Balogun", "Chukwu", "Danjuma", "Eze", "Fashola", "Garba",
  "Ibrahim", "Jibrin", "Kalu", "Lawal", "Mohammed", "Nwosu", "Okonkwo",
  "Oyelaran", "Sanusi", "Tanko", "Umeh", "Yusuf", "Adebayo", "Bello",
];

const TIERS = ["Founding", "Full", "Associate", "Corporate"];
const DISCIPLINES = ["Air rifle", "Air pistol", "Small bore", "Shotgun"];

const nameFor = (r: Rng): string => `${r.pick(FIRST_NAMES)} ${r.pick(LAST_NAMES)}`;

/**
 * A stable person id that is visibly not a real one.
 *
 * The `demo` prefix is load-bearing rather than decorative. Any id that escaped
 * this module and reached a query would find nothing, and a support conversation
 * about a member id beginning `demo-` resolves in one glance — where a
 * well-formed UUID would send somebody looking through the roster for a person
 * who never existed.
 */
const idFor = (index: number, kind: string): string => `demo-${kind}-${index}`;

/* ============================================================================
   THE ROSTER
   ========================================================================= */

const MEMBER_COUNT = 118;

export function demoRoster(): RosterRow[] {
  const r = rng(1);
  const rows: RosterRow[] = [];

  for (let index = 0; index < MEMBER_COUNT; index += 1) {
    /* A club of 118 against a cap of 125 — §11.2's roster metric is only
       interesting when it is near the cap, and a demonstration sitting at 20%
       would make the founder's most-watched number look idle. */
    const founding = index < 25;
    rows.push({
      personId: idFor(index, "person"),
      name: nameFor(r),
      memberNumber: 1 + index,
      /* Mostly active, with the handful of other states a real roster carries —
         a suspended member and a couple of lapsed ones are what makes the
         standing column worth having. */
      status: founding
        ? "active"
        : r.chance(0.04)
          ? "lapsed"
          : r.chance(0.02)
            ? "suspended"
            : "active",
      tierName: founding ? "Founding" : r.pick(TIERS.slice(1)),
      startedOn: addDays(new Date("2026-08-17T00:00:00Z"), -r.int(20, 400)),
    });
  }

  return rows;
}

/* ============================================================================
   THE APPLICATIONS QUEUE — §8.2
   ========================================================================= */

export function demoApplications(now: Date): ApplicationRow[] {
  const r = rng(2);
  const count = 9;

  return Array.from({ length: count }, (_, index) => {
    /* Ages spread across a fortnight and beyond, because §8.2's whole point is
       that an application's AGE is the number that shames the queue — and a
       demonstration where everything arrived today would hide that. */
    const ageDays = [1, 2, 3, 5, 8, 12, 19, 26, 41][index] ?? 1;

    return {
      id: idFor(index, "application"),
      personId: idFor(200 + index, "person"),
      name: nameFor(r),
      status: ageDays > 7 ? "under_review" : "submitted",
      sponsorType: r.chance(0.55) ? "member" : "club",
      submittedAt: addDays(now, -ageDays),
      ageDays,
      /* Two of nine owned, which is the state a real queue is in: somebody
         picked up the ones that arrived while they were at their desk. */
      ownerStaffId: index < 2 ? idFor(index, "staff") : null,
      ownerName: index < 2 ? nameFor(r) : null,
    };
  });
}

/* ============================================================================
   TODAY
   ========================================================================= */

export function demoArrivals(now: Date): ArrivalRow[] {
  /* Seeded from the DATE, so the day's arrivals are stable from midnight to
     midnight and do not re-sort while somebody is reading them. */
  const r = rng(3 + dateOffset(now));
  const roster = demoRoster();
  const count = r.int(9, 16);

  const rows: ArrivalRow[] = [];
  for (let index = 0; index < count; index += 1) {
    const member = roster[r.int(0, roster.length - 1)];
    const hour = 9 + Math.floor((index / count) * 8);
    const at = new Date(now);
    at.setUTCHours(hour - 1, (index % 4) * 15, 0, 0);

    /**
     * Every draw happens unconditionally, and that is not style.
     *
     * A `r.chance()` inside a branch consumes the generator only when the branch
     * is taken, so the STREAM diverges — and the branch here depends on the time
     * of day. The first version read `checkedIn: at < now && r.chance(0.8)`,
     * which produced a different roster at noon and at half past seven on the
     * same date, because fewer arrivals were in the past and fewer draws had been
     * made by the time the loop reached them.
     *
     * A test caught it. The rule is: draw first, decide afterwards.
     */
    const shooting = r.chance(0.7);
    const wantsTable = r.chance(0.6);
    const discipline = r.pick(DISCIPLINES);
    const arrived = r.chance(0.8);

    rows.push({
      personId: member.personId,
      name: member.name,
      at,
      bookingType: shooting ? "shoot" : wantsTable ? "table" : "both",
      discipline: shooting ? discipline : null,
      /* Earlier slots have arrived; later ones have not. What a duty manager
         actually wants from this panel is the ones who have NOT. */
      checkedIn: at.getTime() < now.getTime() && arrived,
    });
  }

  return rows.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/* ============================================================================
   COMPLIANCE — §9.3
   ========================================================================= */

export function demoExpiries(now: Date): ExpiryRow[] {
  const r = rng(4);
  const roster = demoRoster();
  const rows: ExpiryRow[] = [];

  /* Three already lapsed, deliberately. §9.3's claim is that this register stops
     a lapsed licence being found at the firing point, and a demonstration with
     nothing lapsed would not show the founder the thing the screen is for. */
  const offsets = [-38, -12, -3, 2, 6, 9, 14, 21, 27, 34, 41, 48, 55, 63, 71, 84];

  offsets.forEach((days, index) => {
    const member = roster[(index * 7) % roster.length];
    const kind = (["licence", "qualification", "membership"] as const)[index % 3];

    rows.push({
      personId: member.personId,
      name: member.name,
      memberNumber: member.memberNumber,
      kind,
      label:
        kind === "licence"
          ? `Firearm licence FRN-${20000 + r.int(100, 999)}`
          : kind === "qualification"
            ? `${r.pick(DISCIPLINES)} sign-off`
            : "Membership renewal",
      expiresOn: addDays(now, days),
      daysRemaining: days,
    });
  });

  return rows.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

/* ============================================================================
   THE PERSON RECORD — §8.4
   ========================================================================= */

export function demoPerson(personId: string): PersonRecord | null {
  const roster = demoRoster();
  const member = roster.find((row) => row.personId === personId);
  if (!member) return null;

  const r = rng(5 + member.memberNumber);
  const anchor = new Date("2026-08-17T00:00:00Z");

  return {
    personId: member.personId,
    name: member.name,
    memberNumber: member.memberNumber,
    membershipStatus: member.status,
    tierName: member.tierName,
    startedOn: member.startedOn,
    renewsOn: addDays(anchor, r.int(-20, 300)),
    licences: r.chance(0.4)
      ? [
          {
            number: `FRN-${20000 + r.int(100, 999)}`,
            status: r.chance(0.8) ? "verified" : "pending_review",
            expiresOn: addDays(anchor, r.int(-30, 500)),
            calibres: [r.pick([".22 LR", "4.5mm", "12 gauge"])],
          },
        ]
      : [],
    qualifications: Array.from({ length: r.int(0, 3) }, () => ({
      discipline: r.pick(DISCIPLINES),
      level: r.pick(["Introductory", "Competent", "Competition"]),
      expiresAt: r.chance(0.7) ? addDays(anchor, r.int(-10, 400)) : null,
    })),
    waiverSignedAt: r.chance(0.92) ? addDays(anchor, -r.int(1, 300)) : null,
  };
}

/* ============================================================================
   MONEY — §10, §11.2
   ========================================================================= */

/**
 * A quarter of trading.
 *
 * The mix is arranged to make the club's own strategic question legible rather
 * than to flatter it: F&B is a real line but not the largest, which is the state
 * §11.2 says would falsify the hospitality thesis if it persisted. A
 * demonstration where F&B dominated would show the founder a club they do not
 * have and quietly answer the question the surface exists to ask.
 */
export function demoCharges(now: Date): RevenueCharge[] {
  const r = rng(6);
  const charges: RevenueCharge[] = [];

  for (let day = 90; day >= 0; day -= 1) {
    const at = addDays(now, -day);
    const busy = [0, 5, 6].includes(at.getUTCDay());

    for (let n = 0; n < (busy ? r.int(3, 7) : r.int(1, 4)); n += 1) {
      const roll = r.next();
      const [referenceType, amount]: [RevenueCharge["referenceType"], Kobo] =
        roll < 0.42
          ? ["booking", naira(r.int(4, 12) * 1000)]
          : roll < 0.72
            ? ["fnb", naira(r.int(2, 18) * 1000)]
            : roll < 0.85
              ? ["guest_visit", naira(15000)]
              : roll < 0.97
                ? ["membership", naira(r.int(60, 250) * 1000)]
                : ["adjustment", naira(r.int(1, 5) * 1000)];

      charges.push({ referenceType, totalKobo: amount, raisedAt: at });
    }
  }

  return charges;
}

export function demoBalances(): BalanceRow[] {
  const r = rng(7);
  const roster = demoRoster();

  return Array.from({ length: 11 }, (_, index) => {
    const member = roster[(index * 13) % roster.length];
    const ageDays = [64, 51, 44, 38, 29, 22, 17, 11, 7, 4, 2][index];

    return {
      personId: member.personId,
      name: member.name,
      memberNumber: member.memberNumber,
      outstandingKobo: naira(r.int(3, 90) * 1000),
      ageDays,
    };
  }).sort((a, b) => b.ageDays - a.ageDays);
}

export function demoFailedPayments(): FailedPaymentRow[] {
  const r = rng(8);
  const roster = demoRoster();
  /* Anchored rather than taken from the clock, so the list is stable across
     renders for the same reason everything else here is. */
  const anchor = new Date("2026-08-17T00:00:00Z");

  return Array.from({ length: 4 }, (_, index) => {
    const member = roster[(index * 29) % roster.length];
    return {
      id: idFor(index, "payment"),
      personId: member.personId,
      name: member.name,
      amountKobo: naira(r.int(5, 120) * 1000),
      purpose: r.pick(["subscription", "guest_overage", "bar"]),
      at: addDays(anchor, -r.int(1, 20)),
      gatewayReference: `ps_demo_${1000 + index}`,
    };
  }).sort((a, b) => b.at.getTime() - a.at.getTime());
}

/* ============================================================================
   THE TWO FALSIFYING NUMBERS — §11.2
   ========================================================================= */

/**
 * Visits and F&B sales, arranged so the non-shooting share is real but modest.
 *
 * Roughly a third of visits fire nothing, which is a club whose hospitality is
 * working without having taken over. Same reasoning as the revenue mix: the
 * demonstration must not answer the founder's strategic question for them.
 */
export function demoVisitEvidence(now: Date): {
  visits: VisitRecord[];
  service: ServiceRecord[];
} {
  const r = rng(9);
  const roster = demoRoster();
  const visits: VisitRecord[] = [];
  const service: ServiceRecord[] = [];

  for (let day = 90; day >= 0; day -= 1) {
    const at = addDays(now, -day);
    const busy = [0, 5, 6].includes(at.getUTCDay());

    for (let n = 0; n < (busy ? r.int(6, 14) : r.int(2, 7)); n += 1) {
      const member = roster[r.int(0, roster.length - 1)];
      const fired = r.chance(0.68);
      visits.push({ personId: member.personId, at, firedRound: fired });
      if (!fired || r.chance(0.3)) {
        service.push({ personId: member.personId, at });
      }
    }

    /* A handful of people each week who bought lunch and never checked in — the
       exact case F4 exists for, and the one the real number can only see through
       a charge. */
    if (r.chance(0.35)) {
      const member = roster[r.int(0, roster.length - 1)];
      service.push({ personId: member.personId, at });
    }
  }

  return { visits, service };
}

/**
 * Check-in durations — §11.4.
 *
 * Mostly comfortably inside the promise, with a small tail that breaches it,
 * because a demonstration where every check-in took nine seconds would show the
 * founder a number that can only ever be good news.
 */
export function demoCheckInDurations(): number[] {
  const r = rng(10);
  return Array.from({ length: 214 }, () =>
    r.chance(0.94) ? r.int(6, 15) : r.int(18, 95),
  );
}

/* ============================================================================
   SAFETY — §6.2, §9.2
   ========================================================================= */

export function demoLevelHistory(now: Date): LevelEvent[] {
  const r = rng(11);

  /* Episodes rather than isolated moves: the club went down and came back up,
     which is what §11.3's degradation count is counting. Staffing dominates,
     which is the argument §6.2 says the founder would otherwise make from
     memory. */
  const episodes: {
    days: number;
    to: OperatingLevel;
    cause: DegradationCause;
    note: string;
  }[] = [
    { days: 3, to: "guests_capped", cause: "staffing", note: "One officer off sick, Saturday evening." },
    { days: 11, to: "live_fire_closed", cause: "coverage", note: "No qualified officer for the small bore line." },
    { days: 19, to: "guests_capped", cause: "staffing", note: "Front of house single-crewed from 6pm." },
    { days: 26, to: "range_closed", cause: "stadium", note: "Stadium closed the access road for an event." },
    { days: 34, to: "guests_capped", cause: "staffing", note: "Two officers at the Aduvie fixture." },
    { days: 47, to: "live_fire_closed", cause: "equipment", note: "Ventilation fault on the indoor line." },
  ];

  const events: LevelEvent[] = [];
  episodes.forEach((episode, index) => {
    const at = addDays(now, -episode.days);
    events.push({
      id: idFor(index * 2, "level"),
      from: "normal",
      to: episode.to,
      cause: episode.cause,
      note: episode.note,
      at,
      setByName: nameFor(r),
    });
    events.push({
      id: idFor(index * 2 + 1, "level"),
      from: episode.to,
      to: "normal",
      cause: episode.cause,
      note: "Cover restored; back to normal operation.",
      at: new Date(at.getTime() + r.int(2, 6) * 3_600_000),
      setByName: nameFor(r),
    });
  });

  return events.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export function demoNearMisses(now: Date): NearMissRecord[] {
  const r = rng(12);

  const reports: { days: number; kind: NearMissKind; what: string; where: string | null }[] = [
    { days: 2, kind: "line_discipline", what: "Shooter turned from the line with the action still closed. Spotted before they stepped back.", where: "Lane 4" },
    { days: 5, kind: "movement", what: "A guest walked forward of the firing line to check a target while the relay was live.", where: "Indoor line" },
    { days: 9, kind: "equipment", what: "Rifle failed to eject and the shooter raised it to look down the barrel.", where: "Lane 2" },
    { days: 14, kind: "ammunition", what: "Two calibres left open on the same bench during a changeover.", where: "Bench 3" },
    { days: 21, kind: "line_discipline", what: "Muzzle came off target during a magazine change, swept the empty lane beside it.", where: "Lane 6" },
    { days: 30, kind: "other", what: "Door to the range propped open during live fire; nobody in the corridor at the time.", where: null },
    { days: 44, kind: "movement", what: "Spectator stood up behind the line without ear protection while the relay was running.", where: "Deck rail" },
  ];

  return reports.map((report, index) => {
    /* Roughly half named, half anonymous — the founder's decision working, and
       the mix that shows why the LIST must not distinguish them. */
    const named = r.chance(0.5);
    return {
      id: idFor(index, "nearmiss"),
      kind: report.kind,
      whatHappened: report.what,
      location: report.where,
      reportedAt: addDays(now, -report.days),
      reportedByStaffId: named ? idFor(index, "staff") : null,
      reporterName: named ? nameFor(r) : null,
    };
  });
}

/* ============================================================================
   HELPERS
   ========================================================================= */

/**
 * A stable per-day offset, so anything dated re-rolls at Lagos midnight rather
 * than on every render — and rolls to something different tomorrow, so the
 * demonstration does not look frozen.
 */
function dateOffset(now: Date): number {
  const key = lagosDateKey(now);
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return Math.abs(hash % 9973);
}
