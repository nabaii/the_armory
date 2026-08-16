import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getArmoryDb, schema } from "@/db/armory/client";
import { addDays, lagosDateKey } from "@/lib/time";
import type { DayPackSource, DateString, InstantString } from "@/server/rows";

/**
 * THE DAY PACK QUERIES — §8.1.
 *
 *   "On connection, each desk and lane device pulls and caches: today's and
 *    tomorrow's expected arrivals with computed status; all active memberships and
 *    tiers; all guest invitations for the window; the full firearm register;
 *    ammunition lot balances; the active waiver version; staff and device records.
 *    Refreshed continuously while online; sufficient to run a full day alone."
 *
 * One query per collection, run inside a single transaction, projected by
 * src/server/daypack-projection.ts.
 *
 * ===========================================================================
 * WHY THE WHOLE SNAPSHOT IS ONE TRANSACTION
 *
 * An earlier version fired these in parallel with `Promise.all` and noted that the
 * snapshot was therefore not consistent across collections. That was a limitation of
 * the driver it was written against, not a decision — and it does not apply here,
 * because the armoury client holds a pooled TCP connection with real transactions
 * (see src/db/armory/client.ts).
 *
 * So they run in one transaction and the pack is a coherent snapshot. That matters
 * more than it first appears: the desk evaluates permissions against this data with
 * no network for the rest of the day. A pack whose `memberships` were read before a
 * renewal committed and whose `allowances` were read after it describes a club that
 * never existed, and §4's guarantee — that the desk reaches the same decision the
 * server would — is only true of a state the server actually had.
 *
 * The cost is serialised round trips rather than parallel ones. For thirteen small
 * queries on one connection that is a few tens of milliseconds, and this endpoint is
 * not on §2's one-second path: the desk opens from IndexedDB, and this is the refresh
 * behind it.
 *
 * ===========================================================================
 * DATES ARE FORMATTED IN POSTGRES
 *
 * Every `timestamptz` is rendered with `to_char(… AT TIME ZONE 'UTC', …'Z')` and
 * every `date` column is already a `YYYY-MM-DD` string in Drizzle's default mode.
 *
 * src/server/rows.ts explains why: the desk and the server must build byte-identical
 * Subjects from this data, and they do it by starting from the same strings and
 * converting with the same function. Handing this layer a `Date` for one column and a
 * string for another would put a conversion on one side only, and
 * `new Date("2027-06-01")` is midnight UTC while `new Date("2027-06-01T00:00:00")` is
 * midnight local — a licence that expires on different days in Lagos.
 *
 * ===========================================================================
 * THE WINDOW
 *
 * "Today's and tomorrow's" is a Lagos calendar window (§2: "All timestamps stored
 * UTC. Rendered Africa/Lagos"). Computed from the server's clock, not the tablet's —
 * the tablet's clock is the untrusted one (src/offline/device.ts) — and carried in the
 * pack so the desk knows which days it can answer for.
 */

/** An ISO instant with a Z suffix, matching JavaScript's `toISOString()`. */
const instant = (column: unknown) =>
  sql<InstantString>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** The same, for a nullable column. */
const instantOrNull = (column: unknown) =>
  sql<InstantString | null>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * A `jsonb` list of discipline slugs, or the permissive empty list.
 *
 * Anything unreadable becomes empty rather than throwing. The alternative is
 * worse than it looks: this value reaches MAY_SHOOT_DISCIPLINE on every tablet,
 * so a malformed row would either close the whole range or crash the endpoint
 * every device pulls from. Failing open here is the same choice `waiverValidityDays`
 * makes, for the same stated reason — turning members away over a rule nobody
 * set is the wrong way to be wrong.
 */
const asDisciplineList = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

/**
 * Assemble everything one pack is built from.
 *
 * `now` is a parameter because the window depends on it, and because a test that
 * cannot fix the clock cannot assert which arrivals fall inside it.
 */
