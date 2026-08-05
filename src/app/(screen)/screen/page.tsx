import { ScreenApp } from "@/components/screen/ScreenApp";

/**
 * /screen — the live tournament display.
 *
 * Entirely client-side once loaded, because §5 requires it to run offline:
 * "Must not depend on internet connectivity to display a live tournament."
 * The engine is pure, the state is in localStorage, and nothing here calls a
 * server after the first load.
 *
 * Static, so it can be cached by the browser and opened on a venue machine with
 * no connection at all.
 */
export default function ScreenPage() {
  return <ScreenApp />;
}
