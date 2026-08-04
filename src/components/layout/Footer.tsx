import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { Lockup } from "@/components/brand/Lockup";
import { Caption, Kicker } from "@/components/ui/Text";
import { Resolved } from "@/components/ui/Pending";
import { contact, footerNav, site } from "@/lib/site";

/* ============================================================================
   FOOTER — contact, hours, location, legal, social (spec §3).

   Ground: Charred Timber. This is the one dark ground in the palette that
   carries layered text at AA — Chalk headings at 14.05:1 and Terrazzo
   secondary text at 10.78:1. Range Teak and VIP Teal are single-ink and would
   force every line to the same colour, which a footer cannot survive.

   It also carries the footer-only navigation the spec calls for: Sport,
   Groups and Leagues live here rather than in the five-item primary nav.
   The institutional page is deliberately absent — it is unlisted and sent
   after a meeting.
   ========================================================================= */

export function Footer() {
  return (
    <footer
      className={[
        "bg-charred-timber text-chalk",
        "[--ink:var(--color-chalk)] [--ink-muted:var(--color-terrazzo)]",
        "[--rule:var(--color-gabion-stone)]",
        "pt-12 pb-6",
      ].join(" ")}
    >
      <Container>
        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr_1fr_1.2fr] lg:gap-4">
          {/* ---- Identity ---- */}
          <div>
            {/* Single-colour variant: Chalk on a dark ground, per §3. */}
            <Lockup mono className="text-chalk" />
            <Caption className="mt-3 max-w-[28ch]">
              {site.legalName}
              <br />
              {site.location}
            </Caption>
          </div>

          {/* ---- The club ---- */}
          <nav aria-labelledby="footer-club">
            <Kicker as="h2" id="footer-club" muted={false} className="mb-2">
              The club
            </Kicker>
            <FooterList items={footerNav.club} />
          </nav>

          {/* ---- Visiting ---- */}
          <nav aria-labelledby="footer-visit">
            <Kicker as="h2" id="footer-visit" muted={false} className="mb-2">
              Visiting
            </Kicker>
            <FooterList items={footerNav.visit} />
          </nav>

          {/* ---- Contact ----
              Every value here is outstanding from the founder. They render as
              visible gaps in development and are omitted in production; the
              build gate is what prevents a launch while they are missing. */}
          <div>
            <Kicker as="h2" muted={false} className="mb-2">
              Contact
            </Kicker>
            <ul className="flex flex-col gap-1 text-caption text-[var(--ink-muted)]">
              <li>
                <Resolved
                  value={contact.phone}
                  label="Public enquiries phone"
                  render={(v) => (
                    <a href={`tel:${v.replace(/\s/g, "")}`} className="no-underline hover:underline">
                      {v}
                    </a>
                  )}
                />
              </li>
              <li>
                <Resolved
                  value={contact.email}
                  label="Public enquiries email"
                  render={(v) => (
                    <a href={`mailto:${v}`} className="no-underline hover:underline">
                      {v}
                    </a>
                  )}
                />
              </li>
              <li>
                <Resolved value={contact.hours} label="Opening hours" />
              </li>
            </ul>
          </div>
        </div>

        <hr className="u-rule-segmented mt-8 text-[var(--rule)]" />

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Caption>
            &copy; {new Date().getFullYear()} {site.legalName}
          </Caption>

          <nav aria-label="Legal">
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {footerNav.legal.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-caption text-[var(--ink-muted)] no-underline hover:underline"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </Container>
    </footer>
  );
}

function FooterList({
  items,
}: {
  items: readonly { href: string; label: string }[];
}) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            className="text-caption text-[var(--ink-muted)] no-underline hover:underline"
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
