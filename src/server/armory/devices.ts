import { and, desc, eq, isNull } from "drizzle-orm";
import type { ArmoryReader, ArmoryTx } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import type { DeviceSurface } from "@/domain/enums";
import { hashDeviceToken } from "@/server/sync/device-auth";
import { applied, refused, type Written } from "./record";

/**
 * THE DEVICE REGISTER, AND REVOCATION — §3.1, §10, §11 M10.
 *
 *   §10, Device revocation: "A LOST OR STOLEN TABLET CAN BE REVOKED
 *    SERVER-SIDE, and its cached day pack rendered unusable on next launch."
 *
 * ===========================================================================
 * THE HALF THAT WAS MISSING, AND WHY IT MATTERED MORE THAN IT LOOKED
 *
 * Every mechanical part of §10's revocation has existed since M1 and is tested:
 * the device endpoints answer `revoked: true`, `src/offline/device.ts` acts on
 * that verdict, `wipeLocalState()` destroys every local database, and a test
 * asserts the contents of `LOCAL_DATABASES` so adding a store without adding it
 * there cannot pass silently.
 *
 * What did not exist was a way for a FOUNDER to set `revoked_at`. The security
 * review recorded it as the one §10 control with no operator path: revoking a
 * stolen tablet meant finding an engineer, at whatever hour the tablet went
 * missing.
 *
 * That is the whole of this module. It is small on purpose — the hard parts were
 * built first, and this is the button.
 *
 * ===========================================================================
 * REVOCATION IS REVERSIBLE, AND THE REVERSAL IS NOT UNDO
 *
 * `restoreDevice` exists because the realistic case is not a theft. It is a
 * tablet that was mislaid on Friday, revoked on Saturday morning, and found in a
 * drawer on Monday — and a founder who cannot undo a precaution will hesitate
 * before taking one, which is the failure mode that gets a stolen tablet left
 * live over a weekend.
 *
 * But restoring does NOT return the device to service, and the wording says so.
 * By the time a founder restores it, the tablet has very likely already been
 * wiped — §10 requires that on next launch — so the credential it holds names a
 * device whose local state is gone. It has to be enrolled again with a fresh
 * token, which is `reissueToken`. Presenting restore as "undo" would leave a
 * founder holding a tablet that says it is registered and shows nothing.
 */

export type DeviceRecord = {
  readonly id: string;
  readonly label: string;
  readonly surface: DeviceSurface;
  readonly registeredAt: Date;
  readonly lastSeenAt: Date | null;
  readonly revokedAt: Date | null;
  /** False for a device registered but never issued a credential. */
  readonly hasToken: boolean;
  /** One line for the founder. Never a status word on its own. */
  readonly line: string;
};

/**
 * Every device the club has registered, revoked ones included.
 *
 * Revoked devices are returned, not filtered. §10's whole point is that a
 * founder can see what has been taken out of service and when — a list that
 * hid them would answer "which tablets do we have" and not "which tablets can
 * open the club's roster", and the second is the question being asked.
 *
 * Most recently seen first, because a founder looking at this list is almost
 * always looking for one specific tablet and the one they are holding is the
 * one that just synced.
 */
export async function deviceRegister(
  tx: ArmoryReader,
  now: Date,
): Promise<DeviceRecord[]> {
  const rows = await tx
    .select({
      id: schema.devices.id,
      label: schema.devices.label,
      surface: schema.devices.surface,
      registeredAt: schema.devices.registeredAt,
      lastSeenAt: schema.devices.lastSeenAt,
      revokedAt: schema.devices.revokedAt,
      tokenHash: schema.devices.tokenHash,
    })
    .from(schema.devices)
    .orderBy(desc(schema.devices.lastSeenAt), desc(schema.devices.registeredAt));

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    surface: row.surface,
    registeredAt: row.registeredAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
    hasToken: row.tokenHash !== null,
    line: describe(row, now),
  }));
}

/**
 * What a founder needs to read to decide, in one line.
 *
 * The judgement being made is "is this the tablet that went missing", and the
 * facts that answer it are when it was last seen and whether it is still live.
 * A status word alone — "active", "revoked" — answers neither.
 *
 * The silence threshold is deliberately the same seven days
 * `src/offline/device.ts` uses for its offline grace period. A tablet that has
 * been silent longer than the period after which it would refuse itself is a
 * tablet that is either broken or gone, and those are the two a founder wants
 * pulled out of a list.
 */
