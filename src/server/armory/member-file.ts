import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { ArmoryReader } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import type { FirearmStatus, InvitationStatus, LicenceStatus } from "@/domain/enums";

/**
 * WHAT THE CLUB HOLDS ABOUT ONE MEMBER — Members Portal §9.
 *
 * The reads behind Me's five groups. `accountFor` in money.ts already serves
 * the fifth; this module serves documents, firearms and the hosting ledger.
 *
 * ===========================================================================
 * §9.1 — FIREARMS ARE READ-ONLY, AND THAT IS A DESIGN DECISION NOT AN OMISSION
 *
 *   "Firearms is read-only by design. The custody log is append-only and the
 *    member is not an actor in it. A member may see every movement of their own
 *    firearm; they may not initiate one from a phone."
 *
 * There is deliberately no write in this file. Whoever adds one should read
 * that paragraph first: a custody event initiated from a phone is a movement of
 * a firearm recorded by somebody who was not standing next to it.
 *
 * ===========================================================================
 * §9.1 — GUESTS SITS SECOND, AND THIS IS WHY IT NEEDS A HISTORY
 *
 *   "Guests sits second, not buried under settings. Hosting has no tab; this is
 *    its home, and placing it beneath payment preferences would contradict
 *    Section 5.2 in the one screen that is supposed to compensate for the
 *    missing tab."
 *
 * §3.2 counts a guest's visits ACROSS ALL HOSTS rather than per host, because
 * "someone brought four times by four different members is the person most
 * likely to join". The conversion route in §10 hangs off that number, so this
 * module reads the club-wide count rather than the member's own.
 */

/* ============================================================================
   DOCUMENTS — §9.1, group three
   ========================================================================= */

export type MemberDocuments = {
  readonly waiver: {
    readonly signedAt: Date | null;
    readonly version: string | null;
    readonly isCurrent: boolean;
    readonly activeVersion: string | null;
  };
  readonly licences: readonly {
    readonly id: string;
    readonly status: LicenceStatus;
    readonly calibres: readonly string[];
    /* A `date` column, so a Lagos calendar day rather than an instant. Kept as
       the string Postgres returns and parsed by the screen with
       `parseDateColumn`, which is the one function that reads a date column as
       Lagos midnight rather than as UTC. */
    readonly expiresOn: string | null;
  }[];
  readonly qualifications: readonly {
    readonly discipline: string;
    readonly level: string;
    readonly expiresAt: Date | null;
  }[];
};

export async function documentsFor(
  db: ArmoryReader,
  personId: string,
): Promise<MemberDocuments> {
  const [active] = await db
    .select({ id: schema.waiverVersions.id, version: schema.waiverVersions.version })
    .from(schema.waiverVersions)
    .where(eq(schema.waiverVersions.isActive, true))
    .limit(1);

  const [signature] = await db
    .select({
      waiverVersionId: schema.waiverSignatures.waiverVersionId,
      signedAt: schema.waiverSignatures.signedAt,
      version: schema.waiverVersions.version,
    })
    .from(schema.waiverSignatures)
    .innerJoin(
      schema.waiverVersions,
      eq(schema.waiverVersions.id, schema.waiverSignatures.waiverVersionId),
    )
    .where(
      and(
        eq(schema.waiverSignatures.personId, personId),
        isNotNull(schema.waiverSignatures.signedAt),
      ),
    )
    /* Most recent by the SIGNING clock, not by id. Ids are UUIDv7 and so are
       ordered by generation, which for an offline signature is when the tablet
       minted it — not the order the club signed things in once a queue has
       drained out of order. The same reasoning as `waiverStandingFor`. */
    .orderBy(desc(schema.waiverSignatures.signedAt))
    .limit(1);

  const [licences, qualifications] = await Promise.all([
    db
      .select({
        id: schema.licences.id,
        status: schema.licences.status,
        calibres: schema.licences.calibres,
        expiresOn: schema.licences.expiresOn,
        /* `documentUrl` is NOT selected, and must never be. §10: "Licence scans
           readable only by the founder role." The member's own scan is theirs,
           but this screen renders on a phone in a public building and the URL
           is a signed link that would sit in a page's HTML. */
      })
      .from(schema.licences)
      .where(eq(schema.licences.personId, personId))
      .orderBy(desc(schema.licences.expiresOn)),
    db
      .select({
        discipline: schema.qualifications.discipline,
        level: schema.qualifications.level,
        expiresAt: schema.qualifications.expiresAt,
      })
      .from(schema.qualifications)
      .where(eq(schema.qualifications.personId, personId)),
  ]);

  return {
    waiver: {
      signedAt: signature?.signedAt ?? null,
      version: signature?.version ?? null,
      activeVersion: active?.version ?? null,
      /* Current means "signed the version the club is running now". A signature
         against a superseded version is a real signature and is shown as one —
         it is simply not the one that admits the member today. */
      isCurrent: Boolean(
        active && signature && signature.waiverVersionId === active.id,
      ),
    },
    licences: licences.map((licence) => ({
      ...licence,
      calibres: (licence.calibres as string[] | null) ?? [],
    })),
    qualifications,
  };
}

