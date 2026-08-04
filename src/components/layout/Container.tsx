import { cn } from "@/lib/cn";

/**
 * Horizontal container. Max content width 1280px (spec §6).
 *
 * Gutters widen with the viewport rather than staying fixed — on a 1280px
 * layout, tight gutters make the page read as a web app; generous ones read
 * as a printed prospectus, which is the register we want.
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
        "mx-auto w-full max-w-content px-3 sm:px-4 lg:px-8",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
