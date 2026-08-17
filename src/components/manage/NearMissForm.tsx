"use client";

import { useActionState } from "react";
import { NEAR_MISS_KINDS } from "@/domain/enums";
import { MINIMUM_NARRATIVE } from "@/domain/near-miss";
import { reportNearMiss } from "@/app/actions/manage";
import { MANAGE_FORM_IDLE } from "@/lib/manage-state";

/**
 * THE THIRTY-SECOND FORM — Management §9.2, S5.
 *
 *   "A near-miss report that takes two minutes and asks who was at fault will not
 *    be filed. The form is short, it can be submitted from a phone in under
 *    thirty seconds, and it asks what happened rather than who did it."
 *
 * ===========================================================================
 * FOUR FIELDS, AND THREE OF THEM ARE OPTIONAL
 *
 * One required narrative, one category as radio buttons rather than a select — a
 * select on a phone is a modal wheel and two extra taps — an optional location,
 * and the naming choice. Nothing else. Every field considered and rejected is
 * recorded in the schema comment, because the pressure to add a severity picker
 * will arrive and the reasoning should be available when it does.
 *
 * ===========================================================================
 * THE NAMING CHECKBOX DEFAULTS TO ANONYMOUS
 *
 * Founder's decision: the reporter chooses per report. The default is the safer
 * of the two, because a form that arrived pre-named would make the choice for
 * somebody at the moment they are least likely to notice it — and the whole
 * purpose of the choice is that it belongs to the person who knows what it costs
 * them.
 *
 * The label says what naming BUYS rather than what anonymity avoids. "Add my name
 * so the safety holder can ask me about it" is the true reason to do it; "file
 * anonymously" framed as the brave option would nudge people towards a report
 * nobody can follow up.
 */
export function NearMissForm() {
  const [state, action, pending] = useActionState(reportNearMiss, MANAGE_FORM_IDLE);

  if (state.status === "ok") {
    return (
      <div className="flex flex-col gap-1 border border-sight-grey/30 bg-chalk p-2">
        <p className="text-[13px]">{state.message}</p>
        <p className="text-[11px] text-sight-ink">
          It is visible to the safety holder and the founder, and to nobody else.
          It will never appear on a commercial screen or beside your name in a
          figure.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <fieldset className="flex flex-col gap-1">
        <legend className="text-[11px] uppercase tracking-[0.12em] text-sight-ink">
          What was it about
        </legend>
        <div className="flex flex-wrap gap-1">
          {NEAR_MISS_KINDS.map((kind, index) => (
            <label
              key={kind}
              className="cursor-pointer border border-sight-grey/40 px-2 py-1 text-[13px] has-[:checked]:border-reticle-black has-[:checked]:bg-terrazzo/50 has-[:checked]:font-medium"
            >
              <input
                type="radio"
                name="kind"
                value={kind}
                defaultChecked={index === 0}
                className="sr-only"
              />
              {KIND_LABELS[kind]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.12em] text-sight-ink">
          What happened
        </span>
        <textarea
          name="whatHappened"
          rows={3}
          required
          minLength={MINIMUM_NARRATIVE}
          placeholder="Muzzle came off target during a reload and swept the empty lane beside it."
          className="border border-sight-grey/40 bg-chalk p-1 text-[14px] leading-snug"
        />
        <span className="text-[11px] text-sight-ink">
          What happened and what nearly followed from it. Not who — an incident is
          where blame belongs, and this is not one.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.12em] text-sight-ink">
          Where <span className="normal-case tracking-normal">(optional)</span>
        </span>
        <input
          type="text"
          name="location"
          placeholder="Lane 4"
          className="border border-sight-grey/40 bg-chalk p-1 text-[14px]"
        />
      </label>

      <label className="flex items-start gap-1 text-[13px]">
        <input type="checkbox" name="named" value="1" className="mt-[3px]" />
        <span>
          Add my name, so the safety holder can ask me about it.
          <span className="block text-[11px] text-sight-ink">
            Left unticked this is filed anonymously. Either way it never appears in
            a figure or on a dashboard.
          </span>
        </span>
      </label>

      {state.status === "error" && (
        <p className="text-[13px] text-ten-ring-deep">{state.message}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="self-start bg-charred-timber px-3 py-1 text-[14px] font-medium text-chalk disabled:bg-sight-grey"
      >
        {pending ? "Filing…" : "File it"}
      </button>
    </form>
  );
}

/** Plain words. A category nobody can read at speed is a category nobody picks. */
const KIND_LABELS: Readonly<Record<string, string>> = {
  line_discipline: "Line discipline",
  equipment: "Equipment",
  ammunition: "Ammunition",
  movement: "Somebody moved",
  other: "Something else",
};
