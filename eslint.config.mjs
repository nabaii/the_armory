import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * A `"use server"` MODULE MAY EXPORT ONLY ASYNC FUNCTIONS.
 *
 * Members Portal Design Specification §13.2, named risk:
 *
 *   "One of the three defects behind the member sign-in failure was seven
 *    'use server' modules exporting their form-state objects. Next registers
 *    every export as a client-callable endpoint, so those modules threw on
 *    submit and took sign-in, the application, the enquiry and the waitlist
 *    forms down together. The booking flow is the largest new server-action
 *    surface in this document. THE SAME FAILURE WILL RECUR THERE unless the
 *    constraint is captured as a lint rule rather than as institutional
 *    memory."
 *
 * This is that rule. It is written as a `no-restricted-syntax` selector rather
 * than as a plugin because the whole rule is one AST shape: in a file whose
 * first statement is the "use server" directive, an export whose declaration is
 * not an async function declaration is the defect.
 *
 * ===========================================================================
 * WHAT IT CATCHES, AND WHAT IT CANNOT
 *
 * It catches the exact shape that failed — `export const emptyState = {...}`,
 * `export type` is erased and harmless, `export function` without `async` is
 * caught, and a re-export of a value is caught.
 *
 * It cannot catch an async function that is assigned to a const and exported,
 * which Next does accept. That form is legal and is deliberately not flagged;
 * the rule is aimed at the failure, not at style.
 *
 * The remedy when it fires is always the same and is never to disable it: move
 * the value to its own module. src/lib/hosting-state.ts, src/lib/money-state.ts
 * and src/lib/booking-flow-state.ts all exist for this reason and each says so
 * at the top.
 */
const USE_SERVER_EXPORTS = {
  files: ["src/app/actions/**/*.ts", "src/**/actions.ts"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector:
          "Program:has(ExpressionStatement:first-child > Literal[value='use server']) > ExportNamedDeclaration > VariableDeclaration",
        message:
          'A "use server" module may export only async functions. Next registers every export as a client-callable endpoint, and a plain value there throws on submit — taking every form in the module down with it. Move the value to its own module, as src/lib/booking-flow-state.ts does.',
      },
      {
        selector:
          "Program:has(ExpressionStatement:first-child > Literal[value='use server']) > ExportNamedDeclaration > FunctionDeclaration[async=false]",
        message:
          'A "use server" module may export only ASYNC functions. A synchronous export is registered as an endpoint and fails the same way. Move it to its own module.',
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  USE_SERVER_EXPORTS,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
