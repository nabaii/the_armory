import type { Metadata } from "next";
import { Section, groundNames, isSingleInk } from "@/components/layout/Section";
import { Button, CtaPair } from "@/components/ui/Button";
import {
  Body,
  Caption,
  Data,
  Display,
  H1,
  H2,
  H3,
  Kicker,
  LaneNumeral,
  Lead,
  SegmentedRule,
} from "@/components/ui/Text";
import { Lockup } from "@/components/brand/Lockup";
import { ConcentricRings, Reticle } from "@/components/brand/Reticle";
import {
  auditRequiredPairs,
  contrast,
  level,
  palette,
  round,
  type PaletteName,
} from "@/lib/contrast";
import { contentGate, gateSummary } from "@/lib/content-gate";
import { cta } from "@/lib/site";

/* ============================================================================
   DESIGN SYSTEM REFERENCE — internal.

   Not a public page. Its purpose is to make the system inspectable by the
   whole team and signable-off by the founder, and to keep the documented
   contrast figures honest: every ratio here is COMPUTED from the same palette
   the components use, so it cannot drift from the tokens.
   ========================================================================= */

export const metadata: Metadata = {
  title: "Design system reference",
  robots: { index: false, follow: false, nocache: true },
};

/* Grounds paired with the ink they actually carry, for the swatch matrix. */
const GROUND_INK: Record<string, { bg: PaletteName; inks: PaletteName[] }> = {
  chalk: { bg: "chalk", inks: ["reticle-black", "sight-ink", "sight-grey", "ten-ring-deep", "ten-ring-red"] },
  terrazzo: { bg: "terrazzo", inks: ["reticle-black", "sight-ink", "sight-grey", "ten-ring-deep"] },
  "charred-timber": { bg: "charred-timber", inks: ["chalk", "terrazzo", "deck-oak", "soffit-blue", "gabion-stone", "ten-ring-red"] },
  "range-teak": { bg: "range-teak", inks: ["chalk", "terrazzo"] },
  "vip-teal": { bg: "vip-teal", inks: ["chalk", "terrazzo", "soffit-blue"] },
  "soffit-blue": { bg: "soffit-blue", inks: ["reticle-black", "chalk", "sight-ink"] },
};

