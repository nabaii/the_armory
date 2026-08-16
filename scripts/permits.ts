/**
 * ISSUE THE BOOTSTRAP ACCOUNT'S PERMITS, LICENCES AND WAIVER.
 *
 *   npm run db:permits              show what the founder holds — writes nothing
 *   npm run db:permits -- --apply   issue everything missing
 *   npm run db:permits -- --revoke  take back everything this script issued
 *
 * ============================================================================
 * WHAT THIS IS FOR, AND THE THING IT IS NOT
 *
 * A founder testing their own club cannot walk the whole product while the
 * capability service is correctly refusing them. This issues the records that
 * clear those refusals, so the experience can be exercised against a real
 * database rather than a fixture.
 *
 * It is a BOOTSTRAP tool and it is not an operations tool. Every record it
 * writes is a compliance artefact in normal use — a waiver signature is the
 * club's evidence that a person accepted the range rules, and §10 makes the
 * firearm custody chain append-only precisely because these records are
 * evidence. Writing one for somebody who has not signed anything is defensible
 * only while the club is not yet open.
 *
 * So three things are true of everything below, deliberately:
 *
 *   1. IT IS MARKED. Every record carries the sentinel in a text field the
 *      schema already has, so it is identifiable by anybody auditing the
 *      roster — including somebody who has never read this file. The waiver's
 *      sentinel sits in `signature_image_url`, the field that would otherwise
 *      hold the captured signature: a row with this in it is visibly a row with
 *      no signature behind it, which is exactly what it is.
 *   2. IT IS REVERSIBLE. `--revoke` removes what the sentinel matches and
 *      nothing else, so a signature later captured at the desk survives.
 *   3. IT TOUCHES NOBODY ELSE. The founder is resolved through
 *      `staff_users.role = 'founder'` — the same rule `apply-credentials.ts`
 *      uses, for the reason it gives: identity by role, never by a value
 *      somebody may have edited.
 *
 * ============================================================================
 * IT REPORTS FACTS AND DOES NOT DECIDE PERMISSION
 *
 * P1 — "no screen makes its own permission decision" — binds a script too. This
 * prints what the member HOLDS and never works out what that entitles them to.
 * The portal's own action stack is the authority on what is blocking them, and
 * it renders whatever the capability service returns; reproducing that logic
 * here would be a second source of truth that drifts.
 *
 * Worth knowing before running it, because it changes what you should expect:
 * on the database this was written against, only ONE of the three things in the
 * title was blocking anything. The waiver was unsigned. Qualifications were not
 * required by `club_settings.disciplines_requiring_qualification`, which was
 * empty, and no firearm was registered, so a licence would have sat there
 * proving nothing. All three are issued because all three were asked for; the
 * ordering below reflects which one actually mattered.
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  getArmoryDb,
  isArmoryDatabaseConfigured,
  schema,
} from "@/db/armory/client";

/** Provenance. Written into a field a human reading the row will see. */
const SENTINEL = "BOOTSTRAP — issued by npm run db:permits, not a real record";

/**
 * What the licence covers when the club has registered no firearms yet.
 *
 * Read from `armory.firearms` first, because a licence that does not cover the
 * kit is a licence that blocks at the lane. This list is only reached on an
 * empty register, and it is the four the club's own disciplines imply rather
 * than an attempt at a real schedule.
 */
const PLACEHOLDER_CALIBRES = ["4.5mm", ".177", ".22LR", "9mm"];

const APPLY = process.argv.includes("--apply");
const REVOKE = process.argv.includes("--revoke");

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

type Db = ReturnType<typeof getArmoryDb>;

async function main() {
  if (!isArmoryDatabaseConfigured()) {
    console.error(
      `\n${red("No DATABASE_URL.")} This talks to a real database — set it and run again.\n`,
    );
    process.exit(1);
  }

  if (APPLY && REVOKE) {
    console.error(`\n${red("Pick one of --apply or --revoke.")}\n`);
    process.exit(1);
  }

  const db = getArmoryDb();
  const now = new Date();
  const founder = await resolveFounder(db);

  console.log(
    `\n${bold("The bootstrap account")}  ${dim(`${founder.name} · M-${String(founder.memberNumber ?? 0).padStart(3, "0")}`)}\n`,
  );

  if (REVOKE) {
    await revoke(db, founder.personId);
  } else if (APPLY) {
    await issue(db, founder, now);
  } else {
    await show(db, founder);
    console.log(dim("  Nothing written. Pass --apply to issue, --revoke to undo.\n"));
    return;
  }

  console.log("");
  await show(db, founder);
}

