import { motion } from "motion/react";
import { useMotionChoice, useReduceMotion } from "../motion/MotionProvider";
import { springs } from "../motion/tokens";
import "./settings.css";

const THUMB_TRAVEL = 22; // px, track inner width 48 - thumb 24 - 2 x 1 inset

/** Icon swap per better-ui: scale 0.25 -> 1, opacity, 4px blur, spring duration 0.3 bounce 0. Reduced motion: instant swap. */
const glyph = (shown: boolean, reduce: boolean) => ({
  initial: false as const,
  animate: shown ? { opacity: 1, transform: "scale(1)", filter: "blur(0px)" } : { opacity: 0, transform: reduce ? "scale(1)" : "scale(0.25)", filter: reduce ? "blur(0px)" : "blur(4px)" },
  transition: reduce ? { duration: 0 } : springs.ui,
});

/**
 * Reduce-motion switch, bound to the same state as the old button (MotionProvider).
 * Device preference wins: when the OS asks for reduced motion the switch shows On and is locked.
 * The On/Off word sits beside the track so state is never colour-only; the thumb glyph
 * (waves = motion allowed, bar = still) is a second cue.
 * Thumb slide and icon swap follow Kokonut UI "Switch Button" (MIT, https://github.com/kokonut-labs/kokonutui):
 * a spring thumb and a circle of the new colour spreading from the thumb (clip-path, see settings.css).
 */
export function ReduceMotionSwitch({ labelledBy, describedBy }: { labelledBy: string; describedBy: string }) {
  const { os, userChoice, setUserChoice } = useMotionChoice();
  const reduce = useReduceMotion();
  const on = os || userChoice;
  const svg = { viewBox: "0 0 16 16", width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const, focusable: false as const };
  return (
    <button type="button" role="switch" className="set-switch" aria-checked={on} aria-labelledby={labelledBy} aria-describedby={describedBy} disabled={os} onClick={() => setUserChoice(!userChoice)}>
      <span className="set-switch-text">{on ? "On" : "Off"}</span>
      <span className="set-switch-track" aria-hidden="true">
        <span className="set-switch-fill" />
        <motion.span className="set-switch-slide" initial={false} animate={{ transform: `translateX(${on ? THUMB_TRAVEL : 0}px)` }} transition={reduce ? { duration: 0 } : springs.ui}>
          <span className="set-switch-thumb">
            <motion.svg {...svg} {...glyph(!on, reduce)}>
              <path d="M2 4.5q3-2 6 0t6 0M2 8q3-2 6 0t6 0M2 11.5q3-2 6 0t6 0" />
            </motion.svg>
            <motion.svg {...svg} {...glyph(on, reduce)}>
              <path d="M3.5 8h9" />
            </motion.svg>
          </span>
        </motion.span>
      </span>
    </button>
  );
}

/** The sentence under the switch; copy unchanged from the old Settings control. */
export function reduceMotionHelp(os: boolean) {
  return os
    ? "Your device asks for reduced motion, so animation is off. Handshake follows that setting."
    : "By default Handshake follows your device setting, which currently allows animation. Turn this on to stop movement anyway.";
}
