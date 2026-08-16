import type { Metadata } from "next";
import { requireMember } from "@/server/auth/session";
import { MembersShell } from "@/components/member/MembersShell";
import { isFounding } from "@/server/leagues/eligibility";
import { resolveArmoryMember } from "@/server/armory/member-session";

/**
 * MEMBER SHELL.
 *
 * ===========================================================================
 * WHY THIS IS A ROUTE GROUP
 *
 * `(member)` keeps every authenticated surface in its own segment, which buys
 * two things Phase 1 spent real effort earning:
 *
 * 1. THE MARKETING BUNDLE STAYS CLEAN. Portal code — session handling, member
 *    state, league components — is never imported by a static marketing page,
 *    so the measured 1088ms LCP and 379KB payload are unaffected by anything
 *    built here.
 *
 * 2. THE GUARD IS IN ONE PLACE. `requireMember()` runs in this layout, so every
 *    route beneath it is authenticated by construction. A new page added under
 *    `(member)` cannot forget to check — which is how member areas leak.
 *
 * The guard is a defence in depth rather than the only one: any route reading
 * member data must still scope its queries by the member's own id. A layout
 * check protects the page; it does not protect a query that asks for someone
 * else's row.
 * ===========================================================================
 */

export const metadata: Metadata = {
  /* Nothing under here is ever indexed. A members' club does not publish the
     shape of its member area, and these pages hold personal data. */
  robots: { index: false, follow: false, nocache: true, nosnippet: true },
};

/* Member surfaces are personal and change constantly. Never prerender, never
   cache — a cached portal page is one member's data served to another. */
export const dynamic = "force-dynamic";

export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const member = await requireMember();

  /**
   * The two halves of one person — Members Portal §4.3.
   *
   * The display name belongs to the leagues product (`public.members`); the
   * member number and tier belong to the management system (`armory`). The
   * header carries all three, so the layout is the one place that reads both.
   *
   * Resolving it here rather than in each page is what makes the anchor
   * PERMANENT: §4.3 asks for the member number "on every screen, in every
   * session", and a header assembled per page would eventually meet a page that
   * forgot. It costs one read per request, cached by `resolveArmoryMember`'s
   * own callers within the render.
   */
  const resolution = await resolveArmoryMember();
  const armory = resolution.state === "member" ? resolution.member : null;

  return (
    <>
      <MembersShell
        identity={{
          displayName: member.displayName,
          memberNumber: armory?.memberNumber ?? null,
          tierName: armory?.tier.name ?? null,
          founding: isFounding(member.status),
        }}
      />
      {children}
    </>
  );
}
