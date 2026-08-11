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
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS STICKY GLASS, AND WHY FOUNDING STATUS MOVED INTO A CHIP
 *
 * It sticks because in an installed app this is the "who am I signed in as"
 * strip, and a member checking a booking on a range floor should not have to
 * scroll up to confirm the account. It is glass because it now overlays live
 * content rather than sitting in flow, which is the only condition under which
 * glass is worth its cost — over a solid ground it is just tinted paint.
 *
 * That forced one change. The bar used to flood ITSELF with VIP Teal for
 * founding members, and a bar-wide brand colour cannot also be a Chalk-tinted
 * glass surface: the two are competing for the same pixels, and proving AA for
 * Chalk type on translucent teal over unpredictable content is a second proof
 * for a surface this small.
 *
 * So the ground is glass for everyone and the distinction moved to an OPAQUE
 * VIP Teal chip around the name. Nothing is lost — §10 asks for founding
 * members to be permanently and visibly distinguished, not for the club's
 * furniture colour to be used at full bleed — and the chip is a stronger
 * signal than a background tint because it is attached to the name itself.
 * Chalk on VIP Teal is 5.32:1, and the chip being opaque is what keeps that
 * true over any backdrop.
 */
export function MemberBar({ member }: { member: Member }) {
  const founding = isFounding(member.status);

  return (
    <div
      className={[
        /* Directly beneath the header, which is `sticky top-0` plus the status
           bar inset it carries under `viewport-fit=cover`. */
        "sticky top-[calc(var(--header-h)+var(--safe-t))] z-40",
        "u-glass u-glass-edge-bottom",
      ].join(" ")}
    >
      <Container className="flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
        <p className="u-kicker flex items-center gap-1 text-[var(--ink)]">
          {founding ? (
            <span
              className={[
                "inline-flex items-center gap-1 rounded-control px-1 py-[2px]",
                /* Opaque, so the 5.32:1 holds whatever scrolls underneath. */
                "bg-vip-teal text-chalk",
              ].join(" ")}
            >
              <CentreDot className="size-[5px]" />
              {member.displayName}
            </span>
          ) : (
            member.displayName
          )}
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
