import { eq } from "drizzle-orm";
import { getArmoryDb, isArmoryDatabaseConfigured, schema } from "@/db/armory/client";
import { getDb, isDatabaseConfigured } from "@/db/client";
import { members } from "@/db/schema";
import type { Subject, TierPermissions } from "@/domain/capability";
import { subjectFromRows, tierPermissions } from "@/server/subject";
import { getMember } from "@/server/auth/session";
import { allowancePeriod } from "./allowances";

/**
 * THE MEMBER BEHIND THE PORTAL — §6.2.
 *
 * The portal signs a member in against the leagues product (email, passwordless)
 * and every §6.2 screen then needs the MANAGEMENT system: their membership,
 * their tier's permission matrix, their guest allowance. `members.person_id`
 * (drizzle/0005) is the join, and this is the one place that traverses it.
 *
 * ===========================================================================
 * A PORTAL SESSION IS NOT A MEMBERSHIP
 *
 * The three states this returns are genuinely different and the screens treat
 * them differently:
 *
 *   not linked   Signed in to leagues, no person record. §3.1 makes applicant,
 *                guest and member states of a person, and this account is none
 *                of them — somebody who signed in to look at a ladder.
 *   linked, no membership
 *                A person the club knows — very likely a former guest (§3.2's
 *                acquisition funnel). They may book nothing, and the honest
 *                screen invites them to apply rather than showing an empty
 *                calendar.
 *   member       Everything §6.2 needs.
 *
 * Collapsing the first two into "not a member" would lose the club its warmest
 * prospect: §3.2 counts guest visits "across all hosts, not per host" precisely
 * because someone brought four times by four different members is the person
 * most likely to join.
 */

export type ArmoryMember = {
  readonly personId: string;
  readonly membershipId: string;
  readonly memberNumber: number;
  readonly tier: TierPermissions;
  readonly startedOn: Date;
  /** For MAY_BOOK, MAY_HOST and everything else §4 decides. */
  readonly subject: Subject;
  readonly allowance: {
    readonly includedQuota: number;
    readonly usedCount: number;
    readonly remaining: number;
    readonly periodEnd: Date;
  };
};

export type MemberResolution =
  | { readonly state: "signed_out" }
  | { readonly state: "not_linked" }
  | { readonly state: "no_membership"; readonly personId: string }
  | { readonly state: "member"; readonly member: ArmoryMember };

export async function resolveArmoryMember(): Promise<MemberResolution> {
  if (!isDatabaseConfigured() || !isArmoryDatabaseConfigured()) {
    return { state: "signed_out" };
  }

  const account = await getMember();
  if (!account) return { state: "signed_out" };

  const [link] = await getDb()
    .select({ personId: members.personId })
    .from(members)
    .where(eq(members.id, account.id))
    .limit(1);

  if (!link?.personId) return { state: "not_linked" };
  const personId = link.personId;

  const db = getArmoryDb();

  const [membership] = await db
    .select({
      id: schema.memberships.id,
      personId: schema.memberships.personId,
      tierId: schema.memberships.tierId,
      memberNumber: schema.memberships.memberNumber,
      status: schema.memberships.status,
      startedOn: schema.memberships.startedOn,
      endedOn: schema.memberships.endedOn,
      renewsOn: schema.memberships.renewsOn,
    })
    .from(schema.memberships)
    .where(eq(schema.memberships.personId, personId))
    .limit(1);

  if (!membership) return { state: "no_membership", personId };

  const [tier] = await db
    .select()
    .from(schema.tiers)
    .where(eq(schema.tiers.id, membership.tierId))
    .limit(1);

  if (!tier) return { state: "no_membership", personId };

  const [licences, qualifications, signature] = await Promise.all([
    db
      .select({
        id: schema.licences.id,
        personId: schema.licences.personId,
        status: schema.licences.status,
        calibres: schema.licences.calibres,
        expiresOn: schema.licences.expiresOn,
      })
      .from(schema.licences)
      .where(eq(schema.licences.personId, personId)),
    db
      .select({
        personId: schema.qualifications.personId,
        discipline: schema.qualifications.discipline,
        level: schema.qualifications.level,
        expiresAt: schema.qualifications.expiresAt,
      })
      .from(schema.qualifications)
      .where(eq(schema.qualifications.personId, personId)),
    db
      .select({
        personId: schema.waiverSignatures.personId,
        waiverVersionId: schema.waiverSignatures.waiverVersionId,
        signedAt: schema.waiverSignatures.signedAt,
      })
      .from(schema.waiverSignatures)
      .where(eq(schema.waiverSignatures.personId, personId))
      .limit(1),
  ]);

  /* §3.1 makes started_on nullable; a membership issued by M3's onboarding
     always sets it. Falling back to the period arithmetic's epoch would put the
     allowance year on 1 January for anyone missing it, so the created date is
     the honest substitute — it is when the club started counting. */
  const startedOn = membership.startedOn
    ? new Date(`${membership.startedOn}T00:00:00.000Z`)
    : new Date();

  const now = new Date();
  const { periodEnd } = allowancePeriod(startedOn, now);

  const [allowanceRow] = await db
    .select({
      includedQuota: schema.hostAllowances.includedQuota,
      usedCount: schema.hostAllowances.usedCount,
    })
    .from(schema.hostAllowances)
    .where(eq(schema.hostAllowances.membershipId, membership.id))
    .limit(1);

  /* No row yet means no guest has been invited this period, not that the member
     has no allowance — the row is created on first use (`ensureAllowancePeriod`).
     Reading it as zero quota would tell a member with six included visits that
     they have none, which §12 is explicit must never be a surprise. */
  const includedQuota = allowanceRow?.includedQuota ?? tier.guestAllowanceAnnual;
  const usedCount = allowanceRow?.usedCount ?? 0;

  return {
    state: "member",
    member: {
      personId,
      membershipId: membership.id,
      memberNumber: membership.memberNumber,
      tier: tierPermissions(tier),
      startedOn,
      /* The row types in src/server/rows.ts carry instants as ISO strings —
         they are the day pack's wire format, and `subjectFromRows` shares them
         with the desk so both sides build an identical Subject (§4). Drizzle
         returns Dates for timestamptz, so the conversion happens here rather
         than by widening the shared type, which would let the two builders
         drift apart on exactly the field §4 needs them to agree on. */
      subject: subjectFromRows({
        personId,
        membership,
        tier,
        waiverSignature: signature[0]
          ? {
              personId: signature[0].personId,
              waiverVersionId: signature[0].waiverVersionId,
              signedAt: signature[0].signedAt.toISOString(),
            }
          : null,
        licences,
        qualifications: qualifications.map((row) => ({
          personId: row.personId,
          discipline: row.discipline,
          level: row.level,
          expiresAt: row.expiresAt?.toISOString() ?? null,
        })),
      }),
      allowance: {
        includedQuota,
        usedCount,
        remaining: Math.max(0, includedQuota - usedCount),
        periodEnd,
      },
    },
  };
}
