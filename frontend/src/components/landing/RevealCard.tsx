import { useEffect, useId, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { useReduceMotion } from "../motion/MotionProvider";
import "./landing.css";

/** True on devices where nothing can hover (phones, tablets): the panel then just shows its content. */
function useNoHover(): boolean {
  const [none, setNone] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(hover: none)").matches);
  useEffect(() => {
    const m = matchMedia("(hover: none)");
    const on = () => setNone(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return none;
}

/**
 * A quiet panel: at rest it shows only a big title and one line of summary. Move the pointer onto it (or tab into it)
 * and the title fades out while the content fades up in its place; leave and it fades back.
 * The fade is driven by motion (not CSS transitions) so it still plays when the device asks for reduced motion:
 * a slow fade is not movement, and the sliding is the part that stops under reduced motion (MotionConfig removes transforms).
 * Nothing is hidden from keyboards or screen readers: the content is always in the page, focusing anything inside it
 * opens the panel, and on touch screens (no hover) the content is shown straight away.
 *
 * Props
 * - title: the big word, e.g. "Progress".
 * - summary: one line under the title at rest, e.g. "36% done, 5 of 14 lessons".
 * - children: the content that fades up.
 */
export function RevealCard({ title, summary, className = "", children }: { title: string; summary: string; className?: string; children: ReactNode }) {
  const id = useId();
  const noHover = useNoHover();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const open = noHover || hover || focus;
  // Under reduced motion there is no sliding at all (motion applies transform changes instantly in that mode, which looked like a jump).
  const reduce = useReduceMotion();
  const lift = reduce ? 0 : 18;
  return (
    <motion.section
      className={`lp-reveal ${className}`}
      aria-labelledby={id}
      onPointerEnter={(e) => e.pointerType !== "touch" && setHover(true)}
      onPointerLeave={() => setHover(false)}
      // Only keyboard focus pins the card open. A mouse click on a button inside leaves focus there, and the card then stayed open after the pointer left.
      onFocusCapture={(e) => { if ((e.target as HTMLElement).matches(":focus-visible")) setFocus(true); }}
      onBlurCapture={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFocus(false)}
      initial={false}
      animate={{ backgroundColor: open ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)" }}
      transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
    >
      <motion.div
        className="lp-reveal-face"
        aria-hidden="true"
        initial={false}
        animate={{ opacity: open ? 0 : 1, y: open ? -lift : 0 }}
        transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
        style={{ willChange: "opacity, transform" }}
      >
        <span className="lp-reveal-title">{title}</span>
        <span className="lp-reveal-summary">{summary}</span>
        <span className="lp-reveal-cue">Hover to open</span>
      </motion.div>
      <motion.div
        className="lp-reveal-body"
        initial={false}
        animate={{ opacity: open ? 1 : 0, y: open ? 0 : lift }}
        transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1], delay: open ? 0.15 : 0 }}
        style={{ willChange: "opacity, transform" }}
      >
        <h2 id={id} className="lp-reveal-head">
          {title}
          <span className="sr-only">: {summary}</span>
        </h2>
        {children}
      </motion.div>
    </motion.section>
  );
}
