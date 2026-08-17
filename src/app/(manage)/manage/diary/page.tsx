import { notFound } from "next/navigation";
import { admitsSurface } from "@/domain/grants";
import { Panel } from "@/components/manage/Panel";
import { requireStaffPrincipal } from "@/server/armory/manage-session";

/**
 * DIARY — Management System §7. The programme, and the booking book.
 *
 * ===========================================================================
 * THIS SURFACE AND THE MEMBER DIARY ARE ONE PIECE OF WORK
 *
 *   §7: "The staff Diary and the member Diary are one piece of work seen from
 *    two sides. Members read the diary. Staff write it. Somebody has to type
 *    that the kitchen is open on Thursday before a member can read that the
 *    kitchen is open on Thursday."
 *
 * The specification is emphatic that they "ship together or neither ships", and
 * that splitting them across two efforts produces two efforts that disagree
 * about what an event is. The member half exists — M11 and M12 built the tab,
 * the calendar and the three feeds. This is the authoring half, and it is the
 * next sprint rather than this one.
 *
 * What is rendered below is therefore the shape of the work and what each part
 * is waiting on. An empty screen would say the same thing less usefully.
 */

export default async function Diary() {
  const principal = await requireStaffPrincipal();
  if (!admitsSurface(principal, "diary")) notFound();

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-3 p-2 lg:p-3">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold leading-none">Diary</h1>
        <p className="text-[13px] text-sight-ink">
          What members read, and what staff write.
        </p>
      </header>

      <div className="grid gap-2 md:grid-cols-2">
        <Panel
          title="Opening hours"
          empty={{
            kind: "unauthored",
            line:
              "The club publishes 9 to 6, every day, from src/content/club-week.ts. Editing it means running db:hours, which is a terminal and not a screen.",
          }}
        />
        <Panel
          title="Service hours"
          empty={{
            kind: "unauthored",
            line:
              "When the kitchen and bar serve. The table exists and is empty, so no cover can be booked — which is correct until somebody says when the club serves.",
          }}
        />
        <Panel
          title="Events and closures"
          empty={{
            kind: "unauthored",
            line:
              "Guest evenings, fixtures, a closure for a public holiday. The events table exists and nobody has written to it, which makes the member Diary emptier than no Diary would have been.",
          }}
        />
        <Panel
          title="The booking book"
          empty={{
            kind: "not_built",
            line:
              "Every booking, in a day and week view. A primary path rather than an edge case — the club's channel is WhatsApp, so for some members this will be the only way they ever book.",
          }}
        />
      </div>
    </div>
  );
}
