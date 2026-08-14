import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { ArmoryReader } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import {
  dashboardHeadline,
  guestConversion,
  hostingRate,
  lapseList,
  occupancy,
  rankHosts,
  recentOverrides,
  rosterMetric,
  type HostAdmissions,
  type OccupancyCell,
  type OverrideRow,
  type RateMetric,
  type RosterMetric,
} from "@/domain/dashboard";
import { exceptionSummary, type ArmouryException } from "@/domain/exceptions";
import { addDays, lagosDateKey } from "@/lib/time";
import { format, fromStorage } from "@/lib/money";
import { armouryExceptionReport } from "./register";
import { revenueByPurpose } from "./money";

/**
 * THE OWNER DASHBOARD'S QUERIES — §6.6, §11 M9.
 *
 * The arithmetic is in src/domain/dashboard.ts and is tested there. This module
 * assembles rows and hands them over; it computes no ratio and decides no
 * ordering that the domain layer owns.
 *
 * ===========================================================================
 * THE WINDOW IS A PARAMETER AND IT IS NOT "ALL TIME"
 *
 * Every rate here is over a period, and the period has to be stated on screen
 * or the number means nothing. Ninety days is the default because it is long
 * enough to smooth a quiet fortnight and short enough that a founder reading it
 * in August is being told about this season rather than about the launch.
 *
 * §6.6's own windows are respected where it gives one: expiries within ninety
 * days, overrides in the last seven.
 *
 * ===========================================================================
 * FULL SCANS, AND THAT IS FINE AT THIS SIZE
 *
 * §2.1 puts staging at a hundred members with a few hundred sessions. Several
 * of these are aggregates over the whole table.
 *
 * That will not survive ten times the data, and the honest version of this note
 * is the one src/app/api/exceptions/route.ts already gives: the fix is
 * materialised aggregates or a scheduled roll-up, neither is needed now, and
 * building either now would be building a cache nobody can verify against a
 * table nobody has filled.
 */

/** How far back the rates look, unless the caller says otherwise. */
const DEFAULT_WINDOW_DAYS = 90;

/** §6.6's own window for documents about to run out. */
const EXPIRY_HORIZON_DAYS = 90;

/** §6.6's own window for overrides. §12 wants same-day; this is the list. */
const OVERRIDE_WINDOW_DAYS = 7;

export type DashboardView = {
  /** The one line at the top. Ordered by what would ruin a week. */
  readonly headline: string;
  readonly windowDays: number;
  readonly roster: RosterMetric;
  readonly hosting: RateMetric;
  readonly conversion: RateMetric;
  readonly admissionsByHost: readonly HostAdmissions[];
  readonly occupancy: readonly OccupancyCell[];
  readonly lapses: ReturnType<typeof lapseList>;
  readonly revenue: readonly {
    readonly purpose: string;
    readonly totalKobo: number;
    readonly label: string;
    readonly count: number;
  }[];
  readonly exceptions: readonly ArmouryException[];
  readonly exceptionSummary: string;
  readonly expiring: readonly {
    readonly kind: "licence" | "qualification";
    readonly personName: string;
    readonly expiresOn: string;
    readonly line: string;
  }[];
  readonly overrides: readonly OverrideRow[];
};

