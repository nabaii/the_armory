import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import NotFoundContent from "@/app/(site)/not-found";

/**
 * The GLOBAL 404 — a URL that matched no route at all.
 *
 * `(site)/not-found.tsx` handles anything raised inside the website group and
 * inherits the chrome from that group's layout. This one sits above every
 * group, so it renders the chrome itself; without it, an unmatched URL would
 * arrive at the bare document shell with no header, no footer and no way back.
 *
 * The content is the same component, so the two can never drift apart.
 *
 * Both exist for a brand reason as much as a UX one: Next's built-in not-found
 * injects `body{color:#000;background:#fff}` plus a `prefers-color-scheme: dark`
 * inversion to pure black, and Brand Guidelines §11 forbids both.
 */
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function GlobalNotFound() {
  return (
    <>
      <a href="#main" className="u-skip-link">
        Skip to content
      </a>
      <Header />
      <main id="main" className="flex-1">
        <NotFoundContent />
      </main>
      <Footer />
    </>
  );
}
