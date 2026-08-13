import { toDate } from "@/offline/daypack";
import type {
  LicenceSnapshot,
  QualificationSnapshot,
  Subject,
  TierPermissions,
} from "@/domain/capability";
import type {
  LicenceRow,
  MembershipRow,
  QualificationRow,
  TierRow,
  WaiverSignatureRow,
} from "./rows";

/**
 * THE SERVER'S SUBJECT — the other half of §4.
 *
 *   §4: "One service, called from every surface. No screen makes its own
 *        permission decision, and no permission check is duplicated in the client
 *        and the server."
 *
 * `evaluate()` is that one service and it is pure, so what remains is two loaders
 * that must agree. `subjectFor()` in src/offline/daypack.ts assembles a Subject
 * from the day pack on a tablet. This assembles the identical Subject from
 * Postgres rows.
 *
 * ===========================================================================
 * WHAT MAKES THE AGREEMENT STRUCTURAL RATHER THAN ASSERTED
 *
 * The two builders read different inputs, so a test that compares them against
 * hand-written expectations proves only that both matched the expectation the day
 * it was written. Three things make the agreement hold by construction instead:
 *
 *   1. Both start from the SAME row shapes (src/server/rows.ts). The pack is a
 *      projection of those rows, so the desk and the server are reading one
 *      snapshot in two formats rather than two queries that resemble each other.
 *
 *   2. Both convert dates with the SAME function — `toDate`, imported here from
 *      the offline module rather than rewritten. The whole class of bug where one
 *      side reads a date as midnight UTC and the other as midnight Lagos is
 *      removed rather than tested for.
 *
 *   3. Both project the tier FIELD BY FIELD. `TierRow` carries `active`, which a
 *      `TierPermissions` does not, and spreading it would hand `evaluate()` an
 *      object of a different shape on one side than the other. Nothing reads
 *      `active`, so every decision would still match — which is exactly what
 *      makes it worth being strict about: a divergence that changes no behaviour
 *      today is the one that survives long enough to change behaviour later.
 *
 * The parity test in src/server/parity.test.ts builds both from one fixture and
 * compares whole decision objects, including the sentence §4.1 makes part of the
 * contract.
 */

/**
 * The tier as the evaluator sees it.
 *
 * Shared by both builders. If `TierPermissions` gains a required field, this
 * object literal stops compiling and so does the pack's — which is the intended
 * way to find out that a new permission needs projecting on both sides.
 */
export function tierPermissions(row: TierRow): TierPermissions {
  return {
    id: row.id,
    name: row.name,
    canHost: row.canHost,
    guestAllowanceAnnual: row.guestAllowanceAnnual,
    guestConcurrentMax: row.guestConcurrentMax,
    canOwnFirearm: row.canOwnFirearm,
    canStoreFirearm: row.canStoreFirearm,
    disciplineAccess: row.disciplineAccess,
    bookingHorizonDays: row.bookingHorizonDays,
    concurrentBookingsMax: row.concurrentBookingsMax,
  };
}

export type SubjectSource = {
  personId: string;
  /** Null for a guest — §3.1: "a state of a person, not another kind of record." */
  membership: MembershipRow | null;
  tier: TierRow | null;
  /** Most recent signature, whatever version it was against. */
  waiverSignature: WaiverSignatureRow | null;
  licences: readonly LicenceRow[];
  qualifications: readonly QualificationRow[];
};

/**
 * Build the capability Subject from database rows.
 *
 * Pure, and takes rows rather than a connection, so the query and the projection
 * fail separately and this half is testable without Postgres.
 */
export function subjectFromRows(source: SubjectSource): Subject {
  const licences: LicenceSnapshot[] = source.licences.map((licence) => ({
    id: licence.id,
    status: licence.status,
    calibres: licence.calibres,
    expiresOn: toDate(licence.expiresOn),
  }));

  const qualifications: QualificationSnapshot[] = source.qualifications.map(
    (qualification) => ({
      discipline: qualification.discipline,
      level: qualification.level,
      expiresAt: toDate(qualification.expiresAt),
    }),
  );

  return {
    personId: source.personId,
    /* A membership whose tier is missing is treated as no membership, matching
       the desk exactly. It should be impossible on this side — the join would
       have failed — but the two builders diverging on an impossible case is how
       an impossible case becomes a support call. */
    membership:
      source.membership && source.tier
        ? {
            id: source.membership.id,
            status: source.membership.status,
            tier: tierPermissions(source.tier),
            endedOn: toDate(source.membership.endedOn),
            renewsOn: toDate(source.membership.renewsOn),
          }
        : null,
    waiver: source.waiverSignature
      ? {
          waiverVersionId: source.waiverSignature.waiverVersionId,
          signedAt: new Date(source.waiverSignature.signedAt),
        }
      : null,
    licences,
    qualifications,
  };
}

/**
 * Pick one person's rows out of a whole snapshot and build their Subject.
 *
 * The convenience the parity test needs, and the shape a request handler wants:
 * the day pack query already fetches every active membership and tier, so a
 * per-person Subject on the server is a lookup rather than another query.
 */
export function subjectFromSnapshot(
  snapshot: {
    memberships: readonly MembershipRow[];
    tiers: readonly TierRow[];
    licences: readonly LicenceRow[];
    qualifications: readonly QualificationRow[];
    waiverSignatures: readonly WaiverSignatureRow[];
  },
  personId: string,
): Subject {
  const membership =
    snapshot.memberships.find((row) => row.personId === personId) ?? null;

  const tier = membership
    ? (snapshot.tiers.find((row) => row.id === membership.tierId) ?? null)
    : null;

  return subjectFromRows({
    personId,
    membership,
    tier,
    waiverSignature:
      snapshot.waiverSignatures.find((row) => row.personId === personId) ?? null,
    licences: snapshot.licences.filter((row) => row.personId === personId),
    qualifications: snapshot.qualifications.filter(
      (row) => row.personId === personId,
    ),
  });
}
