import { and, asc, eq, isNull } from "drizzle-orm";
import type { ArmoryDb, ArmoryReader } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import type { StaffGrant, StaffRole } from "@/domain/enums";
import {
  decideGrant,
  heldGrants,
  type HeldGrant,
  type Refusal,
} from "@/domain/grants";
import { uuidv7 } from "@/lib/uuidv7";

/**
 * THE GRANT LOADER AND THE ONE PLACE GRANTS ARE WRITTEN — Management §5, §12.1.
 *
 * The pure half lives in src/domain/grants.ts and decides. This half reads the
 * rows and writes them, and it is deliberately the only module that does.
 *
 * ===========================================================================
 * WHY THE SEPARATION CHECK CANNOT LIVE IN THE DATABASE
 *
 * §12 asks for database-level enforcement wherever it is possible, and 0002
 * delivers it for the append-only tables. S3 is the case where it is not
 * possible honestly: it forbids a SET — custody together with ledger — and a row
 * constraint cannot see a set. A trigger counting sibling rows could, and would
 * be `refuseCombination` written a second time in PL/pgSQL, which is exactly the
 * duplication the README's warning about `firearms.status` exists to discourage.
 *
 * So the rule lives once, in the domain, and this module is the only writer —
 * which is what makes "once" true rather than aspirational.
 *
 * ===========================================================================
 * THE CHECK AND THE WRITE ARE ONE TRANSACTION
 *
 * Two managers granting at the same moment would otherwise each read a clean
 * hand, each decide correctly, and together assemble the pair S3 forbids. This
 * is §8.3's "two devices, one allowance" wearing a different hat, and it has the
 * same resolution: read the current hand INSIDE the transaction that writes, so
 * the second one sees the first.
 */

/* ============================================================================
   READING
   ========================================================================= */

/**
 * Everything about a member of staff that a management screen needs.
 *
 * Assembled once per request. `role` travels with the grants because the
 * founder exception is expressed against it — read is exempt — and a caller
 * holding grants without the role could not evaluate that.
 */
export type StaffPrincipal = {
  readonly staffUserId: string;
  readonly personId: string;
  readonly role: StaffRole;
  readonly grants: ReadonlySet<StaffGrant>;
};

/**
 * The rows a person holds, live or not.
 *
 * Returns rows rather than a set so the caller can hand them to `heldGrants`
 * with its own `now`. §15 requires capability to be re-evaluated per request,
 * and a loader that resolved the clock itself would invite a cached principal —
 * which is the same defect one layer down.
 */
export async function grantRowsFor(
  db: ArmoryReader,
  staffUserId: string,
): Promise<HeldGrant[]> {
  const rows = await db
    .select({
      grant: schema.staffGrants.grant,
      grantedByStaffId: schema.staffGrants.grantedByStaffId,
      reason: schema.staffGrants.reason,
      expiresAt: schema.staffGrants.expiresAt,
      revokedAt: schema.staffGrants.revokedAt,
    })
    .from(schema.staffGrants)
    .where(eq(schema.staffGrants.staffUserId, staffUserId))
    .orderBy(asc(schema.staffGrants.createdAt));

  return rows;
}

/** The principal behind a request, at this instant. */
export async function principalFor(
  db: ArmoryReader,
  staffUserId: string,
  now: Date,
): Promise<StaffPrincipal | null> {
  const [staff] = await db
    .select({
      id: schema.staffUsers.id,
      personId: schema.staffUsers.personId,
      role: schema.staffUsers.role,
      active: schema.staffUsers.active,
    })
    .from(schema.staffUsers)
    .where(eq(schema.staffUsers.id, staffUserId))
    .limit(1);

  if (!staff || !staff.active) return null;

  const rows = await grantRowsFor(db, staffUserId);

  return {
    staffUserId: staff.id,
    personId: staff.personId,
    role: staff.role,
    grants: heldGrants(rows, now),
  };
}

/* ============================================================================
   THE REGISTER — Management §5.1, and the founder exception

   "The exception is a register, not a silence."
   ========================================================================= */

export type RegisterEntry = {
  readonly staffUserId: string;
  readonly grant: StaffGrant;
  readonly reason: string;
  readonly grantedByStaffId: string | null;
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
};

