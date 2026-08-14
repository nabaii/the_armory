"use client";

import { useEffect, useRef, useState } from "react";
import type { CapturedSignature } from "@/offline/waiver";

/**
 * SIGNING THE WAIVER AT THE DESK — §6.4, §3.1.
 *
 * Step 9 of docs/M1_offline_acceptance.md. The screen that was missing.
 *
 * ===========================================================================
 * THE DOCUMENT IS SHOWN, AND THE BUTTON IS UNDERNEATH IT
 *
 * The waiver text travels in the day pack for this screen (see the note on
 * `activeWaiverBody` in src/offline/daypack.ts). It is rendered in full, in a
 * scrolling panel, above the signing area — the same ordering EndOfDay.tsx uses
 * for its guard list, and for the same reason: the thing the officer must read
 * is never below the thing they must press.
 *
 * There is no "I have read this" checkbox. It would add a tap to a workflow §1.2
 * gives fifteen seconds, and it is worth nothing as evidence — a tick recorded
 * by the same device, at the same instant, by the same finger, corroborates the
 * signature not at all. What the club actually holds is the version, the text of
 * that version (immutable in `waiver_versions`), the time, the device, the
 * officer who witnessed it, and the mark itself.
 *
 * ===========================================================================
 * THE MARK IS TAKEN WITH A POINTER, NOT A KEYBOARD
 *
 * Pointer events rather than touch or mouse events: one code path covers a
 * finger, a stylus and a mouse, and `setPointerCapture` keeps a stroke that
 * leaves the canvas mid-signature attached to it. A signature that broke into
 * two strokes because someone's hand drifted over the edge of the box would be a
 * worse record of the same act.
 *
 * The canvas is sized to its rendered box at device pixel ratio, so the stored
 * image is not a blurry upscale of a CSS-sized bitmap.
 */

/** Roughly a signature's aspect on a tablet held in landscape. */
const CANVAS_HEIGHT = 180;

export function WaiverSheet({
  name,
  version,
  body,
  onSign,
  onCancel,
}: {
  name: string;
  /** The active version's label, shown so the record is legible to a human. */
  version: string;
  body: string;
  /** Returns a refusal sentence, or null when the signature was taken. */
  onSign: (captured: CapturedSignature) => Promise<string | null>;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasMark, setHasMark] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  /* Sized once against the rendered box. The sheet is fixed to the viewport and
     does not reflow while it is open, so there is nothing to observe. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;

    canvas.width = width * ratio;
    canvas.height = CANVAS_HEIGHT * ratio;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.scale(ratio, ratio);
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
    /* Not a theme token: this is ink on a document, and it has to stay legible
       in a PNG that will be looked at years from now outside this application. */
    context.strokeStyle = "#000000";
  }, []);

  const positionOf = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;

    const { x, y } = positionOf(event);
    context.beginPath();
    context.moveTo(x, y);
    /* A dot is a mark. Someone who signs with a single tap has signed. */
    context.lineTo(x, y);
    context.stroke();
    setHasMark(true);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;

    const { x, y } = positionOf(event);
    context.lineTo(x, y);
    context.stroke();
  };

  const end = () => {
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    setHasMark(false);
  };

  const submit = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasMark || saving) return;

    setSaving(true);
    setRefusal(null);

    canvas.toBlob((blob) => {
      if (!blob) {
        /* §4.3's shape rather than a browser error. The officer's route out is
           to take the signature again, and nothing has been written. */
        setRefusal("This tablet could not save the signature. Try once more.");
        setSaving(false);
        return;
      }

      void onSign({ contentType: "image/png", bytes: blob }).then((reason) => {
        if (reason) setRefusal(reason);
        setSaving(false);
      });
    }, "image/png");
  };

  return (
    <section
      aria-label={`Sign the waiver for ${name}`}
      className="fixed inset-0 z-20 flex flex-col overflow-y-auto bg-[--color-bone] p-4"
    >
      <header className="flex items-start gap-3 border-b border-[--color-terrazzo] pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-medium">{name}</h2>
          <p className="text-sm text-[--color-sight-ink]">
            Range waiver, version {version}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded border border-[--color-reticle-black] px-3 py-2 text-sm font-medium"
        >
          Cancel
        </button>
      </header>

      {/* The document. Scrolls within its own box so the signing area below it
          is always reachable without scrolling past the text. */}
      <div className="mt-3 max-h-64 overflow-y-auto border border-[--color-terrazzo] p-3 text-sm whitespace-pre-wrap">
        {body}
      </div>

      <p className="mt-4 text-sm font-medium">Sign below</p>

      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        style={{ height: CANVAS_HEIGHT }}
        className="mt-1 w-full touch-none border border-[--color-reticle-black] bg-white"
        aria-label="Signature area"
      />

      <div className="mt-2 flex items-center justify-between">
        <p className="text-sm text-[--color-sight-ink]">
          {/* §10's attribution, said out loud. The member can see whose name
              goes on the record beside theirs. */}
          Witnessed at the desk and recorded on this tablet.
        </p>
        <button
          type="button"
          onClick={clear}
          disabled={!hasMark}
          className="shrink-0 rounded border border-[--color-reticle-black] px-3 py-2 text-sm font-medium disabled:border-[--color-sight-grey] disabled:text-[--color-sight-grey]"
        >
          Clear
        </button>
      </div>

      {refusal && (
        <p
          role="alert"
          className="mt-3 border-l-4 border-[--color-ten-ring-deep] bg-[--color-terrazzo] px-3 py-2 text-sm font-medium"
        >
          {refusal}
        </p>
      )}

      <button
        type="button"
        disabled={!hasMark || saving}
        onClick={submit}
        className="mt-4 w-full border border-[--color-reticle-black] px-4 py-3 font-medium disabled:border-[--color-sight-grey] disabled:text-[--color-sight-grey]"
      >
        {saving ? "Recording…" : "Record this signature"}
      </button>
    </section>
  );
}
