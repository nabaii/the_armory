"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeManageSurface, type ManageNavItem } from "@/lib/manage-nav";
import { cn } from "@/lib/cn";

/**
 * THE MANAGEMENT SHELL — Management System §5, §5.2.
 *
 * ===========================================================================
 * A BAR UNDER THE THUMB, A RAIL ON A DESK, AND ONE SET OF DESTINATIONS
 *
 * §5.2 assigns the pattern by role — "front of house: bottom bar, phone or
 * tablet… founder: desktop rail, collapsing to a bar with overflow" — and the
 * shell does not need to know which role is reading it. Two presentations of
 * the same generated list, chosen by viewport, is the same answer with no
 * branch on identity: a duty manager on a laptop gets the rail, and the same
 * person on their phone at the range gets the bar.
 *
 * The list itself is `manageNavFor`, computed on the server from grants. This
 * component receives it and renders it. It evaluates no permission — §5's S1 is
 * emphatic that "an inline check in an administrative screen is not a shortcut;
 * it is a hole in the club's governance", and a client component is the worst
 * possible place to hold one.
 *
 * ===========================================================================
 * THE REGISTER IS DELIBERATELY NOT THE MEMBER ONE
 *
 * The site's access register — Soffit Blue for open contexts, VIP Teal for
 * member contexts — encodes WHAT KIND OF MEMBER somebody is. Borrowing it for a
 * staff surface would say something untrue about the person reading it. So
 * management takes the neutral ground: Chalk, Charred Timber chrome, Sight Ink
 * for secondary text, and no register colour at all.
 *
 * Red is reserved here for "this requires a decision" and is never a primary
 * action. On a screen the founder opens to find out what needs them, a red Save
 * button would spend the one colour that means urgency on the most ordinary
 * thing on the page.
 */
export function ManageShell({
  items,
  banner,
  children,
}: {
  items: readonly ManageNavItem[];
  /**
   * The demonstration banner, rendered by the layout.
   *
   * Passed in rather than imported here because this is a client component and
   * the banner carries a server action. It is a slot rather than an option: the
   * layout always supplies it, so no management route can render without it.
   */
  banner: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = activeManageSurface(pathname ?? "");

  return (
    <div className="min-h-dvh bg-chalk text-reticle-black lg:flex">
      {/* The desktop rail. Hidden below lg, where the bar takes over. */}
      <nav
        aria-label="Management"
        className="hidden w-[--rail] shrink-0 border-r border-sight-grey/30 bg-chalk lg:block"
        style={{ "--rail": "232px" } as React.CSSProperties}
      >
        <div className="sticky top-0 flex flex-col gap-2 p-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sight-ink">
            The Armory
          </p>
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.surface}>
                <Link
                  href={item.href}
                  aria-current={active === item.surface ? "page" : undefined}
                  className={cn(
                    "flex flex-col gap-[2px] border-l-2 py-2 pl-2 pr-1 transition-colors",
                    active === item.surface
                      ? "border-ten-ring-deep bg-terrazzo/40 font-semibold"
                      : "border-transparent hover:bg-terrazzo/25",
                  )}
                >
                  <span className="text-[15px] leading-tight">{item.label}</span>
                  {/* The question each surface answers. §5's table, rendered —
                      a new duty manager should not have to guess what DIARY is. */}
                  <span className="text-[11px] leading-snug text-sight-ink">
                    {item.answers}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Padding-bottom clears the bar, plus the home indicator. Below lg
            only — the rail does not overlay anything. */}
        {/* Above the content, on every route. A screen cannot opt out of it. */}
        {banner}
        <main className="min-w-0 flex-1 pb-[calc(68px+env(safe-area-inset-bottom))] lg:pb-0">
          {children}
        </main>
      </div>

      {/* The bar. Six will not fit; nobody but the founder sees six. */}
      <nav
        aria-label="Management"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-sight-grey/30 bg-chalk pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="flex">
          {items.map((item) => (
            <li key={item.surface} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-label={item.a11yLabel}
                aria-current={active === item.surface ? "page" : undefined}
                className={cn(
                  "flex h-[68px] flex-col items-center justify-center gap-1 px-1 text-[11px]",
                  active === item.surface
                    ? "font-semibold text-reticle-black"
                    : "text-sight-ink",
                )}
              >
                {/* State is carried by three signals and never by colour alone:
                    the dot, the weight, and aria-current. The same rule
                    glass.css sets for the members bar. */}
                <span
                  aria-hidden
                  className={cn(
                    "size-1 rounded-full",
                    active === item.surface ? "bg-ten-ring-red" : "bg-transparent",
                  )}
                />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
