import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

/**
 * SITE CHROME.
 *
 * Header, footer and the skip link — everything that makes a page part of the
 * website. Every public route, the member portal and the sign-in flow sit
 * beneath this.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SEPARATE FROM THE ROOT LAYOUT
 *
 * The live tournament screen (`/screen`) is not a web page in the same sense.
 * It is a fixed display on a wall, shown on a television in a room where people
 * are shooting, and it must carry no navigation, no footer and no skip link —
 * there is nobody to navigate.
 *
 * Hiding the chrome with CSS would leave it in the accessibility tree and in
 * the tab order, which matters because the range officer's control panel IS
 * operated by keyboard. So the chrome moved down a level instead: the root
 * layout is now the document shell, and this group owns the website.
 * ---------------------------------------------------------------------------
 */
export default function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {/* Spec §7: full keyboard navigability. */}
      <a href="#main" className="u-skip-link">
        Skip to content
      </a>
      <Header />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
    </>
  );
}
