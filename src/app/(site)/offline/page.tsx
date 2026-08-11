import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, Kicker } from "@/components/ui/Text";
import { routes } from "@/lib/site";
import { Button } from "@/components/ui/Button";

/**
 * The offline fallback, served by the service worker when a page is requested
 * with no network and nothing cached for it.
 *
 * It is a real route rather than a string of HTML inside sw.js so that it
 * carries the header, the tab bar and the footer. That matters more than it
 * sounds: an installed app that drops to a bare error page has visibly stopped
 * being an app, whereas one that keeps its chrome and explains itself has
 * simply lost signal — which is the truth, and is what a member standing in a
 * basement range needs to be told.
 *
 * `noindex`: this page is meaningless to a stranger arriving from search, and
 * it would compete with real pages for the same queries.
 */
export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <>
      <PageHeader
        kicker="No connection"
        title="You are offline"
        lead="This page has not been opened on this device yet, so there is nothing stored to show you. Reconnect and it will load normally."
      />

      <Section ground="terrazzo" rhythm="tight">
        <Kicker className="mb-2">What still works</Kicker>
        <Body muted className="u-measure">
          Pages you have already visited on this device will open without a
          connection. Anything showing your membership, your bookings or a live
          league will not — those are never stored on the phone, so that a lost
          or shared handset cannot hand someone else your account.
        </Body>

        <div className="mt-4">
          <Button href={routes.home} variant="secondary">
            Back to the home page
          </Button>
        </div>
      </Section>
    </>
  );
}
