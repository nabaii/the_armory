/**
 * What every intake form renders from.
 *
 * `formError` is for problems that are not a specific field's fault — rate
 * limiting, or an unconfigured pipeline. It is always accompanied by an
 * instruction the visitor can act on.
 *
 * In its own module because a `"use server"` file may export only async
 * functions. The full reasoning is in src/lib/money-state.ts.
 */

import type { FieldErrors } from "@/server/validation";

export type IntakeState = {
  ok: boolean;
  errors?: FieldErrors;
  formError?: string;
};

export const emptyIntakeState: IntakeState = { ok: false };
