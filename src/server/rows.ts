import type {
  BookingType,
  FirearmStatus,
  InvitationStatus,
  LicenceStatus,
  MembershipStatus,
  ParticipantRole,
  StaffRole,
  DeviceSurface,
} from "@/domain/enums";

/**
 * THE DATABASE, AS THE SYNC LAYER READS IT.
 *
 * One row type per query result, and every consumer of Postgres in the sync layer
 * reads these rather than a driver's return type.
 *
 * ===========================================================================
 * WHY DATES ARE STRINGS HERE
 *
 * Two things are built from these rows: the `Subject` the server evaluates
 * capabilities against (src/server/subject.ts) and the day pack the desk
 * evaluates them against (src/server/daypack-projection.ts). §4 requires those two
 * paths to reach the same decision, and §8 requires one of them to do it with no
 * network.
 *
 * The pack crosses the wire as JSON, so its dates are ISO strings. If the server's
 * Subject were built from `Date` objects handed over by the driver while the
 * desk's were built from strings, the two would agree only as long as every
 * conversion on both sides happened to match — and `new Date("2027-06-01")` is
 * midnight UTC while `new Date("2027-06-01T00:00:00")` is midnight local. A
 * licence expiring at either of those is a different answer to
 * MAY_USE_OWN_FIREARM in Lagos.
 *
 * So both start from the same string and convert with the same function
 * (`toDate`, exported from src/offline/daypack.ts). The queries are responsible
 * for producing these shapes:
 *
 *   · `date` columns as `YYYY-MM-DD`
 *   · `timestamptz` columns as ISO instants with an offset
 *
 * which is what `to_char`/`to_json` give for the first and what the driver gives
 * for the second.
 */

/** A calendar date, `YYYY-MM-DD`. Postgres `date`. */
export type DateString = string;

/** An instant with an offset. Postgres `timestamp with time zone`. */
export type InstantString = string;

export type PersonRow = {
  id: string;
  firstName: string;
  lastName: string;
  /**
   * Signed, expiring URL (§2: "Signed, expiring URLs only"). Re-issued with each
   * pull, which is why the pack is a whole-state snapshot rather than a delta of
   * things that changed.
   */
  photoUrl: string | null;
};

export type MembershipRow = {
  id: string;
  personId: string;
  tierId: string;
  memberNumber: number;
  status: MembershipStatus;
  endedOn: DateString | null;
  renewsOn: DateString | null;
};

export type TierRow = {
  id: string;
  name: string;
  canHost: boolean;
  guestAllowanceAnnual: number;
  guestConcurrentMax: number;
  canOwnFirearm: boolean;
  canStoreFirearm: boolean;
  disciplineAccess: readonly string[];
  bookingHorizonDays: number;
  concurrentBookingsMax: number;
  active: boolean;
};

/**
 * A licence, WITHOUT the document.
 *
 * `document_url` exists on the table and is deliberately absent from this type.
 * §10: "Licence scans readable only by the founder role. Not by range officers.
 * Not on the desk or lane surfaces." The row type the sync layer reads cannot
 * carry one, so no query written against it can select one into a pack by
 * accident. See the same argument, one layer down, in `PackLicence`.
 */
export type LicenceRow = {
  id: string;
  personId: string;
  status: LicenceStatus;
  calibres: readonly string[];
  expiresOn: DateString | null;
};

export type QualificationRow = {
  personId: string;
  discipline: string;
  level: string;
  expiresAt: InstantString | null;
};

export type WaiverSignatureRow = {
  personId: string;
  waiverVersionId: string;
  signedAt: InstantString;
};

export type AllowanceRow = {
  membershipId: string;
  includedQuota: number;
  usedCount: number;
  overagePriceLabel: string | null;
};

export type InvitationRow = {
  id: string;
  hostMembershipId: string;
  hostPersonId: string;
  guestPersonId: string | null;
  bookingId: string | null;
  status: InvitationStatus;
  expiresAt: InstantString;
  isChargeable: boolean;
};

export type ArrivalRow = {
  personId: string;
  bookingId: string | null;
  sessionId: string | null;
  role: ParticipantRole;
  /**
   * Null where the booking touches no firing line — Members Portal §7.4's
   * `table` and `spectate`.
   *
   * The desk still expects this person, and that is the whole reason the row
   * exists: "a spectator consumes neither, but does consume a seat and a NAME
   * ON THE ARRIVALS LIST". A person in the building the desk did not expect is
   * the failure this prevents, and it does not become less of one because they
   * are not shooting.
   */
  discipline: string | null;
  /**
   * What they are here for. Defaults to `shoot` for every booking written
   * before drizzle/0008, which is what those bookings were.
   *
   * Carried so the desk can say "Table" or "Spectating" where there is no
   * discipline to print. A row that read "—" would make the officer ask, which
   * is the fifteen seconds P6 exists to protect.
   */
  bookingType: BookingType;
  slotStart: InstantString;
  hostPersonId: string | null;
  invitationId: string | null;
};

