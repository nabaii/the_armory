/**
 * The form state the guest visit action returns — §6.3's car-park link.
 *
 * In its own module because a `"use server"` file may export only async
 * functions. The full reasoning is in src/lib/money-state.ts.
 */

import type { FieldErrors } from "@/server/validation";

export type VisitState = {
  ok: boolean;
  errors?: FieldErrors;
  formError?: string;
};

export const emptyVisitState: VisitState = { ok: false };
