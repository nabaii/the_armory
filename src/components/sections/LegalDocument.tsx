import { Section } from "@/components/layout/Section";
import { Body, Caption, H1, H2, Kicker } from "@/components/ui/Text";
import { Pending } from "@/components/ui/Pending";
import { CentreDot } from "@/components/brand/Reticle";

/* ============================================================================
   LEGAL DOCUMENT SHELL

   Legal copy is outstanding from counsel (spec §8, owner: Legal) and it is not
   the build team's to write. Rather than leave three empty routes, each page
   renders its own required-contents brief — so the shell is useful to whoever
   drafts it, and unmistakably unfinished to everyone else.

   Nothing here is drafting. A privacy policy that looks plausible but was
   written by a developer is worse than an obviously absent one: it creates the
   appearance of compliance under the Nigeria Data Protection Act without any of
   the substance, and it is exactly the kind of page nobody re-reads before
   launch.

   `npm run gate:launch` blocks while the `legal` item is unresolved.
   ========================================================================= */

export function LegalDocument({
  title,
  purpose,
  requiredContents,
  note,
}: {
  title: string;
  /** What this document is for, in one sentence. */
  purpose: string;
  /** What counsel must cover. Derived from the specification, not invented. */
  requiredContents: readonly string[];
  note?: string;
}) {
  return (
    <>
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-3">Legal</Kicker>
        <H1>{title}</H1>
        <Body muted className="mt-3">
          {purpose}
        </Body>

        <div className="mt-6">
          <Pending label={`${title} — drafting outstanding (Legal)`} />
        </div>
      </Section>

      <Section ground="terrazzo" rhythm="default">
        <Kicker className="mb-2">Required contents</Kicker>
        <H2>What this document must cover.</H2>
        <Body muted className="mt-2">
          Drawn from the Design Specification and the Brief. This is a brief for
          counsel, not a draft.
        </Body>

        <ul className="mt-4 flex flex-col gap-2">
          {requiredContents.map((item) => (
            <li key={item} className="flex gap-2 text-body">
              <CentreDot className="mt-[0.6em] size-[5px] shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        {note && (
          <Caption className="mt-4 max-w-[68ch]">{note}</Caption>
        )}
      </Section>
    </>
  );
}
