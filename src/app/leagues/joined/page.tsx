import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, Caption } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { routes } from "@/lib/site";

export const metadata: Metadata = {
  title: "You are on the waitlist",
  robots: { index: false, follow: false },
};

/**
 * Leagues waitlist confirmation.
 *
 * Promises exactly what was promised on the form and nothing more — §9 requires
 * the Leagues page to "promise nothing that Phase 2 will not deliver", and a
 * confirmation page is the easiest place to accidentally over-promise. No launch
 * date, because none has been set. One email, when it opens.
 */
export default function WaitlistJoinedPage() {
  return (
    <>
      <PageHeader
        ground="charred"
        kicker="Leagues waitlist"
        title="You are on the list."
        lead="We will email you once, when Leagues opens. Nothing else."
      />

      <Section ground="chalk" rhythm="default">
        <Body muted>
          Leagues follows the opening of the club rather than the other way round.
          It needs enough members for a season to be worth playing, which is also
          why founding members get first access.
        </Body>
        <Body className="mt-3">
          If you would rather be inside the founding cohort than on a waitlist,
          that is a different conversation — and a short one.
        </Body>
        <Button href={routes.membership} variant="primary" className="mt-3">
          What membership includes
        </Button>
        <Caption className="mt-3">
          You can ask us to remove your address at any time. See our{" "}
          <a
            href={routes.privacy}
            className="underline decoration-1 underline-offset-2"
          >
            privacy policy
          </a>
          .
        </Caption>
      </Section>
    </>
  );
}