export async function loadDayPackSource(now: Date): Promise<DayPackSource> {
  const windowStart = lagosDateKey(now);
  const windowEnd = lagosDateKey(addDays(now, 1));

  const db = getArmoryDb();

  return db.transaction(async (tx) => {
    /* §3.1: "Exactly one active version at a time." Read first: without it there is
       no pack to build, and failing before thirteen queries is cheaper than after. */
    const [activeWaiver] = await tx
      .select({
        id: schema.waiverVersions.id,
        /* The label and the text travel with the pack because §6.4's desk has to
           SHOW the document before it can take a signature against it, and it has
           to do that with no network. A tablet that could record an acceptance but
           could not display what was accepted would be producing evidence of
           nothing. Club boilerplate, not personal data — so unlike a licence scan
           it is safe to hold on a desk surface (§10). */
        version: schema.waiverVersions.version,
        body: schema.waiverVersions.body,
      })
      .from(schema.waiverVersions)
      .where(eq(schema.waiverVersions.isActive, true))
      .limit(1);

    if (!activeWaiver) {
      /**
       * Refused rather than defaulted.
       *
       * MAY_ATTEND is decided against the active version. A pack sent with a
       * placeholder would fail the waiver check for every member on the tablet, for a
       * reason that is the club's configuration and not theirs, and the officer would
       * have no way to tell.
       */
      throw new Error(
        "No active waiver version. A day pack cannot be built without one (§3.1).",
      );
    }

    const people = await tx
      .select({
        id: schema.people.id,
        firstName: schema.people.firstName,
        lastName: schema.people.lastName,
        photoUrl: schema.people.photoUrl,
      })
      .from(schema.people)
      .orderBy(schema.people.lastName, schema.people.firstName);

    /* §8.1: "all active memberships". Resigned and lapsed rows are excluded so a
       former member does not appear on the desk as somebody with a tier. `suspended`
       IS included: §4.2 blocks them at check-in with a reason, which it can only do
       if the desk knows they exist. */
    const memberships = await tx
      .select({
        id: schema.memberships.id,
        personId: schema.memberships.personId,
        tierId: schema.memberships.tierId,
        memberNumber: schema.memberships.memberNumber,
        status: schema.memberships.status,
        endedOn: schema.memberships.endedOn,
        renewsOn: schema.memberships.renewsOn,
      })
      .from(schema.memberships)
      .where(inArray(schema.memberships.status, ["active", "pending", "suspended"]))
      .orderBy(schema.memberships.memberNumber);

    const tiers = await tx
      .select({
        id: schema.tiers.id,
        name: schema.tiers.name,
        canHost: schema.tiers.canHost,
        guestAllowanceAnnual: schema.tiers.guestAllowanceAnnual,
        guestConcurrentMax: schema.tiers.guestConcurrentMax,
        canOwnFirearm: schema.tiers.canOwnFirearm,
        canStoreFirearm: schema.tiers.canStoreFirearm,
        disciplineAccess: schema.tiers.disciplineAccess,
        bookingHorizonDays: schema.tiers.bookingHorizonDays,
        concurrentBookingsMax: schema.tiers.concurrentBookingsMax,
        active: schema.tiers.active,
      })
      .from(schema.tiers)
      .orderBy(schema.tiers.sortOrder);

    /**
     * Licence FACTS and no document.
     *
     * `documentUrl` is not selected, and `LicenceRow` has no field for it. §10:
     * "Licence scans readable only by the founder role. Not by range officers. Not on
     * the desk or lane surfaces." The desk genuinely needs status, calibres and expiry
     * — MAY_USE_OWN_FIREARM is undecidable without them — and never the scan.
     */
    const licences = await tx
      .select({
        id: schema.licences.id,
        personId: schema.licences.personId,
        status: schema.licences.status,
        calibres: schema.licences.calibres,
        expiresOn: schema.licences.expiresOn,
      })
      .from(schema.licences);

    const qualifications = await tx
      .select({
        personId: schema.qualifications.personId,
        discipline: schema.qualifications.discipline,
        level: schema.qualifications.level,
        expiresAt: instantOrNull(schema.qualifications.expiresAt),
      })
      .from(schema.qualifications);

    /**
     * The most recent signature per person.
     *
     * §3.1 makes waiver_signatures append-only and "a resignature is a new row", so a
     * person has a history and the capability service wants one signature — the
     * latest, whatever version it was against. Deciding whether that version is the
     * ACTIVE one is `evaluate()`'s job, not this query's; doing it here would be the
     * duplicated permission check §4 forbids.
     */
    const waiverSignatures = await tx
      .selectDistinctOn([schema.waiverSignatures.personId], {
        personId: schema.waiverSignatures.personId,
        waiverVersionId: schema.waiverSignatures.waiverVersionId,
        signedAt: instant(schema.waiverSignatures.signedAt),
      })
      .from(schema.waiverSignatures)
      .orderBy(
        schema.waiverSignatures.personId,
        sql`${schema.waiverSignatures.signedAt} DESC`,
      );

    /* The allowance period covering today. §3.2: one row per membership per period,
       and `usedCount` is authoritative server-side (§8.3). */
    const allowances = await tx
      .select({
        membershipId: schema.hostAllowances.membershipId,
        includedQuota: schema.hostAllowances.includedQuota,
        usedCount: schema.hostAllowances.usedCount,
        /* §14 has not set the overage price. Null rather than a number nobody chose. */
        overagePriceLabel: sql<string | null>`NULL::text`,
      })
      .from(schema.hostAllowances)
      .where(
        and(
          lte(schema.hostAllowances.periodStart, windowStart),
          gte(schema.hostAllowances.periodEnd, windowStart),
        ),
      );

    /**
     * Invitations in the window. §8.1: "all guest invitations for the window."
     *
     * The host is joined through the membership because the pack carries the host as a
     * PERSON: the host-presence rule in §4.2 asks whether that human has checked in,
     * and a membership id cannot be compared against a participation.
     *
     * `tokenHash` is not selected. It is a bearer credential for the guest link
     * (§6.3), and a pack carrying four hundred of them would let anyone holding the
     * tablet complete any pending invitation.
     */
    const hostMembership = schema.memberships;
    const invitations = await tx
      .select({
        id: schema.guestInvitations.id,
        hostMembershipId: schema.guestInvitations.hostMembershipId,
        hostPersonId: hostMembership.personId,
        guestPersonId: schema.guestInvitations.guestPersonId,
        bookingId: schema.guestInvitations.bookingId,
        status: schema.guestInvitations.status,
        expiresAt: instant(schema.guestInvitations.expiresAt),
        isChargeable: schema.guestInvitations.isChargeable,
      })
      .from(schema.guestInvitations)
      .innerJoin(
        hostMembership,
        eq(hostMembership.id, schema.guestInvitations.hostMembershipId),
      )
      .where(
        and(
          inArray(schema.guestInvitations.status, ["issued", "opened", "completed"]),
          gte(schema.guestInvitations.expiresAt, new Date(`${windowStart}T00:00:00Z`)),
        ),
      );

    /**
     * Expected arrivals for today and tomorrow (§8.1, §6.4).
     *
     * A booking participant is an expected arrival. The session id is attached where a
     * session for that booking is already open, so the desk can write a check-in
     * against it offline — and is null where one is not, which is what
     * `buildCheckIn` refuses on.
     *
     * No computed status, deliberately, despite §8.1's wording. See the note on
     * `PackArrival`: a status computed here is wrong the moment the host checks in.
     */
    const arrivals = await tx
      .select({
        personId: schema.bookingParticipants.personId,
        bookingId: schema.bookings.id,
        sessionId: schema.sessions.id,
        role: schema.bookingParticipants.role,
        discipline: schema.bookings.discipline,
        bookingType: schema.bookings.bookingType,
        slotStart: instant(schema.bookings.slotStart),
        hostPersonId: hostMembership.personId,
        invitationId: schema.bookingParticipants.guestInvitationId,
      })
      .from(schema.bookingParticipants)
      .innerJoin(
        schema.bookings,
        eq(schema.bookings.id, schema.bookingParticipants.bookingId),
      )
      .innerJoin(
        hostMembership,
        eq(hostMembership.id, schema.bookings.hostMembershipId),
      )
      .leftJoin(
        schema.sessions,
        and(
          eq(schema.sessions.bookingId, schema.bookings.id),
          eq(schema.sessions.status, "open"),
        ),
      )
      .where(
        and(
          gte(schema.bookings.bookingDate, windowStart),
          lte(schema.bookings.bookingDate, windowEnd),
          inArray(schema.bookings.status, ["confirmed", "completed"]),
        ),
      )
      .orderBy(schema.bookings.slotStart);

    /* §8.1: "the full firearm register". Decommissioned rows included — a serial that
       has left service still has to resolve at the lane rather than reading as
       unknown. `status` is derived from custody_events by trigger (§3.4). */
    const firearms = await tx
      .select({
        id: schema.firearms.id,
        serialNumber: schema.firearms.serialNumber,
        make: schema.firearms.make,
        model: schema.firearms.model,
        calibre: schema.firearms.calibre,
        ownership: schema.firearms.ownership,
        ownerPersonId: schema.firearms.ownerPersonId,
        status: schema.firearms.status,
      })
      .from(schema.firearms)
      .orderBy(schema.firearms.serialNumber);

    const ammunitionLots = await tx
      .select({
        id: schema.ammunitionLots.id,
        calibre: schema.ammunitionLots.calibre,
        quantityRemaining: schema.ammunitionLots.quantityRemaining,
      })
      .from(schema.ammunitionLots)
      .where(gte(schema.ammunitionLots.quantityRemaining, 1))
      .orderBy(schema.ammunitionLots.receivedOn);

    /**
     * Who is on the premises right now — §6.5's relay, M7.
     *
     * Scoped to OPEN sessions rather than to the pack's date window. The two
     * are almost the same and differ in the case that matters: a session opened
     * before midnight and still running at one in the morning is a range with
     * people on it, and a query keyed on today's date would empty the relay
     * under an officer who is still working.
     *
     * Checked-out rows travel too. `relay()` filters them, and the close guard
     * in §6.4 needs to know somebody left rather than merely not seeing them.
     */
    const participations = await tx
      .select({
        id: schema.participations.id,
        sessionId: schema.participations.sessionId,
        personId: schema.participations.personId,
        role: schema.participations.role,
        hostPersonId: schema.participations.hostPersonId,
        laneId: schema.participations.laneId,
        checkedInAt: instant(schema.participations.checkedInAt),
        checkedOutAt: instantOrNull(schema.participations.checkedOutAt),
      })
      .from(schema.participations)
      .innerJoin(
        schema.sessions,
        eq(schema.sessions.id, schema.participations.sessionId),
      )
      .where(eq(schema.sessions.status, "open"))
      .orderBy(schema.participations.checkedInAt);

    /* Every lane, including the ones that are down. §6.4 assigns a lane at
       check-in and the officer must be able to see why a bay is unavailable —
       omitting a lane under maintenance would make it look as though the club
       had one fewer bay than it has. */
    const lanes = await tx
      .select({
        id: schema.lanes.id,
        discipline: schema.lanes.discipline,
        number: schema.lanes.number,
        status: schema.lanes.status,
        positionCapacity: schema.lanes.positionCapacity,
      })
      .from(schema.lanes)
      .orderBy(schema.lanes.discipline, schema.lanes.number);

    /* No `pinHash`. §10: a pack containing every officer's PIN hash would move the
       club's staff authentication onto a tablet that can be carried out of the
       building. */
    const staff = await tx
      .select({
        id: schema.staffUsers.id,
        personId: schema.staffUsers.personId,
        displayName: sql<string>`${schema.people.firstName} || ' ' || left(${schema.people.lastName}, 1) || '.'`,
        role: schema.staffUsers.role,
        active: schema.staffUsers.active,
      })
      .from(schema.staffUsers)
      .innerJoin(schema.people, eq(schema.people.id, schema.staffUsers.personId));

    /**
     * Device records, INCLUDING revoked ones.
     *
     * §8.1 asks for "device records" and the revoked ones are the point: a desk that
     * holds the list can refuse a lane tablet the founder revoked this morning without
     * asking the server, which is the §10 guarantee surviving an outage.
     */
    const devices = await tx
      .select({
        id: schema.devices.id,
        label: schema.devices.label,
        surface: schema.devices.surface,
        /* `sql<boolean>` rather than `isNotNull`, which types as SQL<unknown> in a
           select projection and would erase the field's type in `DeviceRow`. */
        revoked: sql<boolean>`${schema.devices.revokedAt} IS NOT NULL`,
      })
      .from(schema.devices);

    /**
     * §14's open items, read from the club's own row (drizzle/0006).
     *
     * These were three literals here, each with a comment explaining that the
     * DEVICE reads them from the pack "so it changes without a deploy". The
     * device did; the server did not, and the sentence was therefore only half
     * true. Now both read a row.
     *
     * Absent settings fall back to the same undecided positions the literals
     * held, so a database that has not run 0006 behaves exactly as before —
     * which matters because this query is on the path every tablet takes to
     * open, and a missing settings row must not close the range.
     */
    const [settings] = await tx
      .select({
        waiverValidityDays: schema.clubSettings.waiverValidityDays,
        storageEnabled: schema.clubSettings.storageEnabled,
        disciplinesRequiringQualification:
          schema.clubSettings.disciplinesRequiringQualification,
      })
      .from(schema.clubSettings)
      .limit(1);

    return {
      pulledAt: now,
      windowStart: windowStart as DateString,
      windowEnd: windowEnd as DateString,

      activeWaiverVersionId: activeWaiver.id,
      activeWaiverVersion: activeWaiver.version,
      activeWaiverBody: activeWaiver.body,
      /**
       * §14 has not settled how long a signature stays valid, and §3.1's note says
       * this "fails open" until it does. Null means a signature against the active
       * version never expires, which is what the capability service already
       * implements for null — and the right way to be wrong, because the alternative
       * turns members away at the door over a rule nobody set.
       *
       * `?? null` rather than a default: an unset column and a missing settings
       * row must reach the same undecided position, so a club that has not made
       * this decision behaves identically whichever way it has not made it.
       */
      waiverValidityDays: settings?.waiverValidityDays ?? null,
      /** §13: the storage workflow sits behind a flag, off until the club turns it on. */
      storageEnabled: settings?.storageEnabled ?? false,
      /**
       * §14 blocks the real list on the club's competency policy. Empty means no
       * discipline demands a sign-off, which is the permissive answer.
       *
       * The column is `jsonb` and arrives as `unknown`. Narrowed rather than cast,
       * because a malformed value here would make MAY_SHOOT_DISCIPLINE refuse
       * every discipline on every tablet — a club-wide outage from one bad row.
       */
      disciplinesRequiringQualification: asDisciplineList(
        settings?.disciplinesRequiringQualification,
      ),

      people,
      memberships,
      tiers,
      licences,
      qualifications,
      waiverSignatures,
      allowances,
      invitations,
      arrivals,
      participations,
      firearms,
      ammunitionLots,
      lanes,
      staff,
      devices,
    };
  });
}
