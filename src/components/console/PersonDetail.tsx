"use client";

import type { PersonDetailView } from "@/offline/person";

/**
 * PERSON DETAIL — §6.4.
 *
 *   "Opened only when the officer needs it. Documents, history, current blocks
 *    with reasons."
 *
 * Renders and nothing else. Every sentence on this screen was written by
 * src/domain/capability/reasons.ts and selected by src/offline/person.ts; there
 * is no condition in this file that decides anything about a person.
 *
 * ===========================================================================
 * WHY IT IS A PANEL AND NOT A ROUTE
 *
 * §6.4 opens with Today being "the default and dominant screen", and this screen
 * being opened "only when the officer needs it". A route would survive a back
 * button, a reload and a tab restore — it would become somewhere the desk can be
 * left sitting. A panel over Today closes when the question is answered, which is
 * the interaction §1.2's fifteen-second budget actually describes.
 *
 * It also means Today never unmounts, so re-opening the desk's dominant screen
 * costs nothing and cannot re-enter the one-second cold start (§2).
 *
 * ===========================================================================
 * NO DOCUMENT IS RENDERED HERE, EVER
 *
 * §10: licence scans are "readable only by the founder role. Not by range
 * officers. Not on the desk or lane surfaces."
 *
 * The documents list shows what a document ESTABLISHES — verified, which
 * calibres, until when. There is no image, no link, and no key to build one
 * from: `documentUrl` never reaches this surface (see src/offline/daypack.ts).
 * If a future change makes it available, it must not be rendered here, and
 * `assertNoRestrictedFields` should stop it before this file is reached.
 */

/** Live or not, three ways — the same reasoning as Today's status glyphs. */
const DOCUMENT_GLYPH = { live: "✓", lapsed: "✕" } as const;

export function PersonDetail({
  view,
  onClose,
}: {
  view: PersonDetailView;
  onClose: () => void;
}) {
  return (
    <section
      aria-label={`${view.name} — detail`}
      className="fixed inset-0 z-20 overflow-y-auto bg-[--color-bone] p-4"
    >
      <header className="flex items-start gap-3 border-b border-[--color-terrazzo] pb-4">
        {view.photoUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- a signed,
             expiring URL from object storage; next/image would proxy and cache
             it, which is the one thing §10 does not want done with a member's
             face. Same reasoning as Today.tsx. */
          <img
            src={view.photoUrl}
            alt=""
            className="size-14 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[--color-terrazzo] font-medium"
          >
            {view.name
              .split(" ")
              .map((part) => part[0])
              .slice(0, 2)
              .join("")}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-medium">{view.name}</h2>
          <p className="truncate text-sm text-[--color-sight-ink]">
            {view.standing}
          </p>
          {view.onPremises && (
            <p className="mt-1 text-sm font-medium">On the premises now.</p>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded border border-[--color-reticle-black] px-3 py-2 text-sm font-medium"
        >
          Close
        </button>
      </header>

      {/* The single line, if there is one. §4.3 forbids a stack of conditions,
          so the headline block is exactly one sentence — the fuller list below
          is the officer's own request, not something pushed at them. */}
      {view.line && (
        <p className="mt-4 border-l-8 border-[--color-ten-ring-deep] py-2 pl-3 font-medium">
          {view.line}
        </p>
      )}

      <Group title="Documents">
        <ul className="divide-y divide-[--color-terrazzo]">
          {view.documents.map((document, position) => (
            <li
              key={`${document.kind}-${position}`}
              className="flex items-baseline gap-3 py-2"
            >
              <span aria-hidden className="w-4 shrink-0 font-mono">
                {document.live ? DOCUMENT_GLYPH.live : DOCUMENT_GLYPH.lapsed}
              </span>
              <span className="sr-only">
                {document.live ? "Current." : "Not current."}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block">{document.label}</span>
                <span className="block text-sm text-[--color-sight-ink]">
                  {document.state}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Group>

      {view.blocks.length > 0 && (
        <Group title="Current blocks">
          <ul className="space-y-3">
            {view.blocks.map((block, position) => (
              <li
                key={`${block.capability}-${position}`}
                className={`py-1 pl-3 ${
                  block.overridable
                    ? "border-l-4 border-[--color-deck-oak]"
                    : "border-l-8 border-[--color-ten-ring-deep]"
                }`}
              >
                <p className="font-medium">{block.message}</p>
                {/* §4.1: "remedy — optional. What resolves it." The one part of
                    a block an officer can hand to the member. */}
                {block.remedy && (
                  <p className="text-sm text-[--color-sight-ink]">
                    {block.remedy}
                  </p>
                )}
                {block.overridable && (
                  <p className="text-sm text-[--color-sight-ink]">
                    An officer may let this through with a recorded reason.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Group>
      )}

      {view.expiring.length > 0 && (
        <Group title="Expiring soon">
          <ul className="space-y-1 text-sm">
            {view.expiring.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Group>
      )}

      <Group title="Expected today and tomorrow">
        {view.history.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {view.history.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[--color-sight-ink]">
            Nothing expected in this device&rsquo;s window.
          </p>
        )}

        {/* Said plainly rather than left to be inferred from an empty list.
            §8.1 gives the pack two days; a member's full history is a server
            read and lives on the founder's dashboard (§6.6). An officer who
            thought this WAS the history would draw the wrong conclusion about a
            member who has shot here for years. */}
        {view.historyIsPartial && (
          <p className="mt-2 text-sm text-[--color-sight-ink]">
            This device carries today and tomorrow only. Full visit history is on
            the owner dashboard.
          </p>
        )}
      </Group>
    </section>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h3 className="text-sm font-medium tracking-wide text-[--color-sight-ink] uppercase">
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}
