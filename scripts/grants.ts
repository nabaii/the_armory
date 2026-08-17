/**
 * ISSUE THE FOUNDER'S STANDING AUTHORITY.
 *
 *   npm run db:grants                          # show what they hold, write nothing
 *   npm run db:grants -- --apply               # issue the founder's bundle
 *   npm run db:grants -- --apply --if-unheld   # issue it ONLY if they have never held one
 *   npm run db:grants -- --revoke              # take back what this script issued
 *
 * ============================================================================
 * WHY THIS EXISTS AT ALL, AND WHY IT IS ON THE RELEASE PATH
 *
 * Management §5 moves staff authority out of `staff_users.role` and into grant
 * rows, which is what makes the club's two structural separations refusable
 * rather than merely promised. It also creates a bootstrap problem the role
 * column never had: a brand new database has a founder who holds NOTHING, and
 * `requireStaffPrincipal` correctly redirects an empty hand away from /manage —
 * so the surface is live, correct, and unreachable by anybody.
 *
 * `npm run release` therefore runs this on every boot, for the same reason it
 * runs db:hours: the club's founder deploys from a phone and has no terminal to
 * run a one-off from. That constraint is recorded in scripts/hours.ts and it has
 * not changed.
 *
 * ============================================================================
 * --if-unheld, AND WHY IT IS NOT --if-empty
 *
 * hours.ts seeds into an EMPTY table, which is the right predicate there: a
 * published week is either present or absent.
 *
 * Authority is not like that, because REVOCATION IS A STATE. If this seeded
 * whenever the founder held no LIVE grant, then a founder who deliberately gave
 * up the ledger — the exception in §5.1, the whole reason crossing a separation
 * is affordable — would have it handed back on the next cold start, silently, on
 * a free instance that cold-starts several times a day. The governance control
 * would be undone by the deploy that was meant to support it.
 *
 * So the predicate is "this founder has never had a grant row at all", live or
 * revoked. A revoked row is evidence the club has made a decision here, and this
 * script does not overrule a decision. It only gets a new database to a state
 * where somebody can sign in.
 *
 * ============================================================================
 * IT GOES THROUGH issueGrants, NOT THROUGH AN INSERT
 *
 * The separation check in `refuseCombination` runs against the resulting hand,
 * exactly as it would for any other member of staff. The founder's bundle is
 * clean by construction — it drops one side of each separation — and proving
 * that against the live database rather than asserting it is the point. If this
 * script is ever refused, the bundle has drifted and the refusal is the finding.
 *
 * ============================================================================
 * THREE PROPERTIES, THE SAME THREE scripts/permits.ts CLAIMS
 *
 *   MARKED       Every row this issues carries REASON below, verbatim. A row
 *                with it in is visibly a bootstrap grant rather than an
 *                appointment somebody made, which is what it is.
 *   REVERSIBLE   --revoke takes back what the sentinel matches and nothing
 *                else, so a grant later issued by a person survives.
 *   SCOPED       The founder is resolved through `staff_users.role`, the rule
 *                apply-credentials.ts and permits.ts already use: identity by
 *                role, never by a value somebody may have edited. It touches
 *                nobody else, and it never issues to a second account.
 */

import { eq } from "drizzle-orm";
import { getArmoryDb, schema } from "@/db/armory/client";
import { grantsForRole, heldGrants, SEPARATIONS } from "@/domain/grants";
import { grantRowsFor, issueGrants, revokeGrants } from "@/server/armory/grants";

/** The sentinel. Identifiable by anybody auditing the register. */
const REASON =
  "Bootstrap: founder's standing authority, issued by scripts/grants.ts at first boot.";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

