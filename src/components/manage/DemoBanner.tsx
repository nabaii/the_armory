import { setDemoMode } from "@/app/actions/manage-demo";

/**
 * THE DEMONSTRATION BANNER, AND THE SWITCH.
 *
 * ===========================================================================
 * IT IS NOT DISMISSIBLE, AND THAT IS THE ENTIRE POINT
 *
 * A banner with a close button is a banner that gets closed, after which a
 * founder is reading invented figures on a screen that looks exactly like the
 * real one. The only way to make it go away is to turn demonstration mode off,
 * which is also the only way to make the data real.
 *
 * It sits ABOVE the content on every management route rather than inside one
 * screen, so there is no path through the application that renders demonstration
 * data without it — including a screen written next year by somebody who never
 * read this file.
 *
 * ===========================================================================
 * IT BORROWS THE ONE COLOUR NOTHING ELSE HERE MAY USE
 *
 * Management reserves red for "this requires a decision" and gives the primary
 * action Charred Timber, so a red band is unlike anything else on the surface.
 * That is deliberate: the banner has to be the most conspicuous thing on the
 * screen, and it is the only element permitted to outrank an exception panel.
 *
 * Ten Ring Deep rather than Ten Ring Red, because this carries text — the mark's
 * own red measures 4.14:1 against white and fails AA at body size, which is why
 * the deeper token exists at all.
 */
export function DemoBanner({ on }: { on: boolean }) {
  if (!on) return <EnableRow />;

  return (
    <div
      /* `role="status"`, not `alert`: it is a standing condition rather than an
         event, and an alert would be announced over whatever a screen reader
         user was already reading on every navigation. */
      role="status"
      className="flex flex-wrap items-center gap-2 bg-ten-ring-deep px-2 py-1 text-chalk"
    >
      <span className="text-[11px] font-bold uppercase tracking-[0.18em]">
        Demonstration data
      </span>
      <span className="text-[12px] leading-snug text-chalk/90">
        Nothing on this screen is real. No member, booking, charge or report below
        exists.
      </span>

      <form action={setDemoMode} className="ml-auto">
        <input type="hidden" name="on" value="0" />
        <button
          type="submit"
          className="border border-chalk/70 px-2 py-[2px] text-[12px] font-medium text-chalk hover:bg-chalk/10"
        >
          Show real data
        </button>
      </form>
    </div>
  );
}

/**
 * The way in, when demonstration mode is off.
 *
 * Quiet on purpose. It is a founder's tool for showing somebody the product, and
 * a prominent button offering to replace the club's real figures with invented
 * ones is an invitation to press it by accident on a screen somebody is working
 * from.
 */
function EnableRow() {
  return (
    <div className="flex items-center gap-2 border-b border-sight-grey/25 px-2 py-[2px]">
      <form action={setDemoMode} className="ml-auto">
        <input type="hidden" name="on" value="1" />
        <button
          type="submit"
          className="text-[11px] uppercase tracking-[0.12em] text-sight-grey hover:text-sight-ink"
        >
          Demonstration data
        </button>
      </form>
    </div>
  );
}
