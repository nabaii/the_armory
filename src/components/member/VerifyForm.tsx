"use client";

import { useActionState } from "react";
import { FormStatus, SubmitButton } from "@/components/ui/Form";
import { Button } from "@/components/ui/Button";
import { completeSignIn } from "@/app/actions/auth";
import { routes } from "@/lib/site";

/**
 * The POST that actually redeems a sign-in token.
 *
 * A form rather than an auto-submitting effect, deliberately: auto-submitting
 * on mount would reintroduce exactly the problem the interstitial exists to
 * solve, since a headless scanner that executes JavaScript would submit it.
 */
export function VerifyForm({ token, next }: { token: string; next: string }) {
  const [state, action, pending] = useActionState(completeSignIn, {});

  return (
    <form action={action}>
      {state.error && (
        <div className="mb-4">
          <FormStatus tone="error" heading="That link no longer works.">
            {state.error}
          </FormStatus>
          <Button href={routes.signIn} variant="primary" className="mt-3">
            Request a new link
          </Button>
        </div>
      )}

      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="next" value={next} />

      {!state.error && (
        <SubmitButton pending={pending}>
          {pending ? "Signing you in…" : "Sign in"}
        </SubmitButton>
      )}
    </form>
  );
}
