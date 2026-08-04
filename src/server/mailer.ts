/**
 * TRANSACTIONAL EMAIL
 *
 * Flow A step 4 and Flow B steps 5-7 are all email. That makes deliverability a
 * silent single point of failure for the entire funnel: if SPF, DKIM and DMARC
 * are not configured on the club's domain, confirmations land in spam, the flows
 * appear to work perfectly in testing, and applications quietly die.
 *
 * ⚠ DNS IS A LAUNCH TASK, NOT A LATER TASK. Configure SPF, DKIM and DMARC on
 * the club domain in week one and test against real Gmail and Outlook inboxes.
 * No amount of correct code compensates for an unauthenticated sending domain.
 *
 * Written against `fetch` and Web standards only — no SDK, no Node built-ins —
 * so the hosting decision stays late and reversible (see the infra note in the
 * README). Postmark is the provider; swapping it is one adapter.
 */

import { env, isConfigured } from "@/server/env";

export type Email = {
  to: string;
  subject: string;
  /** Plain text. Written first, because it is what a spam filter reads. */
  text: string;
  replyTo?: string;
  /** Groups messages in provider analytics: "application", "booking", etc. */
  tag?: string;
};

export type SendResult =
  | { ok: true; provider: "postmark" | "console" }
  | { ok: false; error: string };

export interface Mailer {
  send(email: Email): Promise<SendResult>;
}

/* ---------------------------------------------------------------------------
   POSTMARK
   -------------------------------------------------------------------------- */

class PostmarkMailer implements Mailer {
  async send(email: Email): Promise<SendResult> {
    try {
      const response = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Postmark-Server-Token": env.postmarkToken!,
        },
        body: JSON.stringify({
          From: env.mailFrom,
          To: email.to,
          Subject: email.subject,
          TextBody: email.text,
          ReplyTo: email.replyTo,
          Tag: email.tag,
          MessageStream: "outbound",
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        return { ok: false, error: `postmark ${response.status}: ${detail.slice(0, 200)}` };
      }
      return { ok: true, provider: "postmark" };
    } catch (error) {
      return { ok: false, error: `postmark request failed: ${describe(error)}` };
    }
  }
}

/* ---------------------------------------------------------------------------
   CONSOLE — development only.

   Never returns ok:true in production. If mail is unconfigured in production,
   the intake layer must know delivery did NOT happen so it can refuse the
   submission rather than showing a false confirmation.
   -------------------------------------------------------------------------- */

class ConsoleMailer implements Mailer {
  async send(email: Email): Promise<SendResult> {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "mail not configured" };
    }
    console.info(
      `\n[mail:dev] to=${email.to} tag=${email.tag}\n  ${email.subject}\n${indent(email.text)}\n`,
    );
    return { ok: true, provider: "console" };
  }
}

export const mailer: Mailer = isConfigured.mail()
  ? new PostmarkMailer()
  : new ConsoleMailer();

const indent = (s: string) =>
  s
    .split("\n")
    .map((l) => `  | ${l}`)
    .join("\n");

export const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
