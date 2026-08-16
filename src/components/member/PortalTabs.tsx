"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Container } from "@/components/layout/Container";
import { cn } from "@/lib/cn";
import { activePortalHref, portalNav } from "@/lib/app-nav";

/**
 * THE FOUR TABS AND THE RED ACTION, IN THE HEADER — Members Portal §5.
 *
 * The wide-screen half of the same navigation the bottom bar carries on a
 * phone. Both render from `portalNav` and both resolve the active tab with
 * `activePortalHref`, so there is one list and one rule; two implementations
 * would disagree about which tab is lit within a release, and the version a
 * member sees would depend on the width of their window.
 *
 * ===========================================================================
 * WHY THIS IS A CLIENT COMPONENT AND THE SHELL AROUND IT IS NOT
 *
 * §13.2: client components are used "where interaction genuinely requires them
 * … and nowhere else". Reading the current path is one of those places — the
 * active tab has to change on navigation without a round trip. Nothing else in
 * the header does, so nothing else crosses the boundary: the member's name,
 * number and tier are rendered on the server and never reach the bundle.
 */
export function PortalTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  const active = activePortalHref(pathname);

  return (
    <nav aria-label="Members app" className={cn("border-t border-[var(--rule)]/25", className)}>
      <Container>
        <ul className="flex items-stretch gap-1">
          {portalNav.map((item) => {
            const isActive = active === item.href;
            /* The accent stands down on its own page, exactly as it does in the
               bottom bar: a filled red BOOK shouting at somebody already inside
               the booking flow is noise, and the red centre dot cannot sit on a
               red fill. */
            const accent = item.accent && !isActive;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={item.a11yLabel}
                  className={cn(
                    "relative flex min-h-5 items-center gap-1 px-2 py-1",
                    "u-kicker no-underline",
                    "transition-colors duration-[var(--duration-fast)]",
                    "ease-[var(--ease-precision)]",
                    accent
                      ? "bg-ten-ring-deep text-white rounded-control"
                      : "text-[var(--ink)]",
                    isActive && "font-bold",
                  )}
                >
                  {/* §8's centre dot as the active marker, on the opaque ground
                      the header already guarantees it. */}
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="size-[5px] shrink-0 rounded-full bg-ten-ring-red"
                    />
                  )}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </Container>
    </nav>
  );
}
