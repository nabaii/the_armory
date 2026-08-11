import type {
  DeviceSurface,
  InvitationStatus,
  LicenceStatus,
  MembershipStatus,
  ParticipantRole,
  StaffRole,
} from "@/domain/enums";
import type {
  FirearmSnapshot,
  LicenceSnapshot,
  QualificationSnapshot,
  Subject,
  TierPermissions,
} from "@/domain/capability";

/**
 * THE DAY PACK — Build Specification §8.1.
 *
 *   "On connection, each desk and lane device pulls and caches: today's and
 *    tomorrow's expected arrivals with computed status; all active memberships
 *    and tiers; all guest invitations for the window; the full firearm
 *    register; ammunition lot balances; the active waiver version; staff and
 *    device records. Refreshed continuously while online; sufficient to run a
 *    full day alone."
 *
 * ===========================================================================
 * WHAT THIS TYPE IS ACTUALLY FOR
 *
 * §4 requires one capability service for both sides. §8 requires the desk to
 * make real permission decisions with no server. `evaluate()` in
 * src/domain/capability is already pure and takes every fact as an argument —
 * so the only thing standing between it and working offline is something to
 * assemble a `Subject` from local data.
 *
 * That is this file. `subjectFor()` at the bottom is the entire point: the
 * server builds a Subject from Postgres, the desk builds the identical Subject
 * from this pack, and both hand it to the same function. Not an equivalent
 * decision — the same one, including the sentence shown to the member.
 *
 * ===========================================================================
 * §10 IS ENFORCED BY THE SHAPE OF THIS TYPE
 *
 *   "Licence scans readable only by the founder role. Not by range officers.
 *    Not on the desk or lane surfaces."
 *
 * The desk genuinely needs to know whether a licence is verified, what
 * calibres it covers and when it expires — MAY_USE_OWN_FIREARM is undecidable
 * without those. It does not need, and must never hold, the scan itself.
 *
 * So `PackLicence` below carries the facts and has no `documentUrl` field at
 * all. Not omitted by a serialiser that someone could change, not filtered by
 * a query that someone could edit — absent from the type, so a pack containing
 * one does not compile. §10 stops being a rule anybody has to remember.
 *
 * The same reasoning removes `address`, `dateOfBirth`, `notes` and
 * `emergencyContact*` from `PackPerson`. A desk tablet needs a name, a
 * photograph and a status to check somebody in fifteen seconds (§1.2). It does
 * not need a home address, and a stolen tablet holding four hundred of them is
 * the concentration §10 opens by warning about.
 *
 * The emergency contact is the interesting exclusion, because it looks
 * necessary. It is not needed to CHECK SOMEONE IN — it is needed when there is
 * an incident, which is a moment where fetching one record from the server, or
 * asking the founder, is entirely acceptable and far better than holding every
 * member's next of kin on a device in a public building.
 */

/* ---------------------------------------------------------------------------
   THE RECORDS
   -------------------------------------------------------------------------- */

/** A person, as the desk may see them. See §10 note above for the omissions. */
export type PackPerson = {
  id: string;
  firstName: string;
  lastName: string;
  /** Signed, expiring URL (§2). Re-issued with each pull. */
  photoUrl: string | null;
};

export type PackMembership = {
  id: string;
  personId: string;
  tierId: string;
  memberNumber: number;
  status: MembershipStatus;
  endedOn: string | null;
  renewsOn: string | null;
};

/** Licence FACTS. Deliberately no document. §10. */
export type PackLicence = {
  id: string;
  personId: string;
  status: LicenceStatus;
  calibres: readonly string[];
  expiresOn: string | null;
};

export type PackQualification = {
  personId: string;
  discipline: string;
  level: string;
  expiresAt: string | null;
};

export type PackWaiverSignature = {
  personId: string;
  waiverVersionId: string;
  signedAt: string;
};

export type PackInvitation = {
  id: string;
  hostMembershipId: string;
  hostPersonId: string;
  guestPersonId: string | null;
  bookingId: string | null;
  status: InvitationStatus;
  expiresAt: string;
  isChargeable: boolean;
};

