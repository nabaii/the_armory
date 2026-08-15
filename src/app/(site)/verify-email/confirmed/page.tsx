import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { routes } from "@/lib/site";

/**
 * Confirmed.
 *
 * The page says what changed and what it bought, because "Success!" tells a
 * member nothing they can act on. What they gained is a second door and a way
 * back, and this is the only moment they are paying attention to it.
 */

export const metadata: Metadata = {
  title: "Email confirmed",
  robots: { index: false, follow: false },
};

export default function EmailConfirmedPage() {
  return (
    <>
      <PageHeader
        ground="teal"
        kicker="Your account"
        title="That address is yours."
        lead="You can now sign in with an email link as well as with your phone and password."
      />

      <Section ground="chalk" rhythm="default">
        <Body className="max-w-[68ch]">
          If you ever forget your password, ask for a sign-in link at{" "}
          <span className="font-medium">Sign in</span> and we will email it to
          you. Your phone number and password keep working exactly as before.
        </Body>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button href={routes.portal} variant="primary">
            Go to your club
          </Button>
          <Button href={routes.portalAccount} variant="secondary">
            Your account
          </Button>
        </div>
      </Section>
    </>
  );
}
