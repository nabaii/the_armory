import type { ConnectionOptions } from "node:tls";

/**
 * WHEN TO DEMAND TLS, AND WHAT TO VERIFY AGAINST — decided once.
 *
 * §10 requires "TLS in transit", and this data is identity documents, home
 * addresses, dates of birth and firearm licences.
 *
 * ===========================================================================
 * WHY THIS IS ITS OWN MODULE
 *
 * Two things connect to this database and they are not the same program:
 *
 *   · the APPLICATION, through src/db/pool.ts
 *   · MIGRATIONS, through drizzle.config.ts, run by drizzle-kit from a laptop
 *     or a deploy hook
 *
 * The rule lived only in the pool, and the consequence was found the first time
 * anybody pointed `db:migrate` at a managed provider: Render refuses a
 * connection that does not offer TLS, the driver reported `ECONNRESET`, and
 * drizzle-kit swallowed it into a bare exit code 1 with an empty stderr and a
 * spinner that simply stopped. The database stayed empty and nothing said why.
 *
 * A security rule that only one of two callers applies is not a rule. This is
 * the rule; both import it.
 */

/**
 * Whether this connection needs TLS at all.
 *
 * The only exception is a local connection during development, where there is
 * no certificate to verify and no network to intercept. Anything else —
 * including a hostname that merely LOOKS local, and every connection in
 * production — gets TLS with verification on, rather than the
 * `rejectUnauthorized: false` that turns TLS into decoration.
 */
export function needsTls(url: string): boolean {
  if (process.env.NODE_ENV !== "production") {
    return !/@(localhost|127\.0\.0\.1|::1|host\.docker\.internal)[:/]/.test(url);
  }
  return true;
}

/**
 * TLS options for `pg`, or `undefined` for a local connection.
 *
 * ===========================================================================
 * `DATABASE_CA_CERT`, AND THE THING SOMEBODY WOULD OTHERWISE DO AT 2AM
 *
 * `rejectUnauthorized: true` verifies the server's certificate against Node's
 * built-in CA bundle. Several managed Postgres providers present certificates
 * that bundle does not contain, so a correctly configured deployment can fail
 * its first connection with:
 *
 *   SELF_SIGNED_CERT_IN_CHAIN
 *   UNABLE_TO_VERIFY_LEAF_SIGNATURE
 *
 * There is exactly one search result away from that error, and it is
 * `rejectUnauthorized: false`. That does not fix a certificate problem — it
 * removes the check that noticed one, leaving the connection encrypted against
 * a passive listener and wide open to an active one.
 *
 * So the correct fix is configuration rather than a code edit made under
 * deployment pressure: set `DATABASE_CA_CERT` to the provider's CA certificate
 * (PEM) and verification continues against THAT.
 *
 * There is deliberately no environment variable that disables verification. If
 * one is ever genuinely needed it should be added here, with a comment arguing
 * for it — not discovered in a dashboard by whoever is on call.
 */
export function tlsOptions(url: string): ConnectionOptions | undefined {
  if (!needsTls(url)) return undefined;

  /* Render and several others hand the CA over as a single-line PEM with
     literal `\n`. Both forms are accepted so pasting either into a dashboard
     works. */
  const ca = process.env.DATABASE_CA_CERT?.trim().replace(/\\n/g, "\n");

  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}
