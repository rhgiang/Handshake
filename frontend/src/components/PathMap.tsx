import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { PathNodeState } from "./PathNode";
import { MARK_LABEL, StatusMark, type MarkState } from "./StatusMark";
import { AnimatedProgress } from "./motion/AnimatedProgress";

// The curriculum as a winding path of glowing "platform" nodes, one section per unit.
// Presentational only: Home maps buildCurriculum() + progress into these props.
// Motion (float, glow, reveal on scroll) is CSS-only and switched off by prefers-reduced-motion.

export type MapLetter = { letter: string; status: MarkState; due?: boolean };
/** letters: the letters this lesson teaches, each with its status (small, under the lesson). note: optional small line, e.g. "RYAN: 2 of 4 live". */
export type MapLesson = { id: string; title: string; summary: string; xp: number; state: PathNodeState; partial?: number; letters?: MapLetter[]; note?: string };

const STATE_TEXT: Record<PathNodeState, string> = { locked: "Locked", available: "Ready", current: "Up next", done: "Done" };
// Horizontal wiggle (px) per row, so the path winds like a trail instead of a straight list.
const WIGGLE = [0, 44, 72, 44, 0, -44, -72, -44];

/** Adds `is-visible` to each `.reveal` child when it scrolls into view (or at once when IntersectionObserver is missing). */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const els = ref.current?.querySelectorAll<HTMLElement>(".reveal") ?? [];
    if (typeof IntersectionObserver === "undefined") {
      els.forEach((e) => e.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("is-visible");
            io.unobserve(en.target);
          }
        }),
      { rootMargin: "0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return ref;
}

/**
 * One unit: a summary card on the left, the lesson path on the right.
 *
 * Props
 * - index: 1-based unit number, shown in the "UNIT n" pill.
 * - title, goal: unit text.
 * - lessons: MapLesson[]. state = "done" | "current" | "available" | "locked".
 * - onOpen(id): called when a non-locked node (or the "Start" button, when shown) is activated.
 * - showStart: show the "Start" card under the current lesson. Default true. Home turns it off because its banner has the Go button.
 *
 * Accessibility: every node is a real button whose accessible name carries the state and XP in text.
 * Locked nodes stay focusable (aria-disabled). The "Start" card for the current lesson is always visible
 * (never hover-only).
 */
export function UnitSection(props: { index: number; title: string; goal: string; lessons: MapLesson[]; onOpen: (id: string) => void; showStart?: boolean }) {
  const { index, title, goal, lessons, onOpen, showStart = true } = props;
  const ref = useReveal<HTMLElement>();
  const done = lessons.filter((l) => l.state === "done").length;
  const xp = lessons.reduce((n, l) => n + l.xp, 0);

  return (
    <section className="unit" aria-labelledby={`unit-${index}-title`} ref={ref}>
      <Card className="unit-card gap-0 rounded-3xl border-2 p-6">
        <div className="unit-badge" aria-hidden="true">
          <span>{index}</span>
        </div>
        <h2 id={`unit-${index}-title`}>{title}</h2>
        <p className="muted">{goal}</p>
        <p className="unit-stats">
          <span>{lessons.length} lessons</span>
          <span aria-hidden="true"> · </span>
          <span>{xp} XP</span>
        </p>
        <AnimatedProgress value={done} max={lessons.length} label={`Unit ${index} progress`} />
        <p className="muted small">
          {done} of {lessons.length} done
        </p>
      </Card>

      <div className="unit-path">
        <p className="level-pill">
          <span className="level-eyebrow">Unit {index}</span>
          <span className="level-title">{title}</span>
        </p>
        <ol className="map">
          {lessons.map((l, i) => {
            const shift = WIGGLE[i % WIGGLE.length];
            const nextShift = WIGGLE[(i + 1) % WIGGLE.length];
            const part = l.state !== "done" && l.partial !== undefined ? Math.round(l.partial * 100) : undefined;
            const label = `${l.id} ${l.title}, ${STATE_TEXT[l.state].toLowerCase()}${part !== undefined ? `, partly done ${part}%` : ""}, ${l.xp} XP`;
            return (
              <li key={l.id} className={`map-row map-${l.state}${part !== undefined ? " map-partial" : ""} reveal`} style={{ ["--fill" as string]: `${part ?? 0}%`, ["--shift" as string]: `${shift}px`, ["--link-shift" as string]: `${(shift + nextShift) / 2}px` }}>
                <div className="map-stage">
                  <button
                    type="button"
                    className="map-node"
                    aria-label={label}
                    aria-disabled={l.state === "locked" || undefined}
                    aria-current={l.state === "current" ? "step" : undefined}
                    onClick={() => l.state !== "locked" && onOpen(l.id)}
                  >
                    <span className="map-glow" aria-hidden="true" />
                    <span className="map-disc" aria-hidden="true">
                      <span className="map-glyph">{l.state === "done" ? "✓" : l.state === "locked" ? "🔒" : l.id}</span>
                    </span>
                  </button>
                  <div className="map-label">
                    <strong>{l.title}</strong>
                    <span className="muted small">
                      {STATE_TEXT[l.state]} · {l.xp} XP
                    </span>
                    {part !== undefined && <span className="small map-partial-text">Partly done · {part}%: redo the skipped steps to finish</span>}
                    {l.letters && l.letters.length > 0 && (
                      <ul className="mini-letters" aria-label={`Letters in ${l.title}`}>
                        {l.letters.map((m) => (
                          <li key={m.letter}>
                            <StatusMark state={m.status} size={12} />
                            <strong>{m.letter}</strong>
                            <span className="sr-only">{MARK_LABEL[m.status]}</span>
                            {m.due && <span className="mini-due">due</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {l.note && <span className="muted small">{l.note}</span>}
                  </div>
                </div>

                {showStart && l.state === "current" && (
                  <div className="start-card">
                    <h3>{l.title}</h3>
                    <p className="muted small">{l.summary}</p>
                    <Button size="lg" className="mt-3 h-12 w-full rounded-2xl border-b-4 border-brand-deep text-base" onClick={() => onOpen(l.id)}>
                      Start
                    </Button>
                  </div>
                )}

                {i < lessons.length - 1 && <span className="map-link" aria-hidden="true" />}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
