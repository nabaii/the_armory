import { eq } from "drizzle-orm";
import { getArmoryDb, schema } from "@/db/armory/client";
import type { DeviceSurface } from "@/domain/enums";

/**
 * AUTHENTICATING A TABLET — §3.1, §10.
 *
 * Every /sync/* request presents a device token as a bearer credential. This turns
 * it into a device, or refuses.
 *
 * ===========================================================================
 * WHY THE ANSWER IS THREE OUTCOMES AND NOT TWO
 *
 * `revoked` is not the same as `unauthenticated`, and collapsing them would break
 * §10. A revoked device must learn that it is revoked, because learning it is what
 * triggers the wipe — src/offline/device.ts only destroys local data on an
 * explicit server "revoked", and treats an unauthenticated response as a session
 * problem that holds the queue instead.
 *
 * So a revoked tablet authenticates successfully and is told it is revoked. That
 * reads backwards for a moment and is the whole mechanism: the request is refused
 * with a body a stolen tablet acts on by erasing itself.
 */

export type DeviceIdentity = {
  deviceId: string;
  label: string;
  surface: DeviceSurface;
  /** True when the founder has revoked this device. §10. */
  revoked: boolean;
};

export type DeviceAuthResult =
  | { ok: true; device: DeviceIdentity }
  /** No token, a malformed one, or one that matches no device. 401. */
  | { ok: false; reason: string };

/**
 * SHA-256 of the presented token, hex encoded.
 *
 * Web Crypto rather than node:crypto so this runs unchanged in a Node server, an
 * edge runtime and a test — the same runtime-agnostic property src/db/client.ts is
 * built around, which is what keeps the hosting decision (§2) reversible.
 */
export async function hashDeviceToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Read the bearer token from a request.
 *
 * Header only, never a query parameter. A token in a URL is written to every
 * access log, proxy cache and browser history between the tablet and the database,
 * and this one opens the whole roster.
 */
export function readDeviceToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;

  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;

  const token = value.trim();
  return token.length > 0 ? token : null;
}

/**
 * Identify the device making this request.
 *
 * Looks up by hash, so the plaintext token is never compared in SQL and never
 * appears in a query log.
 */
export async function authenticateDevice(
  request: Request,
): Promise<DeviceAuthResult> {
  const token = readDeviceToken(request);
  if (!token) {
    return {
      ok: false,
      reason: "This device did not present a credential.",
    };
  }

  const tokenHash = await hashDeviceToken(token);
  const db = getArmoryDb();

  const [row] = await db
    .select({
      id: schema.devices.id,
      label: schema.devices.label,
      surface: schema.devices.surface,
      revokedAt: schema.devices.revokedAt,
    })
    .from(schema.devices)
    .where(eq(schema.devices.tokenHash, tokenHash))
    .limit(1);

  if (!row) {
    /* Deliberately the same sentence as a missing credential. A response that
       distinguished "no such token" from "no token" would confirm to anyone
       probing the endpoint that a given token is one character from valid. */
    return {
      ok: false,
      reason: "This device did not present a credential.",
    };
  }

  return {
    ok: true,
    device: {
      deviceId: row.id,
      label: row.label,
      surface: row.surface,
      revoked: row.revokedAt !== null,
    },
  };
}

/**
 * Record that this device was seen, for the founder's dashboard and for §10.
 *
 * Failure is swallowed. This is bookkeeping on the way past, and a device that
 * successfully pushed a custody event must not be told the push failed because a
 * `last_seen_at` update did not land.
 */
export async function touchDevice(deviceId: string): Promise<void> {
  try {
    const db = getArmoryDb();
    await db
      .update(schema.devices)
      .set({ lastSeenAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.devices.id, deviceId));
  } catch {
    /* Bookkeeping only. */
  }
}
