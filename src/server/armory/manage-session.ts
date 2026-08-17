import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getArmoryDb, isArmoryDatabaseConfigured } from "@/db/armory/client";
import { getDb, isDatabaseConfigured } from "@/db/client";
import { members } from "@/db/schema";
import { schema } from "@/db/armory/client";
import { getMember } from "@/server/auth/session";
import { heldGrants } from "@/domain/grants";
import { routes } from "@/lib/site";
import { grantRowsFor, type StaffPrincipal } from "./grants";

/**
 * WHO IS RUNNING THE CLUB — Management System §12.3.
 *
 *   "Management is a personal login, not a shared one."
 *
 * ===========================================================================
 * WHY THIS IS THE MEMBER SESSION AND NOT THE STAFF SESSION
 *
 * The system already has a staff session, in staff-session.ts, and it is the
 * wrong one for this surface. It is DEVICE-BOUND by design: a device token
 * proving which tablet, plus a PIN proving which officer, because §10 requires
 * the console's shared tablet to attribute every action to a named person
 * without a keyboard.
 *
 * Management is the opposite posture — §4's table sets it out. A personal
 * device, online, sitting down, with time to think. Requiring a registered
 * device would mean the founder cannot open the ledger from their own phone,
 * which is the single most likely way this surface is ever used.
 *
 * So management authenticates the way the members portal does, and resolves
 * staff standing from the person behind the account. That is not a shortcut: it
 * is §3.1's rule applied one more time. "Applicant, guest and member are states,
 * not separate tables", and `staff_users.person_id` says the same about staff —
 * a member of staff is a person who also holds a post, so the club has exactly
 * one identity for them and one place to revoke it.
 *
 * ===========================================================================
 * WHAT THIS DOES NOT YET DO, AND IT IS REGISTERED RATHER THAN HIDDEN
 *
 * §12.3 also asks that where a device is shared, "sessions are short and
 * re-authentication is quick, because the alternative is a permanently
 * signed-in device on a public counter". A member session is long, because it
 * is built for a member's own phone.
 *
 * That is acceptable while management is opened from personal devices and is
 * NOT acceptable for the front-of-house tablet §4.1 describes. The console
 * hand-off — a single-purpose, minutes-long, device-bound session — is the
 * answer to that and is not built here. Until it is, management on a shared
 * counter device is a posture the club should not adopt, and the outstanding
 * register says so under `manage-shared-device`.
 */

export type ManageResolution =
  | { readonly state: "signed_out" }
  /** Signed in, and not a member of staff. The commonest case by far. */
  | { readonly state: "not_staff" }
  /** Was staff. `active` is false — an account kept for its attribution. */
  | { readonly state: "stood_down" }
  | { readonly state: "staff"; readonly principal: StaffPrincipal };

/**
 * Resolve the staff principal behind this request.
 *
 * `now` is taken once, here, and threaded into `heldGrants` — §15 requires
 * capability to be re-evaluated per request rather than per session, and an
 * acting grant that lapses at 06:00 has to stop being held at 06:00 even on a
 * tab that has been open all night.
 */
export async function resolveStaff(): Promise<ManageResolution> {
  if (!isDatabaseConfigured() || !isArmoryDatabaseConfigured()) {
    return { state: "signed_out" };
  }

  const account = await getMember();
  if (!account) return { state: "signed_out" };

  const [link] = await getDb()
    .select({ personId: members.personId })
    .from(members)
    .where(eq(members.id, account.id))
    .limit(1);

  if (!link?.personId) return { state: "not_staff" };

  const db = getArmoryDb();
  const [staff] = await db
    .select({
      id: schema.staffUsers.id,
      personId: schema.staffUsers.personId,
      role: schema.staffUsers.role,
      active: schema.staffUsers.active,
    })
    .from(schema.staffUsers)
    .where(eq(schema.staffUsers.personId, link.personId))
    .limit(1);

  if (!staff) return { state: "not_staff" };

  /**
   * An inactive account is distinguished from no account, and both are refused.
   *
   * The distinction is for the person reading the screen. "You are not staff"
   * to somebody who ran the club until last month is a worse sentence than the
   * truth, and the truth costs one branch. §4.3's rule about never rendering a
   * generic refusal is a rule about members; it reads the same to a colleague.
   */
  if (!staff.active) return { state: "stood_down" };

  const rows = await grantRowsFor(db, staff.id);

  return {
    state: "staff",
    principal: {
      staffUserId: staff.id,
      personId: staff.personId,
      role: staff.role,
      grants: heldGrants(rows, new Date()),
    },
  };
}

/**
 * The layout guard. Returns a principal or does not return.
 *
 * ===========================================================================
 * A PERSON WITH NO GRANTS IS SIGNED OUT OF MANAGEMENT, NOT SHOWN AN EMPTY SHELL
 *
 * `surfacesFor` on an empty hand yields nothing, so the alternative is a
 * management application with a navigation bar containing no destinations. That
 * is the worst of the three available answers: it tells somebody they are staff,
 * shows them a product, and refuses every part of it without saying why.
 *
 * The founder is exempt from this by construction rather than by a branch —
 * their bundle always contains grants, and `surfacesFor` gives them all six.
 */
export async function requireStaffPrincipal(): Promise<StaffPrincipal> {
  const resolution = await resolveStaff();

  if (resolution.state === "signed_out") {
    redirect(`${routes.signIn}?next=${encodeURIComponent(routes.manage)}`);
  }

  /* Both refusals land on the member portal rather than on an error page. A
     person who is signed in and is not staff has somewhere they belong, and
     sending them there is a better answer than a wall. */
  if (resolution.state !== "staff") redirect(routes.portal);

  if (resolution.principal.grants.size === 0) redirect(routes.portal);

  return resolution.principal;
}
