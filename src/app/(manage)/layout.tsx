import type { Metadata } from "next";
import { ManageShell } from "@/components/manage/ManageShell";
import { manageNavFor } from "@/lib/manage-nav";
import { requireStaffPrincipal } from "@/server/armory/manage-session";

/**
 * THE MANAGEMENT SYSTEM — a third route group, beside the public site and the
 * members portal.
 *
 * Management System Design Specification §14: "One repository, one deployment,
 * a third route group beside the public site and the portal, guarded in the
 * layout and generated from capability."
 *
 * ===========================================================================
 * THE GUARD IS HERE, AND THE GUARD IS NOT THE PROTECTION
 *
 * `requireStaffPrincipal()` runs once, in this layout, so every route beneath it
 * is authenticated by construction and a page added later cannot forget to
 * check. That is the same argument `(member)/layout.tsx` makes, and the same
 * caveat applies with more force: a layout check protects the PAGE. It does not
 * protect a query that asks for a row the viewer may not see.
 *
 * Every screen below must therefore still assert its own grant before reading.
 * The layout says "you are staff"; only the grant says "you may see the
 * ledger", and S1 puts that decision in one service rather than in a screen.
 *
 * ===========================================================================
 * NOT INSTALLABLE, AND THAT IS A DECISION
 *
 * The site has a manifest and the console has its own. Management deliberately
 * gets neither. It is a personal-device surface used online, sitting down, with
 * time to think — §4's table — and an install prompt buys nothing while adding
 * a third service-worker scope to reason about on a codebase that has already
 * had to resolve two.
 *
 * §12.4 is the harder half of the same rule: there is no second offline system.
 * A duty manager without connectivity uses the console, which is designed for
 * exactly that and is bolted to the counter.
 */

export const metadata: Metadata = {
  title: "Management",
  /* Never indexed. This surface carries more personal data than any other in
     the product — the roster, compliance, incidents and money. */
  robots: { index: false, follow: false, nocache: true, nosnippet: true },
};

/**
 * Never prerendered, never cached.
 *
 * `/manage` is also in `NEVER_CACHE` in public/sw.js, which is the half that
 * matters on a lost phone: a service worker cache lives on the device and
 * outlives sign-out, because clearing a cookie does not clear the Cache API.
 */
export const dynamic = "force-dynamic";

export default async function ManageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const principal = await requireStaffPrincipal();

  /* Computed on the server, from grants read this request. §15: capability is
     re-evaluated per request, not per session — so a grant revoked five minutes
     ago is gone from this bar on the next navigation rather than at the end of
     somebody's shift. */
  const items = manageNavFor(principal);

  return <ManageShell items={items}>{children}</ManageShell>;
}
