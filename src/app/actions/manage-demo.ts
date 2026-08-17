"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { routes } from "@/lib/site";
import { DEMO_COOKIE } from "@/server/armory/manage-source";
import { resolveStaff } from "@/server/armory/manage-session";

/**
 * TURN DEMONSTRATION MODE ON OR OFF.
 *
 * ===========================================================================
 * IT RE-CHECKS THE CAPABILITY. THE FORM IS NOT THE AUTHORITY
 *
 * The button only renders for a founder, and that is worth nothing here — a
 * server action is a public endpoint with a generated name, reachable by anybody
 * who has ever seen the page. S1's rule holds hardest at the write: the screen
 * decides what to show, the capability service decides what to allow.
 *
 * So this resolves the principal from scratch and checks `grants`. A duty manager
 * who posts to this action gets nothing, silently, which is the correct answer to
 * a request that should not have been possible to compose.
 *
 * ===========================================================================
 * NO STATE OBJECT IS EXPORTED FROM THIS MODULE
 *
 * §14: "Server actions must not export their state objects. The defect that took
 * down member sign-in will recur on every new form surface in this document."
 * This module exports one function and no types, so there is nothing to get
 * wrong — see src/lib/booking-flow-state.ts for where the shared shapes live
 * when a form does need them.
 */
export async function setDemoMode(formData: FormData): Promise<void> {
  const resolution = await resolveStaff();

  if (resolution.state !== "staff") return;
  if (!resolution.principal.grants.has("grants")) return;

  const on = formData.get("on") === "1";
  const jar = await cookies();

  if (on) {
    jar.set(DEMO_COOKIE, "1", {
      /* Not readable by script. The flag carries no secret, but a cookie the
         page can write is a cookie a third-party script can write, and the one
         thing this must never do is switch itself on without being asked. */
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      /* Scoped to the management surface. It has no meaning anywhere else and a
         site-wide cookie would travel with every marketing page request. */
      path: routes.manage,
      /**
       * SESSION-LIFETIME, DELIBERATELY.
       *
       * No maxAge, so it dies with the browser. A founder who leaves this on and
       * opens the ledger in a board meeting three weeks later is the failure
       * this prevents — and a persisted preference is exactly how that happens.
       */
    });
  } else {
    jar.delete({ name: DEMO_COOKIE, path: routes.manage });
  }

  /* Every management route re-renders. The source is resolved per request, so
     one revalidation of the layout segment is enough — and a targeted
     revalidation would leave whichever screen the founder is standing on
     showing the data they just switched away from. */
  revalidatePath(routes.manage, "layout");
}
