import { useEffect, useRef, useState, type CSSProperties } from "react";
import { animate } from "motion/react";
import { useReduceMotion } from "../motion/MotionProvider";
import { flipSequence } from "./flip";

// Inspired by Kokonut UI "Split Flap Text" (MIT), https://github.com/kokonut-labs/kokonutui.
// Own implementation: one-shot rotateX flip per tile, no idle loop.
const HALF_FLIP = 0.05; // seconds per half turn; a 3-letter trip is 300 ms
const FLAP = "perspective(240px) rotateX(";

type Run = { cancel: () => void };

/**
 * A letter tile that flips through a few random letters once on mount (staggered by `delay`),
 * lands on its real letter, and flips once more on mouse hover. The initial markup and the
 * reduced-motion render are always the real letter. Every flip is a run with its own cancel
 * token; at most one run is active, and the effect cleanup cancels it and restores the tile.
 */
export function FlipTile({ letter, delay, style, className = "set-tile" }: { letter: string; delay: number; style?: CSSProperties; className?: string }) {
  const reduce = useReduceMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(letter);
  const active = useRef<Run | null>(null);

  /** Start a run unless one is active. Returns nothing; the run owns `active` until it ends or is cancelled. */
  const start = (steps: number, waitSeconds = 0) => {
    const el = ref.current;
    if (!el || active.current) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let control: { cancel: () => void } | undefined;
    const run: Run = {
      cancel: () => {
        cancelled = true;
        clearTimeout(timer);
        control?.cancel();
      },
    };
    active.current = run;
    const play = (keyframes: string[], ease: "easeIn" | "easeOut") => {
      const a = animate(el, { transform: keyframes }, { duration: HALF_FLIP, ease });
      control = a;
      return a;
    };
    void (async () => {
      if (waitSeconds) await new Promise<void>((r) => { timer = setTimeout(r, waitSeconds * 1000); });
      for (const next of flipSequence(letter, steps)) {
        if (cancelled) return;
        await play([`${FLAP}0deg)`, `${FLAP}-90deg)`], "easeIn");
        if (cancelled) return;
        setShown(next);
        await play([`${FLAP}90deg)`, `${FLAP}0deg)`], "easeOut");
      }
      if (cancelled) return;
      el.style.transform = "";
      active.current = null;
    })();
  };

  useEffect(() => {
    const el = ref.current;
    if (!reduce) start(3, delay);
    return () => {
      active.current?.cancel();
      active.current = null;
      if (el) el.style.transform = ""; // never leave a cancelled tile mid-turn (rotateX(-90deg) is invisible)
      setShown(letter);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, letter, delay]);

  return (
    <span ref={ref} className={className} aria-hidden="true" style={style} onPointerEnter={(e) => { if (!reduce && e.pointerType === "mouse") start(2); }}>
      {shown}
    </span>
  );
}
