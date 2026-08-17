import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { ArmoryReader } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import type { ApplicationStatus } from "@/domain/enums";
import { addDays, lagosDateKey, lagosDaysBetween, parseDateColumn } from "@/lib/time";

/**
 * THE READS BEHIND THE MANAGEMENT SURFACES.
 *
 * Kept apart from src/server/armory/dashboard.ts on purpose. That module is M9's
 * owner dashboard — a DAY view, computed for one person. These are the queries
 * the management screens need, and Management §11 is explicit that the two are
 * different products: "It is a day view; intelligence is a season view."
 *
 * Nothing here evaluates a permission. Every function takes a reader and returns
 * rows; the caller has already been admitted by its grant. S1: "No management
 * screen evaluates a permission", and a query module is a screen's accomplice if
 * it starts deciding who may call it.
 */

/**
 * A DATE column that may be null, parsed the one way this codebase parses them.
 *
 * `parseDateColumn` refuses null because most callers hold a NOT NULL column and
 * would rather fail loudly than carry an optional through. Here the nullability
 * is real — a membership may have no renewal date, a licence no expiry — so it
 * is handled once, at the boundary, rather than by widening the parser for
 * everybody.
 */
const dateOrNull = (value: string | null): Date | null =>
  value === null ? null : parseDateColumn(value);

/* ============================================================================
   THE EXPIRY REGISTER — Management §9.3

   "The data exists across M2 and is currently only visible one person at a
    time. A single register — every licence and qualification across staff and
    members, ordered by expiry — turns a recurring compliance failure into a
    routine weekly glance. It is one query and one screen, and it is the
    cheapest serious risk reduction in this document."
   ========================================================================= */

export type ExpiryRow = {
  readonly personId: string;
  readonly name: string;
  readonly memberNumber: number | null;
  readonly kind: "licence" | "qualification" | "membership";
  /** "Firearm licence", "Air rifle sign-off", "Membership renewal". */
  readonly label: string;
  readonly expiresOn: Date;
  /** Negative where it has already lapsed. */
  readonly daysRemaining: number;
};

/**
 * Everything approaching expiry across the whole roster, soonest first.
 *
 * ===========================================================================
 * IT INCLUDES WHAT HAS ALREADY LAPSED, AND THAT IS THE POINT
 *
 * A register showing only the next sixty days is a register that loses a
 * problem the moment it becomes serious. A licence that expired last week is not
 * less interesting than one expiring next week — it is the one somebody will
 * arrive on, and §9.3's whole claim is that this screen stops a lapsed licence
 * being discovered at the firing point.
 *
 * `lapsedWithinDays` bounds the look back so the register does not fill with a
 * qualification somebody let go in 2019 and never renewed. Ninety days is long
 * enough to cover a season's inattention and short enough that the screen stays
 * a list of things to act on.
 *
 * ===========================================================================
 * A DATE COLUMN IS A DAY, NOT AN INSTANT
 *
 * `licences.expires_on` is a DATE and `parseDateColumn` yields midnight in
 * Lagos at the START of it — the defect the capability service's `liveOn` exists
 * to correct, where a licence marked "expires 14 August" was refused all day on
 * the 14th. `lagosDaysBetween` counts whole days from the same parse, so a
 * licence expiring today reports 0 rather than -1, and the register agrees with
 * the desk about which morning is the last one.
 */
