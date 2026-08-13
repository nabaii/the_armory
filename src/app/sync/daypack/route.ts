import { projectDayPack } from "@/server/daypack-projection";
import { loadDayPackSource } from "@/server/sync/daypack-query";
import { touchDevice } from "@/server/sync/device-auth";
import { fingerprint, ok, requireDevice, unavailable } from "@/server/sync/http";
import { log } from "@/server/log";
import type { DayPackResponse } from "@/sync/contract";

/**
 * GET /sync/daypack — §8.1.
 *
 * Everything a device needs to run a day alone. The largest response this system
 * sends and the most sensitive: the roster, the firearm register, and every guest
 * invitation in the window. What it deliberately does NOT contain is described in
 * src/server/daypack-projection.ts and enforced by the shape of `DayPack`.
 *
 * ===========================================================================
 * WHY THIS ROUTE IS THIN AND WHERE THE WORK IS
 *
 *   · authentication and revocation → src/server/sync/http.ts
 *   · the queries                   → src/server/sync/daypack-query.ts
 *   · the projection and §10        → src/server/daypack-projection.ts
 *
 * Nothing in this file decides anything, which is what makes the parts that do
 * testable without an HTTP request. That split is the same one §4 imposes on
 * permissions and §8.4 imposes on the outbox, applied here.
 */

/**
 * Never statically rendered, never cached.
 *
 * `force-dynamic` for the same reason `(member)/layout.tsx` uses it: a cached
 * response here is one club's roster served to whoever asks next. The
 * `cache-control: no-store` header in http.ts covers intermediaries; this covers
 * the framework's own cache.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireDevice(request);
  if ("response" in auth) return auth.response;

  try {
    const source = await loadDayPackSource(new Date());
    const pack = projectDayPack(source);
    const etag = await fingerprint(pack);

    /* §10's grace period counts from the last time the SERVER confirmed this
       device, and this response is that confirmation. Recorded before returning so
       a device that syncs daily never approaches the bound. */
    await touchDevice(auth.device.deviceId);

    const body: DayPackResponse = {
      pack,
      etag,
      device: {
        id: auth.device.deviceId,
        revoked: false,
        label: auth.device.label,
        surface: auth.device.surface,
      },
    };

    return ok(body, { etag });
  } catch (error) {
    /**
     * Logged at error level and reported as retryable.
     *
     * A pack that cannot be built is a server problem — a missing active waiver
     * version, an unreachable database — and the tablet's correct response is to
     * keep working from the pack it already has and try again. Telling it anything
     * final would make a configuration mistake look like a revocation.
     */
    log.error("sync.daypack.failed", {
      deviceId: auth.device.deviceId,
      message: error instanceof Error ? error.message : String(error),
    });

    return unavailable("The club's information could not be assembled just now.");
  }
}
