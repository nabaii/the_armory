/**
 * BOOTSTRAP A REAL CLUB — the smallest one that actually works.
 *
 *   FOUNDER_NAME="Ada Obi" FOUNDER_PHONE=08012345678 FOUNDER_EMAIL=ada@example.com \
 *     npm run db:bootstrap
 *
 * ============================================================================
 * THIS IS NOT scripts/seed.ts, AND THE DIFFERENCE IS THE WHOLE POINT
 *
 * `db:seed` builds §2.1's staging fixture: a hundred invented people, several
 * hundred sessions, a known password. It is test data and it must never touch a
 * production database — the append-only triggers mean the custody events,
 * waivers and rounds it writes can never be removed.
 *
 * This writes ONE person: yours. It creates the minimum set of rows that makes
 * every surface reachable, and it is safe to run against production because
 * every row it writes is a row the club would have created by hand anyway.
 *
 * ============================================================================
 * WHY A FRESH DATABASE CANNOT SIMPLY BE SIGNED INTO
 *
 * Migrations build the structure. They do not build a club, and four of the
 * things missing are hard prerequisites rather than nice-to-haves:
 *
 *   · NO ACTIVE WAIVER VERSION. `loadDayPackSource` THROWS without one — §3.1
 *     requires exactly one active version and the desk cannot evaluate
 *     MAY_ATTEND against a version that does not exist. /console is dead until
 *     this row exists.
 *   · NO TIER. §4's whole permission matrix is columns on a tier. A membership
 *     without one cannot answer whether its holder may book, host or shoot.
 *   · NO PERSON, NO MEMBERSHIP. The portal resolves a session to a person; with
 *     none, every §6.2 screen correctly reports no membership.
 *   · NO STAFF USER, NO DEVICE. §10 requires both to unlock a tablet, and the
 *     dashboard requires the founder role.
 *
 * ============================================================================
 * WHAT IT DELIBERATELY DOES NOT DECIDE
 *
 * §14 leaves tier names, fees, the roster cap and the guest overage price to
 * the club, and src/lib/content-gate.ts states the house rule: "a missing value
 * must LOOK missing. Plausible placeholder content is how a site ships with an
 * invented phone number."
 *
 * So the tier below is named "Founding member" — which is true — and its fees
 * are NULL. `club_settings` is left exactly as migration 0006 created it: every
 * §14 value unset. Nothing here invents a commercial decision.
 *
 * ============================================================================
 * IDEMPOTENT, AND CREDENTIALS ARE WRITTEN TO A FILE
 *
 * Re-running changes nothing: every insert is guarded, and an existing founder
 * is found rather than duplicated. Pass `--reset-credentials` to mint a fresh
 * password, PIN and device token for the founder who already exists.
 *
 * The secrets go to `.bootstrap-credentials.txt`, which .gitignore excludes,
 * rather than to stdout — a terminal is scrolled, screenshotted and pasted into
 * chat, and these open the club's roster.
 */

import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getArmoryDb, schema } from "@/db/armory/client";
import { getDb } from "@/db/client";
import { members } from "@/db/schema";
import { hashSecret } from "@/server/armory/kdf";
import { uuidv7 } from "@/lib/uuidv7";

/* ---------------------------------------------------------------------------
   INPUT
   -------------------------------------------------------------------------- */

const name = process.env.FOUNDER_NAME?.trim();
const rawPhone = process.env.FOUNDER_PHONE?.trim();
const email = process.env.FOUNDER_EMAIL?.trim().toLowerCase() || null;
const resetCredentials = process.argv.includes("--reset-credentials");

if (!name || !rawPhone) {
  console.error(
    "\nBootstrap needs who you are.\n\n" +
      '  FOUNDER_NAME="Ada Obi" FOUNDER_PHONE=08012345678 \\\n' +
      "    FOUNDER_EMAIL=ada@example.com npm run db:bootstrap\n\n" +
      "The phone is your sign-in identifier (§3.1 makes it the club's unique\n" +
      "key, not the email). The email is optional.\n",
  );
  process.exit(1);
}

