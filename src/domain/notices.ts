import { EXPIRY_WARNING_DAYS, expiries, type Expiry, type Subject } from "./capability";

/**
 * THE NOTICE LADDER — §12.
 *
 *   §12.1, on a member whose licence expired yesterday:
 *     "Own-firearm use blocked. Club-equipment shooting still permitted.
 *      WARNINGS WERE SENT AT 60, 30 AND 7 DAYS."
 *
 * That last sentence is written as part of the expected behaviour of a test
 * scenario, which is easy to read past. It is a requirement: the club must be
 * able to say it warned them, three times, on a schedule, before the thing that
 * blocked them at the desk.
 *
 * §4.3 is the same obligation stated as a principle — "Blocks that a member
 * could have resolved in advance must have been surfaced in the portal in
 * advance. Anything a member first learns at the desk, in front of their guest,
 * is a defect in this system." The portal surfacing is
 * `foreseeableBlocks()`; this is the half that reaches someone who has not
 * opened the portal.
 *
 * ===========================================================================
 * PURE, LIKE EVERYTHING THAT DECIDES
 *
 * This computes WHO should be written to and WHAT ABOUT. It does not send, and
 * it does not know that WhatsApp exists (§9). Sending is retried, queued and
 * templated by the integration layer; deciding is a function of the roster and
 * the date, and keeping the two apart means the decision can be tested against
 * a hundred members and a period boundary without a network.
 *
 * ===========================================================================
 * ONE MESSAGE, NOT THREE
 *
 * A member whose licence, club sign-off and membership renewal all land on the
 * same rung gets ONE message naming three things.
 *
 * The reasoning is §4.3's, applied outside the desk: a block "never a stack of
 * conditions" exists because a stack is unreadable and unactionable. Three
 * separate WhatsApp messages within a second of each other are that stack,
 * delivered worse — and the club's primary channel (§9) is the one place it can
 * least afford to read as automated noise. A member who mutes the club because
 * it sent them three messages about one renewal is a member who will not see
 * the fourth.
 *
 * ===========================================================================
 * WHY EACH NOTICE CARRIES A KEY
 *
 * The sweep runs on a schedule and schedules are re-run: a deploy at midday, a
 * retried job, a founder pressing the button because they were not sure the
 * first one worked. None of those may produce a second message.
 *
 * So a notice carries a deterministic `key` built from the person, the thing
 * expiring, its date and the rung. Running this function twice on the same day
 * with the same roster produces byte-identical keys, and the send layer stores
 * them and skips what it has already sent. The idempotency is a property of the
 * decision rather than of the sender's bookkeeping, which is what lets it
 * survive a sender being replaced.
 */

export type Notice = {
  readonly personId: string;
  /** Which rung of the ladder. One of EXPIRY_WARNING_DAYS. */
  readonly daysRemaining: number;
  /**
   * Everything expiring for this person on this rung. Never empty, and ordered
   * as `expiries()` orders them — soonest first.
   */
  readonly items: readonly Expiry[];
  /**
   * Stable across re-runs on the same day. The unit of "already sent".
   *
   * Deliberately built from the expiry DATE rather than from today's date: a
   * licence renewed and re-recorded with a new expiry produces a different key
   * and so is warned about again, which is correct, while the same licence seen
   * twice in one day produces the same key and is not.
   */
  readonly key: string;
};

/** What the sender needs to know about a person, alongside their Subject. */
export type NoticeCandidate = {
  readonly subject: Subject;
};

/**
 * Everyone who should hear from the club today, and about what.
 *
 * `now` is the only clock. Callers pass the sweep's instant so a run replayed
 * against yesterday produces yesterday's notices rather than today's — which is
 * what makes this testable against §12.1's boundary cases at all.
 */
export function noticesDue(
  roster: readonly NoticeCandidate[],
  now: Date,
): Notice[] {
  const notices: Notice[] = [];

  for (const candidate of roster) {
    /* The widest rung bounds the window. Asking for 60 days and then filtering
       to the ladder is one pass; asking per rung would be three. */
    const widest = Math.max(...EXPIRY_WARNING_DAYS);
    const due = expiries(candidate.subject, now, widest).filter(
      (expiry) => expiry.isWarningDay,
    );

    if (due.length === 0) continue;

    /* Group by rung. Two things expiring 30 days apart are two conversations
       and must not be merged into one message; two things expiring on the same
       rung are one. */
    const byRung = new Map<number, Expiry[]>();
    for (const expiry of due) {
      const bucket = byRung.get(expiry.daysRemaining);
      if (bucket) bucket.push(expiry);
      else byRung.set(expiry.daysRemaining, [expiry]);
    }

    for (const [daysRemaining, items] of byRung) {
      notices.push({
        personId: candidate.subject.personId,
        daysRemaining,
        items,
        key: noticeKey(candidate.subject.personId, daysRemaining, items),
      });
    }
  }

  /* Soonest first, so a sender working through a backlog under a rate limit
     delivers the most urgent warnings before the least. */
  return notices.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

/**
 * The idempotency key.
 *
 * Sorted, so the key does not depend on the order `expiries()` happened to
 * return two things that fall on the same day — an ordering change would
 * otherwise reissue every notice in the club exactly once, which is the kind of
 * bug that looks like a mail-merge accident to the members receiving it.
 */
function noticeKey(
  personId: string,
  daysRemaining: number,
  items: readonly Expiry[],
): string {
  const parts = items
    .map((item) => `${item.kind}@${item.expiresOn.toISOString().slice(0, 10)}`)
    .sort();

  return `notice:${personId}:${daysRemaining}:${parts.join(",")}`;
}

/**
 * The line that goes at the top of the message.
 *
 * Here rather than in a template file because §4.1 makes the human string part
 * of the contract — "the human string is what the desk displays and what the
 * member reads in the portal, so it must be written by someone who can write" —
 * and the same sentence should reach them by every route. A member who reads
 * one wording in WhatsApp and a different one in the portal has to work out
 * whether they are two problems.
 */
export function noticeSummary(notice: Notice): string {
  const when =
    notice.daysRemaining === 0
      ? "today"
      : notice.daysRemaining === 1
        ? "tomorrow"
        : `in ${notice.daysRemaining} days`;

  if (notice.items.length === 1) {
    return `${notice.items[0].label} expires ${when}.`;
  }

  const labels = notice.items.map((item) => item.label);
  const last = labels[labels.length - 1];
  const rest = labels.slice(0, -1).join(", ");

  return `${rest} and ${last} expire ${when}.`;
}