/**
 * Somebody who is already on the premises — §6.5's relay, M7.
 *
 * ===========================================================================
 * WHY THE PACK CARRIES THESE AND NOT ONLY THE ARRIVALS
 *
 * `ArrivalRow` above is who was EXPECTED. Through M5 that was enough, because
 * the only surface reading the pack was the desk, and the desk writes its own
 * check-ins — what it expected plus what it recorded is the whole picture.
 *
 * A lane tablet has no such luxury. Check-in happens at the counter, on a
 * different device, and §6.5 asks the lane to show "who is on which lane RIGHT
 * NOW". Without these rows the relay on a lane tablet would be empty all
 * evening, or would show expected arrivals as though they had turned up.
 *
 * ===========================================================================
 * THE HONEST LIMIT, STATED RATHER THAN DISCOVERED
 *
 * This closes the gap while the club is online. §8.1 refreshes the pack
 * "continuously while online", so a desk check-in reaches the lane within a
 * pull.
 *
 * With no uplink it does not, and no amount of projection changes that: two
 * tablets with no network between them cannot learn what the other recorded.
 * The lane then shows what it issued and scored itself, which is the honest
 * answer and the reason §6.5's Pair and Score both work from a shooter the lane
 * can see rather than from a roster it might not have.
 *
 * The alternative — peer sync between devices on the club's wifi — is a
 * distributed system with its own conflict rules, in a build whose §8 already
 * names offline as the largest single line of effort. It is not in Phase 1 and
 * nothing here assumes it.
 */
export type ParticipationRow = {
  id: string;
  sessionId: string;
  personId: string;
  role: ParticipantRole;
  hostPersonId: string | null;
  laneId: string | null;
  checkedInAt: InstantString;
  checkedOutAt: InstantString | null;
};

export type FirearmRow = {
  id: string;
  serialNumber: string;
  make: string;
  model: string;
  calibre: string;
  ownership: "club" | "member";
  ownerPersonId: string | null;
  /** Derived from custody_events by trigger (§3.4). Never written by the desk. */
  status: FirearmStatus;
};

export type AmmunitionLotRow = {
  id: string;
  calibre: string;
  quantityRemaining: number;
};

/**
 * §6.4: "three taps maximum from Today to checked in WITH A LANE ASSIGNED."
 *
 * The pack carried no lanes until M5, which is why `participations.lane_id` was
 * written as null throughout M1 — see docs/M1_offline_acceptance.md. A desk
 * cannot assign what it has not been told about.
 */
export type LaneRow = {
  id: string;
  discipline: string;
  number: number;
  status: "available" | "maintenance" | "closed";
  positionCapacity: number;
};

export type StaffRow = {
  id: string;
  personId: string;
  displayName: string;
  role: StaffRole;
  active: boolean;
};

export type DeviceRow = {
  id: string;
  label: string;
  surface: DeviceSurface;
  revoked: boolean;
};

/**
 * Everything one day pack is built from.
 *
 * Assembled by the queries in src/server/sync/daypack-query.ts and consumed by
 * the pure projection. Grouped as one type so the projection is a total function
 * of its input and can be tested without a database.
 */
export type DayPackSource = {
  /** Server time at which the snapshot was taken. */
  pulledAt: Date;
  /** Lagos calendar dates covered — today and tomorrow (§8.1). */
  windowStart: DateString;
  windowEnd: DateString;

  activeWaiverVersionId: string;
  /** The label and text of that version. §6.4 signs at the desk, offline. */
  activeWaiverVersion: string;
  activeWaiverBody: string;
  waiverValidityDays: number | null;
  storageEnabled: boolean;
  disciplinesRequiringQualification: readonly string[];

  people: readonly PersonRow[];
  memberships: readonly MembershipRow[];
  tiers: readonly TierRow[];
  licences: readonly LicenceRow[];
  qualifications: readonly QualificationRow[];
  waiverSignatures: readonly WaiverSignatureRow[];
  allowances: readonly AllowanceRow[];
  invitations: readonly InvitationRow[];
  arrivals: readonly ArrivalRow[];
  participations: readonly ParticipationRow[];
  firearms: readonly FirearmRow[];
  ammunitionLots: readonly AmmunitionLotRow[];
  lanes: readonly LaneRow[];
  staff: readonly StaffRow[];
  devices: readonly DeviceRow[];
};