function describe(
  row: {
    label: string;
    lastSeenAt: Date | null;
    revokedAt: Date | null;
    tokenHash: string | null;
  },
  now: Date,
): string {
  if (row.revokedAt) {
    return `Revoked ${ago(row.revokedAt, now)}. It wipes itself the next time it is opened.`;
  }

  if (!row.tokenHash) {
    return "Registered, never enrolled. It holds no credential and no data.";
  }

  if (!row.lastSeenAt) {
    return "Enrolled, never synced.";
  }

  const days = Math.floor((now.getTime() - row.lastSeenAt.getTime()) / 86_400_000);

  return days >= OFFLINE_GRACE_DAYS
    ? `Last seen ${ago(row.lastSeenAt, now)} — past the point where it refuses itself.`
    : `Last seen ${ago(row.lastSeenAt, now)}.`;
}

/** Mirrors the bound in src/offline/device.ts. See `describe`. */
const OFFLINE_GRACE_DAYS = 7;

function ago(at: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return `${Math.floor(days / 30)} months ago`;
}

/* ============================================================================
   REVOKE
   ========================================================================= */

export type RevocationResult = {
  readonly deviceId: string;
  readonly label: string;
  readonly revokedAt: Date;
};

/**
 * Take a tablet out of service. §10.
 *
 * ===========================================================================
 * THE TOKEN IS DESTROYED, NOT JUST FLAGGED
 *
 * Setting `revoked_at` alone would be enough for the wipe: the sync endpoints
 * check it and answer `revoked: true`, which is what the device acts on.
 *
 * The token is cleared as well, and the difference matters in the case this
 * function exists for. A flagged-but-valid credential still authenticates. Any
 * future endpoint that forgets to check `revoked_at` — and one eventually will,
 * because it is a condition rather than a mechanism — would serve the club's
 * roster to a stolen tablet. Clearing the hash means the credential matches no
 * row at all, so the protection does not depend on every future author
 * remembering.
 *
 * The cost is that revocation is not literally reversible: `restoreDevice`
 * clears the flag and the tablet still needs a fresh token. That is the honest
 * position anyway — see the header.
 *
 * ===========================================================================
 * A REASON IS REQUIRED
 *
 * §3.6: "an override is permitted but never silent." Revocation is not an
 * override, but it is the same shape of act — irreversible, taken in a hurry,
 * and examined afterwards. "Reported stolen by Ada on Saturday morning" is what
 * makes the audit row worth having six months later; a bare timestamp is not.
 */
export async function revokeDevice(
  tx: ArmoryTx,
  input: {
    readonly deviceId: string;
    readonly reason: string;
    readonly now: Date;
  },
): Promise<Written<RevocationResult>> {
  const reason = input.reason.trim();

  if (reason === "") {
    return refused({
      code: "REVOCATION_NEEDS_REASON",
      message: "Say why this tablet is being revoked.",
    });
  }

  const [device] = await tx
    .select({
      id: schema.devices.id,
      label: schema.devices.label,
      revokedAt: schema.devices.revokedAt,
    })
    .from(schema.devices)
    .where(eq(schema.devices.id, input.deviceId))
    .limit(1);

  if (!device) {
    return refused({
      code: "NO_SUCH_DEVICE",
      message: "That tablet is not on the club's register.",
    });
  }

  if (device.revokedAt) {
    /**
     * Already revoked, and this is a SUCCESS rather than a refusal.
     *
     * A founder pressing the button twice — or two founders pressing it at once
     * during the same scare — must not be told something went wrong. The tablet
     * is out of service, which is the outcome they wanted, and an error message
     * at that moment invites somebody to go looking for a second way to do it.
     */
    return applied({
      deviceId: device.id,
      label: device.label,
      revokedAt: device.revokedAt,
    });
  }

  await tx
    .update(schema.devices)
    .set({
      revokedAt: input.now,
      /* See the header: destroyed, not flagged. */
      tokenHash: null,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(schema.devices.id, device.id),
        /* `IS NULL` makes the write itself idempotent under concurrency, so two
           simultaneous revocations cannot each believe they were first and write
           two different timestamps. */
        isNull(schema.devices.revokedAt),
      ),
    );

  return applied(
    { deviceId: device.id, label: device.label, revokedAt: input.now },
    [
      {
        action: "device.revoke",
        entityType: "device",
        entityId: device.id,
        before: { label: device.label, revoked: false },
        after: { revoked: true },
        /* §3.6's shape. Not an override, but the same standard: never silent,
           and the reason is the part worth having later. */
        override: { reason },
      },
    ],
  );
}

/**
 * Clear a revocation. The tablet still needs a fresh credential.
 *
 * See the header for why this is not undo. The result carries
 * `needsReenrolment` so the screen says so rather than implying the tablet is
 * back.
 */
export async function restoreDevice(
  tx: ArmoryTx,
  input: { readonly deviceId: string; readonly now: Date },
): Promise<
  Written<{
    readonly deviceId: string;
    readonly label: string;
    readonly needsReenrolment: boolean;
  }>
