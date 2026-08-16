"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import {
  activePortalHref,
  guestNav,
  isAppNavActive,
  isPortalRoute,
  memberNav,
  portalNav,
  type AppNavItem,
} from "@/lib/app-nav";
import {
  getSessionHint,
  getSessionHintServerSnapshot,
  subscribeToSessionHint,
} from "@/lib/session-hint";
import { AppNavIcon } from "@/components/layout/AppNavIcon";

/* ============================================================================
   THE BOTTOM BAR — the single change that makes this read as an app.

   A phone user's thumb reaches the bottom third of the screen comfortably and
   the top-left corner not at all. Every native app puts its primary navigation
   where the hand is; a hamburger in the opposite corner is the one detail that
   marks a site as a site no matter how well it is styled. This is that fix.

   ----------------------------------------------------------------------------
   THE ACTIVE STATE, AND WHY IT IS A SOLID CHIP INSIDE A FROSTED BAR

   Brand Guidelines §8 assign "a single red dot as marker" to active
   navigation, and that marker does not survive glass: Ten Ring Red measures
   1.43:1 against the worst-case tint, because red and frosted Chalk are both
   mid-luminance. The full derivation is in glass.css.

   Rather than pick a different red — which §3 forbids and which would make the
   dot a different dot on this one surface — the tab gives the marker the
   ground the brand already guarantees it. `.u-glass-lens` is opaque Chalk, so
   the dot measures its usual 3.79:1, and the lens doubles as the selected-tab
   affordance that a web app otherwise cannot fake.

   State is therefore carried by FOUR signals, none of which is colour alone
   (WCAG 1.4.1): the lens, the weight change, the dot, and `aria-current`.

   ----------------------------------------------------------------------------
   WHY LABELS DO NOT GREY OUT WHEN INACTIVE

   Because they cannot. Sight Ink measures 2.35:1 on glass over a dark
   backdrop, and there is no lighter ink that clears AA on this surface at all
   — see glass.css. Inactive labels are full Reticle Black at normal weight.
   This looks flatter than the muted-grey convention and it is not a bug.
   ========================================================================= */

export function BottomNav() {
  const pathname = usePathname();

  /* Guest-first, then swap. The server has no idea who this is (deliberately —
     see session-hint.ts), so the server snapshot is always `false` and the
     first render is the set that is correct for an anonymous visitor, which is
     also the overwhelmingly common case.

     `useSyncExternalStore` rather than state-plus-effect: the cookie is an
     external store mutated by the server and by other tabs, and this hook is
     the one that guarantees the hydration render matches the server's while
     still re-reading when the app is resumed from the background. */
  const signedIn = useSyncExternalStore(
    subscribeToSessionHint,
    getSessionHint,
    getSessionHintServerSnapshot,
  );

  /**
   * Inside the members app the bar is the members app's.
   *
   * Members Portal §4.2: the navigation changes from HOME · VISIT · RANGES ·
   * CLUB · APPLY to TODAY · DIARY · COMPETE · ME · BOOK. This is where that
   * happens, and it is switched on the PATH rather than on the session hint.
   *
   * That matters for one render: the hint resolves on the client, so the first
   * paint of any page is the signed-out set. On a public page that is correct
   * and invisible. On a portal page it would be a flash of the marketing nav
   * under a member's thumb — five wrong destinations, one of which is Apply,
   * shown to somebody who is already a member. The path is known on the server,
   * so switching on it makes the members bar correct from the first byte.
   */
  const portal = isPortalRoute(pathname);
  const items = portal ? portalNav : signedIn ? memberNav : guestNav;
  const active = portal ? activePortalHref(pathname) : null;

  return (
    <nav
      aria-label="App"
      className={cn(
        /* Fixed, not sticky: the bar is chrome and does not participate in
           page flow. `--app-nav-space` reserves the room it takes — applied on
           the footer, so no page has to remember to do it. */
        "fixed inset-x-0 bottom-0 z-50 lg:hidden",
        "u-glass u-glass-edge-top",
        /* The home indicator on iOS and the gesture bar on Android sit inside
           the viewport once `viewport-fit=cover` is set. Padding rather than
           height, so the bar's touch surface extends into the inset instead of
           leaving a translucent dead strip below it. */
        "pb-[var(--safe-b)]",
      )}
    >
      <ul className="grid h-[var(--app-nav-h)] grid-cols-5">
        {items.map((item) => (
          <Tab
            key={item.href}
            item={item}
            /* Longest prefix inside the portal — every route there begins with
               /portal, so a subtree test would light Today on every screen and
               would light both Diary and Book on /portal/book/new. */
            active={
              portal ? active === item.href : isAppNavActive(pathname, item.href)
            }
          />
        ))}
      </ul>
    </nav>
  );
}

