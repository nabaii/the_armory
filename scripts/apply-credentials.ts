/**
 * APPLY `.bootstrap-credentials.txt` TO THE DATABASE.
 *
 *   npm run db:credentials
 *
 * ============================================================================
 * WHY THIS EXISTS: THE FILE LOOKS LIKE A CONTROL AND IS NOT ONE
 *
 * `scripts/bootstrap.ts` WRITES that file as a receipt — the only plaintext
 * copy of secrets the database stores as scrypt hashes. It reads naturally as
 * a settings file, so the obvious thing to do with it is edit it, and the
 * obvious thing then fails: the hashes are unchanged, sign-in refuses, and
 * nothing explains why.
 *
 * That is a trap the tool laid, so the tool should provide the way out. This
 * script makes the file an INPUT, explicitly, by being run. Edit the file, run
 * this, and the database matches what you wrote.
 *
 * ============================================================================
 * IT NEVER PRINTS A SECRET
 *
 * Every line of output says what CHANGED, not what it changed to. The file is
 * already the one place the plaintext lives; a terminal is scrolled,
 * screenshotted and pasted into chat, and these credentials open the club's
 * roster.
 *
 * ============================================================================
 * WHICH PERSON IT UPDATES
 *
 * The founder — resolved through `staff_users.role = 'founder'`, not through
 * the phone number in the file. That matters, because changing the phone is
 * the most likely edit, and looking the person up BY the new phone would find
 * nobody and silently create a second club member instead of renumbering the
 * one that exists.
 */

import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getArmoryDb, schema } from "@/db/armory/client";
import { getDb } from "@/db/client";
import { members } from "@/db/schema";
import { hashSecret } from "@/server/armory/kdf";
import { normalisePhone } from "@/server/armory/member-password";
import { hashDeviceToken } from "@/server/sync/device-auth";

const FILE = ".bootstrap-credentials.txt";

/** `  Label   value` → value. Tolerant of the spacing a human will introduce. */
function field(text: string, label: string): string | null {
  const match = new RegExp(`^\\s*${label}\\s{2,}(.+?)\\s*$`, "mi").exec(text);
  return match?.[1]?.trim() || null;
}

async function main() {
  let text: string;
  try {
    text = readFileSync(FILE, "utf8");
  } catch {
    console.error(
      `\nNo ${FILE}. Run \`npm run db:bootstrap\` first — this applies that file, it does not create it.\n`,
    );
    process.exit(1);
  }

  const name = field(text, "Name");
  const rawPhone = field(text, "Phone");
  const email = field(text, "Email");
  const password = field(text, "Password");
  const pin = field(text, "Officer PIN");
  const deviceCode = field(text, "Device code");

  const db = getArmoryDb();
  const leagues = getDb();

  /* The founder, by ROLE. See the header on why not by phone. */
  const [staff] = await db
    .select({ id: schema.staffUsers.id, personId: schema.staffUsers.personId })
    .from(schema.staffUsers)
    .where(eq(schema.staffUsers.role, "founder"))
    .limit(1);

  if (!staff) {
    console.error(
      "\nNo founder on this database. Run `npm run db:bootstrap` first.\n",
    );
    process.exit(1);
  }

  console.log(`\nApplying ${FILE} to the database.\n`);
  const changed: string[] = [];

  /* ------------------------------------------------------------- IDENTITY */

  const person: Record<string, unknown> = {};

  if (name) {
    const [first, ...rest] = name.split(/\s+/);
    person.firstName = first;
    person.lastName = rest.join(" ") || first;
    changed.push("name");
  }

  if (rawPhone) {
    const phone = normalisePhone(rawPhone);

    /* §3.1 makes the phone unique. A collision here means the number already
       belongs to somebody else, and silently moving it would take over their
       identity — refused rather than resolved. */
    const [clash] = await db
      .select({ id: schema.people.id })
      .from(schema.people)
      .where(eq(schema.people.phone, phone))
      .limit(1);

    if (clash && clash.id !== staff.personId) {
      console.error(
        "  phone            REFUSED — that number already belongs to another person.\n",
      );
      process.exit(1);
    }

    person.phone = phone;
    changed.push("phone");
  }

  if (email) {
    person.email = email.toLowerCase();
    changed.push("email");
  }

  if (Object.keys(person).length > 0) {
    await db
      .update(schema.people)
      .set({ ...person, updatedAt: new Date() })
      .where(eq(schema.people.id, staff.personId));

    /* The portal account carries the display name shown on shared surfaces. */
    if (name) {
      await leagues
        .update(members)
        .set({ displayName: name, fullName: name })
        .where(eq(members.personId, staff.personId));
    }

    console.log(`  identity         updated (${changed.join(", ")})`);
  } else {
    console.log("  identity         unchanged");
  }

  /* ------------------------------------------------------------- PASSWORD */

  if (password) {
    await db
      .insert(schema.memberCredentials)
      .values({
        id: crypto.randomUUID(),
        personId: staff.personId,
        passwordHash: await hashSecret(password),
        /* You chose it and nobody else has seen it. */
        mustChange: false,
      })
      .onConflictDoUpdate({
        target: schema.memberCredentials.personId,
        set: {
          passwordHash: await hashSecret(password),
          mustChange: false,
          /* A reset clears the lockout — otherwise somebody who locked
             themselves out is still locked out after fixing the cause. */
          failedCount: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        },
      });

    console.log(`  password         set (${password.length} characters)`);
  } else {
    console.log("  password         unchanged");
  }

  /* ------------------------------------------------------------------ PIN */

  if (pin) {
    await db
      .update(schema.staffUsers)
      .set({
        pinHash: await hashSecret(pin),
        pinFailedCount: 0,
        pinLockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.staffUsers.id, staff.id));

    console.log(`  officer PIN      set (${pin.length} digits)`);
  } else {
    console.log("  officer PIN      unchanged");
  }

  /* --------------------------------------------------------------- DEVICE */

  if (deviceCode) {
    const [device] = await db
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .limit(1);

    if (device) {
      await db
        .update(schema.devices)
        .set({
          tokenHash: await hashDeviceToken(deviceCode),
          tokenIssuedAt: new Date(),
          /* A reissued code un-revokes nothing by itself, but a device being
             given a fresh credential is one being put back into service. */
          revokedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.devices.id, device.id));

      console.log("  device code      set");
    } else {
      console.log("  device code      no device to apply it to");
    }
  } else {
    console.log("  device code      unchanged");
  }

  console.log("\nDone. Sign in at /sign-in/member with the phone and password above.\n");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("\nCould not apply credentials.\n");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
