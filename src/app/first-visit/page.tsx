import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { StepSequence } from "@/components/sections/StepSequence";
import { StatementBlock } from "@/components/sections/StatementBlock";
import { BookingModule } from "@/components/sections/BookingModule";
import { Body, Caption, H2, H3, Kicker } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { Pending } from "@/components/ui/Pending";
import { ImageSlot } from "@/components/media/ImageSlot";
import { CentreDot } from "@/components/brand/Reticle";
import { ritual, whatToBring } from "@/content/ritual";
import { contact, routes } from "@/lib/site";

/* ============================================================================
   THE FIRST VISIT — spec §3.

   Purpose, verbatim: "Remove fear. This is the highest-leverage page on the
   site for the growth segment — women, first-timers, couples, corporate
   groups."

   The Brief: "Anxiety is the conversion killer." Everything on this page is
   ordered to reduce it, and the tone rule from the guidelines is doing most of
   the work — safety is "stated with calm authority, not alarm".

   Access register: Soffit Blue. This is the open, welcoming context, and the
   colour does that job before a word is read.

   Success measure: booking completion rate; deposit capture; no-show rate.
   ========================================================================= */

export const metadata: Metadata = {
  title: "The first visit",
  description:
    "Your first visit to The Armory Shooting Sports Club. No experience, licence or equipment needed — everything is provided, and a range officer is with you throughout.",
};

export default function FirstVisitPage() {
  return (
    <>
      {/* -------------------------------------------- 1. REASSURANCE HEADLINE */}
      <PageHeader
        ground="soffit"
        kicker="Your first visit"
        title="No experience. No licence. No equipment."
        lead="Everything is provided and a range officer is with you throughout. Most people who shoot here had never held a rifle before their first visit."
      />

      {/* ------------------------------------------------------- 2. THE RITUAL */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Step by step</Kicker>
        <H2>What actually happens.</H2>
        <Body muted className="mt-2">
          In order, from the moment you arrive. Nothing here is a surprise on the
          day.
        </Body>
        <StepSequence steps={ritual} className="mt-6" />
      </Section>

      {/* ------------------------------------- 3. WHAT TO WEAR AND BRING */}
      <Section ground="terrazzo" rhythm="default">
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
          <div>
            <Kicker className="mb-2">Practical</Kicker>
            <H2>What to wear and bring.</H2>
            <ul className="mt-4 flex flex-col gap-2">
              {whatToBring.map((item) => (
                <li key={item} className="flex gap-2 text-body">
                  <CentreDot className="mt-[0.6em] shrink-0 size-[5px]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <ImageSlot
            awaiting="Equipment still life — precision objects, neutral ground, warm side light (day)"
            aspect="landscape"
            layout="half"
          />
        </div>
      </Section>

      {/* ------------------------------------------------------------ 4. SAFETY
          "Stated with calm authority, not alarm." Facts in sequence, no
          warnings, no bold red anything. The hospitality framing does the work:
          everything is provided, so nothing needs to be brought — which is
          also what makes the safety story airtight. */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Safety</Kicker>
        <H2>Nothing comes in, and nothing goes out.</H2>
        <div className="mt-4 grid gap-6 lg:grid-cols-3 lg:gap-4">
          <div>
            <H3>Range-owned only</H3>
            <Body muted className="mt-1">
              Every firearm belongs to the range and stays on site. You are never
              asked to own, licence, transport or store anything.
            </Body>
          </div>
          <div>
            <H3>Always supervised</H3>
            <Body muted className="mt-1">
              A range officer is on the line for the whole session. Nobody shoots
              unsupervised, including members.
            </Body>
          </div>
          <div>
            <H3>Issued and returned</H3>
            <Body muted className="mt-1">
              Equipment and ammunition are issued for your session and returned
              at the end of it. Protection for eyes and ears is provided.
            </Body>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------ 5. WHO IT IS FOR
          Spec: "Explicitly names beginners, groups and non-shooters." The
          growth segment must see itself on this page. */}
      <Section ground="soffit" rhythm="default">
        <StatementBlock
          kicker="Who it is for"
          statement="Bring someone who doesn't shoot."
          support="The bar seating looks directly onto the air rifle firing line, so a friend or partner with no interest in any of this has a seat, a drink and a clear view. Beginners, couples, groups and colleagues are all normal here."
        />
      </Section>

      {/* ------------------------------------------- 6. PRICING AND DEPOSIT
          Spec: "Pricing. Visible. Deposit terms and refund policy stated
          plainly." And §9: refund and deposit terms appear BEFORE payment is
          taken — so they are on this page, not inside the payment step. */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">Price and deposit</Kicker>
        <H2>What it costs.</H2>
        <div className="mt-3">
          <Pending label="First-visit price, deposit amount and refund policy wording (Founder) — blocks the booking flow" />
          <Caption className="mt-2 max-w-[68ch]">
            Price is shown here plainly, along with the deposit and what happens
            if you need to change or cancel. Spec §9 requires these terms to
            appear before any payment is taken, and the policy version in force
            is stored against every booking.
          </Caption>
        </div>
      </Section>

      {/* --------------------------------------------------- 7. BOOKING MODULE
          Slot selection, party size, deposit terms, then a Paystack deposit.
          Target is under three minutes on a mobile device.

          The module refuses to render a payment form it cannot honour — with no
          published price or refund policy it degrades to a phone number instead.
          See BookingModule. */}
      <Section ground="terrazzo" rhythm="default" id="book">
        <Kicker className="mb-2">Book</Kicker>
        <H2>Choose a session.</H2>
        <div className="mt-4">
          <BookingModule />
        </div>

        {/* A booking or gateway outage must degrade to a phone call rather than
            a lost booking. The number is deliberately on the page, not hidden
            behind an error state that only appears once something has failed. */}
        {/* Only offered when there is a number to offer. `Pending` renders
            nothing in production, so asking someone to call and then showing
            no number is an instruction the page cannot fulfil. */}
        {contact.bookingsPhone ? (
          <Caption className="mt-4">
            Prefer to book by phone, or having trouble with the form?{" "}
            <a
              href={`tel:${contact.bookingsPhone.replace(/\s/g, "")}`}
              className="underline decoration-1 underline-offset-2"
            >
              Call {contact.bookingsPhone}
            </a>
          </Caption>
        ) : (
          <Caption className="mt-4">
            <Pending label="Bookings phone number (Founder)" />
          </Caption>
        )}
      </Section>

      {/* -------------------------------------------- 8. SOFT MEMBERSHIP BRIDGE
          "No hard sell before the experience." One line, one quiet CTA. */}
      <Section ground="chalk" rhythm="tight">
        <Body>
          Many of our members started with a first visit. There is no need to
          decide anything before you have been.
        </Body>
        <Button href={routes.membership} variant="secondary" className="mt-3">
          What membership includes
        </Button>
      </Section>
    </>
  );
}
