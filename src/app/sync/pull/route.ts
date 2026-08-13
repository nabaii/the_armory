import { projectDayPack } from "@/server/daypack-projection";
import { log } from "@/server/log";
import { loadDayPackSource } from "@/server/sync/daypack-query";
import { touchDevice } from "@/server/sync/device-auth";
import { fingerprint, ok, requireDevice, unavailable } from "@/server/sync/http";
import type { PullResponse } from "@/sync/contract";

/**
 * GET /sync/pull — the continuous refresh (§8.1: "Refreshed continuously while
 * online").
 *
 * Conditional on the fingerprint of the pack the device already holds. An unchanged
 * club costs one request with no body; a changed one returns the whole pack.
 *
 * src/sync/contract.ts argues at length for why this is not a cursor over a change
 * feed, and that argument is the interesting part of this endpoint: there is no
 * total order to cursor over for the server-authoritative tables, and inventing a
 * change log for a hundred-member club before M4 would spend a schema commitment
 * §14 has not made.
 *
 * ===========================================================================
 * WHY 200 AND NOT 304
 *
 * The obvious implementation answers `If-None-Match` with a bare 304, which is what
 * HTTP is for. This returns 200 with `{ changed: false }` instead, for one reason:
 * the response also has to carry the device verdict.
 *
 * §10's revocation reaches a tablet through exactly these responses. A 304 has no
 * body, so a revoked device whose pack happened to be current would be told
 * "nothing has changed" and keep running — the one case where the club most needs
 * the answer to arrive is the case where the cache header would suppress it. The
 * verdict is not part of the pack and must not be fingerprinted with it.
 *
 * The saving 304 exists for is the body, and `{ changed: false }` is forty bytes.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireDevice(request);
  if ("response" in auth) return auth.response;

  /* Either header is accepted: `If-None-Match` is the HTTP spelling and what a
     `fetch` caller will reach for, and `?etag=` is what a service worker or a URL
     built by hand tends to carry. Both are the same value. */
  const url = new URL(request.url);
  const presented =
    request.headers.get("if-none-match") ?? url.searchParams.get("etag");

  try {
    const source = await loadDayPackSource(new Date());
    const pack = projectDayPack(source);
    const etag = await fingerprint(pack);

    /* This response is the server confirming the device, which is what §10's grace
       period counts from. Recorded on both branches — a device that pulls every
       thirty seconds and finds nothing changed is still in contact. */
    await touchDevice(auth.device.deviceId);

    if (presented && presented === etag) {
      const unchanged: PullResponse = {
        changed: false,
        device: { revoked: false },
      };
      return ok(unchanged, { etag });
    }

    const changed: PullResponse = {
      changed: true,
      etag,
      pack,
      device: { revoked: false },
    };
    return ok(changed, { etag });
  } catch (error) {
    log.error("sync.pull.failed", {
      deviceId: auth.device.deviceId,
      message: error instanceof Error ? error.message : String(error),
    });

    return unavailable("The club's information could not be refreshed just now.");
  }
}