export type PackFirearm = {
  id: string;
  serialNumber: string;
  make: string;
  model: string;
  calibre: string;
  ownership: "club" | "member";
  ownerPersonId: string | null;
  /** Derived from custody_events server-side (§3.4). Never written here. */
  status: FirearmSnapshot["status"];
};

export type PackAmmunitionLot = {
  id: string;
  calibre: string;
  quantityRemaining: number;
};

export type PackStaff = {
  id: string;
  personId: string;
  displayName: string;
  role: StaffRole;
  active: boolean;
};

export type PackDevice = {
  id: string;
  label: string;
  surface: DeviceSurface;
  revoked: boolean;
};

export type PackAllowance = {
  membershipId: string;
  includedQuota: number;
  usedCount: number;
  overagePriceLabel: string | null;
};

/**
 * An expected arrival — one row on the desk's Today screen (§6.4).
 *
 * The status is NOT carried in the pack, despite §8.1 saying "with computed
 * status". It is computed on the device by calling the capability service,
 * because a status computed on the server an hour ago is wrong the moment the
 * host checks in — and §4 requires exactly that row to clear itself without
 * the officer retrying. Shipping a precomputed status would make that
 * impossible and would duplicate the permission logic §4 forbids duplicating.
 */
export type PackArrival = {
  personId: string;
  bookingId: string | null;
  sessionId: string | null;
  role: ParticipantRole;
  discipline: string;
  slotStart: string;
  /** For a guest: who is bringing them. */
  hostPersonId: string | null;
  invitationId: string | null;
};

/* ---------------------------------------------------------------------------
   THE PACK
   -------------------------------------------------------------------------- */

/**
 * Everything a device needs to run a day alone.
 *
 * Serialisable as-is: every date is an ISO string, because this crosses the
 * wire as JSON and is then structured-cloned into IndexedDB. `hydrate()`
 * converts to Dates at the one boundary where they are needed, so no other
 * module has to remember which fields are strings.
 */
export type DayPack = {
  /** Server time at which this pack was produced. Drives staleness (§8.1). */
  pulledAt: string;
  /** Lagos calendar dates this pack covers — today and tomorrow. */
  windowStart: string;
  windowEnd: string;

  /** §3.1: exactly one active version. A signature against any other is stale. */
  activeWaiverVersionId: string;
  /** Null until counsel settles it (§14). Fails open — see WaiverContext. */
  waiverValidityDays: number | null;

  /** §13/§14: the storage workflow sits behind a flag. */
  storageEnabled: boolean;
  /** Disciplines that demand a club sign-off before shooting unsupervised. */
  disciplinesRequiringQualification: readonly string[];

  tiers: readonly (TierPermissions & { active: boolean })[];
  people: readonly PackPerson[];
  memberships: readonly PackMembership[];
  licences: readonly PackLicence[];
  qualifications: readonly PackQualification[];
  waiverSignatures: readonly PackWaiverSignature[];
  allowances: readonly PackAllowance[];
  invitations: readonly PackInvitation[];
  arrivals: readonly PackArrival[];
  firearms: readonly PackFirearm[];
  ammunitionLots: readonly PackAmmunitionLot[];
  staff: readonly PackStaff[];
  devices: readonly PackDevice[];
};

/* ---------------------------------------------------------------------------
   INDEXING

   The Today screen evaluates several capabilities for every expected arrival,
   and §6.4 gives the whole render one second from cold with no network. Doing
   that against arrays with `.find()` inside a loop is quadratic in the number
   of people in the pack, which is fine for a demo of six and is not fine for
   the hundred-member staging fixture §2.1 requires.

   So a pack is indexed once on load and the index is what everything reads.
   -------------------------------------------------------------------------- */