export async function dashboard(
  tx: ArmoryReader,
  now: Date,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<DashboardView> {
  const since = addDays(now, -windowDays);
  const overridesSince = addDays(now, -OVERRIDE_WINDOW_DAYS);
  const expiryHorizon = lagosDateKey(addDays(now, EXPIRY_HORIZON_DAYS));
  const today = lagosDateKey(now);

  /* ---------------------------------------------------------------- ROSTER */

  const [seatedRow] = await tx
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(schema.memberships)
    /* §3.1's seat-holders. `rosterStanding` in src/domain/roster.ts decides
       which statuses occupy a seat; this mirrors its answer rather than
       inventing a second one — a suspended member has not given their seat
       back, and a resigned one has. */
    .where(inArray(schema.memberships.status, ["active", "pending", "suspended"]));

  const [waitlistRow] = await tx
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(schema.waitlistEntries)
    .where(inArray(schema.waitlistEntries.status, ["waiting", "contacted"]));

  const [settings] = await tx
    .select({ rosterCap: schema.clubSettings.rosterCap })
    .from(schema.clubSettings)
    .limit(1);

  const roster = rosterMetric({
    seated: seatedRow?.count ?? 0,
    /* Null when §14 has not set it. `rosterMetric` says "no roster cap set"
       rather than reporting headroom against a number nobody chose. */
    cap: settings?.rosterCap ?? null,
    waitlistDepth: waitlistRow?.count ?? 0,
  });

  /* --------------------------------------------------------- HOSTING RATE */

  const [canHostRow] = await tx
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(schema.memberships)
    .innerJoin(schema.tiers, eq(schema.tiers.id, schema.memberships.tierId))
    .where(
      and(
        eq(schema.memberships.status, "active"),
        /* The denominator §6.6's rate needs. See `hostingRate`: dividing by the
           whole roster reports a club as failing at something half its members
           were never able to do. */
        eq(schema.tiers.canHost, true),
      ),
    );

  const [hostedRow] = await tx
    .select({
      count: sql<number>`COUNT(DISTINCT ${schema.guestInvitations.hostMembershipId})::int`,
    })
    .from(schema.guestInvitations)
    .where(gte(schema.guestInvitations.issuedAt, since));

  const hosting = hostingRate({
    hostsWhoInvited: hostedRow?.count ?? 0,
    membersWhoCanHost: canHostRow?.count ?? 0,
  });

  /* ----------------------------------------------------------- CONVERSION */

  /**
   * §3.2's funnel, counted across all hosts.
   *
   * `guest_visit_summary` is the table §3.2 describes for exactly this, and it
   * is read rather than recomputed from participations — the specification calls
   * it "a materialised view or maintained table" and says its counts are
   * "across all hosts, not per host", which is the property the conversion rate
   * depends on and which a fresh COUNT over participations would have to
   * re-derive correctly every time somebody wrote one.
   */
  const [guestsRow] = await tx
    .select({
      distinct: sql<number>`COUNT(*)::int`,
      converted: sql<number>`COUNT(${schema.guestVisitSummary.convertedMembershipId})::int`,
    })
    .from(schema.guestVisitSummary)
    .where(gte(schema.guestVisitSummary.firstVisitAt, since));

  const conversion = guestConversion({
    guestsWhoApplied: guestsRow?.converted ?? 0,
    distinctGuests: guestsRow?.distinct ?? 0,
  });

  /* ----------------------------------------------------- ADMISSIONS BY HOST */

  /**
   * §6.6's most commercially useful list — §1.1 makes admission sponsor-led, so
   * these members ARE the growth channel.
   *
   * Guests brought comes from invitations; applications and admissions come from
   * `applications.sponsor_membership_id`, which is how §3.1 records who put
   * somebody forward. Two aggregates joined in TypeScript rather than one query
   * with two LEFT JOINs, because joining them in SQL multiplies the rows and the
   * guest count silently becomes guests × applications.
   */
  const invitesByHost = await tx
    .select({
      membershipId: schema.guestInvitations.hostMembershipId,
      guests: sql<number>`COUNT(*)::int`,
    })
    .from(schema.guestInvitations)
    .where(gte(schema.guestInvitations.issuedAt, since))
    .groupBy(schema.guestInvitations.hostMembershipId);

  const applicationsByHost = await tx
    .select({
      membershipId: schema.applications.sponsorMembershipId,
      applications: sql<number>`COUNT(*)::int`,
      admitted: sql<number>`COUNT(*) FILTER (WHERE ${schema.applications.status} = 'admitted')::int`,
    })
    .from(schema.applications)
    .where(
      and(
        isNotNull(schema.applications.sponsorMembershipId),
        gte(schema.applications.submittedAt, since),
      ),
    )
    .groupBy(schema.applications.sponsorMembershipId);

  const hostNames = await tx
    .select({
      membershipId: schema.memberships.id,
      personId: schema.memberships.personId,
      firstName: schema.people.firstName,
      lastName: schema.people.lastName,
    })
    .from(schema.memberships)
    .innerJoin(schema.people, eq(schema.people.id, schema.memberships.personId));

  const nameByMembership = new Map(
    hostNames.map((row) => [
      row.membershipId,
      { personId: row.personId, name: `${row.firstName} ${row.lastName}` },
    ]),
  );

  const hostTally = new Map<string, HostAdmissions>();

  const upsertHost = (membershipId: string) => {
    const existing = hostTally.get(membershipId);
    if (existing) return existing;

    const who = nameByMembership.get(membershipId);
    const fresh: HostAdmissions = {
      hostPersonId: who?.personId ?? membershipId,
      hostName: who?.name ?? "A member",
      guestsBrought: 0,
      applications: 0,
      admitted: 0,
    };
    hostTally.set(membershipId, fresh);
    return fresh;
  };

  for (const row of invitesByHost) {
    const host = upsertHost(row.membershipId);
    hostTally.set(row.membershipId, { ...host, guestsBrought: row.guests });
  }

  for (const row of applicationsByHost) {
    if (!row.membershipId) continue;
    const host = upsertHost(row.membershipId);
    hostTally.set(row.membershipId, {
      ...host,
      applications: row.applications,
      admitted: row.admitted,
    });
  }

  /* --------------------------------------------------------------- OCCUPANCY */

  /**
   * §6.6: "occupancy by day and slot separating member and guest load."
   *
   * Grouped in Postgres because the date and slot have to be computed in Lagos
   * (§2), and `AT TIME ZONE` in the database is the one place that is certain to
   * agree with the rest of the system. Doing it in TypeScript would put the
   * conversion on the application's clock, which src/lib/time.ts is explicit is
   * the untrusted one.
   */
  const participationRows = await tx
    .select({
      date: sql<string>`to_char(${schema.participations.checkedInAt} AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD')`,
      slot: sql<string>`to_char(${schema.participations.checkedInAt} AT TIME ZONE 'Africa/Lagos', 'HH24:00')`,
      isGuest: sql<boolean>`${schema.participations.role} = 'guest_shooter'`,
    })
    .from(schema.participations)
    .where(gte(schema.participations.checkedInAt, since));

  /* ------------------------------------------------------------- LAPSE LIST */

  const lapsedRows = await tx
    .select({
      personId: schema.memberships.personId,
      memberNumber: schema.memberships.memberNumber,
      endedOn: schema.memberships.endedOn,
      firstName: schema.people.firstName,
      lastName: schema.people.lastName,
    })
    .from(schema.memberships)
    .innerJoin(schema.people, eq(schema.people.id, schema.memberships.personId))
    .where(
      and(
        eq(schema.memberships.status, "lapsed"),
        isNotNull(schema.memberships.endedOn),
      ),
    );

  /* ---------------------------------------------------------------- REVENUE */

  const revenue = await revenueByPurpose(tx, since);

  /* ------------------------------------------------------------- EXCEPTIONS */

  const exceptions = await armouryExceptionReport(tx, now);

  /* -------------------------------------------------------------- EXPIRIES */

  /**
   * §6.6's "expiries within 90 days".
   *
   * Licences and qualifications together, because a founder does not think of
   * them separately — both are a member who will be refused something they
   * expect to be able to do, and both are fixed by the same phone call.
   *
   * Already-expired ones are excluded: those are not an expiry to plan for, they
   * are a block the member is already meeting, and §4.3 surfaces those where the
   * member can act on them. Mixing them here would make the list a backlog.
   */
  const expiringLicences = await tx
    .select({
      firstName: schema.people.firstName,
      lastName: schema.people.lastName,
      expiresOn: schema.licences.expiresOn,
    })
    .from(schema.licences)
    .innerJoin(schema.people, eq(schema.people.id, schema.licences.personId))
    .where(
      and(
        eq(schema.licences.status, "verified"),
        isNotNull(schema.licences.expiresOn),
        gte(schema.licences.expiresOn, today),
        lte(schema.licences.expiresOn, expiryHorizon),
      ),
    )
    .orderBy(schema.licences.expiresOn);

  const expiringQualifications = await tx
    .select({
      firstName: schema.people.firstName,
      lastName: schema.people.lastName,
      discipline: schema.qualifications.discipline,
      expiresAt: schema.qualifications.expiresAt,
    })
    .from(schema.qualifications)
    .innerJoin(
      schema.people,
      eq(schema.people.id, schema.qualifications.personId),
    )
    .where(
      and(
        isNotNull(schema.qualifications.expiresAt),
        gte(schema.qualifications.expiresAt, now),
        gte(
          sql`${addDays(now, EXPIRY_HORIZON_DAYS)}`,
          schema.qualifications.expiresAt,
        ),
      ),
    )
    .orderBy(schema.qualifications.expiresAt);

  const expiring = [
    ...expiringLicences.map((row) => ({
      kind: "licence" as const,
      personName: `${row.firstName} ${row.lastName}`,
      expiresOn: row.expiresOn ?? "",
      line: `${row.firstName} ${row.lastName} — licence expires ${row.expiresOn}.`,
    })),
    ...expiringQualifications.map((row) => ({
      kind: "qualification" as const,
      personName: `${row.firstName} ${row.lastName}`,
      expiresOn: lagosDateKey(row.expiresAt ?? now),
      line: `${row.firstName} ${row.lastName} — ${row.discipline} qualification expires ${lagosDateKey(row.expiresAt ?? now)}.`,
    })),
  ].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));

  /* ------------------------------------------------------------- OVERRIDES */

  /**
   * §12: an override "appears on the founder's dashboard THE SAME DAY".
   *
   * Read from `audit_log`, which §3.6 makes append-only and which
   * drizzle/0002 additionally guards: an override row with no reason is
   * rejected by the database. So a row here always carries the sentence the
   * officer typed, and there is no case to handle where it does not.
   */
  const overrideRows = await tx
    .select({
      id: schema.auditLog.id,
      action: schema.auditLog.action,
      reason: schema.auditLog.overrideReason,
      occurredAt: schema.auditLog.occurredAt,
      firstName: schema.people.firstName,
      lastName: schema.people.lastName,
    })
    .from(schema.auditLog)
    .leftJoin(
      schema.staffUsers,
      eq(schema.staffUsers.id, schema.auditLog.actorStaffId),
    )
    .leftJoin(schema.people, eq(schema.people.id, schema.staffUsers.personId))
    .where(
      and(
        eq(schema.auditLog.isOverride, true),
        gte(schema.auditLog.occurredAt, overridesSince),
      ),
    );

  const overrides = recentOverrides(
    overrideRows.map((row) => ({
      id: row.id,
      action: row.action,
      reason: row.reason ?? "",
      /* Null when the override came from a device with no live shift — M1's
         attribution gap, closed at M5 but still possible on a row written
         before it. "A device" is honest; a made-up name would not be. */
      actorName:
        row.firstName && row.lastName
          ? `${row.firstName} ${row.lastName}`
          : "A device",
      occurredAt: row.occurredAt,
    })),
    overridesSince,
  );

  return {
    headline: dashboardHeadline({
      integrityExceptions: exceptions.filter((e) => e.severity === "integrity")
        .length,
      attentionExceptions: exceptions.filter((e) => e.severity === "attention")
        .length,
      overrides: overrides.length,
      expiringSoon: expiring.length,
      roster,
    }),
    windowDays,
    roster,
    hosting,
    conversion,
    admissionsByHost: rankHosts([...hostTally.values()]),
    occupancy: occupancy({ participations: participationRows }),
    lapses: lapseList(
      lapsedRows.map((row) => ({
        personId: row.personId,
        name: `${row.firstName} ${row.lastName}`,
        memberNumber: row.memberNumber,
        lapsedOn: new Date(`${row.endedOn}T00:00:00.000Z`),
      })),
      now,
    ),
    revenue: revenue.map((row) => ({
      purpose: row.purpose,
      totalKobo: row.totalKobo,
      label: format(fromStorage(row.totalKobo)),
      count: row.count,
    })),
    exceptions,
    exceptionSummary: exceptionSummary(exceptions),
    expiring,
    overrides,
  };
}