async function main() {
  const apply = process.argv.includes("--apply");
  const ifUnheld = process.argv.includes("--if-unheld");
  const revoke = process.argv.includes("--revoke");

  if (apply && revoke) {
    console.error("--apply and --revoke are opposites. Choose one.");
    process.exit(1);
  }

  const db = getArmoryDb();
  const now = new Date();

  const [founder] = await db
    .select({ id: schema.staffUsers.id, personId: schema.staffUsers.personId })
    .from(schema.staffUsers)
    .where(eq(schema.staffUsers.role, "founder"))
    .limit(1);

  if (!founder) {
    /* Not an error. A database without a bootstrapped club has no founder yet,
       and `npm run release` must not fail the boot over it — the same
       reasoning db:hours applies to an unconfigured week. */
    console.log(dim("\n  No founder on staff_users. Nothing to do.\n"));
    return;
  }

  const rows = await grantRowsFor(db, founder.id);
  const live = heldGrants(rows, now);
  const bundle = grantsForRole("founder");

  console.log(`\n${bold("The founder's authority")}\n`);

  if (rows.length === 0) {
    console.log(`  ${yellow("NONE EVER ISSUED")} — /manage will refuse them\n`);
  } else {
    for (const grant of bundle) {
      const held = live.has(grant);
      console.log(`  ${held ? green("held") : dim("  — ")}  ${grant}`);
    }
    const extra = [...live].filter((g) => !bundle.includes(g));
    for (const grant of extra) {
      console.log(`  ${green("held")}  ${grant} ${dim("(outside the bundle)")}`);
    }
    console.log("");
  }

  /* What the bundle deliberately withholds, said out loud. A founder who finds
     the armoury register refusing them should be told why here rather than
     discovering it on the screen. */
  console.log(`${bold("Withheld from the founder's bundle, by design")}\n`);
  for (const separation of SEPARATIONS) {
    const dropped = separation.pair.find((g) => !bundle.includes(g));
    if (dropped) {
      console.log(`  ${dropped.padEnd(24)} ${dim(separation.id)}`);
    }
  }
  console.log(
    dim(
      "\n  Read is exempt — all six surfaces are visible. Crossing a separation\n" +
        "  means issuing an acting grant with a reason, which lapses by clock.\n",
    ),
  );

  if (revoke) {
    const mine = rows.filter((row) => row.reason === REASON && row.revokedAt === null);
    if (mine.length === 0) {
      console.log(dim("  Nothing this script issued is still live.\n"));
      return;
    }

    const result = await revokeGrants(db, {
      staffUserId: founder.id,
      removing: mine.map((row) => row.grant),
      actorStaffId: founder.id,
      now,
    });

    console.log(`  ${green("revoked")}  ${result.revoked.join(" ")}\n`);
    return;
  }

  if (!apply) {
    console.log(dim("  Read-only. Pass --apply to issue the bundle.\n"));
    return;
  }

  /**
   * The bootstrap predicate. See the header: "never held", not "holds none".
   *
   * Counted over ALL rows including revoked ones, so a deliberate revocation is
   * never undone by a cold start.
   */
  if (ifUnheld && rows.length > 0) {
    console.log(
      dim(
        `  --if-unheld: ${rows.length} grant row${rows.length === 1 ? "" : "s"} already on record. Left alone.\n`,
      ),
    );
    return;
  }

  const result = await issueGrants(db, {
    staffUserId: founder.id,
    adding: bundle,
    reason: REASON,
    /* Standing, not acting. The founder's own authority does not lapse
       overnight — an acting grant is for covering somebody else's post. */
    expiresAt: null,
    actorStaffId: founder.id,
    now,
  });

  if (!result.ok) {
    /* The bundle crosses a separation, which means it has drifted from
       ROLE_BUNDLES' guarantee. That is a finding rather than a hiccup, and it
       should stop a boot loudly rather than leave the founder locked out with
       no explanation. */
    console.error(
      `\n  REFUSED — ${result.refusal.separation.id}\n  ${result.refusal.message}\n`,
    );
    process.exit(1);
  }

  if (result.issued.length === 0) {
    console.log(dim("  Already held. Nothing written.\n"));
    return;
  }

  console.log(`  ${green("issued")}  ${result.issued.join(" ")}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