> {
  const [device] = await tx
    .select({
      id: schema.devices.id,
      label: schema.devices.label,
      revokedAt: schema.devices.revokedAt,
      tokenHash: schema.devices.tokenHash,
    })
    .from(schema.devices)
    .where(eq(schema.devices.id, input.deviceId))
    .limit(1);

  if (!device) {
    return refused({
      code: "NO_SUCH_DEVICE",
      message: "That tablet is not on the club's register.",
    });
  }

  if (!device.revokedAt) {
    return applied({
      deviceId: device.id,
      label: device.label,
      needsReenrolment: device.tokenHash === null,
    });
  }

  await tx
    .update(schema.devices)
    .set({ revokedAt: null, updatedAt: input.now })
    .where(eq(schema.devices.id, device.id));

  return applied(
    {
      deviceId: device.id,
      label: device.label,
      /* Always true in practice: revocation cleared the token. Computed rather
         than hard-coded so the screen stays right if that ever changes. */
      needsReenrolment: device.tokenHash === null,
    },
    [
      {
        action: "device.restore",
        entityType: "device",
        entityId: device.id,
        before: { revoked: true },
        after: { revoked: false, needsReenrolment: device.tokenHash === null },
      },
    ],
  );
}

/* ============================================================================
   RE-ENROLMENT
   ========================================================================= */

/**
 * Issue a fresh credential for a device, returning it ONCE.
 *
 * The other half of restore, and the reason restore is not undo. A tablet that
 * has been revoked holds a token that matches no row, so it needs a new one
 * typed into it — the same enrolment `ConsoleEnrolment` already performs, which
 * is the only thing on that surface that genuinely cannot be done offline.
 *
 * ===========================================================================
 * THE PLAINTEXT IS RETURNED ONCE AND IS NOT RECOVERABLE
 *
 * Only the hash is stored (drizzle/0003), for the reason the schema gives: the
 * raw token exists only where somebody put it, and a database dump must not
 * hand anyone a working credential for a tablet that opens the club's roster.
 *
 * So this returns the token in its response and nowhere else. `scripts/seed.ts`
 * prints device codes with the same warning and for the same reason. A founder
 * who loses the code before typing it in reissues; that costs a tap and is the
 * correct trade.
 *
 * ===========================================================================
 * REFUSED WHILE THE DEVICE IS REVOKED
 *
 * Not a technical constraint — the write would work. It is refused because
 * issuing a live credential to a device the club has recorded as stolen is
 * precisely the mistake this whole module exists to make impossible, and the
 * two-step — restore, then reissue — is what makes it a decision rather than a
 * slip.
 */
export async function reissueToken(
  tx: ArmoryTx,
  input: {
    readonly deviceId: string;
    readonly registeredByStaffId: string | null;
    readonly now: Date;
  },
): Promise<
  Written<{
    readonly deviceId: string;
    readonly label: string;
    /** Plaintext. Shown once, stored nowhere. */
    readonly token: string;
  }>
> {
  const [device] = await tx
    .select({
      id: schema.devices.id,
      label: schema.devices.label,
      revokedAt: schema.devices.revokedAt,
    })
    .from(schema.devices)
    .where(eq(schema.devices.id, input.deviceId))
    .limit(1);

  if (!device) {
    return refused({
      code: "NO_SUCH_DEVICE",
      message: "That tablet is not on the club's register.",
    });
  }

  if (device.revokedAt) {
    return refused({
      code: "DEVICE_REVOKED",
      message: `${device.label} is revoked. Restore it first, if it has been found.`,
    });
  }

  /* 256 bits from a CSPRNG, matching the seed and the schema's reasoning: there
     is nothing to grind, which is why the hash below needs no KDF. */
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  await tx
    .update(schema.devices)
    .set({
      tokenHash: await hashDeviceToken(token),
      tokenIssuedAt: input.now,
      registeredByStaffId: input.registeredByStaffId,
      /* Cleared, because the new credential has never been used. Leaving the
         old value would put a "last seen" on the register that belongs to an
         enrolment that no longer exists. */
      lastSeenAt: null,
      updatedAt: input.now,
    })
    .where(eq(schema.devices.id, device.id));

  return applied(
    { deviceId: device.id, label: device.label, token },
    [
      {
        action: "device.reissue_token",
        entityType: "device",
        entityId: device.id,
        /* The token itself is NOT in the audit row. §3.6 wants a record that it
           happened, not a copy of the credential in an append-only table
           nobody can redact. */
        after: { label: device.label, issuedAt: input.now.toISOString() },
      },
    ],
  );
}
