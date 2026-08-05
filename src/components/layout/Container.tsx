import { cn } from "@/lib/cn";

/**
 * Horizontal container. Max content width 1280px (spec §6).
 *
 * Gutters widen with the viewport rather than staying fixed — on a 1280px
 * layout, tight gutters make the page read as a web app; generous ones read
 * as a printed prospectus, which is the register we want.
 *
 *   < 480   16px
 *   >= 480  32px
 *   >= 1024 48px
 *   >= 1440 64px
 *
 * The 16px step below `sm` is the same principle applied at the other end
 * rather than an exception to it. At 320px, 24px gutters spend 15% of the
 * screen on margin and leave 272px of content — which is where the header
 * ran out of room for the lockup, the menu button and the Apply link at once
 * (see the budget in Header.tsx). Generous gutters signal premium on a
 * prospectus page; on a 320px phone they just make the content column narrow,
 * and a cramped column is not a premium signal.
 *
 * The 48px step at `lg` exists for the same reason at the top end. 64px
 * gutters spend 128px at exactly 1024px, which is the one width where the
 * header has to seat the lockup, five nav items and the Apply CTA on one
 * line — and it could not. Above 1280px the container is capped anyway, so
 * the visible margin keeps growing regardless of this value; the step only
 * ever bites in the 1024-1439 band where the space is genuinely contested.
 */
export function Container({
  children,
  className,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "header" | "footer" | "section" | "nav" | "main";
}) {
  return (
    <Tag
      className={cn(
        "mx-auto w-full max-w-content px-2 sm:px-4 lg:px-6 xl:px-8",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
