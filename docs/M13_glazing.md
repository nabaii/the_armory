# M13 — Glazing, and a legibility floor

Two pieces of work that turn out to be the same piece of work: a material for
the application, and a product a forty-five-year-old can read.

---

## The brief, and the tension in it

> *"It should look and feel like UI you cannot find elsewhere… push the
> boundaries. Be sure to remember that this is a platform to be used by people
> largely over 30, and mostly between 35-50. We want it to be easy to use.
> Embrace glassmorphism."*

Those pull against each other, and the pull is the interesting part.
Glassmorphism is the style that fails this audience most reliably: low-contrast
text on translucent panels, hairline type, and a blur that costs frames on the
phones the members actually carry. Presbyopia begins around forty and contrast
sensitivity declines with it. The median user here is inside that window.

So the material had to be built the way this codebase builds everything else —
from measurement — and the legibility work had to happen at the same time rather
than as a later correction.

---

## The diagnosis

The site was a vertical stack of full-bleed colour bands. The typography was
excellent and the structure legible, and it had **no material and no depth**:
every surface sat at exactly the same distance from the reader. Nothing could be
foreground, nothing could be set into anything, and the frosted chrome the app
already had — `glass.css`, correctly derived, already shipping — was frosted
over nothing.

The photography meant to carry that depth does not exist yet. `ImageSlot` exists
precisely so the product can be built without it. So the material had to come
from somewhere that is not a photograph.

---

## The idea: setting out, and glazing

Architects publish **setting-out drawings** — a grid of reference lines with
heavier gridlines at intervals, used to position a building on its site. A range
publishes the same document in another idiom: the firing line, the lane
divisions, the distance markers. Both are precision measurement geometry, and so
is the club's mark: a broken ring with ticks.

So the ground under this application is a **setting-out field**, and the panels
on it are **glazing** — sheet glass set square into an opening, which is the
other thing this building is made of.

That is a deliberate refusal of the genre's house style. Glassmorphism elsewhere
means a 32px blur, a 24px radius and a saturated gradient behind it. Every one
of those is wrong here:

| | Why not |
| --- | --- |
| the radius | `--radius-panel` is 0 and `--radius-control` is 2px. Precision equipment has crisp edges, and squareness is the cheapest thing that makes this material unmistakably **this club's** rather than a system component from a phone. |
| the gradient | Guidelines §6 is explicit that textures are *photographed from the building*, not invented. No CSS pretends to be terrazzo. A ruled grid is a drawing, not a material — the same licence `.u-rule-segmented` already took when it derived a divider from the mark's tick geometry. |
| the blur | Capped at 10px, and dropped entirely on anything that repeats. |

What is left is the part of the material that is actually load-bearing: **a
plane of glass with a lit edge, sitting a measurable distance above a drawing
you can still read through it.**

---

## What was measured, and what the measurements decided

Every figure is a normal-blend composite in sRGB gamma space — the method
`glass.css` and `base.css` already use — taken against the worst backdrop the
surface can have.

### One tint, 62%, for both registers

| Pane | Surface | Body ink | Muted ink |
| --- | --- | --- | --- |
| light on a Chalk field | `#F2F1EE` | 12.70:1 | 6.01:1 |
| light on a Terrazzo field | `#E9E7E3` | 11.61:1 | 5.50:1 |
| dark on Charred Timber | `#2C2B29` | 12.97:1 | 9.96:1 |
| dark on VIP Teal | `#304547` | 9.31:1 | 7.15:1 |
| dark on Range Teak | `#4F3E2D` | 9.35:1 | 7.18:1 |

### Muted ink comes back — and that is the point

`glass.css` had to forbid it. Over an unknown backdrop Sight Ink measures
2.35:1, and no tint recovers it, so the chrome carries hierarchy by weight and
ground alone. That restriction **does not survive the change of context and must
not be copied out of habit.** Content glazing sits over a ground this codebase
chose, so the composite is computable — and Sight Ink measures 6.01:1 on it. The
full three-level type hierarchy is available on a pane.

### Register follows the band

A Chalk pane on Charred Timber puts Ten Ring Red at **2.45:1**. Recovering it
takes a 92% tint, at which point it is a Chalk rectangle with an expensive
filter behind it. So light panes go on light grounds and dark panes on dark
ones — which is also how a window behaves in a building.

### Soffit Blue carries no glazing at all

The ground that is neither. A light pane over it measures Ten Ring Red at
**2.78:1** — under the 3:1 a marker needs, and the centre dot is the app's
active marker. Captions come in at 4.57:1, which *passes*, with seven
hundredths of headroom on the smallest type the product sets, for the audience
least able to absorb the difference. Every other glazed ground clears the same
test by a full point.

`groundGlaze` returns `null` for Soffit rather than the nearest guess — the same
treatment `emptyReason` gives a value the club has not set, for the same reason:
a plausible-looking default is how a contrast failure ships.

### The field band is Terrazzo, and that was found by looking

The first build put the field on Chalk. Every contrast figure passed and **the
material was invisible**: a Chalk pane over a Chalk field composites to `#F2F1EE`
against `#EBEBE8`, about four points of luminance. Panes read as faint outlines,
and glazing you cannot see through is a border with a filter behind it.

Glazing needs the ground darker than the pane — which is the only way it works
in a building. On Terrazzo the same pane sits over `#D6D2CC`, roughly twenty
points, and the material appears. `tokens.css` had already called Terrazzo *"the
signature surface of the building. Section grounds, cards, panels"*; the band
system was simply never using it for what it names.

