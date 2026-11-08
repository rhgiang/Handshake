import type { ReactNode } from "react";
import { isPracticeable } from "../cv";
import { CoachTip } from "./CoachTip";
import { HoldRing } from "./HoldRing";
import { RewardLine } from "./RewardLine";
import { StatusMessage, type StatusKind } from "./StatusMessage";

// The lesson layout. Presentational only: LessonPlayer (Ryan) supplies the camera, the 3D reference and the text.
// Keep these prop names; they are the agreed contract in CLAUDE.md.
export type LessonViewProps = {
  title: string; // "Sign L", "Spell LILY", "Sign hello"
  target: string; // letter or sign id being checked
  word?: { letters: string[]; index: number }; // spell steps: letter row with the current one highlighted
  reference: ReactNode; // 3D hand, supplied by LessonPlayer
  showReference: boolean;
  camera: ReactNode; // <Camera {...cam} />
  progress: number; // 0..1 hold progress
  landmarkTip: string; // instant tip from getHandFeedback (shown first)
  coachTip: string; // Gemini tip, '' while loading
  coachCached: boolean; // label "cached" when true
  sideBySide: boolean; // 3rd repeat of the same mistake: reference beside the live hand, large
  status: string; // announced via aria-live, e.g. "Matches our recording: L"
  stepLabel: string; // "Step 2 of 9"
  actionLabel: string; // "Skip" or "Continue"
  onAction: () => void;
  onSelfCheck?: () => void; // self-graded signs: "I signed it"
  // Optional, Duolingo-style footer (added by Group 1; old callers unaffected):
  lessonProgress?: number; // 0..1 through the lesson, drawn as a bar at the top
  feedback?: "match" | "miss"; // colours the footer; the status text and icon carry the meaning too
  actionDisabled?: boolean; // "Continue" stays disabled until the sign matches
  onRetry?: () => void; // "Try again" after a match
  onSkip?: () => void; // move on without a match (not counted as one)
  howTo?: { text: string; cached: boolean }; // how to form the letter, written by Gemini from general ASL knowledge
  reward?: { message: string; cached: boolean }; // praise after a confirmed match (Gemini or canned, "cached")
};

/** Picks the status style from the wording the player sends. The text always carries the meaning. */
function kindOf(status: string, feedback?: "match" | "miss"): StatusKind {
  if (feedback === "match") return "match";
  if (feedback === "miss") return "notyet";
  if (/^matches/i.test(status)) return "match";
  if (/^not /i.test(status)) return "notyet";
  return "info";
}

import { LessonExit } from "./LessonExit";

export function LessonView(p: LessonViewProps) {
  const primary = p.onRetry || p.actionDisabled !== undefined || (!p.onSelfCheck && p.actionLabel === "Continue");
  return (
    <div className={`page lesson${p.sideBySide ? " lesson-compare" : ""}`}>
      {p.lessonProgress !== undefined && (
        <progress className="lesson-progress" value={p.lessonProgress} max={1} aria-label={p.stepLabel} />
      )}
      <LessonExit />
      <header className="lesson-head">
        <p className="eyebrow">{p.stepLabel}</p>
        <h1>{p.title}</h1>
      </header>

      {p.word && (
        <ol className="word-tiles" aria-label="Letters of the word">
          {p.word.letters.map((l, i) => {
            const state = i < p.word!.index ? "done" : i === p.word!.index ? "current" : "todo";
            return (
              <li key={i} className={`tile tile-${state}`} aria-current={state === "current" ? "step" : undefined}>
                <span className="tile-letter">{l}</span>
                <span className="tile-state">
                  {state === "done" ? "✓ Done" : state === "current" ? "Now" : isPracticeable(l) ? "Next" : "Reference only"}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="lesson-main">
        <div className="lesson-left">
          <section className="card lesson-camera" aria-label="Your camera">
            <h2 className="small-title">Your hand</h2>
            {p.camera}
          </section>
          <div className="row">
            {p.onSelfCheck && (
              <button type="button" onClick={p.onSelfCheck}>
                I signed it
              </button>
            )}
            {p.onSkip && (
              <button type="button" className="secondary" onClick={p.onSkip}>
                Skip
              </button>
            )}
            {p.onRetry && (
              <button type="button" className="secondary" onClick={p.onRetry}>
                Try again
              </button>
            )}
            <button type="button" className={primary ? "" : "secondary"} onClick={p.onAction} disabled={p.actionDisabled}>
              {p.actionLabel}
            </button>
            {/* The praise line sits to the right of Continue, on the same row. */}
            <RewardLine reward={p.reward} />
          </div>
        </div>

        {/* Side panel: hold progress, the live result, the coach, and the reference. Sticky on wide screens. */}
        <aside className="card coach-panel" aria-label="Coach and reference">
          <div className="panel-ring-row">
            <HoldRing progress={p.progress} label={`Hold progress for ${p.target}`} size={84} />
            <p className="panel-target">
              Target <strong>{p.target}</strong>
            </p>
          </div>
          <StatusMessage kind={kindOf(p.status, p.feedback)} label={false} message={p.status} />
          {p.howTo && (
            <section aria-label="How to form it">
              <h2 className="small-title">How to form {p.target}</h2>
              <p>{p.howTo.text}</p>
              <p className="muted small">Written by Gemini from general ASL knowledge; not yet checked by a fluent signer{p.howTo.cached ? " (cached)" : ""}</p>
            </section>
          )}
          <CoachTip instantTip={p.landmarkTip} coachText={p.coachTip || undefined} coachCached={p.coachCached} />
          {(p.showReference || p.sideBySide) && (
            <section aria-label={p.sideBySide ? "Compare: reference vs your hand" : "Reference"}>
              <h2 className="small-title">{p.sideBySide ? "Compare: reference vs your hand" : "Reference"}</h2>
              {p.reference}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