/**
 * Every grant ever issued, newest first.
 *
 * ===========================================================================
 * IT INCLUDES WHAT WAS TAKEN BACK, AND THAT IS THE POINT
 *
 * A register of grants currently held would show a club in perfect order the
 * morning after somebody held custody and the ledger for one evening. The
 * sequence — issued at 18:40 with a reason, lapsed at 06:00 — is the entire
 * content of the disclosure, and it is why 0011 makes this table append-only
 * and revocation a column rather than a delete.
 *
 * This is what the monthly owner pack renders, and it is the reason the founder
 * exception is affordable: crossing a separation is possible, and it is never
 * quiet.
 */
export async function grantRegister(
  db: ArmoryReader,
  input: { readonly since: Date },
): Promise<RegisterEntry[]> {
  const rows = await db
    .select({
      staffUserId: schema.staffGrants.staffUserId,
      grant: schema.staffGrants.grant,
      reason: schema.staffGrants.reason,
      grantedByStaffId: schema.staffGrants.grantedByStaffId,
      grantedAt: schema.staffGrants.createdAt,
      expiresAt: schema.staffGrants.expiresAt,
      revokedAt: schema.staffGrants.revokedAt,
    })
    .from(schema.staffGrants)
    .orderBy(asc(schema.staffGrants.createdAt));

  return rows
    .filter((row) => row.grantedAt >= input.since)
    .reverse();
}

/* ============================================================================
   WRITING
   ========================================================================= */

export type IssueResult =
  | { readonly ok: true; readonly issued: readonly StaffGrant[] }
  | { readonly ok: false; readonly refusal: Refusal };

/**
 * Issue grants to a member of staff.
 *
 * The transaction is the correctness argument — see the header. `decideGrant`
 * throws on a malformed request (no reason, an expiry in the past) and refuses a
 * forbidden one, and this preserves that division: a throw is a caller bug, a
 * refusal is a sentence a screen renders to a person.
 */
export async function issueGrants(
  db: ArmoryDb,
  input: {
    readonly staffUserId: string;
    readonly adding: readonly StaffGrant[];
    readonly reason: string;
    readonly expiresAt: Date | null;
    readonly actorStaffId: string;
    readonly now: Date;
  },
): Promise<IssueResult> {
  return db.transaction(async (tx) => {
    const current = heldGrants(await grantRowsFor(tx, input.staffUserId), input.now);

    const decision = decideGrant({
      current,
      adding: input.adding,
      reason: input.reason,
      expiresAt: input.expiresAt,
      now: input.now,
    });

    if (!decision.ok) return decision;

    /* Already held is a no-op rather than an error. A manager pressing the
       button twice, or granting a role bundle that overlaps what somebody
       already has, is not a mistake to report — and the partial unique index
       would otherwise turn it into one. */
    const missing = input.adding.filter((grant) => !current.has(grant));
    if (missing.length === 0) return { ok: true, issued: [] };

    await tx.insert(schema.staffGrants).values(
      missing.map((grant) => ({
        id: uuidv7(),
        staffUserId: input.staffUserId,
        grant,
        grantedByStaffId: input.actorStaffId,
        reason: input.reason.trim(),
        expiresAt: input.expiresAt,
      })),
    );

    return { ok: true, issued: missing };
  });
}

/**
 * Take a grant back.
 *
 * Never a delete — 0011 refuses one at the database level. Revocation is
 * immediate rather than scheduled, because the case that matters is somebody
 * leaving, and "from tomorrow" is not an answer to that.
 *
 * Idempotent: revoking what is already revoked reports nothing revoked rather
 * than failing, so a second press of the button is harmless.
 */
export async function revokeGrants(
  db: ArmoryDb,
  input: {
    readonly staffUserId: string;
    readonly removing: readonly StaffGrant[];
    readonly actorStaffId: string;
    readonly now: Date;
  },
): Promise<{ readonly revoked: readonly StaffGrant[] }> {
  const revoked: StaffGrant[] = [];

  for (const grant of input.removing) {
    const rows = await db
      .update(schema.staffGrants)
      .set({ revokedAt: input.now, revokedByStaffId: input.actorStaffId })
      .where(
        and(
          eq(schema.staffGrants.staffUserId, input.staffUserId),
          eq(schema.staffGrants.grant, grant),
          isNull(schema.staffGrants.revokedAt),
        ),
      )
      .returning({ grant: schema.staffGrants.grant });

    if (rows.length > 0) revoked.push(grant);
  }

  return { revoked };
}
