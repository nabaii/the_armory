import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { StatementBlock } from "@/components/sections/StatementBlock";
import { Body, Caption, H2, Kicker } from "@/components/ui/Text";
import { CtaPair } from "@/components/ui/Button";
import { ImageSlot } from "@/components/media/ImageSlot";
import { Pending } from "@/components/ui/Pending";
import { spaces } from "@/content/spaces";
import { cta } from "@/lib/site";

/* ============================================================================
   THE CLUB — spec §3.

   Purpose: "Sell the evening. This page carries the half of the offer a
   range-only site would omit entirely."

   From the Brief: "A range visit is forty-five minutes. An evening here is four
   hours with food and drink attached — and dwell time is where membership
   economics live."

   ----------------------------------------------------------------------------
   THE MOST COMMERCIALLY SIGNIFICANT DETAIL IN THE BUILDING

   Spectating is designed in. The guidelines: "A visitor who does not shoot has
   somewhere to sit, something to drink, and a clear view. This is the most
   commercially significant detail in the building, and the brand should exploit
   it: you can bring people who have no interest in firearms."

   Two consequences, both from the Brief: it roughly doubles the addressable
   party size, and it turns a league night into an event with an audience rather
   than four people taking turns in a lane. The viewing rail therefore gets its
   own section rather than being a line in a paragraph.

   Night photography leads on this page. Per the guidelines, the night register
   "is what sells a membership".

   Success measure: onward click to Membership; time on page.
   ========================================================================= */

export const metadata: Metadata = {
  title: "The club",
  description:
    "The snack bar, the viewing rail, the public deck and the VIP deck at The Armory Shooting Sports Club. Bring someone who doesn't shoot — they have a seat and a view.",
};

export default function TheClubPage() {
  return (
    <>
      <PageHeader
        ground="teal"
        kicker="The club"
        title="An evening, not an appointment."
        lead="Three ranges, a bar that looks onto the firing line, and two decks that are lit after dark. The shooting is the anchor; the evening is the reason people stay."
      />

      {/* The viewing rail, stated explicitly. Spec §3 asks for exactly this:
          "The viewing rail — explicitly stated: bring someone who doesn't
          shoot. They have a seat and a view." */}
      <Section ground="soffit" rhythm="default">
        <StatementBlock
          kicker="Spectating is designed in"
          statement="Bring someone who doesn't shoot."
          support="The bar seating and rail look directly onto the air rifle firing line, and the 50m range has a viewing rail too. Nobody has to stand around holding a coat."
        />
      </Section>

      {/* Each space in its own register — blue for open, teal for VIP. The
          tiering is felt rather than announced, exactly as §4 asks. */}
      {spaces.map((space, i) => (
        <Section key={space.slug} ground={space.register} rhythm="default">
          <div
            className={[
              "grid gap-6 lg:grid-cols-2 lg:items-center lg:gap-8",
              i % 2 === 1 ? "lg:[&>figure]:order-first" : "",
            ].join(" ")}
          >
            <div>
              {/* From the space, not from its position in the list. The index
                  version alternated Inside/Outside down the page and got two
                  of four wrong — see the note on `Space.location`. */}
              <Kicker className="mb-2" muted={false}>
                {space.location === "inside" ? "Inside" : "Outside"}
              </Kicker>
              <H2>{space.name}</H2>
              <Body className="mt-2">{space.summary}</Body>
            </div>
            <figure>
              <ImageSlot
                awaiting={space.awaiting}
                photo={space.photo}
                aspect="landscape"
                layout="half"
              />
            </figure>
          </div>
        </Section>
      ))}

      {/* Capacities and the bar offer are outstanding from Operations. Absent
          rather than estimated — a wrong capacity is a booking problem, not a
          copy problem. */}
      <Section ground="chalk" rhythm="tight">
        <Pending label="Snack bar offer, deck capacities and VIP deck access rules (Operations)" />
        <Caption className="mt-2">
          Capacities and the food and drink offer are published here once
          confirmed. They are absent rather than estimated.
        </Caption>
      </Section>

      <Section ground="charred" rhythm="default">
        <Kicker className="mb-2" muted={false}>
          Membership
        </Kicker>
        <H2>The VIP deck is member territory.</H2>
        <Body muted className="mt-2">
          The public deck and the bar are open to anyone with a booking. The VIP
          deck belongs to the top tier of membership rather than being available
          to book for an evening.
        </Body>
        <CtaPair primary={cta.primary} secondary={cta.secondary} className="mt-4" />
      </Section>
    </>
  );
}
