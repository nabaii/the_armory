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
 * The hostname a connection string names, or null if it cannot be read.
 *
 * `new URL` handles the percent-encoded passwords managed providers generate;
 * the regex is the fallback for a string it refuses, so a malformed URL degrades
 * to "not private" — the safe direction, because the fallback decides whether a
 * certificate gets verified.
 */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return /@([^/:?]+)/.exec(url)?.[1] ?? null;
  }
}

/**
 * Whether the host is reachable only from inside a provider's private network.
 *
 * The test is that the name has no dots. A single-label hostname has no public
 * DNS answer and no route from the internet — Render's `dpg-xxxxx-a`, a Docker
 * service name, a Kubernetes short name. A host with a dot is treated as public
 * even when it looks internal, because being wrong in that direction only costs
 * a verified connection, while being wrong the other way costs the check itself.
 */
export function isPrivateHost(url: string): boolean {
  const host = hostOf(url);
  return host !== null && !host.includes(".");
}

/**
 * TLS options for `pg`, or `undefined` for a local connection.
 *
 * ===========================================================================
 * THE ARGUMENT THIS FILE ASKED FOR, MADE
 *
 * The note below says there is deliberately no way to disable verification, and
 * that if one is ever genuinely needed it should be added HERE with an argument
 * rather than found in a dashboard by whoever is on call. This is that argument.
 *
 * Render's managed Postgres presents a bare self-signed certificate. Asked
 * directly, the server reports `ssl_ca_file` empty — there is no chain and no
 * published CA, which is why the dashboard offers no certificate to download.
 * `rejectUnauthorized: true` therefore cannot succeed against it by any
 * configuration; the sign-in path failed with "self-signed certificate" on every
 * attempt, and no value of `DATABASE_CA_CERT` obtainable from the provider fixes
 * it. Only the certificate the server itself presents would, by pinning.
 *
 * So the exception is drawn as narrowly as the failure: it applies ONLY to a
 * single-label hostname, which by construction is a private-network name with no
 * route from the internet. Every host with a dot in it — every external endpoint,
 * every connection that leaves the provider — keeps full verification and fails
 * closed exactly as before.
 *
 * What is given up, stated plainly: on that private link the connection is
 * encrypted but not authenticated. Passive interception is still defeated; an
 * attacker already positioned inside the provider's private network is not. That
 * is a real reduction and it is the reason this is scoped to a hostname that
 * cannot be reached from outside, rather than to an environment variable that
 * could be set anywhere.
 *
 * `DATABASE_CA_CERT` still wins wherever it is set, private host included. Pin
 * the server's certificate and this branch is never reached — the upgrade path
 * needs no code change, only the value.
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

  /* Checked first, so pinning a certificate upgrades a private connection back
     to a verified one without touching this file. */
  if (ca) return { rejectUnauthorized: true, ca };

  /* Encrypted, unauthenticated, and only where the name cannot be resolved from
     outside the provider. See the argument above. */
  if (isPrivateHost(url)) return { rejectUnauthorized: false };

  return { rejectUnauthorized: true };
}
