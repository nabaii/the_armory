"use client";

import { useActionState } from "react";
import { takeApplication } from "@/app/actions/manage";
import { MANAGE_FORM_IDLE } from "@/lib/manage-state";

/**
 * TAKE AN APPLICATION, OR PUT IT BACK — Management §8.2.
 *
 * One button, and the label is the whole design. "Take it" rather than "Assign" —
 * §8.2's problem is not that applications lack a field, it is that nobody has
 * picked them up, and a form asking WHO should own it invites the reader to
 * nominate somebody else.
 *
 * Releasing stays possible and is deliberately plain. An owner who cannot put an
 * application down will hold it while going on leave, which is worse than
 * unowned because unowned is visible and a distracted owner is not.
 */
export function TakeApplication({
  applicationId,
  ownedByMe,
  ownerName,
}: {
  applicationId: string;
  ownedByMe: boolean;
  ownerName: string | null;
}) {
  const [state, action, pending] = useActionState(takeApplication, MANAGE_FORM_IDLE);

  /* Somebody else has it. Not a button — taking an application off a colleague
     is a conversation rather than a click. */
  if (ownerName && !ownedByMe) {
    return <span className="text-sight-ink">{ownerName}</span>;
  }

  return (
    <form action={action} className="flex items-baseline gap-1">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="release" value={ownedByMe ? "1" : "0"} />
      <button
        type="submit"
        disabled={pending}
        className={
          ownedByMe
            ? "text-[12px] text-sight-ink underline decoration-sight-grey/60 underline-offset-2"
            : "border border-charred-timber px-2 text-[12px] font-medium hover:bg-terrazzo/40"
        }
      >
        {pending ? "…" : ownedByMe ? "Release" : "Take it"}
      </button>
      {state.status === "error" && (
        <span className="text-[11px] text-ten-ring-deep">{state.message}</span>
      )}
    </form>
  );
}
