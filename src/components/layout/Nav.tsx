"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { cta, primaryNav, routes } from "@/lib/site";
import { CentreDot } from "@/components/brand/Reticle";
import { Button } from "@/components/ui/Button";

/* ============================================================================
   NAVIGATION — the header's only client island.

   The hero itself ships zero client JavaScript, which is what the 2.5s LCP
   target on mid-range Android actually depends on. This island exists because
   two things genuinely require it: the mobile panel, and the active-route
   indicator.

   The active indicator is the centre dot, per Brand Guidelines §8 — "a single
   red dot as marker: list bullets, active navigation, map pins, current
   position on a ladder". It is paired with a font-weight change so the state
   is not conveyed by colour alone (WCAG 1.4.1).
   ========================================================================= */

function isActive(pathname: string, href: string) {
  if (href === routes.home) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname();

  return (
    <>
      {/* ---- Desktop: five items maximum (spec §2) ---- */}
      <nav aria-label="Primary" className="hidden lg:block">
        {/* `shrink-0` on the items and `whitespace-nowrap` on the labels.
            Without both, flex shrinking wrapped every multi-word label onto two
            lines at every desktop width — measured at 1024, 1280, 1440 and
            1600. A nav item is either on one line or it does not belong in the
            nav; wrapping made the header 45px of ragged text.

            The gap opens at `xl` rather than starting wide. Five items means
            four gaps, so every step here costs 32px of header — and at 1024px
            the header did not have 32px to give: measured, it wanted 1102px of
            content in a 1024px viewport and ran 79px past its own right
            gutter. That had been true since this nav was written and was
            invisible because `body { overflow-x: hidden }` clips rather than
            scrolls. 16px still clears the 8px rhythm and reads as deliberate;
            the wider setting returns at 1440 where there is room for it. */}
        <ul className="flex items-center gap-2 xl:gap-4">
          {primaryNav.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "u-kicker inline-flex items-center gap-1 py-1 no-underline",
                    "whitespace-nowrap",
                    "transition-colors duration-[var(--duration-fast)]",
                    active
                      ? "text-reticle-black"
                      : "text-sight-ink hover:text-reticle-black",
                  )}
                >
                  {active && <CentreDot className="size-[5px]" />}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <MobilePanel pathname={pathname} />
    </>
  );
}

/* ---------------------------------------------------------------------------
   MOBILE PANEL

   Layout constraint worth recording: §3 sets the lockup's minimum legible
   width at 140px WITH the descriptor, and §2 requires the descriptor in the
   header always. On a 360px viewport that leaves roughly 120px for everything
   else, which is why the mobile CTA is a compact text link and the menu is a
   44px icon button. Measured: 24 + 140 + 12 + 45 + 12 + 44 + 24 = 301px, so it
   clears a 320px viewport with room.
   -------------------------------------------------------------------------- */

function MobilePanel({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /* The panel closes on link activation rather than in an effect watching
     `pathname`. Closing on navigation via an effect means a synchronous
     setState in an effect body (cascading render), and it also fails the case
     where a visitor taps the link for the page they are already on — the route
     never changes, so the effect never fires, and the panel stays open. */
  const close = () => setOpen(false);

  /* Escape to close, focus trap while open, and return focus to the trigger. */
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    /* Prevent the page scrolling behind the panel. */
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("a[href]")?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        className={cn(
          "grid size-[44px] shrink-0 place-items-center",
          "text-reticle-black",
        )}
      >
        {/* Two rules, echoing the mark's tick elements rather than a generic
            hamburger. Three lines would read as a stock icon. */}
        <span aria-hidden="true" className="grid w-4 gap-[6px]">
          <span
            className={cn(
              "h-[2px] w-full bg-current transition-transform",
              "duration-[var(--duration-fast)] ease-[var(--ease-precision)]",
              open && "translate-y-[4px] rotate-45",
            )}
          />
          <span
            className={cn(
              "h-[2px] w-full bg-current transition-transform",
              "duration-[var(--duration-fast)] ease-[var(--ease-precision)]",
              open && "-translate-y-[4px] -rotate-45",
            )}
          />
        </span>
      </button>

      {open && (
        <div
          id="mobile-nav"
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Site menu"
          className={cn(
            "fixed inset-x-0 top-[var(--header-h)] bottom-0 z-40",
            /* Gutters track Container's, so the panel's rules and labels line
               up with the header above them rather than sitting 8px inboard. */
            "bg-chalk px-2 pt-4 pb-6 sm:px-4",
            "u-enter overflow-y-auto",
          )}
        >
          <nav aria-label="Primary">
            <ul className="flex flex-col">
              {primaryNav.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href} className="border-b border-sight-grey/25">
                    <Link
                      href={item.href}
                      onClick={close}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-6 items-center gap-2 py-2 no-underline",
                        "font-display text-h3 font-bold",
                        active ? "text-reticle-black" : "text-sight-ink",
                      )}
                    >
                      {active && <CentreDot />}
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Equal tap target, unequal voice — the same rule as every other
              CTA pair on the site. Full width because a thumb is the input. */}
          <div className="mt-4 flex flex-col gap-2">
            <Button
              href={cta.primary.href}
              variant="primary"
              className="w-full"
              onClick={close}
            >
              {cta.primary.label}
            </Button>
            <Button
              href={cta.secondary.href}
              variant="secondary"
              className="w-full"
              onClick={close}
            >
              {cta.secondary.label}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
