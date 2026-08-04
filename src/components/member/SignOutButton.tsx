"use client";

import { useActionState } from "react";
import { signOut } from "@/app/actions/auth";

/**
 * Sign out.
 *
 * A form POST rather than a link, because signing out is a state change and a
 * GET that mutates can be triggered by a prefetch or a prefetching browser —
 * the same class of problem the sign-in interstitial exists to solve.
 */
export function SignOutButton() {
  const [, action, pending] = useActionState(async () => {
    await signOut();
    return null;
  }, null);

  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        className={[
          "u-kicker text-[var(--ink)] underline decoration-1 underline-offset-4",
          "transition-opacity duration-[var(--duration-fast)] disabled:opacity-60",
        ].join(" ")}
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </form>
  );
}