export default function BrandPage() {
  const gate = gateSummary();
  const audit = auditRequiredPairs();

  return (
    <>
      {/* ------------------------------------------------------------- HEADER */}
      <Section ground="chalk" rhythm="tight">
        <Kicker className="mb-2">Internal reference · not indexed</Kicker>
        <H1>Design system</H1>
        <Lead muted className="mt-2">
          Tokens, grounds, type and devices, derived from the Brand Guidelines
          and Design Specification. Every contrast ratio on this page is
          computed from the live palette, not transcribed.
        </Lead>
      </Section>

      {/* ------------------------------------------------------------- LOCKUP */}
      <Section ground="terrazzo" rhythm="default">
        <Kicker className="mb-2">01 — Identity</Kicker>
        <H2>The lockup</H2>
        <Body muted className="mt-2">
          The descriptor is part of the logo, not a tagline. There is no variant
          that renders the wordmark without it — the only permitted reduction is
          the reticle alone, restricted to favicons, avatars and embroidery.
        </Body>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SwatchFrame label="Full horizontal — default">
            <Lockup className="w-[220px] text-reticle-black" />
          </SwatchFrame>
          <SwatchFrame label="Stacked — square formats">
            <Lockup variant="stacked" className="w-[180px] text-reticle-black" />
          </SwatchFrame>
          <SwatchFrame label="Reticle only — min 24px">
            <Reticle className="size-6" title="The Armory Shooting Sports Club" />
          </SwatchFrame>
          <SwatchFrame label="Single colour on dark" dark>
            <Lockup mono className="w-[220px] text-chalk" />
          </SwatchFrame>
        </div>

        <Body muted className="mt-4">
          <strong className="font-bold">Wordmark status.</strong> Rendered as
          live Archivo at expanded width — a faithful interim for Option B
          (&ldquo;retain the reticle and lockup structure; redraw the wordmark in
          a precision grotesque&rdquo;), which the guidelines recommend. The
          supplied stencil is deliberately not used, since shipping it would
          choose Option A by default rather than deliberately. Awaiting vector
          files; the swap is one file.
        </Body>
      </Section>

      {/* ------------------------------------------------------------ PALETTE */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">02 — Colour</Kicker>
        <H2>Palette and measured contrast</H2>
        <Body muted className="mt-2">
          70 / 25 / 5: roughly 70% warm neutral ground, 25% blacks, greys and
          material tones, and no more than 5% Ten Ring Red. Red is a point,
          never a plane. The blues sit outside the ratio as supporting surfaces.
        </Body>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(palette) as PaletteName[])
            .filter((n) => n !== "white")
            .map((name) => (
              <div key={name} className="border border-sight-grey/30">
                <div
                  className="h-12 w-full"
                  style={{ backgroundColor: palette[name] }}
                />
                <div className="p-2">
                  <Caption muted={false} className="font-bold">
                    {name}
                  </Caption>
                  <Data className="mt-[2px] block text-caption" muted>
                    {palette[name].toUpperCase()}
                  </Data>
                </div>
              </div>
            ))}
        </div>

        <H3 className="mt-8">Derived tokens — added by the build team</H3>
        <Body muted className="mt-2">
          The guidelines assign Sight Grey to secondary type and Ten Ring Red to
          primary calls to action, then ask that both be verified. Both fail at
          body size: white on Ten Ring Red measures{" "}
          <Data muted={false}>
            {round(contrast(palette.white, palette["ten-ring-red"])).toFixed(2)}:1
          </Data>{" "}
          and Sight Grey on Chalk measures{" "}
          <Data muted={false}>
            {round(contrast(palette["sight-grey"], palette.chalk)).toFixed(2)}:1
          </Data>
          , against a 4.5:1 requirement that spec §9 makes an acceptance
          criterion. Two derived tokens resolve it without changing the visual
          system — the logo dot and graphic accent keep the exact colours of the
          mark, and only text-bearing surfaces use the deeper values.
        </Body>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <caption className="sr-only">
              Derived colour tokens and their measured contrast
            </caption>
            <thead>
              <tr className="border-b border-reticle-black">
                <Th>Token</Th>
                <Th>Value</Th>
                <Th>Role</Th>
                <Th>Measured</Th>
              </tr>
            </thead>
            <tbody>
              <Tr
                token="ten-ring-red"
                value={palette["ten-ring-red"]}
                role="Unchanged. The dot, rings, graphic accent, large display."
                note={`${round(contrast(palette["ten-ring-red"], palette.chalk)).toFixed(2)}:1 on Chalk — clears the 3:1 graphic threshold`}
              />
              <Tr
                token="ten-ring-deep"
                value={palette["ten-ring-deep"]}
                role="New. Text-bearing red only: button fills, links, small labels."
                note={`${round(contrast(palette.white, palette["ten-ring-deep"])).toFixed(2)}:1 vs white · ${round(contrast(palette["ten-ring-deep"], palette.chalk)).toFixed(2)}:1 on Chalk`}
              />
              <Tr
                token="sight-grey"
                value={palette["sight-grey"]}
                role="Unchanged. Rules, dividers, quiet UI, large labels."
                note={`${round(contrast(palette["sight-grey"], palette.chalk)).toFixed(2)}:1 on Chalk — large text and UI only`}
              />
              <Tr
                token="sight-ink"
                value={palette["sight-ink"]}
                role="New. Secondary text. Reads as Sight Grey, passes on both light grounds."
                note={`${round(contrast(palette["sight-ink"], palette.chalk)).toFixed(2)}:1 on Chalk · ${round(contrast(palette["sight-ink"], palette.terrazzo)).toFixed(2)}:1 on Terrazzo`}
              />
            </tbody>
          </table>
        </div>

        <H3 className="mt-8">Ink per ground</H3>
        <Body muted className="mt-2">
          Three grounds admit exactly one compliant body-text colour. Teak, Teal
          and Soffit Blue are therefore short-copy accent panels; Charred Timber
          is the only dark ground that carries layered text, which is why the
          footer uses it.
        </Body>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(GROUND_INK).map(([name, { bg, inks }]) => {
            const compliant = inks.filter(
              (ink) => contrast(palette[ink], palette[bg]) >= 4.5,
            );
            return (
              <div
                key={name}
                className="border border-sight-grey/30 p-3"
                style={{ backgroundColor: palette[bg] }}
              >
                <p
                  className="u-kicker mb-2"
                  style={{ color: palette[compliant[0] ?? "reticle-black"] }}
                >
                  {name}
                  {compliant.length === 1 && " · single-ink"}
                </p>
                <ul className="flex flex-col gap-[2px]">
                  {inks.map((ink) => {
                    const r = round(contrast(palette[ink], palette[bg]));
                    const l = level(r);
                    return (
                      <li
                        key={ink}
                        className="u-tabular flex items-baseline justify-between gap-2 text-caption"
                        style={{
                          color: palette[ink],
                          opacity: l === "fail" ? 0.55 : 1,
                        }}
                      >
                        <span>{ink}</span>
                        <span>
                          {r.toFixed(2)}:1{" "}
                          {l === "AA body" ? "✓" : l === "AA large" ? "△" : "✕"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        <Caption className="mt-2">
          ✓ passes AA for body text · △ large text and non-text only · ✕ fails
        </Caption>
      </Section>

      {/* --------------------------------------------------------- TYPE SCALE */}
      <Section ground="terrazzo" rhythm="default">
        <Kicker className="mb-2">03 — Typography</Kicker>
        <H2>Type scale</H2>
        <Body muted className="mt-2">
          Fluid between the 480px and 1440px breakpoints, landing exactly on the
          specified values at each end. Two weights carry the system — Regular
          and Bold. Never body copy in the display face; never headlines in a
          stencil.
        </Body>

        <div className="mt-6 flex flex-col gap-4">
          <ScaleRow token="display" spec="64 / 40">
            <Display as="p">Eight lanes, machine-scored</Display>
          </ScaleRow>
          <ScaleRow token="h1" spec="48 / 32">
            <p className="text-h1 font-display">The first visit</p>
          </ScaleRow>
          <ScaleRow token="h2" spec="32 / 24">
            <p className="text-h2 font-display">Built to standard</p>
          </ScaleRow>
          <ScaleRow token="h3" spec="22 / 19">
            <p className="text-h3 font-display">Everything is provided</p>
          </ScaleRow>
          <ScaleRow token="body-lg" spec="20 / 18">
            <p className="text-body-lg u-measure">
              No experience needed. You arrive with nothing.
            </p>
          </ScaleRow>
          <ScaleRow token="body" spec="17 / 16">
            <p className="text-body u-measure">
              A private, membership-led shooting sports club at the Abuja
              National Stadium, built to national and international competition
              standard.
            </p>
          </ScaleRow>
          <ScaleRow token="caption" spec="14 / 13">
            <p className="text-caption">
              Covered outdoor firing line, multiple target frames.
            </p>
          </ScaleRow>
          <ScaleRow token="data" spec="17 / 16 · tabular">
            <Data>10m · 8 lanes · 60 shots · 594.7</Data>
          </ScaleRow>
        </div>

        <SegmentedRule className="mt-8" />

        <H3 className="mt-6">Tabular numerals</H3>
        <Body muted className="mt-2">
          Non-negotiable. Figures that do not align in columns look amateur
          instantly, and this brand&rsquo;s entire claim is precision.
        </Body>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="border border-sight-grey/30 bg-chalk p-3">
            <Caption muted={false} className="mb-1 font-bold">
              Tabular — correct
            </Caption>
            {["111.1", "594.7", "607.3", "188.0"].map((n) => (
              <Data key={n} as="div">
                {n}
              </Data>
            ))}
          </div>
          <div className="border border-sight-grey/30 bg-chalk p-3">
            <Caption muted={false} className="mb-1 font-bold">
              Proportional — never
            </Caption>
            {["111.1", "594.7", "607.3", "188.0"].map((n) => (
              <div
                key={n}
                className="text-data"
                style={{ fontVariantNumeric: "proportional-nums" }}
              >
                {n}
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------- THE REGISTER */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">04 — Grounds</Kicker>
        <H2>The access register</H2>
        <Body muted className="mt-2">
          Soffit Blue for open, welcoming contexts — the first visit, the snack
          bar, groups. VIP Teal for member and VIP contexts, where it should
          feel earned. This mirrors the actual deck furniture, so the tiering is
          felt rather than announced.
        </Body>
        <Caption className="mt-2">
          Page assignment — Home: neutral · First Visit and Groups: Soffit Blue ·
          Membership and The Club: VIP Teal · The Ranges: Range Teak and Charred
          Timber · Sport: Reticle Black on Chalk.
        </Caption>
      </Section>

      {groundNames.map((ground) => (
        <Section key={ground} ground={ground} rhythm="tight">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Kicker muted={false}>
              {ground}
              {isSingleInk(ground) && " · single-ink"}
            </Kicker>
            <Caption>
              {isSingleInk(ground)
                ? "Short copy only. Secondary text differentiated by size and weight, not colour."
                : "Carries layered text."}
            </Caption>
          </div>
          <H3 className="mt-2">Bring someone who doesn&rsquo;t shoot.</H3>
          <Body muted className="mt-1">
            They have a seat, a drink and a clear view of the firing line.
          </Body>
          <CtaPair primary={cta.primary} secondary={cta.secondary} className="mt-3" />
        </Section>
      ))}

      {/* ------------------------------------------------------------ DEVICES */}
      <Section ground="chalk" rhythm="default">
        <Kicker className="mb-2">05 — Graphic language</Kicker>
        <H2>Devices</H2>
        <Body muted className="mt-2">
          One device per composition. Rings, dots, mesh and oversized numerals
          in the same frame produce noise, and noise is the opposite of
          precision.
        </Body>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SwatchFrame label="Reticle — the mark">
            <Reticle className="size-8" />
          </SwatchFrame>
          <SwatchFrame label="Concentric rings — structure">
            <ConcentricRings className="size-8 text-sight-grey" />
          </SwatchFrame>
          <SwatchFrame label="Segmented rule — divider">
            <div className="w-full px-2">
              <SegmentedRule />
            </div>
          </SwatchFrame>
          <SwatchFrame label="Lane numerals — results, steps">
            <LaneNumeral>01</LaneNumeral>
          </SwatchFrame>
        </div>

        <Caption className="mt-3">
          Mesh, lattice and terrazzo surfaces are intentionally not implemented
          as CSS approximations. §6 requires them to be photographed from the
          building; they land as image tokens after the commissioned shoot.
        </Caption>
      </Section>

      {/* ----------------------------------------------------- WCAG + CONTENT */}
      <Section ground="charred" rhythm="default">
        <Kicker className="mb-2" muted={false}>
          06 — Verification
        </Kicker>
        <H2>Required colour pairs</H2>
        <Body muted className="mt-2">
          The pairs the build actually relies on, computed at render time. These
          are asserted by <Data muted={false}>npm run gate</Data>, which fails
          the build if any regress.
        </Body>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <caption className="sr-only">Required contrast pairs</caption>
            <thead>
              <tr className="border-b border-chalk">
                <Th>Pair</Th>
                <Th>Needs</Th>
                <Th>Measured</Th>
                <Th>Role</Th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr
                  key={`${a.fg}-${a.bg}-${a.role}`}
                  className="border-b border-gabion-stone/40"
                >
                  <td className="py-1 pr-3 align-top text-caption">
                    {a.fg} on {a.bg}
                  </td>
                  <td className="py-1 pr-3 align-top">
                    <Data className="text-caption" muted>
                      {a.threshold.toFixed(1)}:1
                    </Data>
                  </td>
                  <td className="py-1 pr-3 align-top">
                    <Data className="text-caption" muted={false}>
                      {a.ratio.toFixed(2)}:1 {a.pass ? "✓" : "✕"}
                    </Data>
                  </td>
                  <td className="py-1 align-top text-caption text-[var(--ink-muted)]">
                    {a.role}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <SegmentedRule className="mt-8" />

        <H2 className="mt-6">Outstanding content</H2>
        <Body muted className="mt-2">
          {gate.resolved} of {gate.total} resolved. {gate.blockers} launch{" "}
          {gate.blockers === 1 ? "blocker" : "blockers"}. Blockers stop a
          launch; degraded items ship as hidden sections rather than delaying
          the site.
        </Body>

        <ul className="mt-4 flex flex-col gap-2">
          {contentGate.map((item) => (
            <li
              key={item.id}
              className="border-l-2 pl-2"
              style={{
                borderColor: item.resolved
                  ? palette["gabion-stone"]
                  : item.severity === "blocker"
                    ? palette["ten-ring-red"]
                    : palette["deck-oak"],
              }}
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Kicker as="span" muted={false}>
                  {item.resolved
                    ? "resolved"
                    : item.severity === "blocker"
                      ? "blocker"
                      : "degraded"}
                </Kicker>
                <span className="text-body">{item.label}</span>
                <Caption as="span">{item.owner}</Caption>
              </div>
              {item.note && <Caption className="mt-[2px]">{item.note}</Caption>}
            </li>
          ))}
        </ul>
      </Section>

      {/* -------------------------------------------------------------- MOTION */}
      <Section ground="chalk" rhythm="tight">
        <Kicker className="mb-2">07 — Motion</Kicker>
        <H2>Restraint</H2>
        <Body muted className="mt-2">
          Fades and short translations only. No parallax, no scroll-jacking, no
          counters. 200–400ms, ease-out. Motion should feel like precision
          equipment, not a promo video —{" "}
          <Data muted={false}>prefers-reduced-motion</Data> disables it entirely.
        </Body>
        <div className="mt-4">
          <Button href="/" variant="secondary">
            Back to home
          </Button>
        </div>
      </Section>
    </>
  );
}

/* --------------------------------------------------------------- primitives */

function SwatchFrame({
  label,
  children,
  dark = false,
}: {
  label: string;
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <figure>
      <div
        className={`grid min-h-[112px] place-items-center border border-sight-grey/30 p-3 ${
          dark ? "bg-charred-timber" : "bg-chalk"
        }`}
      >
        {children}
      </div>
      <figcaption className="mt-1">
        <Caption>{label}</Caption>
      </figcaption>
    </figure>
  );
}

function ScaleRow({
  token,
  spec,
  children,
}: {
  token: string;
  spec: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 border-t border-sight-grey/30 pt-2 lg:grid-cols-[160px_1fr] lg:gap-4">
      <div>
        <Kicker muted={false}>{token}</Kicker>
        <Data className="mt-[2px] block text-caption" muted>
          {spec}
        </Data>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="py-1 pr-3 align-bottom">
      <span className="u-kicker">{children}</span>
    </th>
  );
}

function Tr({
  token,
  value,
  role,
  note,
}: {
  token: string;
  value: string;
  role: string;
  note: string;
}) {
  return (
    <tr className="border-b border-sight-grey/30">
      <td className="py-2 pr-3 align-top">
        <span className="flex items-center gap-1 text-caption font-bold">
          <span
            aria-hidden="true"
            className="inline-block size-2 shrink-0 border border-sight-grey/40"
            style={{ backgroundColor: value }}
          />
          {token}
        </span>
      </td>
      <td className="py-2 pr-3 align-top">
        <Data className="text-caption" muted>
          {value.toUpperCase()}
        </Data>
      </td>
      <td className="py-2 pr-3 align-top text-caption">{role}</td>
      <td className="py-2 align-top">
        <Data className="text-caption" muted>
          {note}
        </Data>
      </td>
    </tr>
  );
}
