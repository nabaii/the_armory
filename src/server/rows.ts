import type {
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
  discipline: string;
  slotStart: InstantString;
  hostPersonId: string | null;
  invitationId: string | null;
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
  firearms: readonly FirearmRow[];
  ammunitionLots: readonly AmmunitionLotRow[];
  staff: readonly StaffRow[];
  devices: readonly DeviceRow[];
};