/* ============================================================================
   WHO
   ========================================================================= */

type Founder = {
  personId: string;
  staffId: string;
  name: string;
  memberNumber: number | null;
  disciplines: string[];
};

async function resolveFounder(db: Db): Promise<Founder> {
  const [staff] = await db
    .select({ id: schema.staffUsers.id, personId: schema.staffUsers.personId })
    .from(schema.staffUsers)
    .where(eq(schema.staffUsers.role, "founder"))
    .limit(1);

  if (!staff) {
    console.error(
      `\n${red("No founder on this database.")} Run \`npm run db:bootstrap\` first.\n`,
    );
    process.exit(1);
  }

  const [person] = await db
    .select({
      firstName: schema.people.firstName,
      lastName: schema.people.lastName,
    })
    .from(schema.people)
    .where(eq(schema.people.id, staff.personId))
    .limit(1);

  const [membership] = await db
    .select({
      memberNumber: schema.memberships.memberNumber,
      tierId: schema.memberships.tierId,
    })
    .from(schema.memberships)
    .where(eq(schema.memberships.personId, staff.personId))
    .limit(1);

  let disciplines: string[] = [];
  if (membership) {
    const [tier] = await db
      .select({ disciplineAccess: schema.tiers.disciplineAccess })
      .from(schema.tiers)
      .where(eq(schema.tiers.id, membership.tierId))
      .limit(1);
    disciplines = (tier?.disciplineAccess as string[] | undefined) ?? [];
  }

  return {
    personId: staff.personId,
    staffId: staff.id,
    name: `${person?.firstName ?? "?"} ${person?.lastName ?? ""}`.trim(),
    memberNumber: membership?.memberNumber ?? null,
    disciplines,
  };
}

/* ============================================================================
   WHAT THEY HOLD — facts, never entitlements
   ========================================================================= */

async function held(db: Db, personId: string) {
  const [signatures, quals, licences] = await Promise.all([
    db
      .select({
        id: schema.waiverSignatures.id,
        mark: schema.waiverSignatures.signatureImageUrl,
      })
      .from(schema.waiverSignatures)
      .where(eq(schema.waiverSignatures.personId, personId)),
    db
      .select({
        discipline: schema.qualifications.discipline,
        level: schema.qualifications.level,
      })
      .from(schema.qualifications)
      .where(eq(schema.qualifications.personId, personId)),
    db
      .select({
        status: schema.licences.status,
        calibres: schema.licences.calibres,
        number: schema.licences.licenceNumber,
      })
      .from(schema.licences)
      .where(eq(schema.licences.personId, personId)),
  ]);

  return { signatures, quals, licences };
}

async function show(db: Db, founder: Founder) {
  const { signatures, quals, licences } = await held(db, founder.personId);
  const mark = (isBootstrap: boolean) => (isBootstrap ? dim(" (bootstrap)") : "");

  console.log(`  ${bold("Holds")}`);

  console.log(
    signatures.length === 0
      ? `    waiver             ${yellow("unsigned")}`
      : `    waiver             ${green("signed")}${mark(signatures.some((s) => s.mark === SENTINEL))}`,
  );

  console.log(
    quals.length === 0
      ? `    qualifications     ${dim("none")}`
      : `    qualifications     ${green(quals.map((q) => q.discipline).join(", "))}${mark(quals.some((q) => q.level === SENTINEL))}`,
  );

  console.log(
    licences.length === 0
      ? `    firearms licence   ${dim("none")}`
      : `    firearms licence   ${green(licences.map((l) => l.status).join(", "))}${mark(licences.some((l) => l.number === SENTINEL))}`,
  );
  console.log("");
}

/* ============================================================================
   ISSUE
   ========================================================================= */