---

## Two glazing classes, and the reason is frames

`backdrop-filter` costs in proportion to blurred area and to the number of
compositing layers. A Diary day renders a table board plus three discipline
boards of seven slots each — thirty filtered chips is a dropped frame per scroll
on the mid-range Android §6.4's budget is measured against, and a 44px chip has
no room to show a blurred drawing through itself.

- **`.u-glaze`** — the full material. Panels, calendars, boards.
- **`.u-glaze-flat`** — tint and lit edge, no filter. Anything that repeats.

Same tint, so the two can never disagree about contrast.

---

## The legibility work

Not a footnote to the material. The same commit, for the same audience.

| | Was | Now | Why |
| --- | --- | --- | --- |
| `--text-caption` | 13 → 14px | **14 → 15px** | It carries "3 places", the programme's times, every agenda detail line. A member squinting at how many places are left is the moment the portal loses to a WhatsApp message. |
| kicker labels | ad-hoc `0.625rem` (10px) in five components | **`--text-micro`, 11 → 12px** | 10px of tracked uppercase is below what this audience reads in a hurry. Naming the floor is what stops the next component inventing a smaller one. |
| tab bar labels | fixed 10px everywhere | **fluid 10 → 12px** | The original 10px was measured — against a 320px phone. Almost nobody is on one. The jammed case is still avoided; it is no longer imposed on everyone. |
| focus ring | 2px | **3px**, offset kept | The offset is load-bearing: red on a primary button measures 1.34:1, so the ring is drawn on the ground *outside* it, where it is 3.79:1. |

---

## Today is now what §6.1 asked for

> *"A single vertical stack of cards. No tabs within tabs, no horizontal
> carousels, no dashboard grid."*

Today shipped as five full-bleed colour bands. Bands are right for the marketing
site, where each one is an argument — and they are not cards. A member scrolled
through five paragraphs of club, not five things that were theirs.

They are panes now, on one setting-out field. The order is still fixed and still
not computed (§6.3); the stack is still flat. What changed is that the five
things Today has to say are five objects.

**The Soffit Blue band on card 3 is gone deliberately.** It cannot carry a pane,
and it should not have been there anyway: §4's registers encode which *context*
a reader is in — first visit against membership — and Today is entirely one
context. Using the open register to tell one of a member's own cards from
another was reading a rule about access as a rule about variety.

---

## A defect the screenshots found

The calendar was rendered under Windows High Contrast rather than reasoned
about, and two things had quietly stopped working — both predating this work:

1. **The selected day lost its selection.** `bg-[var(--ink)]` is a background
   colour, and forced colours replaces every one. `aria-current` still announced
   it; nobody looking at the screen could see it.
2. **Every mark vanished, legend included** — event square, fixture outline and
   booked bar are all drawn with background or border colour, leaving a key with
   three labels and no glyphs.

Fixed with a narrow `forced-color-adjust: none` on the 5px indicators whose
entire meaning is their colour and shape, and a `Highlight` outline on the
selected cell, because it *is* a selection and that is what selections are drawn
with. Text is never opted out.

This is the second time in three milestones that rendering the thing found a
defect nothing else would have.

---

## The gap that would have opened, and the test that closes it

The tint lives in two places. CSS cannot import a TypeScript constant, so
`--glaze-tint: 62%` is declared in the stylesheet and `0.62` in `contrast.ts` —
and nothing stops somebody changing one. The gate would keep passing against a
number the browser had stopped using.

`src/lib/glaze.test.ts` reads the stylesheet and asserts they agree, that the
field never exceeds the density the proof assumes, and that the two rules
derived from failure — no light glazing on a dark band, no glazing on Soffit
Blue — still hold. §13.2's move: *a lint rule rather than institutional memory.*

`npm run gate` now audits twelve glazed composites, computed rather than pasted.

---

## Verified

| Checked | Result |
| --- | --- |
| `typecheck` · `lint` · `test` | green — **985 tests**, 16 of them new |
| `gate` | passes, with 12 glazed composites and 3 calendar pairs enforced |
| `volume` | within §6.4's budgets |
| `build` | compiles; every portal route still server-rendered on demand |
| Rendered at 390 / 420 / 1280px | field, panes, lit edges and ticks all read as intended |
| `forced-colors: active` | field removed, panes on Canvas, frame and ticks in CanvasText, marks and selection restored |
| Focus ring on a glazed chip | unmistakable at 3px |

---

## Deliberately not done

| | Why |
| --- | --- |
| A two-column Diary on desktop | The calendar is capped at 46rem so its cells stay thumb-sized, but the right half of a 1280px screen is still empty. Calendar and agenda left, day panel right is the obvious next move and it is a layout change, not a material one. |
| Glazing on the marketing bands | Those bands hold sentences, not objects. The field would fight the measure and the panes would have nothing to be. Tier cards took the lit edge only — they keep opaque grounds, because Terrazzo on Chalk is darker than what is behind it, the one arrangement glazing cannot express. |
| Photographic textures | Guidelines §6: photographed from the building, never invented. Unchanged, and the reserved frames now say so in the building's own language — a set-out opening rather than a grey box. |
| Motion beyond a 1px lift | §6 asks for motion that "feels like precision equipment, not a promo video". A card that jumps 4px and grows a 24px shadow is the promo video. |
