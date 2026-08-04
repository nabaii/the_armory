import type { Metadata, Viewport } from "next";
import { fontVariables } from "@/lib/fonts";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { site } from "@/lib/site";
import "./globals.css";

/* ============================================================================
   ROOT LAYOUT

   Metadata follows Brand Guidelines §2, which is stricter than it first looks:
   the full name with descriptor belongs "in every metadata field — page titles,
   search descriptions, social profiles, business listings. The descriptor is
   how a stranger understands what this is."

   That is a positioning requirement, not an SEO one. Someone who sees only a
   search result or a WhatsApp link preview must learn from those few words that
   this is a sport, not a weapons business. So the title template always carries
   the descriptor, and no page may override it away.

   Every claim below is drawn from the source documents and is flagged in them
   as true from opening day. "Built to national and international competition
   standard" is locked as always-true; competition hosting is not claimed.
   ========================================================================= */

const description =
  "A private, membership-led shooting sports club at the Abuja National Stadium, " +
  "built to national and international competition standard. No experience needed — " +
  "everything is provided.";

export const metadata: Metadata = {
  /* metadataBase needs the confirmed domain; tracked as a gate blocker. */
  ...(site.origin ? { metadataBase: new URL(site.origin) } : {}),
  title: {
    default: site.legalName,
    /* The descriptor survives on every page. */
    template: `%s — ${site.legalName}`,
  },
  description,
  applicationName: site.legalName,
  openGraph: {
    type: "website",
    siteName: site.legalName,
    title: site.legalName,
    description,
    locale: "en_NG",
  },
  twitter: { card: "summary_large_image", title: site.legalName, description },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  /* Chalk — the white render of the buildings. Matches the page ground so the
     mobile browser chrome does not introduce a colour the palette does not own. */
  themeColor: "#F6F5F2",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-NG" className={`${fontVariables} h-full`}>
      <body className="flex min-h-full flex-col">
        {/* Spec §7: full keyboard navigability. */}
        <a href="#main" className="u-skip-link">
          Skip to content
        </a>
        <Header />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
