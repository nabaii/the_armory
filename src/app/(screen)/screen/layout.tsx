import type { Metadata } from "next";

/**
 * THE LIVE SCREEN — no site chrome.
 *
 * §5: this is "the only element of Leagues that genuinely requires software at
 * launch… what makes the tournament feel like an event rather than four people
 * writing numbers on paper."
 *
 * It is a television on a wall above the air rifle line, watched from the rail
 * and the bar seating. There is no navigation because there is nobody
 * navigating: no header, no footer, no skip link. The chrome lives in
 * `(site)/layout.tsx` and this group deliberately sits outside it.
 *
 * `noindex` throughout — a kiosk display has no business in search results, and
 * it shows player names.
 */
export const metadata: Metadata = {
  title: "Live",
  robots: { index: false, follow: false, nocache: true, nosnippet: true },
};

export default function ScreenLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="flex min-h-dvh flex-col bg-charred-timber">{children}</div>;
}
