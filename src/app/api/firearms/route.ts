import { firearmRegister } from "@/server/armory/register";
import { handleRead, requireStaff } from "@/server/armory/http";

/**
 * GET /api/firearms — §3.4's register, §7's armoury group.
 *
 *   "One register. One log. No exceptions. Club-owned and member-owned firearms
 *    are rows in the same table, distinguished by an ownership column."
 *
 * So one endpoint, and no `?ownership=` filter. A caller that wanted only club
 * firearms would be recreating the split §3.4 forbids, one query string at a
 * time — and the question a founder actually asks is "where is everything the
 * club is responsible for", which has no ownership in it.
 *
 * ===========================================================================
 * READ-ONLY, AND THERE IS NO POST HERE
 *
 * A firearm's location changes only by a custody event, and custody events
 * arrive through /sync/push because §6.4 requires equipment issue to work
 * offline. Adding a movement endpoint here would be the "parallel workflow"
 * §3.4 names — two paths writing the same append-only log, which is how the log
 * stops being the sole source of truth.
 *
 * Registering a NEW firearm is a different act and is not built yet; §14 lists
 * the regulatory obligation as blocking the schema freeze on custody and
 * ammunition, and registering a firearm is the write that freeze is about.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  /* read_only may read the register. §10 keeps LICENCE DOCUMENTS to the founder;
     the register is not a document, and an accountant or an auditor being able
     to see what the club holds is the point of the role existing. */
  const auth = await requireStaff(request, { atLeast: "read_only" });
  if ("response" in auth) return auth.response;

  return handleRead("firearms.register", async (tx) => {
    const entries = await firearmRegister(tx);

    return {
      firearms: entries.map((entry) => ({
        ...entry,
        lastMovedAt: entry.lastMovedAt?.toISOString() ?? null,
      })),
      /* The counts a founder reads first. Derived here rather than in the
         client so two surfaces cannot disagree about how many are out. */
      summary: {
        total: entries.length,
        issued: entries.filter((e) => e.status === "issued").length,
        offSite: entries.filter((e) => e.status === "off_site").length,
        outOfService: entries.filter(
          (e) => e.status === "at_service" || e.status === "decommissioned",
        ).length,
      },
    };
  });
}