/** §3.1: "phone unique, E.164." The same normalisation the sign-in applies. */
function normalisePhone(raw: string): string {
  const trimmed = raw.replace(/[\s()-]/g, "");
  if (trimmed.startsWith("+")) return trimmed;
  if (trimmed.startsWith("0")) return `+234${trimmed.slice(1)}`;
  return trimmed;
}

const phone = normalisePhone(rawPhone);
const [firstName, ...rest] = name.split(/\s+/);
const lastName = rest.join(" ") || firstName;

/* ---------------------------------------------------------------------------
   SECRETS

   From a CSPRNG, never from a literal. The alphabet omits vowels and
   look-alikes so a code can be read down a phone line without being misheard —
   the same alphabet /api/people/[id]/password uses.
   -------------------------------------------------------------------------- */

const ALPHABET = "23456789BCDFGHJKMNPQRSTVWXZ";

const code = (length: number) =>
  [...randomBytes(length)].map((b) => ALPHABET[b % ALPHABET.length]).join("");

const password = `${code(4)}-${code(4)}-${code(4)}`;
/** Six digits. §10's "short local unlock" — the device is the other factor. */
const pin = [...randomBytes(6)].map((b) => b % 10).join("");
const deviceToken = randomBytes(32).toString("hex");

/* ---------------------------------------------------------------------------
   THE CLUB
   -------------------------------------------------------------------------- */

const DISCIPLINES = ["10m-air-rifle", "50m-range", "25m-pistol", "10m-pistol"];