/* ============================================================================
   FIREARMS — §9.1, group four. Read-only, including the custody log.
   ========================================================================= */

export type MemberFirearm = {
  readonly id: string;
  readonly serialNumber: string;
  readonly make: string;
  readonly model: string;
  readonly calibre: string;
  readonly status: FirearmStatus;
  readonly custody: readonly {
    readonly id: string;
    readonly eventType: string;
    readonly occurredAt: Date;
  }[];
};

export async function firearmsFor(
  db: ArmoryReader,
  personId: string,
): Promise<MemberFirearm[]> {
  const firearms = await db
    .select({
      id: schema.firearms.id,
      serialNumber: schema.firearms.serialNumber,
      make: schema.firearms.make,
      model: schema.firearms.model,
      calibre: schema.firearms.calibre,
      status: schema.firearms.status,
    })
    .from(schema.firearms)
    .where(eq(schema.firearms.ownerPersonId, personId));

  if (firearms.length === 0) return [];

  const events = await db
    .select({
      id: schema.custodyEvents.id,
      firearmId: schema.custodyEvents.firearmId,
      eventType: schema.custodyEvents.eventType,
      occurredAt: schema.custodyEvents.occurredAt,
    })
    .from(schema.custodyEvents)
    .where(
      sql`${schema.custodyEvents.firearmId} in ${firearms.map((firearm) => firearm.id)}`,
    )
    .orderBy(desc(schema.custodyEvents.occurredAt));

  return firearms.map((firearm) => ({
    ...firearm,
    custody: events
      .filter((event) => event.firearmId === firearm.id)
      .map(({ id, eventType, occurredAt }) => ({ id, eventType, occurredAt })),
  }));
}

/* ============================================================================
   THE HOSTING LEDGER — §9.1, group two, and §10's third placement
   ========================================================================= */

export type HostedGuest = {
  readonly invitationId: string;
  readonly name: string | null;
  readonly status: InvitationStatus;
  readonly issuedAt: Date;
  readonly bookingId: string | null;
  /**
   * How many times this person has visited the club, ACROSS ALL HOSTS.
   *
   * §3.2 counts it this way deliberately, and §10's conversion route hangs off
   * it: someone brought four times by four different members is the person most
   * likely to join, and a per-host count would never surface them.
   */
  readonly visitsAcrossAllHosts: number;
};

export async function hostingHistoryFor(
  db: ArmoryReader,
  membershipId: string,
): Promise<HostedGuest[]> {
  const rows = await db
    .select({
      invitationId: schema.guestInvitations.id,
      status: schema.guestInvitations.status,
      issuedAt: schema.guestInvitations.createdAt,
      bookingId: schema.guestInvitations.bookingId,
      guestPersonId: schema.guestInvitations.guestPersonId,
      firstName: schema.people.firstName,
      lastName: schema.people.lastName,
      visits: schema.guestVisitSummary.visitCount,
    })
    .from(schema.guestInvitations)
    .leftJoin(
      schema.people,
      eq(schema.people.id, schema.guestInvitations.guestPersonId),
    )
    .leftJoin(
      schema.guestVisitSummary,
      eq(schema.guestVisitSummary.personId, schema.guestInvitations.guestPersonId),
    )
    .where(eq(schema.guestInvitations.hostMembershipId, membershipId))
    .orderBy(desc(schema.guestInvitations.createdAt))
    .limit(50);

  return rows.map((row) => ({
    invitationId: row.invitationId,
    /* Null until the guest opens their link and completes it themselves. Until
       then the club knows a token and nothing else — §6.3 — and the screen says
       "not opened yet" rather than inventing a placeholder name. */
    name:
      row.firstName && row.lastName ? `${row.firstName} ${row.lastName}` : null,
    status: row.status,
    issuedAt: row.issuedAt,
    bookingId: row.bookingId,
    visitsAcrossAllHosts: row.visits ?? 0,
  }));
}

/**
 * The threshold at which §10 says to offer a guest the application route.
 *
 * Three visits, and it is a number the club can move without a migration
 * because it is read here rather than written into a query. It is deliberately
 * not in club_settings: §14's settings are the ones whose wrong value costs
 * money or turns somebody away, and this one only changes when a suggestion
 * appears on a member's screen.
 */
export const CONVERSION_VISITS = 3;

export const isWorthConverting = (guest: HostedGuest): boolean =>
  guest.visitsAcrossAllHosts >= CONVERSION_VISITS;
