import type { Metadata } from "next";
import { Section } from "@/components/layout/Section";
import { CtaPair } from "@/components/ui/Button";
import { Body, H1, Kicker } from "@/components/ui/Text";
import { cta } from "@/lib/site";

/**
 * Custom 404.
 *
 * This page exists for a brand reason as much as a UX one. Next's built-in
 * not-found styles are injected inline as `body{color:#000;background:#fff}`
 * plus a `prefers-color-scheme: dark` block that inverts to pure black.
 *
 * Brand Guidelines §11 prohibits both: "Pure black, cool greys, and any palette
 * drift toward gunmetal" heads the list of things to avoid, and the brand has
 * no dark mode — dark sections are Charred Timber, chosen deliberately, not an
 * inversion triggered by an OS setting. Defining this route replaces those
 * defaults entirely.
 *
 * Voice: assured and spare. No apology, no exclamation mark, no hype.
 */
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <Section ground="chalk" rhythm="default">
      <Kicker className="mb-3">404</Kicker>
      <H1>That page isn&rsquo;t here.</H1>
      <Body muted className="mt-3">
        It may have moved, or the link may be incomplete. The club, the ranges
        and the first visit are all a step away.
      </Body>
      <CtaPair primary={cta.primary} secondary={cta.secondary} className="mt-4" />
    </Section>
  );
}
