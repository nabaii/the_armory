import type { Metadata } from "next";
import Link from "next/link";
import { Section } from "@/components/layout/Section";
import { Body, Caption, H1, H2, Kicker, Lead } from "@/components/ui/Text";
import { Hero } from "@/components/sections/Hero";
import { StatementBlock, Proposition } from "@/components/sections/StatementBlock";
import { StepSequence } from "@/components/sections/StepSequence";
import { DisciplineGrid } from "@/components/sections/DisciplineCard";
import { SpecificationTable } from "@/components/sections/SpecificationTable";
import { TierComparison } from "@/components/sections/TierComparison";
import { LegitimacyStrip } from "@/components/sections/LegitimacyStrip";
import { WaitlistCapture } from "@/components/sections/WaitlistCapture";
import { ImageGrid } from "@/components/media/ImageSlot";
import {
  Field,
  FormStatus,
  SelectInput,
  SubmitButton,
  TextArea,
  TextInput,
} from "@/components/ui/Form";
import { disciplines } from "@/content/disciplines";
import { ritual } from "@/content/ritual";
import { RemedyStack } from "@/components/member/RemedyCard";
import { StatusPill } from "@/components/member/StatusPill";
import { AllowanceMeter } from "@/components/member/AllowanceMeter";
import { ScoreLine } from "@/components/member/ScoreLine";
import { ProgrammeLine } from "@/components/member/ProgrammeLine";
import { fixtureCredentials, fixtureTiers } from "@/lib/fixtures";
import { cta, routes, site } from "@/lib/site";

/* ============================================================================
   COMPONENT REFERENCE — internal.

   The spec §5 inventory, rendered with real or clearly-scaffolded content, so
   the whole team can review behaviour rather than read about it. Every image
   slot shows its reserved frame, which is what these components look like today
   and until the shoot lands.
   ========================================================================= */

export const metadata: Metadata = {
  title: "Component reference",
  robots: { index: false, follow: false, nocache: true },
};