export type IndexedDayPack = {
  pack: DayPack;
  pulledAt: Date;
  personById: Map<string, PackPerson>;
  tierById: Map<string, TierPermissions>;
  membershipByPersonId: Map<string, PackMembership>;
  licencesByPersonId: Map<string, PackLicence[]>;
  qualificationsByPersonId: Map<string, PackQualification[]>;
  waiverByPersonId: Map<string, PackWaiverSignature>;
  allowanceByMembershipId: Map<string, PackAllowance>;
  invitationById: Map<string, PackInvitation>;
  firearmBySerial: Map<string, PackFirearm>;
  firearmById: Map<string, PackFirearm>;
};

const groupBy = <T>(rows: readonly T[], key: (row: T) => string) => {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const existing = map.get(k);
    if (existing) existing.push(row);
    else map.set(k, [row]);
  }
  return map;
};

const index = <T>(rows: readonly T[], key: (row: T) => string) =>
  new Map(rows.map((row) => [key(row), row]));

export function hydrate(pack: DayPack): IndexedDayPack {
  return {
    pack,
    pulledAt: new Date(pack.pulledAt),
    personById: index(pack.people, (p) => p.id),
    tierById: index(pack.tiers, (t) => t.id),
    /* One membership per person. A person may hold several over a lifetime,
       but the pack carries only live ones, so the last write wins and that is
       the current one. */
    membershipByPersonId: index(pack.memberships, (m) => m.personId),
    licencesByPersonId: groupBy(pack.licences, (l) => l.personId),
    qualificationsByPersonId: groupBy(pack.qualifications, (q) => q.personId),
    waiverByPersonId: index(pack.waiverSignatures, (w) => w.personId),
    allowanceByMembershipId: index(pack.allowances, (a) => a.membershipId),
    invitationById: index(pack.invitations, (i) => i.id),
    firearmBySerial: index(pack.firearms, (f) => f.serialNumber),
    firearmById: index(pack.firearms, (f) => f.id),
  };
}

/* ---------------------------------------------------------------------------
   THE BRIDGE TO §4
   -------------------------------------------------------------------------- */

const toDate = (value: string | null): Date | null =>
  value === null ? null : new Date(value);

/**
 * Build a capability `Subject` from the pack.
 *
 * THE FUNCTION THIS WHOLE FILE EXISTS FOR.
 *
 * The server has an equivalent that reads Postgres. Both produce the same
 * type, both feed `evaluate()`, and the desk therefore reaches the same
 * decision offline that the server would have reached online — including the
 * exact sentence shown to the member (§4.1: "the human string is what the desk
 * displays and what the member reads in the portal").
 *
 * Returns a Subject with `membership: null` for someone the pack knows only as
 * a guest, which is precisely how §3.1 models a guest: a state of a person,
 * not another kind of record.
 */
export function subjectFor(
  indexed: IndexedDayPack,
  personId: string,
): Subject | null {
  if (!indexed.personById.has(personId)) return null;

  const membership = indexed.membershipByPersonId.get(personId) ?? null;
  const packTier = membership ? indexed.tierById.get(membership.tierId) : undefined;

  /* Projected field by field rather than spread.
   *
   * The pack's tier carries `active`, which the server's Subject does not, and
   * spreading it would hand `evaluate()` an object of a different shape on the
   * desk than on the server. Nothing reads `active`, so every decision would
   * still match — which is exactly what makes it worth being strict about: a
   * divergence that changes no behaviour today is the one that survives long
   * enough to change behaviour later. The parity test in daypack.test.ts
   * compares whole objects and caught this. */
  const tier: TierPermissions | undefined = packTier && {
    id: packTier.id,
    name: packTier.name,
    canHost: packTier.canHost,
    guestAllowanceAnnual: packTier.guestAllowanceAnnual,
    guestConcurrentMax: packTier.guestConcurrentMax,
    canOwnFirearm: packTier.canOwnFirearm,
    canStoreFirearm: packTier.canStoreFirearm,
    disciplineAccess: packTier.disciplineAccess,
    bookingHorizonDays: packTier.bookingHorizonDays,
    concurrentBookingsMax: packTier.concurrentBookingsMax,
  };

  const licences: LicenceSnapshot[] = (
    indexed.licencesByPersonId.get(personId) ?? []
  ).map((l) => ({
    id: l.id,
    status: l.status,
    calibres: l.calibres,
    expiresOn: toDate(l.expiresOn),
  }));

  const qualifications: QualificationSnapshot[] = (
    indexed.qualificationsByPersonId.get(personId) ?? []
  ).map((q) => ({
    discipline: q.discipline,
    level: q.level,
    expiresAt: toDate(q.expiresAt),
  }));

  const signature = indexed.waiverByPersonId.get(personId);

  return {
    personId,
    /* A membership whose tier is missing from the pack is treated as no
       membership rather than crashing the desk. It should be impossible —
       the pack carries every active tier — but the failure mode of a thrown
       exception here is a blank Today screen at eight in the morning, and the
       failure mode of this is one person showing a block an officer can
       override. */
    membership:
      membership && tier
        ? {
            id: membership.id,
            status: membership.status,
            tier,
            endedOn: toDate(membership.endedOn),
            renewsOn: toDate(membership.renewsOn),
          }
        : null,
    waiver: signature
      ? {
          waiverVersionId: signature.waiverVersionId,
          signedAt: new Date(signature.signedAt),
        }
      : null,
    licences,
    qualifications,
  };
}

