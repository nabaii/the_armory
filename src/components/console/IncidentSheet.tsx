"use client";

import { useState } from "react";
import {
  incidentCategories,
  involvementLabels,
} from "@/offline/incident";
import type { IncidentInvolvement } from "@/domain/enums";
import type { RelayShooter } from "@/offline/relay";

/**
 * INCIDENT — §6.5.
 *
 *   "Incident — ALWAYS REACHABLE, NEVER MORE THAN ONE TAP AWAY, ALWAYS
 *    AVAILABLE OFFLINE."
 *
 * The "one tap away" half is not in this file — it is the button in the lane
 * header, which is present on every screen of the lane surface and is never
 * behind a menu. This is what opens.
 *
 * ===========================================================================
 * THE ORDER OF THE FIELDS IS THE DESIGN
 *
 * Category first, because it is one tap and it is the field an officer knows
 * the answer to before they have opened the sheet. Narrative second, because it
 * is the only field that takes real time and the officer should be typing
 * within two taps of the incident happening. People last, because naming them
 * requires looking around, and asking for that first is how a sheet gets
 * abandoned.
 *
 * Only the first two are required (src/offline/incident.ts refuses on those and
 * nothing else). Everything else on this screen can be left alone.
 *
 * ===========================================================================
 * THE PEOPLE COME FROM THE RELAY, NOT FROM A SEARCH
 *
 * Everybody standing on a lane right now is already on screen behind this
 * sheet. A search field would be a second data source, an empty-state, and a
 * spelling problem on a firing line. So the picker is the relay, and a person
 * who is not on it is left to the narrative — which is exactly where a
 * contractor, a spectator or somebody from the stadium belongs anyway.
 */

export function IncidentSheet({
  shooters,
  onRecord,
  onCancel,
}: {
  /** Everyone on the range right now. See the header. */
  shooters: readonly RelayShooter[];
  onRecord: (input: {
    category: string;
    narrative: string;
    persons: readonly { personId: string; involvement: IncidentInvolvement }[];
  }) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState<string>("");
  const [narrative, setNarrative] = useState("");
  const [involvement, setInvolvement] = useState<
    Record<string, IncidentInvolvement>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cycle = (personId: string) => {
    const order: (IncidentInvolvement | null)[] = [
      "involved",
      "witness",
      "injured",
      "reported",
      null,
    ];

    setInvolvement((current) => {
      const at = order.indexOf(current[personId] ?? null);
      const next = order[(at + 1) % order.length];
      const copy = { ...current };
      if (next === null) delete copy[personId];
      else copy[personId] = next;
      return copy;
    });
  };

  return (
    <section
      aria-label="Record an incident"
      className="fixed inset-0 z-30 overflow-y-auto bg-[--color-bone] p-4"
    >
      <header className="flex items-start gap-3 border-b border-[--color-terrazzo] pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-medium">Incident</h2>
          <p className="text-[--color-sight-ink]">
            Recorded on this device whether or not there is a connection.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded border border-[--color-reticle-black] px-4 py-3 font-medium"
        >
          Cancel
        </button>
      </header>

      {error && (
        <p
          role="alert"
          className="mt-3 border-l-8 border-[--color-ten-ring-deep] py-2 pl-3 text-lg font-medium"
        >
          {error}
        </p>
      )}

      {/* ------------------------------------------------------- CATEGORY */}

      <h3 className="mt-6 text-sm font-medium tracking-wide uppercase">
        What kind
      </h3>

      <div className="mt-2 grid grid-cols-2 gap-2">
        {incidentCategories.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              setCategory(option.id);
              setError(null);
            }}
            aria-pressed={option.id === category}
            className={`rounded border px-3 py-4 text-left text-base font-medium ${
              option.id === category
                ? "border-[--color-reticle-black] bg-[--color-reticle-black] text-[--color-bone]"
                : "border-[--color-reticle-black]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------ NARRATIVE */}

      <label className="mt-8 block space-y-2">
        <span className="text-sm font-medium tracking-wide uppercase">
          What happened
        </span>
        <textarea
          value={narrative}
          onChange={(event) => {
            setNarrative(event.target.value);
            setError(null);
          }}
          rows={5}
          className="w-full border border-[--color-reticle-black] px-3 py-3 text-lg"
          placeholder="In your own words."
        />
      </label>

      {/* --------------------------------------------------------- PEOPLE */}

      <h3 className="mt-6 text-sm font-medium tracking-wide uppercase">
        Anyone involved
      </h3>

      {shooters.length === 0 ? (
        <p className="mt-1 text-[--color-sight-ink]">
          Nobody is on a lane right now. Say who it was in the account above.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-[--color-terrazzo]">
          {shooters.map((shooter) => (
            <li key={shooter.participationId}>
              <button
                type="button"
                onClick={() => cycle(shooter.personId)}
                className="flex w-full items-center gap-3 py-3 text-left"
              >
                <span className="min-w-0 flex-1 text-lg">{shooter.name}</span>
                <span
                  className={`shrink-0 rounded border px-3 py-2 text-sm font-medium ${
                    involvement[shooter.personId]
                      ? "border-[--color-reticle-black] bg-[--color-reticle-black] text-[--color-bone]"
                      : "border-[--color-sight-grey] text-[--color-sight-ink]"
                  }`}
                >
                  {involvement[shooter.personId]
                    ? involvementLabels[involvement[shooter.personId]]
                    : "Not involved"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (busy) return;
          setBusy(true);
          setError(null);
          void onRecord({
            category,
            narrative,
            persons: Object.entries(involvement).map(
              ([personId, involvement]) => ({ personId, involvement }),
            ),
          })
            .then(setError)
            .finally(() => setBusy(false));
        }}
        /* Never disabled on the strength of the fields. The builder refuses with
           a sentence naming what is missing, which is more use than a dead
           button an officer taps twice and then gives up on. */
        className="mt-8 w-full border border-[--color-reticle-black] bg-[--color-reticle-black] px-4 py-5 text-2xl font-medium text-[--color-bone] disabled:border-[--color-sight-grey] disabled:bg-transparent disabled:text-[--color-sight-grey]"
      >
        Record it
      </button>
    </section>
  );
}
