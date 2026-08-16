import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { Reticle } from "@/components/brand/Reticle";
import { SignOutButton } from "@/components/member/SignOutButton";
import { PortalTabs } from "@/components/member/PortalTabs";
import { cn } from "@/lib/cn";
import { routes } from "@/lib/site";

/**
 * THE MEMBERS APP HEADER — Members Portal §4.
 *
 *   "On sign-in the application becomes the Members App. The panel's position
 *    is that this should read as the same building, a different room — not as a
 *    different product."
 *
 * ===========================================================================
 * §4.3 — THE IDENTITY ANCHOR, AND WHY IT IS NOT A GREETING
 *
 *   "The members header carries the member number permanently — M-014 ·
 *    FOUNDING — rather than a greeting. Member number is issued once and never
 *    reused; founding designation is permanent and publicly claimed. Putting it
 *    in the persistent header, on every screen, in every session, is the
 *    cheapest and strongest belonging signal available to the club and it costs
 *    nothing to build.
 *
 *    A greeting was considered and rejected. *Good evening, Ada* is warmth the
 *    club has not earned from a piece of software, and it dates badly on the
 *    fortieth reading. A member number does not."
 *
 * The name is still here — a member should be able to confirm which account
 * they are signed in as, which was the job of the `MemberBar` this replaces and
 * remains a real one on a shared phone. It is simply not the loudest thing in
 * the bar.
 *
 * ===========================================================================
 * §4 SECONDARY BENEFIT — THE RETICLE, NOT THE WORDMARK
 *
 *   "Leading the members header with the reticle mark rather than the full
 *    lockup keeps the military stencil typeface out of the club's highest-
 *    contact surface while that decision remains open. This is not a reason to
 *    defer the decision. It is a reason not to be forced into it by a shipping
 *    deadline."
 *
 * ===========================================================================
 * WHAT HAPPENS WHEN THE ARMORY HALF HAS NOTHING TO SAY
 *
 * A person can hold a portal session with no membership behind it — signed in
 * to the leagues product, never admitted, or a former guest (§3.1 makes those
 * states of a person rather than separate tables). They have no member number
 * and no tier, and the header says so by omission rather than by rendering
 * "M-—" or "No tier", either of which is a small insult printed on every screen
 * they open. What they get is their name and the club's mark, which is exactly
 * what the club can honestly claim about them.
 */

export type ShellIdentity = {
  /**
   * The display name, never the real name.
   *
   * It is the identity the rest of the product uses — the only name that
   * appears on a standings table — and mixing the two would leave a member
   * unsure which one other members can see.
   */
  readonly displayName: string;
  /** §4.3's anchor. Null for a session with no membership behind it. */
  readonly memberNumber: number | null;
  /** The tier's own name, read from the tier row rather than restated in copy. */
  readonly tierName: string | null;
  /** §10 of the Brand Guidelines: permanent, and visibly distinguished. */
  readonly founding: boolean;
};

export function MembersShell({ identity }: { identity: ShellIdentity }) {
  return (
    <div
      className={[
        /* Directly beneath the site header, which is `sticky top-0` plus the
           status bar inset it carries under `viewport-fit=cover`. */
        "sticky top-[calc(var(--header-h)+var(--safe-t))] z-40",
        "u-glass u-glass-edge-bottom",
      ].join(" ")}
    >
      <Container className="flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
        <Link
          href={routes.portal}
          className="flex items-center gap-2 no-underline"
          aria-label="Today at the club"
        >
          <Reticle className="size-2 shrink-0" />

          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-[2px]">
            {/*
              The anchor. Set in the data face at the same weight the club uses
              for every other number it holds about a person — a member number
              is a fact, not a badge, and §9 forbids decorating facts.
            */}
            {identity.memberNumber !== null && (
              <span className="u-kicker text-[var(--ink)]">
                {memberNumberLabel(identity.memberNumber)}
                {identity.founding && (
                  <>
                    <span aria-hidden="true">{" · "}</span>
                    {/*
                      Founding is permanent (Guidelines §10) and is claimed in
                      the same breath as the number rather than as a separate
                      badge, because it is a property of how this person joined
                      rather than a rank they hold.
                    */}
                    <span>Founding</span>
                  </>
                )}
              </span>
            )}

            <span className="text-caption text-[var(--ink-muted)]">
              {identity.displayName}
            </span>

            {identity.tierName && (
              <span
                className={cn(
                  "inline-flex items-center rounded-control px-1 py-[2px]",
                  /* Opaque, so its contrast holds over whatever scrolls
                     underneath the glass. Chalk on VIP Teal is 5.32:1. */
                  "bg-vip-teal text-chalk u-micro",
                )}
              >
                {identity.tierName}
              </span>
            )}
          </span>
        </Link>

        <SignOutButton />
      </Container>

      {/*
        The four tabs, for a screen wide enough to carry them in the header.
        Below `lg` they are the bottom bar instead — a phone user's thumb
        reaches the bottom third of the screen and the top-left corner not at
        all, which is the whole argument in BottomNav.tsx.

        Both render from `portalNav`, so there is exactly one list and one
        active-tab rule. Two would disagree within a release.
      */}
      <PortalTabs className="hidden lg:block" />
    </div>
  );
}

/**
 * M-014. Zero-padded to three digits.
 *
 * The club's first hundred and twenty-five members are the roster it is
 * planning for, so three digits is the width that keeps every number the same
 * shape in a column — and a member who joined at 14 does not read as an
 * afterthought beside one who joined at 114.
 */
export function memberNumberLabel(memberNumber: number): string {
  return `M-${String(memberNumber).padStart(3, "0")}`;
}
