import { deviceRegister } from "@/server/armory/devices";
import { handleRead, requireStaff } from "@/server/armory/http";

/**
 * GET /api/devices — §3.1, §10, the founder's view of the tablets.
 *
 * Founder only, for the same reason `/api/dashboard` is: this is the list a
 * founder reads to decide which tablet to take out of service, and the control
 * that acts on it is the most destructive one in the system.
 *
 * It returns no credentials. `tokenHash` is not selected — `deviceRegister`
 * projects it to a boolean `hasToken` — so the response says whether a device
 * has been enrolled and never what with.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireStaff(request, { atLeast: "founder" });
  if ("response" in auth) return auth.response;

  return handleRead("devices.list", async (tx) => ({
    devices: await deviceRegister(tx, new Date()),
  }));
}
