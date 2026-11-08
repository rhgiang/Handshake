import type { ReactNode } from "react";
import { SIGNS } from "../cv";
import { StatusMessage } from "./StatusMessage";
import { RewardLine } from "./RewardLine";

export type SceneViewProps = {
  turns: { them: { gloss: string; english: string }; you: { tokens: string[]; english: string } }[];
  turnIndex: number;
  tokenIndex: number;
  camera: ReactNode;
  prompt: string;
  onSelfCheck?: () => void;
  /** Lesson title, shown as the heading. Default "Say hello". */
  title?: string;
  /** Leave the scene without a match (not counted as one). Shown when given. */
  onSkip?: () => void;
  /** Praise after a confirmed sign match (Gemini or canned, "cached"). */
  reward?: { message: string; cached: boolean };
};

/** "fs:RYAN" → "spell RYAN"; a sign id → its gloss. */
const chipLabel = (token: string) => (token.startsWith("fs:") ? `spell ${token.slice(3)}` : (SIGNS[token]?.id ?? token));

/**
 * A conversation scene: the other person's line, then your reply as a row of sign chips on one camera.
 * Finished turns stay above as chat bubbles. Presentational only; LessonPlayer + TokenRunner drive it.
 * Meaning is never colour alone: chips say "done" / "now" in text, and the prompt is an aria-live region.
 */
import { LessonExit } from "./LessonExit";

export function SceneView(p: SceneViewProps) {
  const t = p.turns[p.turnIndex];
  return (
    <div className="page scene">
      <LessonExit />
      <header className="lesson-head">
        <div>
          <p className="eyebrow">
            Conversation · turn {Math.min(p.turnIndex + 1, p.turns.length)} of {p.turns.length}
          </p>
          <h1>{p.title ?? "Say hello"}</h1>
        </div>
      </header>

      <ol className="scene-chat" aria-label="Conversation so far">
        {p.turns.slice(0, p.turnIndex).map((d, i) => (
          <li key={i} className="scene-pair">
            <p className="bubble bubble-them">
              <span className="bubble-gloss">{d.them.gloss}</span> “{d.them.english}”
            </p>
            <p className="bubble bubble-you">{d.you.english}</p>
          </li>
        ))}
        {t && (
          <li className="scene-pair">
            <p className="bubble bubble-them">
              <span className="bubble-gloss">{t.them.gloss}</span> “{t.them.english}”
            </p>
          </li>
        )}
      </ol>

      {t && (
        <section className="card" aria-label="Your reply">
          <h2 className="small-title">Your reply: “{t.you.english}”</h2>
          <ol className="scene-chips">
            {t.you.tokens.map((tok, i) => {
              const state = i < p.tokenIndex ? "done" : i === p.tokenIndex ? "now" : "next";
              return (
                <li key={i} className={`chip-sign chip-${state}`} aria-current={state === "now" ? "step" : undefined}>
                  <span>{chipLabel(tok)}</span>
                  <span className="chip-state">{state === "done" ? "✓ done" : state === "now" ? "now" : "next"}</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section className="card" aria-label="Your camera">
        <h2 className="small-title">Your hand</h2>
        {p.camera}
      </section>

      <StatusMessage kind="info" label={false} message={p.prompt} />
      <RewardLine reward={p.reward} />
      {(p.onSelfCheck || p.onSkip) && (
        <div className="row">
          {p.onSelfCheck && (
            <button type="button" onClick={p.onSelfCheck}>
              I signed it
            </button>
          )}
          {p.onSkip && (
            <button type="button" className="secondary" onClick={p.onSkip}>
              Skip this scene
            </button>
          )}
        </div>
      )}
    </div>
  );
}
