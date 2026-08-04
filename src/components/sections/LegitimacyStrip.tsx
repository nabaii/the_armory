import { cn } from "@/lib/cn";
import { Caption, Kicker } from "@/components/ui/Text";
import { Pending } from "@/components/ui/Pending";
import type { Credential } from "@/lib/content";

/* ============================================================================
   LEGITIMACY STRIP — spec §5: "Affiliation and credential row."

   Job on the page (spec §3): carry institutional legitimacy, for members, for
   sporting bodies and for stakeholders. It is the block that makes the site a
   credibility anchor rather than a brochure.

   ----------------------------------------------------------------------------
   CLAIMS DISCIPLINE IS THE ENTIRE COMPONENT

   Both source documents raise this twice, in the same words. Spec §3: "'Built
   to international competition standard' is a credibility claim true from
   opening. 'Host of the national championships' is a fact that can only be
   published once it has happened. Do not spend a claim that cannot yet be
   cashed — the audience that matters will check."

   So this component filters on `trueOnDayOne` and renders nothing else. An
   aspirational credential is not rendered at reduced prominence or hedged with
   "coming soon" — it is absent. The institutional audience is precisely the one
   that verifies, and this is the block they will verify.

   Every credential also carries internal `evidence`, which is never published.
   A claim nobody can substantiate is not a credential, and requiring the field
   means the question is asked while the content is being written rather than
   during a phone call with a sporting body.
   ========================================================================= */

export function LegitimacyStrip({
  credentials,
  className,
}: {
  credentials: readonly Credential[];
  className?: string;
}) {
  const publishable = credentials.filter((c) => c.trueOnDayOne);

  if (publishable.length === 0) {
    return (
      <div className={cn("border-t border-[var(--rule)]/30 pt-3", className)}>
        <Pending label="Affiliations and certifications, with evidence (Founder)" />
        <Caption className="mt-2">
          Nothing renders here until a credential is true on the day it appears.
          The competition-standard claim stands on its own and does not need
          this strip to be populated.
        </Caption>
      </div>
    );
  }

  return (
    <div className={cn("border-t border-[var(--rule)]/30 pt-3", className)}>
      <Kicker className="mb-2">Standing</Kicker>
      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        {publishable.map((credential) => (
          <li
            key={credential.label}
            className="text-body font-bold text-[var(--ink)]"
          >
            {credential.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