async function bootstrap() {
  const db = getArmoryDb();
  const leagues = getDb();

  console.log("\nBootstrapping the club. Re-running changes nothing.\n");

  /* ------------------------------------------------------------------ TIER
     One tier, permissive, so nothing is blocked while you look around.
     Fees are NULL — §14 leaves them to the club and a plausible number here
     would be a commercial decision nobody made. */
  let [tier] = await db.select().from(schema.tiers).limit(1);

  if (!tier) {
    [tier] = await db
      .insert(schema.tiers)
      .values({
        id: uuidv7(),
        name: "Founding member",
        monthlyFeeKobo: null,
        annualFeeKobo: null,
        canHost: true,
        guestAllowanceAnnual: 12,
        guestConcurrentMax: 3,
        canOwnFirearm: true,
        canStoreFirearm: false,
        disciplineAccess: DISCIPLINES,
        bookingHorizonDays: 60,
        concurrentBookingsMax: 4,
        isAttachable: false,
        sortOrder: 0,
        active: true,
      })
      .returning();
    console.log("  tier            Founding member (fees left unset — §14)");
  } else {
    console.log(`  tier            ${tier.name} (existing)`);
  }

  /* --------------------------------------------------------------- WAIVER
     §3.1: "exactly one active version at a time", enforced by a unique index.
     /console THROWS without one — this is the row that makes the desk load. */
  const [existingWaiver] = await db
    .select()
    .from(schema.waiverVersions)
    .where(eq(schema.waiverVersions.isActive, true))
    .limit(1);

  if (!existingWaiver) {
    await db.insert(schema.waiverVersions).values({
      id: uuidv7(),
      version: "bootstrap-1",
      /* Deliberately not real legal text. It is shown to a member before they
         sign, so replace it before anybody who is not you uses the desk. */
      body:
        "PLACEHOLDER — replace before use.\n\n" +
        "This club operates a live firing range. Shooting sports carry risk of " +
        "serious injury or death. By signing you confirm you will follow every " +
        "instruction given by a range officer at all times.\n\n" +
        "This text is a placeholder inserted by the bootstrap script and is not " +
        "the club's legal position.",
      effectiveFrom: new Date(),
      isActive: true,
    });
    console.log("  waiver          bootstrap-1  ⚠ PLACEHOLDER TEXT");
  } else {
    console.log(`  waiver          ${existingWaiver.version} (existing)`);
  }

  /* ---------------------------------------------------------------- LANES
     Availability is computed from lanes (§6.2 forbids a manual calendar), so
     an empty lane table means an empty booking screen. */
  const existingLanes = await db.select().from(schema.lanes).limit(1);

  if (existingLanes.length === 0) {
    await db.insert(schema.lanes).values(
      DISCIPLINES.flatMap((discipline, d) =>
        [1, 2].map((number) => ({
          id: uuidv7(),
          discipline,
          number: d * 10 + number,
          status: "available" as const,
          positionCapacity: 1,
        })),
      ),
    );
    console.log("  lanes           8 (2 per discipline)");
  } else {
    console.log("  lanes           existing");
  }

  /* --------------------------------------------------------------- PERSON */
  let [person] = await db
    .select()
    .from(schema.people)
    .where(eq(schema.people.phone, phone))
    .limit(1);

  if (!person) {
    [person] = await db
      .insert(schema.people)
      .values({ id: uuidv7(), firstName, lastName, phone, email })
      .returning();
    console.log(`  person          ${firstName} ${lastName}  ${phone}`);
  } else {
    console.log(`  person          ${person.firstName} ${person.lastName} (existing)`);
  }

  /* ----------------------------------------------------------- MEMBERSHIP
     Active, so §4 lets you through every gate. `member_number` comes from the
     sequence — §3.1: "unique, sequential, never reused". */
  const [existingMembership] = await db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.personId, person.id))
    .limit(1);

  if (!existingMembership) {
    await db.insert(schema.memberships).values({
      id: uuidv7(),
      personId: person.id,
      tierId: tier.id,
      status: "active",
      isFounding: true,
      startedOn: new Date().toISOString().slice(0, 10),
    });
    console.log("  membership      active, founding");
  } else {
    console.log(`  membership      ${existingMembership.status} (existing)`);
  }

  /* ---------------------------------------------------------------- STAFF
     Founder role: §6.6's dashboard and every founder-only endpoint. */
  const [existingStaff] = await db
    .select()
    .from(schema.staffUsers)
    .where(eq(schema.staffUsers.personId, person.id))
    .limit(1);

  const pinHash = await hashSecret(pin);

  if (!existingStaff) {
    await db.insert(schema.staffUsers).values({
      id: uuidv7(),
      personId: person.id,
      role: "founder",
      pinHash,
      active: true,
    });
    console.log("  staff           founder");
  } else if (resetCredentials) {
    await db
      .update(schema.staffUsers)
      .set({ pinHash, pinFailedCount: 0, pinLockedUntil: null })
      .where(eq(schema.staffUsers.id, existingStaff.id));
    console.log("  staff           founder (PIN reset)");
  } else {
    console.log("  staff           founder (existing, PIN unchanged)");
  }

  /* ----------------------------------------------------------- PASSWORD */
  const [existingCredential] = await db
    .select()
    .from(schema.memberCredentials)
    .where(eq(schema.memberCredentials.personId, person.id))
    .limit(1);

  if (!existingCredential || resetCredentials) {
    const passwordHash = await hashSecret(password);

    await db
      .insert(schema.memberCredentials)
      .values({
        id: uuidv7(),
        personId: person.id,
        passwordHash,
        /* False, unlike a founder-issued password: nobody else has seen this
           one. It went from a CSPRNG to a file only you can read. */
        mustChange: false,
      })
      .onConflictDoUpdate({
        target: schema.memberCredentials.personId,
        set: { passwordHash, mustChange: false, failedCount: 0, lockedUntil: null },
      });

    console.log("  password        set");
  } else {
    console.log("  password        existing (--reset-credentials to replace)");
  }

  /* ------------------------------------------------------------- DEVICE
     A desk tablet. §3.1: the console loads "only on a registered, unrevoked
     device", and this is the code you type at /console to enrol one. */
  const { hashDeviceToken } = await import("@/server/sync/device-auth");
  const [existingDevice] = await db.select().from(schema.devices).limit(1);

  if (!existingDevice || resetCredentials) {
    const tokenHash = await hashDeviceToken(deviceToken);

    if (existingDevice) {
      await db
        .update(schema.devices)
        .set({ tokenHash, tokenIssuedAt: new Date(), revokedAt: null })
        .where(eq(schema.devices.id, existingDevice.id));
      console.log("  device          desk (token reissued)");
    } else {
      await db.insert(schema.devices).values({
        id: uuidv7(),
        label: "Desk tablet",
        surface: "desk",
        registeredAt: new Date(),
        tokenHash,
        tokenIssuedAt: new Date(),
      });
      console.log("  device          Desk tablet");
    }
  } else {
    console.log("  device          existing (--reset-credentials to reissue)");
  }

  /* ------------------------------------------------------- PORTAL ACCOUNT
     The `public.members` row and the `person_id` link. Normally written by the
     password sign-in itself; done here so the account exists before you use
     it and the display name is yours rather than derived from an address. */
  const [existingMember] = await leagues
    .select()
    .from(members)
    .where(eq(members.personId, person.id))
    .limit(1);

  if (!existingMember) {
    await leagues
      .insert(members)
      .values({
        /* `.invalid` is RFC 2606's reserved TLD — obviously non-routable, for
           a founder the club has no email for. See linkPortalAccount. */
        email: email ?? `person+${person.id}@armory.invalid`,
        displayName: `${firstName} ${lastName}`,
        fullName: `${firstName} ${lastName}`,
        personId: person.id,
      })
      .onConflictDoNothing();
    console.log("  portal account  linked");
  } else {
    console.log("  portal account  existing");
  }

  return person.id;
}


