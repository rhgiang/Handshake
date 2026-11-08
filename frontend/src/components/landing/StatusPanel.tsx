import { useState } from "react";
import { motion } from "motion/react";
import { CountUp } from "../motion/CountUp";
import { useReduceMotion } from "../motion/MotionProvider";
import { RevealCard } from "./RevealCard";
import "./landing.css";

export type ProgressLevel = { number: number; title: string; done: number; total: number };
export type TimelineLesson = { id: string; title: string; level: number; state: "done" | "current" | "available" | "locked" };

// Ring radii, outermost = level 1. One arc per level, so the rings read as four stacked goals.
const RINGS = [86, 68, 50, 32];
const STROKE = 12;

/**
 * "Your progress", kept to the essentials:
 *  1. Rings: one arc per level, centre shows the overall percentage.
 *  2. Level list: the same four levels as words and numbers (hover or focus a row to light its ring).
 *  3. Timeline: every lesson as a dot on one line. The filled part is how far you have got, and a flag marks the next lesson.
 * Everything comes from this browser (progress.ts). The rings and the line are decoration for the text next to them,
 * so they are hidden from screen readers and every number is also written out.
 */
export function StatusPanel(props: {
  levels: ProgressLevel[];
  timeline: TimelineLesson[];
  xp: number;
  streak: number;
  due: number;
  started: boolean;
  onStart(id: string): void;
}) {
  const { levels, timeline, xp, streak, due, started, onStart } = props;
  const reduce = useReduceMotion();
  const [hot, setHot] = useState<number | null>(null);
  const done = timeline.filter((l) => l.state === "done").length;
  const total = timeline.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const next = timeline.find((l) => l.state === "current") ?? null;
  const nextIndex = next ? timeline.indexOf(next) : total;
  const fill = total > 1 ? Math.min(1, Math.max(0, (done === total ? total - 1 : Math.max(done, nextIndex)) / (total - 1))) : 0;
  const spring = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 55, damping: 18 };

  return (
    <RevealCard className="lp-duo-col" title="Progress" summary={`${pct}% done · ${done} of ${total} lessons`}>
      <div className="lp-prog">
        <div className="lp-prog-top">
          <div className="lp-rings" aria-hidden="true">
            <svg viewBox="0 0 200 200" focusable="false">
              {levels.slice(0, 4).map((lv, i) => {
                const r = RINGS[i];
                const C = 2 * Math.PI * r;
                const p = lv.total ? lv.done / lv.total : 0;
                return (
                  <g key={lv.number} className={`lp-ring-g lp-ring-${i + 1}${hot !== null && hot !== i ? " is-dim" : ""}`}>
                    <circle cx="100" cy="100" r={r} className="lp-ring-track" strokeWidth={STROKE} />
                    {p > 0 && (
                      <motion.circle
                        cx="100"
                        cy="100"
                        r={r}
                        className="lp-ring-arc"
                        strokeWidth={STROKE}
                        strokeDasharray={C}
                        initial={{ strokeDashoffset: reduce ? C * (1 - p) : C }}
                        animate={{ strokeDashoffset: C * (1 - p) }}
                        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 50, damping: 17, delay: 0.15 + i * 0.12 }}
                        transform="rotate(-90 100 100)"
                      />
                    )}
                  </g>
                );
              })}
            </svg>
            <div className="lp-rings-center">
              <strong>
                <CountUp value={pct} />
                <small>%</small>
              </strong>
              <span>
                {done} of {total} lessons
              </span>
            </div>
          </div>

          <div className="lp-prog-side">
            <ol className="lp-lvl-list">
              {levels.slice(0, 4).map((lv, i) => (
                <li
                  key={lv.number}
                  className={`lp-lvl lp-lvl-${i + 1}${hot === i ? " is-hot" : ""}`}
                  onMouseEnter={() => setHot(i)}
                  onMouseLeave={() => setHot(null)}
                >
                  <span className="lp-lvl-dot" aria-hidden="true" />
                  <span className="lp-lvl-name">
                    <span className="sr-only">Level {lv.number}: </span>
                    {lv.title}
                  </span>
                  <span className="lp-lvl-count">
                    {lv.done}/{lv.total}
                  </span>
                </li>
              ))}
            </ol>
            <dl className="lp-mini">
              <div>
                <dt>XP</dt>
                <dd>
                  <CountUp value={xp} />
                </dd>
              </div>
              <div>
                <dt>Day streak</dt>
                <dd>
                  <CountUp value={streak} />
                </dd>
              </div>
              <div>
                <dt>To review</dt>
                <dd>
                  <CountUp value={due} />
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="lp-timeline">
          <div className="lp-tl-track" aria-hidden="true">
            <motion.span className="lp-tl-fill" initial={false} animate={{ scaleX: fill }} transition={spring} />
          </div>
          <ol className="lp-tl-dots" aria-label="Every lesson, in order">
            {timeline.map((l, i) => (
              <li key={l.id} className={`lp-tl-dot lp-tl-${l.state} lp-tl-lvl-${l.level}${i > 0 && timeline[i - 1].level !== l.level ? " lp-tl-gap" : ""}`} title={`${l.id} ${l.title}`}>
                <span aria-hidden="true" />
                <span className="sr-only">
                  Lesson {l.id}, {l.title}: {l.state === "current" ? "up next" : l.state === "available" ? "ready" : l.state}
                </span>
              </li>
            ))}
          </ol>
          <div className="lp-tl-foot">
            {next ? (
              <>
                <p>
                  <span className="lp-flag">{started ? "Up next" : "Start here"}</span>
                  <strong>
                    {next.id} {next.title}
                  </strong>
                </p>
                <button type="button" className="lp-cta lp-cta-sm" onClick={() => onStart(next.id)}>
                  {started ? "Continue" : "Start"}
                  <span className="sr-only"> lesson {next.id}</span>
                </button>
              </>
            ) : (
              <p>
                <strong>Every available lesson is finished.</strong> <span className="muted">More are coming later.</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </RevealCard>
  );
}
