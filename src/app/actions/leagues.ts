"use server";

import { redirect } from "next/navigation";
import { requireMember } from "@/server/auth/session";
import { createLeague, joinLeagueByCode } from "@/server/leagues/repository";
import { normaliseJoinCode } from "@/server/leagues/join-code";
import { canCaptainLeague } from "@/server/leagues/eligibility";
import { isDatabaseConfigured } from "@/db/client";
import { log } from "@/server/log";
import { routes } from "@/lib/site";

/**
 * LEAGUE ACTIONS.
 *
 * Every action re-authenticates through `requireMember()` rather than trusting
 * anything passed in. A server action is a public HTTP endpoint: the fact that
 * the only button pointing at it sits behind a guarded layout protects the
 * button, not the endpoint.
 */

import type { LeagueState } from "@/lib/league-state";

/* ---------------------------------------------------------------------------
   CREATE
   -------------------------------------------------------------------------- */

export async function createLeagueAction(
  _previous: LeagueState,
  form: FormData,
): Promise<LeagueState> {
  const member = await requireMember();

  if (!isDatabaseConfigured()) {
    return { formError: "Leagues are not available yet." };
  }

  /* Checked here AND in the repository. This one produces a good message; the
     repository's is the rule. */
  if (!canCaptainLeague(member.status)) {
    return {
      formError:
        "Creating a league is a members' privilege. You can join a league that a member has started.",
    };
  }

  const name = String(form.get("name") ?? "").trim();
  const weekdayRaw = String(form.get("anchorWeekday") ?? "");

  const errors: Record<string, string> = {};

  if (name.length < 2) errors.name = "Give your league a name.";
  else if (name.length > 60) errors.name = "That name is a little long.";

  /* The night the league INTENDS to play. Advisory: §6 makes fixtures
     asynchronous — "the fixture is a week, not an evening" — so this goes in
     the group chat and is never enforced. */
  const anchorWeekday = Number.parseInt(weekdayRaw, 10);
  if (!Number.isInteger(anchorWeekday) || anchorWeekday < 0 || anchorWeekday > 6) {
    errors.anchorWeekday = "Choose the night you plan to play.";
  }

  if (Object.keys(errors).length > 0) return { errors };

  const result = await createLeague({ name, captain: member, anchorWeekday });

  if (!result.ok) {
    if (result.reason === "no-season") {
      return {
        formError:
          "There is no season running at the moment. Leagues open when the next season does.",
      };
    }
    log.error("league creation failed", { reason: result.reason });
    return { formError: "We could not create that league. Please try again." };
  }

  log.info("league created", { leagueId: result.league.id });
  redirect(routes.league(result.league.id));
}

/* ---------------------------------------------------------------------------
   JOIN
   -------------------------------------------------------------------------- */

export async function joinLeagueAction(
  _previous: LeagueState,
  form: FormData,
): Promise<LeagueState> {
  const member = await requireMember();

  if (!isDatabaseConfigured()) {
    return { formError: "Leagues are not available yet." };
  }

  const raw = String(form.get("joinCode") ?? "");
  const joinCode = normaliseJoinCode(raw);

  if (!joinCode) {
    return {
      errors: {
        joinCode: "That code does not look right. It is six characters, like ABC-234.",
      },
    };
  }

  const result = await joinLeagueByCode({ joinCode, member });

  if (!result.ok) {
    switch (result.reason) {
      case "no-such-code":
        /* Same message as a malformed code: confirming that a code EXISTS but
           is not yours would let someone probe for live leagues. */
        return {
          errors: {
            joinCode: "We could not find a league with that code. Check it with whoever invited you.",
          },
        };

      case "already-in":
        /* Not an error from the member's point of view — they are trying to get
           somewhere they already belong. Send them there. */
        redirect(routes.portal);
        break;

      case "league-full":
        return {
          errors: {
            joinCode: "That league is full. A league is a small group by design.",
          },
        };

      case "not-eligible": {
        const { eligibility } = result;
        if (!eligibility.ok && eligibility.reason === "season-cap-reached") {
          /* THE CONVERSION MOMENT.

             This person has just played a full season and enjoyed it enough to
             join another league. The Brief's whole access model turns on this
             instant: "anyone playing weekly discovers, without being pitched,
             that membership is cheaper."

             So it is not rendered as a rejection. See SEASON_CAP_MESSAGE — the
             copy offers the club rather than refusing the league. */
          return { capReached: true };
        }
        return {
          formError:
            "Your membership has lapsed. Speak to us and we will get you back on the line.",
        };
      }
    }
  }

  if (result.ok) {
    log.info("joined league", { leagueId: result.league.id });
    redirect(routes.league(result.league.id));
  }

  return { formError: "We could not join that league. Please try again." };
}

/* The cap copy the form renders is re-exported from @/lib/league-state — a
   `"use server"` file may export only async functions. */
