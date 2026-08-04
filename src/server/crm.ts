/**
 * CRM — the only durable store this site has, and deliberately so.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO DATABASE
 *
 * From the Brief: the site touches member identities and visit schedules,
 * "effectively a list of wealthy Abuja residents and where they will be, and
 * when. That is an attractive target."
 *
 * The most secure store is the one that does not exist. Phase 1 therefore runs
 * no database of its own: submissions are written straight to a CRM that already
 * has access control, audit trails, 2FA and a support contract, and nothing is
 * persisted by the web application at all.
 *
 * The consequence is that the CRM becomes the crown jewels. Mandatory 2FA, a
 * named access list, no seats outside it, and a weekly encrypted export — since
 * with no database of our own, the CRM's export is the only recovery path.
 *
 * Spec §7 also forbids personal data in the CMS "under any circumstances". The
 * CMS holds marketing copy and imagery. Nothing here goes near it.
 * ---------------------------------------------------------------------------
 */

import { env, isConfigured } from "@/server/env";
import { describe } from "@/server/mailer";

export type CrmContact = {
  email: string;
  name: string;
  phone?: string;
  /** "membership-application" | "group-enquiry" | "leagues-waitlist" */
  pipeline: string;
  /** Free-form context. Never identity documents. */
  properties?: Record<string, string>;
};

export type CrmResult =
  | { ok: true; provider: string; id?: string }
  | { ok: false; error: string };

export interface CrmClient {
  upsertContact(contact: CrmContact): Promise<CrmResult>;
}

/* ---------------------------------------------------------------------------
   HUBSPOT
   -------------------------------------------------------------------------- */

class HubSpotCrmClient implements CrmClient {
  async upsertContact(contact: CrmContact): Promise<CrmResult> {
    const [firstname, ...rest] = contact.name.split(" ");

    const properties: Record<string, string> = {
      email: contact.email,
      firstname,
      lastname: rest.join(" ") || firstname,
      lifecyclestage: "lead",
      armory_pipeline: contact.pipeline,
      ...contact.properties,
    };
    if (contact.phone) properties.phone = contact.phone;

    try {
      const response = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.crmToken}`,
        },
        body: JSON.stringify({ properties }),
        signal: AbortSignal.timeout(10_000),
      });

      /* 409 means the contact already exists — for an application that is a
         successful outcome, not an error. A returning enquirer is normal. */
      if (response.status === 409) return { ok: true, provider: "hubspot" };

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        return { ok: false, error: `hubspot ${response.status}: ${detail.slice(0, 200)}` };
      }

      const body = (await response.json()) as { id?: string };
      return { ok: true, provider: "hubspot", id: body.id };
    } catch (error) {
      return { ok: false, error: `hubspot request failed: ${describe(error)}` };
    }
  }
}

/**
 * No CRM configured. Always reports failure so the intake layer falls through
 * to the email path rather than believing the record was stored.
 */
class UnconfiguredCrmClient implements CrmClient {
  async upsertContact(): Promise<CrmResult> {
    return { ok: false, error: "crm not configured" };
  }
}

export const crm: CrmClient =
  isConfigured.crm() && env.crmProvider === "hubspot"
    ? new HubSpotCrmClient()
    : new UnconfiguredCrmClient();