/** A firearm as the capability service expects it, looked up by serial. */
export function firearmBySerial(
  indexed: IndexedDayPack,
  serialNumber: string,
): FirearmSnapshot | null {
  const found = indexed.firearmBySerial.get(serialNumber);
  if (!found) return null;
  return {
    id: found.id,
    serialNumber: found.serialNumber,
    calibre: found.calibre,
    ownership: found.ownership,
    ownerPersonId: found.ownerPersonId,
    status: found.status,
  };
}

/** The host's allowance, for MAY_HOST. */
export function allowanceFor(
  indexed: IndexedDayPack,
  membershipId: string,
): PackAllowance | null {
  return indexed.allowanceByMembershipId.get(membershipId) ?? null;
}

/**
 * Whether a discipline demands a club sign-off.
 *
 * Read from the pack rather than hard-coded, because it is club policy that
 * will change without a deploy — and a desk running last month's rule is the
 * kind of quiet divergence §4 exists to prevent.
 */
export const requiresQualification = (
  indexed: IndexedDayPack,
  discipline: string,
): boolean =>
  indexed.pack.disciplinesRequiringQualification.includes(discipline);

/**
 * Arrivals for one Lagos calendar day, in time order (§6.4: "Expected arrivals
 * in time order").
 */
export function arrivalsFor(
  indexed: IndexedDayPack,
  dateKey: string,
): PackArrival[] {
  return indexed.pack.arrivals
    .filter((a) => a.slotStart.startsWith(dateKey))
    .sort((a, b) => (a.slotStart < b.slotStart ? -1 : a.slotStart > b.slotStart ? 1 : 0));
}

/**
 * Guard against a pack that carries something §10 forbids on this surface.
 *
 * The types already make a licence document unrepresentable in TypeScript, but
 * the pack arrives as JSON from the network and TypeScript is not there at
 * runtime. A server bug, or a hand-rolled fixture, could put one in.
 *
 * Called on every pull. If it trips, the pack is rejected rather than stored —
 * a desk running without today's arrivals is a bad morning, and a stolen
 * tablet full of firearm licence scans is a different order of problem.
 */
export function assertNoRestrictedFields(pack: DayPack): void {
  const offending: string[] = [];

  const forbidden = [
    "documentUrl",
    "document_url",
    "address",
    "dateOfBirth",
    "date_of_birth",
    "emergencyContactName",
    "emergency_contact_name",
    "emergencyContactPhone",
    "emergency_contact_phone",
    "pinHash",
    "pin_hash",
    "tokenHash",
    "token_hash",
  ];

  const walk = (value: unknown, path: string) => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.includes(key)) offending.push(`${path}.${key}`);
      walk(child, `${path}.${key}`);
    }
  };

  walk(pack, "daypack");

  if (offending.length > 0) {
    throw new Error(
      "This day pack carries fields that must never reach a desk or lane " +
        `device (§10): ${offending.join(", ")}. The pack was not stored.`,
    );
  }
}