/* ---------------------------------------------------------------------------
   ENTRY

   Wrapped in a function rather than using top-level await, for the same reason
   scripts/seed.ts is: package.json declares no `"type": "module"`, so tsx
   compiles these to CJS and a top-level await is a build error rather than a
   runtime one. Found the hard way while running the migrations.
   -------------------------------------------------------------------------- */

async function main() {
  const db = getArmoryDb();

  /* Whether this run mints secrets. Read BEFORE bootstrap writes anything —
     afterwards the person exists and the answer would always be "no". */
  const [existing] = await db
    .select({ id: schema.people.id })
    .from(schema.people)
    .where(eq(schema.people.phone, phone))
    .limit(1);

  const willIssue = resetCredentials || !existing;

  await bootstrap();

  if (!willIssue) {
    console.log(
      "\n  Nothing new to issue. Run with --reset-credentials for a fresh" +
        "\n  password, PIN and device code.\n",
    );
    console.log("Done.\n");
    return;
  }

  const file = ".bootstrap-credentials.txt";

  writeFileSync(
    file,
    [
      "THE ARMORY — bootstrap credentials",
      `Generated ${new Date().toISOString()}`,
      "",
      "These are the only copies. The database holds hashes.",
      "This file is gitignored. Delete it once you have stored them.",
      "",
      "MEMBER PORTAL          /sign-in/member",
      `  Phone                ${phone}`,
      `  Password             ${password}`,
      "",
      "DESK / LANE CONSOLE    /console",
      `  Device code          ${deviceToken}`,
      `  Officer PIN          ${pin}`,
      "",
      "The device code enrols the tablet, once. The PIN unlocks a shift on it.",
      "Both are needed — §10 forbids either alone.",
      "",
      "OWNER DASHBOARD        the Dashboard button on /console, once unlocked.",
      "  Your staff role is founder, which is what that endpoint requires.",
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(`\n  Credentials written to ${file} — gitignored, not printed here.`);
  console.log("  Store them, then delete the file.\n");
  console.log("Done.\n");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("\nBootstrap failed.\n");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