async function issue(db: Db, founder: Founder, now: Date) {
  const { signatures, quals, licences } = await held(db, founder.personId);
  const changed: string[] = [];

  /* ---- The waiver. On the database this was written against, the only one
          that was actually blocking anything. --------------------------- */

  const [active] = await db
    .select({
      id: schema.waiverVersions.id,
      version: schema.waiverVersions.version,
    })
    .from(schema.waiverVersions)
    .where(eq(schema.waiverVersions.isActive, true))
    .limit(1);

  if (!active) {
    changed.push(
      yellow("waiver — no active version published, nothing to sign against"),
    );
  } else if (signatures.length > 0) {
    changed.push(dim("waiver — already signed, left alone"));
  } else {
    await db.insert(schema.waiverSignatures).values({
      personId: founder.personId,
      waiverVersionId: active.id,
      signedAt: now,
      signatureImageUrl: SENTINEL,
    });
    changed.push(green(`waiver — signed against version ${active.version}`));
  }

  /* ---- Qualifications, one per discipline the tier grants. ---------------- */

  const alreadyQualified = new Set(quals.map((q) => q.discipline));
  const missing = founder.disciplines.filter((d) => !alreadyQualified.has(d));

  if (founder.disciplines.length === 0) {
    changed.push(dim("qualifications — tier grants no disciplines"));
  } else if (missing.length === 0) {
    changed.push(dim("qualifications — already held for every discipline"));
  } else {
    await db.insert(schema.qualifications).values(
      missing.map((discipline) => ({
        personId: founder.personId,
        discipline,
        level: SENTINEL,
        assessedByStaffId: founder.staffId,
        assessedAt: now,
        /* No expiry. A bootstrap qualification lapsing mid-test would send
           somebody hunting for a defect that was this script's doing. */
        expiresAt: null,
      })),
    );
    changed.push(green(`qualifications — ${missing.join(", ")}`));
  }

  /* ---- The firearms licence. --------------------------------------------- */

  if (licences.length > 0) {
    changed.push(dim("firearms licence — already held, left alone"));
  } else {
    const registered = await db
      .select({ calibre: schema.firearms.calibre })
      .from(schema.firearms);

    const fromRegister = [...new Set(registered.map((f) => f.calibre))].filter(
      Boolean,
    );
    const calibres =
      fromRegister.length > 0 ? fromRegister : PLACEHOLDER_CALIBRES;

    await db.insert(schema.licences).values({
      personId: founder.personId,
      licenceNumber: SENTINEL,
      issuingAuthority: SENTINEL,
      calibres,
      issuedOn: isoDate(now),
      /* Ten years: long enough that no test hits an expiry, and obviously not
         a real schedule. */
      expiresOn: isoDate(new Date(now.getTime() + 3652 * 86_400_000)),
      status: "verified",
      verifiedByStaffId: founder.staffId,
      verifiedAt: now,
    });

    changed.push(
      green(`firearms licence — verified, covering ${calibres.join(", ")}`) +
        (fromRegister.length === 0
          ? dim(" (placeholder — no firearms registered yet)")
          : ""),
    );
  }

  console.log(`  ${bold("Issued")}`);
  for (const line of changed) console.log(`    ${line}`);
}

/* ============================================================================
   REVOKE — what the sentinel matches, and nothing else
   ========================================================================= */

async function revoke(db: Db, personId: string) {
  const signatures = await db
    .delete(schema.waiverSignatures)
    .where(
      and(
        eq(schema.waiverSignatures.personId, personId),
        eq(schema.waiverSignatures.signatureImageUrl, SENTINEL),
      ),
    )
    .returning({ id: schema.waiverSignatures.id });

  const quals = await db
    .delete(schema.qualifications)
    .where(
      and(
        eq(schema.qualifications.personId, personId),
        eq(schema.qualifications.level, SENTINEL),
      ),
    )
    .returning({ id: schema.qualifications.id });

  const licences = await db
    .delete(schema.licences)
    .where(
      and(
        eq(schema.licences.personId, personId),
        inArray(schema.licences.licenceNumber, [SENTINEL]),
      ),
    )
    .returning({ id: schema.licences.id });

  console.log(`  ${bold("Revoked")}`);
  console.log(`    waiver signatures  ${signatures.length}`);
  console.log(`    qualifications     ${quals.length}`);
  console.log(`    firearms licences  ${licences.length}`);
  console.log(
    dim(
      "\n    Only records carrying the bootstrap sentinel were removed.\n" +
        "    A signature captured at the desk is untouched.",
    ),
  );
}

/** `YYYY-MM-DD`, which is what a `date` column takes. */
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

main().catch((error) => {
  console.error(`\n${red("Failed.")}`, error);
  process.exit(1);
});