export async function expiryRegister(
  db: ArmoryReader,
  input: {
    readonly now: Date;
    readonly withinDays?: number;
    readonly lapsedWithinDays?: number;
  },
): Promise<ExpiryRow[]> {
  const withinDays = input.withinDays ?? 60;
  const lapsedWithinDays = input.lapsedWithinDays ?? 90;

  const horizon = lagosDateKey(addDays(input.now, withinDays));
  const floor = lagosDateKey(addDays(input.now, -lapsedWithinDays));
  const horizonInstant = addDays(input.now, withinDays);
  const floorInstant = addDays(input.now, -lapsedWithinDays);

  const named = {
    personId: schema.people.id,
    firstName: schema.people.firstName,
    lastName: schema.people.lastName,
  };

  const licences = await db
    .select({
      ...named,
      expiresOn: schema.licences.expiresOn,
      number: schema.licences.licenceNumber,
    })
    .from(schema.licences)
    .innerJoin(schema.people, eq(schema.people.id, schema.licences.personId))
    .where(
      and(
        /* Only a VERIFIED licence can expire in a way that matters. §3.1:
           "capability activates only on verified", so an unverified one grants
           nothing today and its expiry date is not yet the club's problem. */
        eq(schema.licences.status, "verified"),
        gte(schema.licences.expiresOn, floor),
        lte(schema.licences.expiresOn, horizon),
      ),
    );

  const qualifications = await db
    .select({
      ...named,
      expiresAt: schema.qualifications.expiresAt,
      discipline: schema.qualifications.discipline,
    })
    .from(schema.qualifications)
    .innerJoin(schema.people, eq(schema.people.id, schema.qualifications.personId))
    .where(
      and(
        gte(schema.qualifications.expiresAt, floorInstant),
        lte(schema.qualifications.expiresAt, horizonInstant),
      ),
    );

  const memberships = await db
    .select({
      ...named,
      renewsOn: schema.memberships.renewsOn,
      memberNumber: schema.memberships.memberNumber,
    })
    .from(schema.memberships)
    .innerJoin(schema.people, eq(schema.people.id, schema.memberships.personId))
    .where(
      and(
        eq(schema.memberships.status, "active"),
        gte(schema.memberships.renewsOn, floor),
        lte(schema.memberships.renewsOn, horizon),
      ),
    );

  const numbers = new Map(
    (
      await db
        .select({
          personId: schema.memberships.personId,
          memberNumber: schema.memberships.memberNumber,
        })
        .from(schema.memberships)
    ).map((row) => [row.personId, row.memberNumber]),
  );

  const rows: ExpiryRow[] = [];

  const push = (
    person: { personId: string; firstName: string; lastName: string },
    kind: ExpiryRow["kind"],
    label: string,
    expiresOn: Date | null,
  ) => {
    if (!expiresOn) return;
    rows.push({
      personId: person.personId,
      name: `${person.firstName} ${person.lastName}`.trim(),
      memberNumber: numbers.get(person.personId) ?? null,
      kind,
      label,
      expiresOn,
      daysRemaining: lagosDaysBetween(input.now, expiresOn),
    });
  };

  for (const row of licences) {
    push(row, "licence", `Firearm licence ${row.number}`, dateOrNull(row.expiresOn));
  }
  for (const row of qualifications) {
    push(row, "qualification", `${row.discipline} sign-off`, row.expiresAt);
  }
  for (const row of memberships) {
    push(row, "membership", "Membership renewal", dateOrNull(row.renewsOn));
  }

  return rows.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

/* ============================================================================
   THE APPLICATIONS QUEUE — Management §8.2

   "*Applications land somewhere nobody owns* is on the blocker register, and it
    is a staffing decision rather than a software one. What the software can do
    is make ownerlessness impossible to ignore: every application carries a
    named owner and an age, and an application with no owner appears on the
    founder's DAY until it has one."
   ========================================================================= */

export type ApplicationRow = {
  readonly id: string;
  readonly personId: string;
  readonly name: string;
  readonly status: ApplicationStatus;
  readonly sponsorType: "member" | "club";
  readonly submittedAt: Date;
  /** Whole Lagos days since it arrived. The number that shames the queue. */
  readonly ageDays: number;
  /**
   * The staff member who owns moving this forward.
   *
   * ALWAYS NULL TODAY, and deliberately not faked. `applications` has
   * `decided_by_staff_id`, which records who CLOSED an application and says
   * nothing about who is carrying it — and quietly reading that column as
   * ownership would report a healthy queue in which every open application is
   * unowned, which is the exact failure the blocker register names.
   *
   * The column this wants does not exist. It is registered as
   * `application-owner` rather than invented, and until it lands every open
   * application renders as unowned, which is true.
   */
  readonly ownerStaffId: string | null;
};

/** Applications still needing somebody, oldest first. */
export async function applicationsQueue(
  db: ArmoryReader,
  input: { readonly now: Date },
): Promise<ApplicationRow[]> {
  const rows = await db
    .select({
      id: schema.applications.id,
      personId: schema.applications.personId,
      firstName: schema.people.firstName,
      lastName: schema.people.lastName,
      status: schema.applications.status,
      sponsorType: schema.applications.sponsorType,
      submittedAt: schema.applications.submittedAt,
    })
    .from(schema.applications)
    .innerJoin(schema.people, eq(schema.people.id, schema.applications.personId))
    /* Open only. A decided application is a record, not a queue item — and a
       queue that keeps its history in it is a queue nobody reads. */
    .where(inArray(schema.applications.status, ["submitted", "under_review"]))
    .orderBy(asc(schema.applications.submittedAt));

  return rows.map((row) => ({
    id: row.id,
    personId: row.personId,
    name: `${row.firstName} ${row.lastName}`.trim(),
    status: row.status,
    sponsorType: row.sponsorType,
    submittedAt: row.submittedAt,
    ageDays: Math.max(0, -lagosDaysBetween(input.now, row.submittedAt)),
    ownerStaffId: null,
  }));
}

/* ============================================================================
   THE DAY'S ARRIVALS — §6.1, front of house
   ========================================================================= */

export type ArrivalRow = {
  readonly personId: string;
  readonly name: string;
  readonly at: Date;
  readonly bookingType: string;
  readonly discipline: string | null;
  readonly checkedIn: boolean;
};

/**
 * Who is expected today, in time order.
 *
 * The desk console has this already, from its day pack, and this is not a second
 * implementation of that screen — §4's design rule is "share the domain, never
 * the interface". This is the same fact read for a different posture: a duty
 * manager on a phone working out whether tonight is covered, rather than an
 * officer checking somebody in.
 */
export async function expectedArrivals(
  db: ArmoryReader,
  input: { readonly now: Date },
): Promise<ArrivalRow[]> {
  const dayStart = new Date(input.now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = addDays(dayStart, 1);

  const rows = await db
    .select({
      personId: schema.bookingParticipants.personId,
      firstName: schema.people.firstName,
      lastName: schema.people.lastName,
      at: schema.bookings.slotStart,
      bookingType: schema.bookings.bookingType,
      discipline: schema.bookings.discipline,
      participationId: schema.participations.id,
    })
    .from(schema.bookings)
    .innerJoin(
      schema.bookingParticipants,
      eq(schema.bookingParticipants.bookingId, schema.bookings.id),
    )
    .innerJoin(schema.people, eq(schema.people.id, schema.bookingParticipants.personId))
    /* Left, not inner: the whole value of this list is the rows with no
       participation — the people who have not arrived yet. */
    .leftJoin(
      schema.participations,
      and(
        eq(schema.participations.personId, schema.bookingParticipants.personId),
        gte(schema.participations.checkedInAt, dayStart),
      ),
    )
    .where(
      and(
        eq(schema.bookings.status, "confirmed"),
        gte(schema.bookings.slotStart, dayStart),
        lte(schema.bookings.slotStart, dayEnd),
      ),
    )
    .orderBy(asc(schema.bookings.slotStart));

  return rows.map((row) => ({
    personId: row.personId,
    name: `${row.firstName} ${row.lastName}`.trim(),
    at: row.at,
    bookingType: row.bookingType,
    discipline: row.discipline,
    checkedIn: row.participationId !== null,
  }));
}

/* ============================================================================
   THE ROSTER — §8.1
   ========================================================================= */

export type RosterRow = {
  readonly personId: string;
  readonly name: string;
  readonly memberNumber: number;
  readonly status: string;
  readonly tierName: string | null;
  readonly startedOn: Date | null;
};

/**
 * Every member, by member number.
 *
 * Ordered by number rather than by name because that is how the club refers to
 * people — §4.3 of the Members Portal makes the member number the permanent
 * anchor of a member's own screens, and a roster sorted differently from the
 * thing everybody quotes is a roster people search instead of read.
 */
export async function roster(db: ArmoryReader): Promise<RosterRow[]> {
  const rows = await db
    .select({
      personId: schema.memberships.personId,
      firstName: schema.people.firstName,
      lastName: schema.people.lastName,
      memberNumber: schema.memberships.memberNumber,
      status: schema.memberships.status,
      tierName: schema.tiers.name,
      startedOn: schema.memberships.startedOn,
    })
    .from(schema.memberships)
    .innerJoin(schema.people, eq(schema.people.id, schema.memberships.personId))
    .leftJoin(schema.tiers, eq(schema.tiers.id, schema.memberships.tierId))
    .orderBy(asc(schema.memberships.memberNumber));

  return rows.map((row) => ({
    personId: row.personId,
    name: `${row.firstName} ${row.lastName}`.trim(),
    memberNumber: row.memberNumber,
    status: row.status,
    tierName: row.tierName,
    startedOn: dateOrNull(row.startedOn),
  }));
}

/* ============================================================================
   THE PERSON RECORD — Management §8.4

   "When a question arises it is almost always about a person… The person record
    answers all of it in one place, assembled across five milestones — and it is
    the screen on which a capability refusal is most useful, because it can show
    not only that a person is blocked but which of six things is blocking them."
   ========================================================================= */

export type PersonRecord = {
  readonly personId: string;
  readonly name: string;
  readonly memberNumber: number | null;
  readonly membershipStatus: string | null;
  readonly tierName: string | null;
  readonly startedOn: Date | null;
  readonly renewsOn: Date | null;
  readonly licences: readonly {
    readonly number: string;
    readonly status: string;
    readonly expiresOn: Date | null;
    readonly calibres: readonly string[];
  }[];
  readonly qualifications: readonly {
    readonly discipline: string;
    readonly level: string;
    readonly expiresAt: Date | null;
  }[];
  readonly waiverSignedAt: Date | null;
};

/**
 * One person, assembled.
 *
 * Deliberately does NOT return an email or a phone number. §11.1's rule about
 * analytics not copying personal data is about a different surface, but the
 * instinct behind it applies here too: a screen answering "why can this member
 * not host" needs their standing and their paperwork, and a contact detail on it
 * is one more copy of a person's private information on one more screen. When
 * the club needs to ring somebody, that is a deliberate addition with its own
 * grant, not a field that arrived because the row had it.
 */
export async function personRecord(
  db: ArmoryReader,
  personId: string,
): Promise<PersonRecord | null> {
  const [person] = await db
    .select({
      id: schema.people.id,
      firstName: schema.people.firstName,
      lastName: schema.people.lastName,
    })
    .from(schema.people)
    .where(eq(schema.people.id, personId))
    .limit(1);

  if (!person) return null;

  const [membership] = await db
    .select({
      memberNumber: schema.memberships.memberNumber,
      status: schema.memberships.status,
      startedOn: schema.memberships.startedOn,
      renewsOn: schema.memberships.renewsOn,
      tierName: schema.tiers.name,
    })
    .from(schema.memberships)
    .leftJoin(schema.tiers, eq(schema.tiers.id, schema.memberships.tierId))
    .where(eq(schema.memberships.personId, personId))
    .limit(1);

  const licences = await db
    .select({
      number: schema.licences.licenceNumber,
      status: schema.licences.status,
      expiresOn: schema.licences.expiresOn,
      calibres: schema.licences.calibres,
    })
    .from(schema.licences)
    .where(eq(schema.licences.personId, personId));

  const qualifications = await db
    .select({
      discipline: schema.qualifications.discipline,
      level: schema.qualifications.level,
      expiresAt: schema.qualifications.expiresAt,
    })
    .from(schema.qualifications)
    .where(eq(schema.qualifications.personId, personId));

  const [waiver] = await db
    .select({ signedAt: schema.waiverSignatures.signedAt })
    .from(schema.waiverSignatures)
    .where(eq(schema.waiverSignatures.personId, personId))
    .orderBy(asc(schema.waiverSignatures.signedAt));

  return {
    personId: person.id,
    name: `${person.firstName} ${person.lastName}`.trim(),
    memberNumber: membership?.memberNumber ?? null,
    membershipStatus: membership?.status ?? null,
    tierName: membership?.tierName ?? null,
    startedOn: dateOrNull(membership?.startedOn ?? null),
    renewsOn: dateOrNull(membership?.renewsOn ?? null),
    licences: licences.map((row) => ({
      number: row.number,
      status: row.status,
      expiresOn: dateOrNull(row.expiresOn),
      calibres: row.calibres,
    })),
    qualifications,
    waiverSignedAt: waiver?.signedAt ?? null,
  };
}
