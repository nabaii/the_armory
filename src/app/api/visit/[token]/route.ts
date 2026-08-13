import { invitationForToken } from "@/server/armory/invitations";
import { handleRead } from "@/server/armory/http";
import { LIMITS, clientKey, rateLimit } from "@/server/rate-limit";

/**
 * GET /api/visit/:token — §7's `/visit/{token}` (public read), behind §6.3.
 *
 *   §6.3: "HIGHEST-STAKES SCREEN IN THE BUILD. Two minutes, on a phone, in poor
 *          signal, by someone who has never heard of you… opened once, in a car,
 *          by someone slightly nervous about shooting for the first time…
 *          with NO ACCOUNT CREATION AND NO PASSWORD."
 *
 * So this is the one endpoint in the management system with no session of any
 * kind. The token in the URL is the entire credential, which makes the two
 * decisions below the whole security posture of the surface.
 *
 * ===========================================================================
 * RATE LIMITED, BECAUSE §10 SAYS SO AND BECAUSE THE MATHS DEMANDS IT
 *
 * §10: "Rate limiting — on OTP request and on the guest token endpoint."
 *
 * The token is 256 bits from a CSPRNG (invitations.ts), so guessing one is not a
 * realistic attack and the rate limit is not really about that. It is about what
 * an unlimited endpoint becomes: a way to test a stolen list of links, and a way
 * to hammer the database from anywhere with a URL and no account.
 *
 * ===========================================================================
 * A CLOSED INVITATION STILL GETS AN ANSWER
 *
 * Expired, cancelled and already-attended each get their own sentence rather
 * than collapsing into "invalid link".
 *
 * The reason is §6.3's description of who is holding the phone. Someone nervous,
 * in a car park, who has never heard of the club — "this link has expired, ask
 * Ada to send you another" tells them what to do. "Invalid link" tells them they
 * have done something wrong, and the club loses the acquisition §3.2 calls the
 * funnel it must treat as seriously as the firearm register.
 *
 * A token that matches nothing at all is the one case that says little, because
 * that one may genuinely be someone probing.
 */

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;

  const limit = rateLimit(clientKey(request, "guest-token"), LIMITS.guestToken);
  if (!limit.allowed) {
    return new Response(
      JSON.stringify({
        reason: "Too many attempts. Wait a moment and open the link again.",
        remedy: null,
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "retry-after": String(limit.retryAfter),
        },
      },
    );
  }

  return handleRead("visit.resolve", async (tx) => {
    const invitation = await invitationForToken(tx, token);

    if (!invitation) {
      return {
        state: "unknown" as const,
        message: "This link is not one the club recognises.",
      };
    }

    const now = new Date();

    /* The clock, not the status column. A sweep maintains the column and the
       clock is what is true in between — the same reasoning the capability
       service applies to licences and invitations elsewhere. */
    if (invitation.expiresAt <= now) {
      return {
        state: "expired" as const,
        message: `This link has expired. Ask ${invitation.hostName} to send you another.`,
      };
    }

    switch (invitation.status) {
      case "cancelled":
        return {
          state: "cancelled" as const,
          message: `${invitation.hostName} cancelled this visit. Give them a call if that is a surprise.`,
        };

      case "expired":
        return {
          state: "expired" as const,
          message: `This link has expired. Ask ${invitation.hostName} to send you another.`,
        };

      case "attended":
        return {
          state: "attended" as const,
          message: "You have already visited on this invitation.",
        };

      case "issued":
      case "opened":
      case "completed":
        return {
          state: "open" as const,
          invitationId: invitation.invitationId,
          hostName: invitation.hostName,
          expiresAt: invitation.expiresAt.toISOString(),
          /* Whether they have already filled it in. §6.3 turns the link into
             their result page after the session, so a completed invitation is
             not "done" — it is a different screen. */
          completed: invitation.status === "completed",
        };
    }
  });
}