export default function ComponentsPage() {
  return (
    <>
      <Section ground="chalk" rhythm="tight">
        <Kicker className="mb-2">Internal reference · not indexed</Kicker>
        <H1>Components</H1>
        <Lead muted className="mt-2">
          The Design Specification §5 inventory. Content is real where the source
          documents supply it, and visibly scaffolded where it is still
          outstanding.
        </Lead>
        <Body className="mt-2">
          <Link href="/brand" className="underline decoration-1 underline-offset-4">
            Design system reference
          </Link>
        </Body>
      </Section>

      {/* ---------------------------------------------------------------- HERO */}
      <Ref
        n="01"
        name="Hero"
        note="No photograph yet, so the typographic register renders. With a photograph it becomes full-bleed with the derived Charred Timber scrim — a proven 7.32:1 for Chalk text against the worst possible frame."
      />
      <Hero
        headline="Built to international competition standard."
        subline="A private shooting sports club at the Abuja National Stadium. No experience needed — everything is provided."
        kicker={site.location}
        primary={cta.primary}
        secondary={cta.secondary}
        awaiting="Hero — reception & lockup wall (day register)"
      />

      {/* ----------------------------------------------------------- STATEMENT */}
      <Ref
        n="02"
        name="Statement block + Proposition"
        note="The reframe moment. Plain ground, no device, no photography — whitespace is the effect."
      />
      <Section ground="chalk">
        <StatementBlock
          kicker="The idea"
          statement="Sport and precision, not combat."
          support="Everything is provided. You arrive with nothing, and you are never on the line alone."
        />
        <Proposition
          className="mt-8"
          items={[
            { label: "Competition standard", detail: "Built to national and international specification." },
            { label: "Everything provided", detail: "Range-owned firearms only. Nothing enters the facility." },
            { label: "Professional supervision", detail: "A range officer is with you throughout." },
            { label: "At the National Stadium", detail: "Abuja, FCT." },
          ]}
        />
      </Section>

      {/* ------------------------------------------------------- STEP SEQUENCE */}
      <Ref
        n="03"
        name="Step sequence"
        note="The most important content component on the site. Lane numerals borrowed from the building's own firing-point signage. Semantic ordered list; the visible numeral is decorative."
      />
      <Section ground="soffit">
        <Kicker className="mb-2" muted={false}>
          The open register — Soffit Blue
        </Kicker>
        <H2>What happens on your first visit</H2>
        <StepSequence steps={ritual} className="mt-4" />
      </Section>

      {/* ------------------------------------------------------- DISCIPLINES */}
      <Ref
        n="04"
        name="Discipline card + grid"
        note="Facts, not adjectives. Air rifle takes the featured variant — most beginner-accessible, the Leagues home, and the only line that scores itself. The two pistol lines omit lane count rather than render a zero."
      />
      <Section ground="chalk">
        <DisciplineGrid disciplines={disciplines} />
      </Section>

      {/* --------------------------------------------------------- SPEC TABLE */}
      <Ref
        n="05"
        name="Specification table"
        note="Tabular numerals applied at the stylesheet level so they cannot be forgotten. Scrolls inside its own labelled, focusable region — the page body never scrolls sideways."
      />
      <Section ground="terrazzo">
        <SpecificationTable
          caption="10m air rifle — specification"
          rows={[
            { label: "Distance", value: "10 m" },
            { label: "Lanes", value: "8" },
            { label: "Targeting", value: "Automatic" },
            { label: "Scoring", value: "Machine-verified" },
            { label: "Setting", value: "Indoor" },
            { label: "Spectating", value: "Bar seating and viewing rail" },
          ]}
        />
        <Caption className="mt-2">
          Remaining rows — safety systems and targeting technology per discipline
          — are outstanding from Operations.
        </Caption>
      </Section>

      {/* --------------------------------------------------------------- TIERS */}
      <Ref
        n="06"
        name="Tier comparison"
        note="Prices are structurally impossible: Tier.price is a literal type with one legal value. Names below are the Brief's assumed structure, not the founder's decisions. The top tier carries VIP Teal — the colour of the actual deck furniture."
      />
      <Section ground="chalk">
        <TierComparison tiers={fixtureTiers} />
      </Section>

      {/* -------------------------------------------------------- LEGITIMACY */}
      <Ref
        n="07"
        name="Legitimacy strip"
        note="Filters on trueOnDayOne. The fixture includes 'Host of the national championships' — deliberately absent from the output below, because it is not yet true."
      />
      <Section ground="chalk" rhythm="tight">
        <LegitimacyStrip credentials={fixtureCredentials} />
      </Section>

      {/* ------------------------------------------------------ IMAGE + GRID */}
      <Ref
        n="08"
        name="Image + caption, two and three-up"
        note="Every slot names the shot it awaits and derives its own `sizes` from the column count, so a three-up grid cannot request full-width files."
      />
      <Section ground="chalk">
        <ImageGrid
          columns={3}
          items={[
            { awaiting: "Air rifle bar seating (both registers)", caption: "The viewing rail. Bring someone who doesn't shoot." },
            { awaiting: "Public deck (night register)", caption: "Lit after dark." },
            { awaiting: "VIP deck (night register)", caption: "Lounge seating and canopies." },
          ]}
        />
      </Section>

      {/* ---------------------------------------------------------------- FORM */}
      <Ref
        n="09"
        name="Form"
        note="Label, hint and error association derived from the field name so they cannot drift. Errors carry an icon and explicit text, never colour alone — red is the brand accent, and error text uses Ten Ring Deep at 5.25:1 rather than Ten Ring Red at 3.79:1."
      />
      <Section ground="chalk">
        <form className="flex max-w-[34rem] flex-col gap-3">
          <Field name="demo-name" label="Full name" required>
            {(ids) => <TextInput ids={ids} autoComplete="name" />}
          </Field>

          <Field
            name="demo-email"
            label="Email address"
            hint="We reply to applications from a named person, not an inbox."
            required
          >
            {(ids) => <TextInput ids={ids} type="email" autoComplete="email" />}
          </Field>

          <Field
            name="demo-tier"
            label="Tier of interest"
            error="Choose a tier so we can route your application to the right person."
            required
          >
            {(ids) => (
              <SelectInput
                ids={ids}
                placeholder="Select a tier"
                options={fixtureTiers.map((t) => ({ value: t.slug, label: t.name }))}
              />
            )}
          </Field>

          <Field name="demo-note" label="Anything you would like us to know">
            {(ids) => <TextArea ids={ids} />}
          </Field>

          <SubmitButton className="self-start">Submit application</SubmitButton>
        </form>

        <div className="mt-6 flex flex-col gap-3">
          <FormStatus tone="success" heading="Your application is with us.">
            A named member of the club will be in touch within two working days
            to arrange a tour or a first visit.
          </FormStatus>
          <FormStatus tone="error" heading="We could not submit that.">
            Check the highlighted field and try again. If it keeps failing,
            please call us.
          </FormStatus>
        </div>
      </Section>

      {/* ------------------------------------------------------------ WAITLIST */}
      <Ref
        n="10"
        name="Waitlist capture"
        note="One field, per spec §3 — 'nothing else'. Carries a source for the waitlist-to-application conversion measure, a honeypot, and consent language, because a waitlist is personal data."
      />
      <Section ground="charred">
        <Kicker className="mb-2" muted={false}>
          Leagues — Phase 2
        </Kicker>
        <H2>Founding members get first access.</H2>
        <Body muted className="mt-2">
          Friends form a league, shoot a standard air rifle round, and standings
          update automatically. Scores come straight off the automatic targeting
          system, so they are machine-verified.
        </Body>
        <WaitlistCapture source="component-reference" className="mt-4" />
      </Section>

      {/* ==================================================================
          THE MEMBERS APP — Members Portal Design Specification §11.

          "All five belong in the existing component inventory at
           /brand/components so they can be reviewed against the palette page
           rather than discovered in situ."

          Rendered with fixture content, on the grounds they actually appear on.
          MembersShell is the one absentee and deliberately so: it is a sticky
          header with a tab bar, and a second one on this page would overlay the
          real one and be reviewed in a state it never occupies.
          ================================================================== */}

      <Ref
        n="11"
        name="StatusPill"
        note="Clear · attention · blocked. Shared with the desk console, because a member told they are clear must not stand in front of an officer whose screen says otherwise. Three signals — glyph, fill, word — so it survives greyscale, sunlight and a phone held at arm's length."
      />
      <Section ground="chalk">
        <div className="flex flex-wrap gap-2">
          <StatusPill status="clear" />
          <StatusPill status="attention" />
          <StatusPill status="blocked" />
          <StatusPill status="attention" label="Not opened" />
        </div>
      </Section>

      <Ref
        n="12"
        name="RemedyCard"
        note="Renders one refusal from the capability service — reason, remedy, action. It takes a sentence and nothing you could pass it would let it decide anything, which is how P1 is enforced by a type signature rather than by a code review. Today's action stack is this component in a loop."
      />
      <Section ground="chalk">
        <RemedyStack
          items={[
            {
              reason: "Your membership lapsed on 14 March.",
              remedy: "Renew in the portal.",
              status: "blocked",
              action: { href: routes.portalAccount, label: "Renew your membership" },
            },
            {
              reason: "Firearm licence expires 12 October 2026.",
              remedy: "Send the club your renewed licence before it lapses.",
              status: "attention",
            },
          ]}
        />
      </Section>

      <Ref
        n="13"
        name="AllowanceMeter"
        note="What remains, and when the period turns. The overage price is shown ONLY at confirmation — §7.4 is explicit that a member doing mental arithmetic invites fewer people, and invitations are the only growth channel the club has. Both states are below; the first is what Me and booking step four render."
      />
      <Section ground="chalk">
        <AllowanceMeter
          className="max-w-[36rem]"
          remaining={4}
          included={6}
          periodEnd={new Date("2027-01-31T00:00:00.000Z")}
        />
        <div className="mt-8 border-t border-[var(--rule)]/30 pt-6">
          <Caption className="mb-2 block">At confirmation, with an overage:</Caption>
          <AllowanceMeter
            className="max-w-[36rem]"
            remaining={0}
            included={6}
            periodEnd={new Date("2027-01-31T00:00:00.000Z")}
            overage={{ count: 2, price: "the guest rate" }}
          />
        </div>
      </Section>

      <Ref
        n="14"
        name="ScoreLine"
        note="One round: score, discipline, date, and its relation to the member's own history — which is the field that makes the other three worth rendering. A personal best gets one word and the centre dot. No confetti: a good club, not a mobile game."
      />
      <Section ground="chalk">
        <div className="flex flex-col gap-6">
          <ScoreLine
            score={{
              reads: "578",
              discipline: "10m air rifle",
              formatLabel: "60 shots",
              capturedAt: new Date("2026-08-11T18:30:00.000Z"),
              relation: "Up 14 on your last twelve.",
              isPersonalBest: true,
            }}
          />
          <ScoreLine
            score={{
              reads: "541",
              discipline: "10m air rifle",
              formatLabel: "60 shots",
              capturedAt: new Date("2026-07-28T18:30:00.000Z"),
              relation: null,
              superseded: true,
            }}
          />
        </div>
      </Section>

      <Ref
        n="15"
        name="ProgrammeLine"
        note="One thing that is on, shared by Today's Tonight card and the Diary's day list. A closure is the only kind that carries a pill — it is the single entry whose consequence is a member NOT driving to the National Stadium, and giving every kind a colour would make it ordinary."
      />
      <Section ground="soffit">
        <ul className="flex flex-col gap-3">
          <li>
            <ProgrammeLine
              entry={{
                kind: "service",
                title: "Range and deck",
                detail: null,
                startsMinute: 9 * 60,
                endsMinute: 21 * 60,
                staffed: true,
              }}
            />
          </li>
          <li>
            <ProgrammeLine
              entry={{
                kind: "service",
                title: "Club open",
                detail: "No range officer on the floor.",
                startsMinute: 12 * 60,
                endsMinute: 22 * 60,
                staffed: false,
              }}
            />
          </li>
          <li>
            <ProgrammeLine
              entry={{
                kind: "event",
                title: "Guest evening",
                detail: null,
                startsMinute: 18 * 60,
                endsMinute: 21 * 60,
                staffed: false,
              }}
            />
          </li>
          <li>
            <ProgrammeLine
              entry={{
                kind: "closure",
                title: "Closed — public holiday",
                detail: null,
                startsMinute: null,
                endsMinute: null,
                staffed: false,
              }}
            />
          </li>
        </ul>
      </Section>
    </>
  );
}

/** Divider naming each component under review. */
function Ref({ n, name, note }: { n: string; name: string; note: string }) {
  return (
    <Section ground="chalk" rhythm="tight">
      <div className="border-t-2 border-reticle-black pt-2">
        <Kicker muted={false}>
          {n} — {name}
        </Kicker>
        <Caption className="mt-1 max-w-[68ch]">{note}</Caption>
      </div>
    </Section>
  );
}
