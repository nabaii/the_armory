import type { AppNavIconName } from "@/lib/app-nav";

/* ============================================================================
   TAB BAR GLYPHS

   Brand Guidelines §3 protects one idea above all: "The reticle is a targeting
   device, not a weapon... the entire graphic system can be built from targets,
   rings, centres and scoring, and never from guns."

   So none of these is a stock icon. Each is built from the vocabulary the
   brand already owns — the ring, the cardinal ticks, the centre dot, the
   firing bays, the lane numbering, the deck canopy. A downloaded icon set
   would put a generic pin, a generic calendar and a generic person into the
   most-looked-at 68px on the product, and that is precisely where a club that
   has commissioned an identity should not look like everyone else.

   ----------------------------------------------------------------------------
   THE DISTINCTNESS CONSTRAINT

   Icons are read as silhouettes at 22px, not as drawings. The two sets are
   mutually exclusive — a visitor sees the guest five or the member five, never
   a mix — so glyphs only have to be distinct WITHIN a set:

     guest    reticle   slots     bays        canopy   chip
     member   reticle   slots     bays        ladder   card

              circle    portrait  vertical    arc +    landscape
                        grid      strokes     rule     card

   Slot 5 is a card in both sets on purpose. It is "the membership card" either
   way: apply for one, or carry yours.

   Everything is `currentColor` and unlabelled — the tab's text label is the
   accessible name, and a title here would announce every destination twice.
   ========================================================================= */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function AppNavIcon({
  name,
  className,
}: {
  name: AppNavIconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  );
}

const GLYPHS: Record<AppNavIconName, React.ReactNode> = {
  /* HOME — the mark itself. Ring, four cardinal ticks overlaying it so it
     reads segmented rather than continuous, and the centre dot. */
  reticle: (
    <>
      <circle cx="12" cy="12" r="8" {...STROKE} />
      <g {...STROKE} strokeLinecap="butt" strokeWidth="2">
        <line x1="12" y1="1.5" x2="12" y2="6.5" />
        <line x1="12" y1="17.5" x2="12" y2="22.5" />
        <line x1="1.5" y1="12" x2="6.5" y2="12" />
        <line x1="17.5" y1="12" x2="22.5" y2="12" />
      </g>
      <circle cx="12" cy="12" r="2.1" fill="currentColor" />
    </>
  ),

  /* VISIT / BOOK — the slot board. The domain already calls them slots
     (src/server/slots.ts): a session is a bay at a time, and this is that
     board with one taken.

     Two cells, not four. The first draft drew a full 2x2 grid and it turned to
     mush at 22px — frame, rule and four cells is six elements inside a glyph
     the size of a fingernail. One taken slot beside one free slot says the
     same thing and survives the size. */
  slots: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1" {...STROKE} />
      <line x1="3" y1="9" x2="21" y2="9" {...STROKE} strokeLinecap="butt" />
      <rect x="6" y="12" width="5" height="4.5" rx="0.5" fill="currentColor" />
      <rect x="13" y="12" width="5" height="4.5" rx="0.5" {...STROKE} />
    </>
  ),

  /* THE RANGES — three firing bays seen from the line, each with its target
     downrange. Read top-down: the dots are what you are shooting at. */
  bays: (
    <>
      <g {...STROKE}>
        <line x1="6" y1="9.5" x2="6" y2="21" />
        <line x1="12" y1="9.5" x2="12" y2="21" />
        <line x1="18" y1="9.5" x2="18" y2="21" />
      </g>
      <circle cx="6" cy="5" r="1.9" fill="currentColor" />
      <circle cx="12" cy="5" r="1.9" fill="currentColor" />
      <circle cx="18" cy="5" r="1.9" fill="currentColor" />
    </>
  ),

  /* THE CLUB — the deck canopy over the terrace, taken from the building
     rather than from a generic "community" glyph. Arc, deck line, and the
     centre dot marking the place where people actually stand. */
  canopy: (
    <>
      <path d="M3 13.5 A 9 9 0 0 1 21 13.5" {...STROKE} />
      <line x1="2" y1="20" x2="22" y2="20" {...STROKE} />
      <circle cx="12" cy="16.5" r="2" fill="currentColor" />
    </>
  ),

  /* LEAGUES — a standings ladder. Bars descend in length so rank is legible
     without numbers, and the leader carries the centre dot (§8: "current
     position on a ladder"). */
  ladder: (
    <>
      <g {...STROKE}>
        <line x1="9" y1="6" x2="21" y2="6" />
        <line x1="9" y1="12" x2="18.5" y2="12" />
        <line x1="9" y1="18" x2="16" y2="18" />
      </g>
      <circle cx="4.5" cy="6" r="2.1" fill="currentColor" />
    </>
  ),

  /* APPLY — the membership card, not yet issued. */
  chip: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="1" {...STROKE} />
      <g {...STROKE}>
        <line x1="12" y1="9" x2="12" y2="15" />
        <line x1="9" y1="12" x2="15" y2="12" />
      </g>
    </>
  ),

  /* ACCOUNT — the membership card, issued. The dot is the holder; the two
     rules are the name and the standing, which is exactly what the members header
     renders in text one level up. */
  card: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="1" {...STROKE} />
      <circle cx="7.5" cy="12" r="2.1" fill="currentColor" />
      <g {...STROKE}>
        <line x1="12" y1="10" x2="18" y2="10" />
        <line x1="12" y1="14" x2="17" y2="14" />
      </g>
    </>
  ),
};
