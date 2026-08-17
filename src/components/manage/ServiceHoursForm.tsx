"use client";

import { useActionState } from "react";
import { clearServiceHours, saveServiceHours } from "@/app/actions/service-hours";
import { CONSEQUENCE_LINES, MANAGE_FORM_IDLE } from "@/lib/manage-state";

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

/**
 * WHEN THE KITCHEN SERVES — Management §7.1, finding F3.
 *
 * The screen that settles `kitchen-hours`. One window applied to the days it
 * runs on, because that is how the decision is actually made — "lunch, every
 * day" is one thought and seven rows.
 *
 * ===========================================================================
 * MONDAY FIRST, SUNDAY LAST
 *
 * `weekday` is 0-indexed from Sunday to match `Date#getDay`, and the form does
 * not present it that way. A founder reading their own week starts on Monday; a
 * form that started on Sunday because a JavaScript API does would be the
 * database's convenience leaking onto a person.
 */
export function ServiceHoursForm({
  current,
}: {
  current: readonly { weekday: number; opens: number; closes: number; label: string | null }[];
}) {
  const [state, action, pending] = useActionState(saveServiceHours, MANAGE_FORM_IDLE);
  const [clearState, clear, clearing] = useActionState(
    clearServiceHours,
    MANAGE_FORM_IDLE,
  );

  const served = new Set(current.map((period) => period.weekday));

  return (
    <div className="flex flex-col gap-2">
      {current.length === 0 ? (
        <p className="text-[13px] text-reticle-black">
          The club has not published kitchen and bar hours, so no cover is
          bookable. This is the decision that changes that.
        </p>
      ) : (
        <ul className="flex flex-col gap-[2px] text-[13px]">
          {DAYS.filter((day) => served.has(day.value)).map((day) => {
            const period = current.find((entry) => entry.weekday === day.value);
            return (
              <li key={day.value} className="flex items-baseline gap-2">
                <span className="w-10 text-sight-ink">{day.label}</span>
                <span className="tabular-nums">
                  {asTime(period?.opens ?? 0)}–{asTime(period?.closes ?? 0)}
                </span>
                {period?.label && (
                  <span className="text-sight-ink">{period.label}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form action={action} className="flex flex-col gap-2 border-t border-sight-grey/30 pt-2">
        <fieldset className="flex flex-col gap-1">
          <legend className="text-[11px] uppercase tracking-[0.12em] text-sight-ink">
            Serving on
          </legend>
          <div className="flex flex-wrap gap-1">
            {DAYS.map((day) => (
              <label
                key={day.value}
                className="cursor-pointer border border-sight-grey/40 px-2 py-1 text-[13px] has-[:checked]:border-reticle-black has-[:checked]:bg-terrazzo/50 has-[:checked]:font-medium"
              >
                <input
                  type="checkbox"
                  name="weekday"
                  value={day.value}
                  defaultChecked={served.has(day.value)}
                  className="sr-only"
                />
                {day.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.12em] text-sight-ink">
              From
            </span>
            <input
              type="time"
              name="opens"
              required
              defaultValue={current[0] ? asTime(current[0].opens) : "12:00"}
              className="border border-sight-grey/40 bg-chalk p-1 text-[14px] tabular-nums"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.12em] text-sight-ink">
              Until
            </span>
            <input
              type="time"
              name="closes"
              required
              defaultValue={current[0] ? asTime(current[0].closes) : "15:00"}
              className="border border-sight-grey/40 bg-chalk p-1 text-[14px] tabular-nums"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.12em] text-sight-ink">
              What is on <span className="normal-case tracking-normal">(optional)</span>
            </span>
            <input
              type="text"
              name="label"
              placeholder="Kitchen and bar"
              defaultValue={current[0]?.label ?? ""}
              className="border border-sight-grey/40 bg-chalk p-1 text-[14px]"
            />
          </label>
        </div>

        {state.status === "error" && (
          <p className="text-[13px] text-ten-ring-deep">{state.message}</p>
        )}
        {state.status === "ok" && (
          <div className="flex flex-col gap-[2px]">
            <p className="text-[13px]">{state.message}</p>
            {(state.outstanding ?? []).map((kind) => (
              <p key={kind} className="text-[12px] text-ten-ring-deep">
                {CONSEQUENCE_LINES[kind] ?? kind}
              </p>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="bg-charred-timber px-3 py-1 text-[14px] font-medium text-chalk disabled:bg-sight-grey"
          >
            {pending ? "Publishing…" : "Publish the week"}
          </button>
          <span className="text-[11px] text-sight-ink">
            Replaces the whole week — it is one decision, not seven.
          </span>
        </div>
      </form>

      {current.length > 0 && (
        <form action={clear}>
          <button
            type="submit"
            disabled={clearing}
            className="text-[12px] text-sight-ink underline decoration-sight-grey/60 underline-offset-2"
          >
            {clearing ? "Clearing…" : "Clear the week — stop serving entirely"}
          </button>
          {clearState.status === "ok" && (
            <p className="mt-1 text-[12px]">{clearState.message}</p>
          )}
        </form>
      )}
    </div>
  );
}

/** 750 to "12:30". Zero-padded, because a time input demands it. */
const asTime = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