function Tab({ item, active }: { item: AppNavItem; active: boolean }) {
  /* The accent stands down once you are on its page. A filled CTA shouting
     "Apply" at someone already reading the membership page is noise, and the
     ordinary active treatment is the honest thing to show there. It also
     resolves a contrast problem the other way round: the red centre dot cannot
     sit on a red fill. */
  const accent = item.accent && !active;

  return (
    <li className="min-w-0">
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        aria-label={item.a11yLabel}
        className={cn(
          "relative flex h-full flex-col items-center justify-center gap-[3px]",
          "px-[2px] no-underline",
          "text-reticle-black",
          /* Press feedback. The one piece of app-like motion worth adding:
             a native tab responds the instant it is touched. Held inside the
             spec's 200ms / ease-out envelope, and reduced-motion strips it
             along with everything else via the global rule in base.css. */
          "transition-transform duration-[var(--duration-fast)]",
          "ease-[var(--ease-precision)] active:scale-[0.96]",
        )}
      >
        {/* ---- The lens: opaque ground for the active tab ---- */}
        {active && (
          <span
            aria-hidden="true"
            className="u-glass-lens absolute inset-x-[6px] inset-y-[6px]"
          />
        )}

        {/* ---- The accent chip: slot 5, signed out only ---- */}
        {accent && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-x-[6px] inset-y-[6px] rounded-control",
              "bg-ten-ring-deep",
            )}
          />
        )}

        {/* §8's centre dot, on the opaque ground that makes it legible.
            Sits on the lens's top edge so it reads as the reticle's centre
            marking the tab, rather than as a notification badge. */}
        {active && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-[3px] left-1/2 -translate-x-1/2",
              "size-[5px] rounded-full bg-ten-ring-red",
            )}
          />
        )}

        <span
          className={cn(
            "relative flex flex-col items-center gap-[3px]",
            accent && "text-chalk",
          )}
        >
          <AppNavIcon name={item.icon} className="block size-[22px]" />
          <span
            className={cn(
              "font-display uppercase leading-none whitespace-nowrap",
              /* 10px with 60-unit tracking. §5 permits 60-130 units and the
                 site's kicker sits at 120; a five-slot bar at 320px does not
                 have the width for 120, and 60 is inside the range rather
                 than an exception to it.

                 The size was set by measuring the worst label, not by picking
                 a number. "ACCOUNT" and "LEAGUES" are the widest in either
                 set, and at 11px they left roughly 4px of clearance inside a
                 64px cell at 320px — technically fitting, visually jammed.
                 10px is also what iOS and Android use for a tab label, so it
                 is the size the audience already reads at this position.

                 THAT MEASUREMENT WAS ABOUT 320px, AND IT IS NOW HELD THERE
                 RATHER THAN EVERYWHERE. This membership is largely over 30 and
                 concentrated 35-50, where 10px of tracked uppercase is at the
                 edge of comfortable — and almost nobody is on a 320px phone.
                 A 390px iPhone and a 412px Android both have room the original
                 measurement never claimed they did not.

                 So the label is fluid instead of fixed: 10px where the width
                 genuinely forces it, ~11px on the phones the club's members
                 actually carry, 12px by 480px. The jammed case is still
                 avoided; it is simply no longer imposed on everyone. This is
                 the one label on the site allowed below --text-micro's floor,
                 and only at the bottom of its range. */
              "text-[clamp(0.625rem,0.375rem+1.25vw,0.75rem)] tracking-[0.06em]",
              active ? "font-bold" : "font-normal",
            )}
          >
            {item.label}
          </span>
        </span>
      </Link>
    </li>
  );
}
