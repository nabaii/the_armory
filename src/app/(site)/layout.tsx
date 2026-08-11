import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { BottomNav } from "@/components/layout/BottomNav";
import { ServiceWorker } from "@/components/app/ServiceWorker";

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
      {/*
        Last in the DOM, and deliberately so. The tab bar is chrome that is
        always on screen, which makes its tab order position a real decision:
        placed before `main` it would sit between the skip link and the page
        content, so every keyboard user would tab through five destinations
        before reaching the article they came to read.

        Placed last, it is where a screen-reader user expects standing
        navigation to be and where a keyboard user reaches it after the page —
        while `position: fixed` keeps it visually first for the thumb. The skip
        link already covers the case of jumping straight to content.

        It renders below `lg` only, and it is inside this group rather than the
        root layout for the same reason the header is: `/screen` is a
        television on a wall and has nobody to navigate.
      */}
      <BottomNav />
      {/* Renders nothing. Registered from this group rather than the root
          layout so the wall-mounted `/screen` display never asks for it —
          though the worker's own fetch handler excludes that route too, since
          scope is site-wide once any page registers it. */}
      <ServiceWorker />
    </>
  );
}
