"use client";

import { useActionState, useState } from "react";
import { DEGRADATION_CAUSES, type OperatingLevel } from "@/domain/enums";
import { LEVEL_DEFINITIONS, definitionOf, rankOf } from "@/domain/operating";
import { moveOperatingLevel } from "@/app/actions/manage";
import { CONSEQUENCE_LINES, MANAGE_FORM_IDLE } from "@/lib/manage-state";
import { cn } from "@/lib/cn";

/**
 * THE DEGRADATION LADDER AS A SWITCH — Management §6.2.
 *
 *   "One control, four positions… Moving it does the work rather than describing
 *    it… A reason is required. Not a free-text afterthought — a short required
 *    field, because the value of this control over a season is the record of why
 *    the club degraded."
 *
 * ===========================================================================
 * IT LOOKS LIKE A LADDER, BECAUSE IT IS ONE
 *
 * Four rungs stacked vertically in the club's declared order, not a dropdown.
 * The order is the content — the club comes DOWN it in sequence — and a select
 * element would present four peers and lose the one piece of information the
 * control carries. Standing on the third rung, a duty manager can see that the
 * next thing to give is the range itself.
 *
 * ===========================================================================
 * THE REASON IS NOT A SECOND STEP
 *
 * Choosing a rung reveals the cause and the note in the same form rather than
 * advancing to a confirmation screen. §6.2 wants this usable on a bad evening,
 * and a two-step flow on a phone in a corridor is a flow somebody abandons —
 * after which the club has degraded and nothing says why, which is the exact
 * outcome the control exists to prevent.
 */
export function OperatingLevelControl({
  current,
  maySet,
}: {
  current: OperatingLevel;
  maySet: boolean;
}) {
  const [state, action, pending] = useActionState(moveOperatingLevel, MANAGE_FORM_IDLE);
  const [chosen, setChosen] = useState<OperatingLevel | null>(null);

  const now = definitionOf(current);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <p className="text-[13px]">
          <span className="font-semibold">{now.label}</span>
          <span className="text-sight-ink"> — {now.memberLine}</span>
        </p>
      </div>

      {!maySet ? (
        /* Read is not the separation here either. A range officer needs to know
           where the club is; moving it is the duty manager's. */
        <p className="text-[11px] text-sight-ink">
          Moving the operating level is held by the duty manager and above.
        </p>
      ) : (
        <form action={action} className="flex flex-col gap-2">
          <ol className="flex flex-col">
            {LEVEL_DEFINITIONS.map((definition) => {
              const isCurrent = definition.level === current;
              const isChosen = definition.level === chosen;
              const descending = rankOf(definition.level) > rankOf(current);

              return (
                <li key={definition.level}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-baseline gap-2 border-l-2 py-1 pl-2",
                      isChosen
                        ? "border-l-ten-ring-deep bg-terrazzo/50"
                        : isCurrent
                          ? "border-l-reticle-black bg-terrazzo/25"
                          : "border-l-transparent hover:bg-terrazzo/20",
                      isCurrent && "cursor-default",
                    )}
                  >
                    <input
                      type="radio"
                      name="to"
                      value={definition.level}
                      disabled={isCurrent}
                      checked={isChosen}
                      onChange={() => setChosen(definition.level)}
                      className="sr-only"
                    />
                    <span
                      className={cn(
                        "text-[14px]",
                        (isCurrent || isChosen) && "font-semibold",
                      )}
                    >
                      {definition.label}
                    </span>
                    {isCurrent && (
                      <span className="text-[11px] uppercase tracking-[0.1em] text-sight-ink">
                        now
                      </span>
                    )}
                    {!isCurrent && (
                      <span className="ml-auto text-[11px] text-sight-ink">
                        {descending ? "down" : "up"}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ol>

          {chosen && (
            <div className="flex flex-col gap-2 border-t border-sight-grey/30 pt-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-[0.12em] text-sight-ink">
                  Why
                </span>
                <select
                  name="cause"
                  required
                  defaultValue="staffing"
                  className="border border-sight-grey/40 bg-chalk p-1 text-[14px]"
                >
                  {DEGRADATION_CAUSES.map((cause) => (
                    <option key={cause} value={cause}>
                      {CAUSE_LABELS[cause]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-[0.12em] text-sight-ink">
                  The particulars
                </span>
                <input
                  type="text"
                  name="note"
                  required
                  minLength={12}
                  placeholder="Two officers off sick, one on the floor."
                  className="border border-sight-grey/40 bg-chalk p-1 text-[14px]"
                />
                <span className="text-[11px] text-sight-ink">
                  Read next quarter, by somebody deciding whether to hire. Not a
                  formality.
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
                {pending ? "Setting…" : `Set — ${definitionOf(chosen).label}`}
              </button>
            </div>
          )}
        </form>
      )}

      {state.status === "ok" && (
        <div className="flex flex-col gap-1 border-l-2 border-l-ten-ring-deep pl-2">
          <p className="text-[13px]">{state.message}</p>
          {/* What the club now owes. §6.2's four effects are not built, and a
              confirmation implying a WhatsApp message had gone out would be a lie
              told at the worst possible moment. */}
          {(state.outstanding ?? []).length > 0 && (
            <ul className="flex flex-col gap-[2px]">
              {(state.outstanding ?? []).map((kind) => (
                <li key={kind} className="text-[12px] text-ten-ring-deep">
                  {CONSEQUENCE_LINES[kind] ?? kind}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const CAUSE_LABELS: Readonly<Record<string, string>> = {
  staffing: "Short-staffed",
  coverage: "No qualified officer",
  weather: "Weather",
  equipment: "Equipment or facility",
  stadium: "Imposed by the stadium",
  safety: "Following a safety decision",
  other: "Something else",
};
