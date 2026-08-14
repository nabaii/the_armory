import {
  INCIDENT_CATEGORIES,
  INCIDENT_INVOLVEMENTS,
  type IncidentCategory,
  type IncidentInvolvement,
} from "@/domain/enums";
import { uuidv7 } from "@/lib/uuidv7";

/**
 * RECORDING AN INCIDENT — §6.5, §3.3.
 *
 *   §6.5: "Incident — ALWAYS REACHABLE, NEVER MORE THAN ONE TAP AWAY, ALWAYS
 *    AVAILABLE OFFLINE."
 *   §3.3: "Plus incident_persons join carrying person_id and involvement. Must
 *    be creatable offline."
 *
 * ===========================================================================
 * WHAT "ONE TAP AWAY" IS PROTECTING AGAINST
 *
 * Not convenience. The failure this requirement exists to prevent is an
 * incident that is never recorded at all, and the way that happens is never a
 * refusal — it is an officer dealing with something on a live firing line who
 * would have to leave the screen they are on, find a menu, and answer four
 * questions before they could write anything down. They deal with the incident,
 * intend to record it afterwards, and afterwards is the end of a long evening.
 *
 * So this builder asks for as little as it can and refuses almost nothing:
 *
 *   · The SESSION is optional. Things happen in the car park and before the
 *     session opens.
 *   · The PEOPLE are optional. An equipment fault involves nobody.
 *   · The TIME defaults to now and can be moved back, because an officer
 *     writing it up twenty minutes later should not have to lie about when it
 *     happened.
 *
 * The two things it insists on are a category and an account of what happened,
 * because an incident row without them is not a record of anything.
 *
 * ===========================================================================
 * IT DOES NOT REACH THE CAPABILITY SERVICE, AND IT DOES NOT REACH THE PACK
 *
 * §4's service answers whether somebody may do something. Nobody needs
 * permission to report that something went wrong, and a permission check here
 * would be a route by which an incident could be refused.
 *
 * It does not read the day pack either, which is why it takes person ids rather
 * than looking anyone up. That keeps it usable for a person the device has
 * never heard of — a contractor, a spectator, somebody from the stadium — where
 * the lane screen supplies the id it has. The server's parser validates the
 * references; a device with a stale pack must not be the reason an injury goes
 * unrecorded.
 */

export type IncidentRefusal = {
  readonly reason: string;
  readonly remedy: string | null;
};

export type QueuedIncidentWrite = {
  readonly id: string;
  readonly operation: "incidents.create";
  readonly payload: unknown;
};

/** An incident this device recorded, held locally until it is delivered. */
export type LocalIncident = {
  readonly id: string;
  readonly sessionId: string | null;
  readonly category: IncidentCategory;
  readonly narrative: string;
  readonly occurredAt: string;
  readonly reportedByStaffId: string | null;
  readonly persons: readonly {
    readonly personId: string;
    readonly involvement: IncidentInvolvement;
  }[];
};

export type IncidentWrites = {
  readonly incident: LocalIncident;
  readonly queue: readonly QueuedIncidentWrite[];
};

export type IncidentResult =
  | { readonly ok: true; readonly writes: IncidentWrites }
  | { readonly ok: false; readonly refusal: IncidentRefusal };

export type IncidentContext = {
  /** §10. Null only when no officer has unlocked the tablet. */
  readonly actorStaffId: string | null;
  readonly now: Date;
  /** Null is legitimate — see the header. */
  readonly sessionId: string | null;
};

const refuse = (reason: string, remedy: string | null): IncidentResult => ({
  ok: false,
  refusal: { reason, remedy },
});

export function buildIncident(
  input: {
    readonly category: string;
    readonly narrative: string;
    readonly persons: readonly {
      readonly personId: string;
      readonly involvement: string;
    }[];
    /** Defaults to `context.now`. Never in the future — see below. */
    readonly occurredAt?: Date;
  },
  context: IncidentContext,
): IncidentResult {
  if (!(INCIDENT_CATEGORIES as readonly string[]).includes(input.category)) {
    return refuse(
      "Choose what kind of incident this was.",
      "Use Other if none of them fit.",
    );
  }

  const narrative = input.narrative.trim();

  if (narrative === "") {
    return refuse(
      "Say what happened, in a sentence or two.",
      "It does not have to be tidy. It has to exist.",
    );
  }

  const seen = new Set<string>();
  const persons: {
    personId: string;
    involvement: IncidentInvolvement;
  }[] = [];

  for (const entry of input.persons) {
    if (
      !(INCIDENT_INVOLVEMENTS as readonly string[]).includes(entry.involvement)
    ) {
      return refuse(
        "Say how each person named was involved.",
        "Involved, witness, injured, or reported it.",
      );
    }

    /* Same de-duplication as the server parser, for the same reason: the join's
       key is (incident, person) and a double tap must not take the whole
       transaction down. First entry wins — an officer who taps twice meant the
       first one. */
    if (seen.has(entry.personId)) continue;
    seen.add(entry.personId);

    persons.push({
      personId: entry.personId,
      involvement: entry.involvement as IncidentInvolvement,
    });
  }

  /**
   * An incident cannot have happened later than now.
   *
   * Clamped rather than refused. §10's clock rules exist because a tablet back
   * from a dead battery can believe it is 1970, and an officer who has entered
   * a time the device reads as the future is looking at a device with a wrong
   * clock — not at a mistake worth blocking a safety record over.
   */
  const occurredAt =
    input.occurredAt && input.occurredAt.getTime() <= context.now.getTime()
      ? input.occurredAt
      : context.now;

  const id = uuidv7();

  const incident: LocalIncident = {
    id,
    sessionId: context.sessionId,
    category: input.category as IncidentCategory,
    narrative,
    occurredAt: occurredAt.toISOString(),
    reportedByStaffId: context.actorStaffId,
    persons,
  };

  return {
    ok: true,
    writes: {
      incident,
      queue: [
        {
          id,
          operation: "incidents.create",
          payload: {
            sessionId: incident.sessionId,
            category: incident.category,
            narrative: incident.narrative,
            occurredAt: incident.occurredAt,
            /* §3.3's default. Sent explicitly so the row's meaning does not
               depend on a column default the device cannot see. */
            followUpStatus: "open",
            persons: incident.persons.map((person) => ({ ...person })),
          },
        },
      ],
    },
  };
}

/** The categories, in the order the lane offers them. §6.5's one tap. */
export const incidentCategories: readonly {
  readonly id: IncidentCategory;
  readonly label: string;
}[] = [
  { id: "negligent_discharge", label: "Negligent discharge" },
  { id: "safety_breach", label: "Safety breach" },
  { id: "injury", label: "Injury" },
  { id: "equipment_fault", label: "Equipment fault" },
  { id: "property_damage", label: "Property damage" },
  { id: "conduct", label: "Conduct" },
  { id: "other", label: "Other" },
];

export const involvementLabels: Record<IncidentInvolvement, string> = {
  involved: "Involved",
  witness: "Witness",
  injured: "Injured",
  reported: "Reported it",
};
