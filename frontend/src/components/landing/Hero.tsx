import { useState } from "react";
import { MotionConfig, motion } from "motion/react";
import { MARK_LABEL, StatusMark, type MarkState } from "../StatusMark";
import { useMotionSource, useReduceMotion } from "../motion/MotionProvider";
import "./landing.css";

export type HeroLetter = { letter: string; status: MarkState };

/**
 * Top of Home: the big title, the slogan, one message and the two actions.
 * The memorable part is the row of tiles that spells the name of the person you are learning for.
 * Tiles spring in once on load (the page's one orchestrated moment), then idle with a very slow bob.
 * Both stop under reduced motion. Each tile carries its status as a shape plus a hidden text label.
 *
 * Props
 * - letters: the letters of that name with their status.
 * - cta: { label, onClick } primary action (continue the next lesson), or null when every lesson is done.
 * - onSeeLevels: secondary action, scrolls to the level deck.
 */
/**
 * One letter tile. The entrance is a delayed spring; once it has landed, the tile is "ready" and answers the pointer:
 * moving over it (or dragging across the row) lifts it and it floats (CSS bob, faster), and moving off drops it back
 * with a bouncy spring. Tabbing does nothing here because the tiles are decoration, not controls.
 */
function Tile({ letter: l, index: i, low, reduce, off }: { letter: HeroLetter; index: number; low: boolean; reduce: boolean; off: boolean }) {
  const [landed, setLanded] = useState(false);
  // With reduced motion there is no entrance, so the tile is ready at once.
  const ready = landed || reduce;
  return (
    <motion.li
      className={`lp-tile${low ? " lp-tile-low" : ""}`}
      style={{ ["--r" as string]: `${[-5, 3, -2, 5, -4, 2][i % 6]}deg`, ["--k" as string]: i }}
      initial={reduce ? false : { opacity: 0, y: 48, scale: 0.6, rotate: -12 }}
      animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
      transition={ready ? (reduce ? { duration: 0.2, ease: "easeOut" } : { type: "spring", stiffness: 420, damping: 9, mass: 0.9 }) : { type: "spring", stiffness: 260, damping: 15, delay: 0.25 + i * 0.09 }}
      onAnimationComplete={() => setLanded(true)}
      // Hover lift. With the in-app switch on there is no motion at all. When only the device asks for less motion, the lift
      // still happens because the person triggers it with the pointer, but it is a short, calm tween: no spring, no bobbing.
      whileHover={off || !ready ? undefined : reduce ? { y: -18, transition: { duration: 0.16, ease: "easeOut" } } : { y: -34, scale: 1.14, rotate: 0, transition: { type: "spring", stiffness: 300, damping: 14 } }}
    >
      <span className="lp-tile-letter" aria-hidden="true">
        {l.letter}
      </span>
      <span className="lp-tile-status">
        <StatusMark state={l.status} size={16} />
        <span className="lp-tile-status-text">{MARK_LABEL[l.status]}</span>
        <span className="sr-only">Letter {l.letter}: </span>
      </span>
    </motion.li>
  );
}

export function Hero(props: { letters: HeroLetter[]; cta: { label: string; onClick(): void } | null; onSeeLevels(): void }) {
  const { letters, cta, onSeeLevels } = props;
  const reduce = useReduceMotion();
  const { userChoice } = useMotionSource();
  return (
    <section className="lp-hero" aria-labelledby="lp-title">
      <div className="lp-aura" aria-hidden="true" />
      <div className="lp-hero-copy">
        <h1 id="lp-title" className="lp-title">
          <span>Say hello</span> <span>in Sign.</span>
        </h1>
        <p className="lp-slogan">Sign it for someone.</p>
        <p className="lp-message">
          Handshake teaches ASL around the one person you want to talk to. Your camera checks your hands as you sign, and a coach helps with whatever trips you up.
        </p>
        <div className="lp-actions">
          {cta && (
            <button type="button" className="lp-cta" onClick={cta.onClick}>
              {cta.label}
            </button>
          )}
          <button type="button" className="lp-ghost" onClick={onSeeLevels}>
            See all levels
          </button>
        </div>
      </div>

      <MotionConfig reducedMotion="never">
      <ul className="lp-tiles" aria-label="Handshake spelled in letters, with your progress on each">
        {letters.flatMap((l, i) => [
          // HAND / SHAKE: a line break after the fourth tile so the word splits where it reads naturally.
          ...(i === 4 ? [<li key="br" className="lp-break" role="presentation" aria-hidden="true" />] : []),
          <Tile key={`${l.letter}-${i}`} letter={l} index={i} low={i % 2 === 1} reduce={reduce} off={userChoice} />,
        ])}
      </ul>
      </MotionConfig>
    </section>
  );
}
