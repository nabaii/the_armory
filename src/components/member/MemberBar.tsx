import { Container } from "@/components/layout/Container";

import { CentreDot } from "@/components/brand/Reticle";
import { SignOutButton } from "@/components/member/SignOutButton";
import { isFounding, isFullMember } from "@/server/leagues/eligibility";
import type { Member } from "@/db/schema";

/**
 * A thin bar under the site header, identifying who is signed in.
 *
 * Shows the DISPLAY NAME, not the real name. Members will open this on a phone
 * in a bar with people behind them, and display names are the identity the rest
 * of the product uses — mixing the two would make it unclear which one appears
 * on a standings table.
 *
 * Founding members are "permanently and visibly distinguished" (Guidelines
 * §10). This is the smallest honest way to do that: a marker where they will
 * see it every time, not a badge shown to everyone else.
 */
export function MemberBar({ member }: { member: Member }) {
  const founding = isFounding(member.status);

  return (
    <div
      className={[
        "border-b border-sight-grey/25",
        founding ? "bg-vip-teal" : "bg-terrazzo",
        founding
          ? "[--ink:var(--color-chalk)] [--ink-muted:var(--color-chalk)]"
          : "[--ink:var(--color-reticle-black)] [--ink-muted:var(--color-sight-ink)]",
      ].join(" ")}
    >
      <Container className="flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
        <p className="u-kicker flex items-center gap-1 text-[var(--ink)]">
          {founding && <CentreDot className="size-[5px]" />}
          {member.displayName}
          <span className="ml-1 font-normal normal-case tracking-normal">
            {statusLabel(member.status)}
          </span>
        </p>

        <SignOutButton />
      </Container>
    </div>
  );
}

/**
 * Deliberately plain. "Founding member" is a standing, not a rank badge —
 * Guidelines §9 forbids hype, and this brand states facts rather than
 * decorating them.
 */
function statusLabel(status: Member["status"]): string {
  switch (status) {
    case "founding_member":
      return "Founding member";
    case "member":
      return "Member";
    case "lapsed":
      return "Membership lapsed";
    case "non_member":
      /* Never "guest" or "free" — someone paying per visit is a customer of the
         club, and the copy should not imply otherwise. */
      return "Signed in";
  }
}

/** Whether to offer member-only surfaces in navigation. */
export const showsMemberSurfaces = (member: Member): boolean =>
  isFullMember(member.status);
