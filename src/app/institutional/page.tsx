import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, Caption, H2, Kicker } from "@/components/ui/Text";
import { Pending, Resolved } from "@/components/ui/Pending";
import { contact } from "@/lib/site";

/* ============================================================================
   INSTITUTIONAL & PROFESSIONAL TRAINING — UNLISTED.

   Spec §2 sitemap: "(unlisted) — Institutional & corporate training". And:
   "The institutional page is unlisted and sent after a meeting — it is not
   linked from navigation."

   Flow C: "An unlisted capability page may be sent after an initial
   conversation. This audience is won in person."

   ----------------------------------------------------------------------------
   RULES FOR THIS ROUTE

   · noindex, nofollow, nosnippet. Set below.
   · Not linked from the header, the footer, or any public page.
   · Not in sitemap.xml. See src/app/sitemap.ts.
   · NOT listed in robots.txt — see the note in src/app/robots.ts. Adding a
     Disallow line for a private path publishes that path, because robots.txt is
     itself a public document.
   · No public pricing, per Flow C.

   ----------------------------------------------------------------------------
   WHY THERE IS NO CAPABILITY COPY HERE

   Nothing in the three source documents describes what training the club
   actually offers, to whom, or to what standard. Writing that would be
   invention, and inventing capability claims for private security and
   close-protection clients is the worst possible place to do it — this is the
   audience that verifies, and the claim would be trading on the club's
   licensing and safety posture.

   So the page is a shell with a named contact. Capability content is owned by
   the Founder and lands after the conversation that defines it.

   RECOMMENDATION: if this page ever carries genuine capability, programme or
   client detail, it should move behind a signed token or basic auth rather than
   relying on an unlisted URL. An unlisted URL is not access control — it is
   only obscurity, and it survives exactly until someone forwards the link.
   ========================================================================= */

export const metadata: Metadata = {
  title: "Institutional & professional training",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    nosnippet: true,
    noarchive: true,
  },
};

export default function InstitutionalPage() {
  return (
    <>
      <PageHeader
        ground="charred"
        kicker="By arrangement"
        title="Institutional & professional training"
        lead="This page is shared directly rather than published. It is not linked from our website and does not appear in search."
      />

      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Capability</Kicker>
        <H2>Programme detail</H2>
        <div className="mt-3">
          <Pending label="Institutional training capability, programmes and standards (Founder) — not drafted by the build team" />
        </div>
        <Caption className="mt-3 max-w-[68ch]">
          Deliberately not written speculatively. Capability claims for
          professional training touch on licensing and safety posture, and this
          is the audience that verifies them.
        </Caption>
      </Section>

      <Section ground="charred" rhythm="default">
        <Kicker className="mb-2" muted={false}>
          Contact
        </Kicker>
        <H2>Speak to us directly</H2>
        <Body muted className="mt-2">
          Requirements are discussed in person. There is no enquiry form for this
          route, and no pricing is published.
        </Body>
        <div className="mt-4">
          <Resolved
            value={
              contact.institutional
                ? `${contact.institutional.name} — ${contact.institutional.phone}`
                : null
            }
            label="Institutional contact: named person and direct number (Founder)"
            render={(v) => (
              <p className="font-display text-h3 font-bold text-[var(--ink)]">
                {v}
              </p>
            )}
          />
        </div>
      </Section>
    </>
  );
}
