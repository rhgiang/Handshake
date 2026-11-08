import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { SIGNS, isPracticeable, meanPose3D, useLetterCheck } from "../cv";
import { TokenRunner } from "./TokenRunner";
import { buildCurriculum, flatLessons, type Step } from "../lib/curriculum";
import { completeLesson, dueItems, isUnlocked, loadProgress, recordAttempt, recordPartial, type Progress } from "../lib/progress";
import { reportAttempt, reportLessonComplete } from "../lib/track";
import { loadMistakes, mistakeCount, recordMistake } from "../lib/mistakes";
import { requireProfile } from "../lib/requireProfile";
import { SEND_SNAPSHOT, getCoachTip, getHowTo, praise } from "../lib/api";
import { streakAfter, type Praise } from "../lib/praise";
import { LessonView } from "../components/LessonView";
import { SceneView } from "../components/SceneView";
import { Camera } from "../components/Camera";
import { AnimatedProgress } from "../components/motion/AnimatedProgress";
import { createCoachQueue } from "../lib/coachQueue";
import type { FingerFeedback } from "../cv/types";
import { loadTemplates } from "../cv/classifier";
import { celebrate } from "../components/celebrate";
import { LessonNotice } from "../components/LessonNotice";
import { clearRedo, loadRedo, saveRedo } from "./lessonRedo";

const HandModel3D = lazy(() => import("../components/HandModel3D"));

/** Spec §1: "Matches our recording" until a fluent signer has checked the templates (Task 11 Step 2). */
export const MATCH_WORDING = "Matches our recording";

// A lesson's steps flattened into one item per thing the learner does.
export type Item =
  | { kind: "learn"; letter: string; referenceOnly: boolean }
  | { kind: "check"; letter: string; showReference: boolean; reps?: number; word?: { letters: string[]; index: number } }
  | { kind: "identify"; letter: string; options: string[]; again?: boolean } // "which letter is this?": no camera
  | { kind: "other"; step: Step }; // sign / sentence / scene: group-1 Tasks 10 and 12

const shuffle = <T,>(xs: T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/**
 * `names` = the learner's and their person's names (letters only, upper case). Repeats are trimmed, not removed:
 * a word is spelled once per lesson, the review step skips letters this lesson just asked, and a name that already
 * has its own lesson is not used again as a drill word. A lesson no longer ends with a review round (the Alphabet
 * checkpoint, which is only review, keeps it). Practice, mix and look-alike drills still repeat on purpose.
 */
export function expand(steps: Step[], _progress: Progress, names: string[] = []): Item[] {
  const out: Item[] = [];
  const asked = new Set<string>(); // letters already asked earlier in this lesson
  const spelled = new Set<string>();
  for (const s of steps) {
    // Live letters: the practice step already shows the reference beside the camera, so no separate "learn" page.
    if (s.kind === "learn") { if (!isPracticeable(s.letter)) out.push({ kind: "learn", letter: s.letter, referenceOnly: true }); }
    else if (s.kind === "practice") {
      // One step per letter: LetterItem counts the reps (relax the hand between them).
      if (isPracticeable(s.letter)) { out.push({ kind: "check", letter: s.letter, showReference: true, reps: s.reps }); asked.add(s.letter); }
    } else if (s.kind === "identify") {
      if (isPracticeable(s.letter)) out.push({ kind: "identify", letter: s.letter, options: s.options }); // needs a recorded 3D pose
    } else if (s.kind === "mix") {
      // Sign again from memory, random order, reference hidden (hint ladder available).
      for (const l of shuffle(s.letters.filter(isPracticeable))) { out.push({ kind: "check", letter: l, showReference: false }); asked.add(l); }
    } else if (s.kind === "spell") {
      if (spelled.has(s.word)) continue;
      if (steps.length > 1 && !s.showReference && names.includes(s.word)) continue; // a drill that is just a name: that has its own lessons
      spelled.add(s.word);
      const letters = [...s.word];
      letters.forEach((l, index) => out.push(isPracticeable(l)
        ? { kind: "check", letter: l, showReference: s.showReference, word: { letters, index } }
        : { kind: "learn", letter: l, referenceOnly: true }));
    } else if (s.kind === "contrast" || s.kind === "review") {
      if (s.kind === "review" && steps.length > 1) continue; // the end-of-lesson "everything again with the reference" round repeated what practice, mix and the drills just did; only the Alphabet checkpoint is all review
      const letters = s.kind === "contrast" ? s.letters : dueItems(_progress).filter((l) => /^[A-Z]$/.test(l) && !asked.has(l));
      const graded = s.kind === "review" || letters.every(isPracticeable);
      for (const letter of letters) {
        out.push(graded && isPracticeable(letter)
          ? { kind: "check", letter, showReference: true }
          : { kind: "learn", letter, referenceOnly: true });
        asked.add(letter);
      }
    }
    else out.push({ kind: "other", step: s });
  }
  return out;
}

export function LessonPlayer({ lessonId }: { lessonId: string }) {
  return <Player key={lessonId} lessonId={lessonId} />;
}
/** The whole phrase in order, with the part you are on marked in words (not colour alone). */
function PhraseTracker({ tokens, current }: { tokens: string[]; current: number }) {
  return (
    <ol className="row" aria-label="The phrase, in order" style={{ flexWrap: "wrap", gap: "0.4rem", listStyle: "none", padding: 0 }}>
      {tokens.map((t, k) => {
        const label = t.startsWith("fs:") ? t.slice(3) + " (spell)" : (SIGNS[t]?.english ?? t);
        const state = k < current ? "done" : k === current ? "now" : "next";
        return (
          <li key={k} className={state === "now" ? "chip ok" : "chip"} aria-current={state === "now" ? "step" : undefined}>
            {state === "done" ? "✓ " : state === "now" ? "▶ " : ""}{label}
          </li>
        );
      })}
    </ol>
  );
}

/** "Part 3 of 11: MEET" with a bar, for a phrase made of several parts. Words as well as the bar, so it never relies on the bar alone. */
function PartProgress({ index, total, name }: { index: number; total: number; name: string }) {
  return (
    <div role="group" aria-label="Progress through the phrase" style={{ margin: "0 0 0.75rem" }}>
      <p style={{ margin: "0 0 0.35rem", fontWeight: 700 }}>Part {Math.min(index + 1, total)} of {total}: {name}{index > 0 ? ` · ${index} done` : ""}</p>
      <AnimatedProgress value={index} max={total} label={`Phrase progress: ${index} of ${total} parts done`} />
    </div>
  );
}

function Player({ lessonId }: { lessonId: string }) {
  const profile = requireProfile();
  const units = useMemo(() => buildCurriculum(profile).filter((u) => ["u1", "u2", "u3", "u4"].includes(u.id)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const names = [profile.userName, profile.theirName].map((n) => n.toUpperCase().replace(/[^A-Z]/g, "")).filter(Boolean);
  const lesson = useMemo(() => flatLessons(units).find((l) => l.id === lessonId), [units, lessonId]);
  const progress = useRef(loadProgress()); // a ref, not state: recordAttempt mutates, and StrictMode would double-apply updaters
  const [items, setItems] = useState<Item[]>(() => (lesson ? expand(lesson.steps, progress.current, names) : [])); // state: a missed "which letter" comes back once at the end
  const [i, setI] = useState(0);
  const [turn, setTurn] = useState(0); // which exchange of a conversation scene (hooks stay above the early returns)
  const lessonLetters = useMemo(() => [...new Set(items.flatMap((x) => (x.kind === "check" ? [x.letter] : [])))], [items]);


  const finishing = useRef(false);
  // A skipped step is passed without a match. The lesson can then be walked to the end, but it is NOT completed:
  // no XP, no unlock. Otherwise Skip would be a way round the pass rule (mastery needs real matches).
  // Steps already matched stay done: only the skipped ones (and any not reached) are offered again, and that list is saved.
  const total = useRef(Math.max(1, items.length)); // steps in a full run, for the "partly done" share
  const skipped = useRef(new Map<number, Item>()); // index in `items` -> the skipped item
  const [incomplete, setIncomplete] = useState(false);
  const after = useMemo(() => { const all = flatLessons(units); return all.slice(all.findIndex((l) => l.id === lessonId) + 1).find((l) => l.scope === "demo"); }, [units, lessonId]);
  const [resume, setResume] = useState<Item[] | null>(() => loadRedo<Item>(lessonId)); // left over from an earlier visit
  const streak = useRef(0); // consecutive matched steps, for the praise line only (never affects passing)
  const markSkipped = () => { streak.current = streakAfter(streak.current, "skip"); if (items[i]) skipped.current.set(i, items[i]); };
  function skip() {
    markSkipped();
    setTurn(0); // leaving a scene mid-way must not leave the next scene starting at a stale turn
    next();
  }
  function restart(list: Item[]) {
    skipped.current = new Map();
    finishing.current = false;
    setIncomplete(false);
    setResume(null);
    setTurn(0);
    setI(0);
    setItems(list);
  }
  const startAgain = () => { clearRedo(lessonId); if (lesson) { const list = expand(lesson.steps, progress.current, names); total.current = Math.max(1, list.length); restart(list); } }; // fresh order, no leftover "again" items
  const redoSkipped = () => restart([...skipped.current.values()]);
  function next() {
    if (finishing.current) return;
    const left = [...skipped.current.values(), ...items.slice(i + 1)];
    if (i + 1 < items.length) { saveRedo(lessonId, left); return setI(i + 1); }
    if (skipped.current.size) {
      saveRedo(lessonId, left);
      progress.current = recordPartial(progress.current, lessonId, 1 - skipped.current.size / total.current); // opens the next lesson, shows as partly filled
      return setIncomplete(true);
    }
    finishing.current = true;
    clearRedo(lessonId);
    if (!progress.current.completed.includes(lesson!.id)) {
      progress.current = completeLesson(progress.current, lesson!.id, lesson!.xp);
      reportLessonComplete(lesson!.id, lesson!.xp);
    }
    location.hash = `#/complete/${lesson!.id}`;
  }

  if (!lesson) return <div className="page"><p>Lesson not found. <a href="#/">Back to your path</a></p></div>;
  // Same baseline: no skipping ahead by URL. "Skip" inside a lesson passes an item without counting it as a match.
  if (!isUnlocked(units, progress.current, lesson.id)) return <div className="page"><p>Locked: finish the lessons before it first. <a href="#/">Back to your path</a></p></div>;
  if (incomplete) {
    const n = skipped.current.size;
    const stepWord = n === 1 ? "step" : "steps";
    return (
      <LessonNotice
        title="Lesson not finished yet"
        message={`You skipped ${n} ${stepWord}, so this lesson is not complete and no XP was added. Everything you matched is saved: you only need to redo the skipped ${stepWord}.`}
        primary={{ label: `Redo the skipped ${stepWord}`, onClick: redoSkipped }}
        secondary={{ label: "Start the whole lesson over", onClick: startAgain }}
        links={[...(after ? [{ href: `#/lesson/${after.id}`, label: `Go on to ${after.id} ${after.title}` }] : []), { href: "#/", label: "Back to your path" }]}
        footnote={after ? "This lesson stays partly filled on your path until the skipped steps are matched." : undefined}
      />
    );
  }
  if (resume)
    return (
      <LessonNotice
        title="Pick up where you left off"
        message={`${resume.length} ${resume.length === 1 ? "step is" : "steps are"} left in this lesson. The ones you already matched are saved.`}
        primary={{ label: `Continue (${resume.length} left)`, onClick: () => restart(resume) }}
        secondary={{ label: "Start the whole lesson over", onClick: startAgain }}
        links={[{ href: "#/", label: "Back to your path" }]}
      />
    );
  const item = items[i];
  if (!item) return <div className="page"><p>Nothing to practice here yet.</p><button onClick={next}>Continue</button></div>;
  const stepLabel = `Step ${i + 1} of ${items.length}`;

  // Whole signs and sentences: one TokenRunner walks the parts (handshape → place → movement) on one camera.
  if (item.kind === "other" && (item.step.kind === "sign" || item.step.kind === "sentence")) {
    const s = item.step;
    const tokens = s.kind === "sign" ? [s.sign] : s.tokens;
    const title = s.kind === "sign" ? `Sign "${SIGNS[s.sign]?.english ?? s.sign}"` : s.english;
    return (
      <TokenRunner tokens={tokens} leftHanded={profile.leftHanded} onEmpty={skip}
        onDone={() => { progress.current = recordAttempt(progress.current, tokens.join(" "), true); celebrate(); next(); }}
        render={(r) => (
          <LessonView title={title} target={(() => { const u = r.units[r.index]; return u ? (u.kind === "sign" ? u.id : u.letter) : tokens.join(" "); })()}
            reference={<>{s.kind === "sentence" && <PhraseTracker tokens={tokens} current={r.token} />}{r.guide}</>} showReference={!!r.guide} progress={0}
            camera={<>{r.units.length > 1 && <PartProgress index={r.index} total={r.units.length} name={(() => { const u = r.units[r.index]; return u.kind === "sign" ? (SIGNS[u.id]?.english ?? u.id) : `spell ${u.letter}`; })()} />}{r.camera}</>}
            status={r.prompt} landmarkTip="" coachTip="" coachCached={false} sideBySide={false}
            stepLabel={`${stepLabel} · part ${r.index + 1} of ${r.units.length}`} lessonProgress={(i + r.index / r.units.length) / items.length}
            actionLabel="Skip" onAction={skip} onSelfCheck={r.selfCheck} reward={r.reward} />
        )} />
    );
  }
  // Conversation scene: their line, then your reply as signs, turn by turn, on one camera.
  if (item.kind === "other" && item.step.kind === "scene") {
    const turns = item.step.turns.map((t) => ({ them: { gloss: t.them.tokens.join(" "), english: t.them.english }, you: t.you }));
    const turnNow = Math.min(turn, turns.length - 1);
    return (
      <TokenRunner tokens={turns[turnNow].you.tokens} leftHanded={profile.leftHanded}
        onDone={() => {
          if (turn + 1 < turns.length) return setTurn(turn + 1);
          progress.current = recordAttempt(progress.current, `scene:${lesson.id}`, true);
          celebrate();
          setTurn(0);
          next();
        }}
        onEmpty={() => { markSkipped(); if (turnNow + 1 < turns.length) setTurn(turnNow + 1); else { setTurn(0); next(); } }}
        render={(r) => <SceneView title={lesson.title} turns={turns} turnIndex={turnNow} tokenIndex={r.token} camera={<>{r.guide}{r.camera}</>} prompt={r.prompt} onSelfCheck={r.selfCheck} onSkip={skip} reward={r.reward} />} />

    );
  }
  // ONE camera at a time: LetterItem stays mounted across consecutive letter items (no key), so the camera never restarts.
  if (item.kind === "other")
    return <div className="page"><p>Coming in a later milestone: {item.step.kind}</p><button onClick={next}>Continue</button></div>;
  if (item.kind === "identify")
    return <IdentifyItem key={i} item={item} leftHanded={profile.leftHanded} stepLabel={stepLabel} onNext={next}
      onMiss={() => { if (!item.again) setItems((xs) => [...xs, { ...item, again: true }]); }} />;
  return <LetterItem index={i} item={item} lessonLetters={lessonLetters} leftHanded={profile.leftHanded} stepLabel={stepLabel} lessonProgress={i / items.length} stepSize={1 / items.length} progress={progress} streak={streak} onNext={next} onSkip={skip} />;
}

type LetterItemProps = {
  index: number;
  item: Exclude<Item, { kind: "other" } | { kind: "identify" }>;
  lessonLetters: string[];
  leftHanded: boolean;
  stepLabel: string;
  lessonProgress: number; // fraction of steps finished before this one
  stepSize: number; // one step's share of the top bar, added once this step matches so the last step can fill the bar
  progress: { current: Progress };
  streak: { current: number };
  onNext: () => void;
  onSkip: () => void;
};

function LetterItem({ index, item, lessonLetters, leftHanded, stepLabel, lessonProgress, stepSize, progress, streak, onNext, onSkip }: LetterItemProps) {
  const [landmarkTip, setLandmarkTip] = useState("");
  const [coach, setCoach] = useState({ tip: "", cached: false });
  const [sideBySide, setSideBySide] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<"" | "match" | "miss">(""); // drives the green/red footer
  const queue = useMemo(() => createCoachQueue<{ key: string; target: string; feedback: FingerFeedback[]; repeat: number; snapshot?: string }, {tip: string; cached?: boolean}>(
    request => getCoachTip(request.target, request.feedback, request.repeat, request.snapshot),
    result => setCoach({ tip: result.tip, cached: !!result.cached }),
    () => setStatus("Coach unavailable. Use the landmark tip above."),
  ), []);
  const target = item.letter;
  const feedbackGroup = index;
  useEffect(() => () => { queue.reset(); }, []);

  useEffect(() => {
    queue.reset();
    setLandmarkTip("");
    setCoach({ tip: "", cached: false });
    setSideBySide(Object.values(loadMistakes()[target] ?? {}).some((entry) => (entry?.count ?? 0) >= 3));
    setStatus("");
  }, [feedbackGroup]);

  const reps = item.kind === "check" ? (item.reps ?? 1) : 1;
  // Steps that hide the reference on purpose (recall practice): 0 hidden, 1 written hint, 2 reference shown. Never changes the pass check.
  const [hintStage, setHintStage] = useState(0);
  const [rep, setRep] = useState(0); // matches so far in this step
  const relax = useRef(false); // after a rep the hand must leave the sign (or drop out) before the next one counts
  // Praise line: fired after a confirmed match, never awaited. `gen` drops a reply that lands after the step changed.
  const [reward, setReward] = useState<Praise | undefined>();
  const gen = useRef(0);
  const misses = useRef(0);
  const clearReward = () => { gen.current++; misses.current = 0; setReward(undefined); };
  useEffect(() => {
    clearReward();
    check.reset();
    setResult("");
    // Moving to the next rep/step: clear the last one's message so "Matches our recording: X" is not shown (or announced)
    // again before the learner has signed anything.
    setStatus("");
    setRep(0);
    setHintStage(0);
    relax.current = false;
  }, [index]);

  function retry() {
    clearReward();
    queue.reset();
    setLandmarkTip("");
    setCoach({ tip: "", cached: false });
    setStatus("");
    setResult("");
    setRep(0);
    relax.current = false;
    check.reset();
  }

  const check = useLetterCheck(target, lessonLetters, {
    leftHanded,
    enabled: (item.kind === "check" || !item.referenceOnly) && result !== "match", // stop checking once matched; "Try again" restarts
    onFrame: (hand, pred) => { if (relax.current && (!hand || pred.letter !== target)) { relax.current = false; setStatus(`Sign ${target} again (${rep} of ${reps})`); } },
    onMatch: (d) => {
      if (relax.current) return; // still holding the previous rep
      // Learn steps show the camera for trying the sign, but nothing is scored or advanced.
      if (item.kind !== "check") { setStatus(`Matches our recording: ${d.letter} (practice, not scored)`); return; }
      progress.current = recordAttempt(progress.current, d.letter, true);
      reportAttempt(d.letter, true);
      if (rep + 1 < reps) { setRep(rep + 1); relax.current = true; setStatus(`Matches our recording: ${rep + 1} of ${reps}. Relax your hand, then sign ${target} again.`); return; }
      queue.reset();
      setLandmarkTip("");
      setCoach({ tip: "", cached: false });
      setResult("match");
      setStatus(`${MATCH_WORDING}: ${d.letter}`);
      celebrate();
      streak.current = streakAfter(streak.current, "match");
      const g = gen.current;
      void praise("letter", d.letter, { streak: streak.current, tries: misses.current + 1 }).then((r) => { if (g === gen.current) setReward(r); });
    },
    onMiss: (feedback) => {
      if (item.kind !== "check") return;
      if (relax.current) return; // between reps the hand is resting in frame on purpose: that is not a miss
      // A miss shows the tip and keeps the same rep going. It does not send the learner back to rep 1 (that looped for
      // anyone the model misses often). Mastery still needs 3 in a row: recordAttempt resets the streak on a miss.
      progress.current = recordAttempt(progress.current, target, false);
      reportAttempt(target, false, feedback.map((f) => f.code));
      misses.current++;
      streak.current = streakAfter(streak.current, "miss");
      setCoach({ tip: "", cached: false });
      const first = feedback[0];
      setResult("miss");
      setStatus(`Not matching ${target} yet. Keep trying.`);
      setLandmarkTip(first ? `Your ${first.finger} ${first.issue}.` : "Compare your hand with the reference and hold it still.");
      if (!first) return;
      const repeat = mistakeCount(recordMistake(loadMistakes(), target, first.code), target, first.code);
      setSideBySide(repeat >= 3);

      queue.submit({ key: `${target}:${first.code}:${first.issue}`, target, feedback, repeat, snapshot: SEND_SNAPSHOT ? check.snapshot() : undefined });
    },
  });

  // How to form the letter (Gemini, general ASL knowledge). Hidden until it arrives, and when Gemini is unsure or down.
  const [howTo, setHowTo] = useState<{ text: string; cached: boolean } | undefined>();
  const [howToLoading, setHowToLoading] = useState(true);
  useEffect(() => {
    setHowTo(undefined);
    setHowToLoading(true);
    let live = true;
    getHowTo(target).then((r) => live && r.text && setHowTo({ text: r.text, cached: !!r.cached })).catch(() => {}).finally(() => live && setHowToLoading(false));
    return () => { live = false; };
  }, [target]);

  // Once the target matches, the ring and bar stay full until "Try again" (retry() resets the check, so this goes back to live progress).
  const shownProgress = result === "match" ? 1 : check.progress;
  // Top bar: steps finished so far, plus this one once it matches, so the final step can reach 100%.
  const barProgress = Math.min(1, lessonProgress + (result === "match" ? stepSize : 0));
  const noLiveCheck = item.kind === "learn" && item.referenceOnly;
  const moving = target === "J" || target === "Z"; // these are drawn in the air, so a still camera frame can never check them
  const recall = item.kind === "check" && !item.showReference && !sideBySide; // reference hidden on purpose
  const camera = noLiveCheck ? (
    <div className="card">
      {moving ? (
        <p><strong>{target} moves, so the camera can't check it.</strong> Watch the motion in a Deaf-led source such as Lifeprint (lifeprint.com), copy it, then continue.</p>
      ) : (
        <>
          <p><strong>No live check for {target} yet.</strong> It is reference only until the letter passes the Letter gate.</p>
          <p><a href="#/camera-demo">Try the camera and coach in the demo</a></p>
        </>
      )}
    </div>
  ) : (
    <>
      <Camera {...check.cam} progress={shownProgress} />
      {check.hint && <p role="status">{check.hint}</p>}
      {recall && hintStage === 1 && <p role="status">Hint: {howTo?.text ?? (howToLoading ? "loading…" : "no written hint is available for this letter, try Show answer.")}</p>}
      {recall && (
        <button type="button" className={check.missCount >= 2 && hintStage === 0 ? "cta" : "secondary"} onClick={() => setHintStage((hintStage + 1) % 3)}>
          {hintStage === 0 ? (check.missCount >= 2 ? "Struggling? Get a hint" : "Hint") : hintStage === 1 ? "Show answer" : "Hide answer"}
        </button>
      )}
    </>
  );
  // This component re-renders on every camera frame; the pose only changes with the letter, templates or hand.
  const pose = useMemo(() => meanPose3D(target, check.templates, leftHanded), [target, check.templates, leftHanded]);
  const hidden = recall && hintStage < 2;
  // Placeholder keeps the reference slot visible so the learner knows the hand is hidden on purpose, and how to get it.
  const reference = hidden ? (
    <div className="hand3d empty" role="note" style={{ border: "2px dashed currentColor", display: "grid", placeItems: "center", textAlign: "center", padding: "1rem" }}>
      <p><strong>Reference hidden on purpose</strong><br />Try {target} from memory. Stuck? Use Hint, then Show answer.</p>
    </div>
  ) : (
    <Suspense fallback={<div className="hand3d empty">Loading 3D hand…</div>}>
      <HandModel3D pose={pose} letter={target} />
    </Suspense>
  );
  const common = { target, reference, camera, landmarkTip, coachTip: coach.tip, coachCached: coach.cached, sideBySide, stepLabel, lessonProgress: barProgress, howTo: recall && hintStage < 2 ? undefined : howTo };

  if (item.kind === "learn")
    return (
      <LessonView {...common} title={`Learn ${item.letter}`} showReference progress={0}
        status={item.referenceOnly ? (moving ? `${item.letter} moves: learn the motion, then continue.` : "Reference only, coming later") : `This is ${item.letter}. Try it, then continue.`}
        actionLabel="Continue" onAction={onNext} />
    );

  return (
    <LessonView {...common} title={item.word ? `Spell ${item.word.letters.join("")}` : `Sign ${item.letter}`} word={item.word}
      showReference={item.showReference || sideBySide || recall} progress={shownProgress}
      status={status || (recall ? `From memory: sign ${target}. The reference is hidden on purpose so you practice recalling it.` : `Hold the sign for ${target}${reps > 1 ? ` (${rep} of ${reps})` : ""}`)} feedback={result || undefined}
      actionLabel="Continue" actionDisabled={result !== "match"} onAction={onNext} reward={reward}
      onRetry={result === "match" ? retry : undefined} onSkip={result === "match" ? undefined : onSkip} />
  );
}

/** "Which letter is this?": a recorded 3D hand and answer choices. No camera, and it does not count toward mastery (that needs signing). */
function IdentifyItem({ item, leftHanded, stepLabel, onNext, onMiss }: { item: Extract<Item, { kind: "identify" }>; leftHanded: boolean; stepLabel: string; onNext: () => void; onMiss: () => void }) {
  const templates = useMemo(() => loadTemplates(), []);
  const pose = useMemo(() => meanPose3D(item.letter, templates, leftHanded), [item.letter, templates, leftHanded]);
  const [picked, setPicked] = useState<string[]>([]);
  const done = picked.includes(item.letter);
  const last = picked[picked.length - 1];
  const status = done ? `Yes, that is ${item.letter}. It matches the reference.` : last ? `Not ${last}. Try another.` : "Pick the letter this hand is showing.";
  function pick(l: string) {
    if (done || picked.includes(l)) return;
    if (l !== item.letter && picked.length === 0) onMiss();
    setPicked([...picked, l]);
  }
  // A quiz needs a hand to look at. If this letter has no recorded 3D pose (older templates), say so and move on instead of
  // showing a blank hand the learner can only skip. It is not scored either way.
  if (!pose)
    return (
      <div className="page">
        <p className="muted">{stepLabel}</p>
        <p role="status">There is no 3D hand for {item.letter} yet, so this question is skipped. It does not count for or against you.</p>
        <p><button type="button" className="cta" onClick={onNext}>Continue</button></p>
      </div>
    );
  return (
    <div className="page">
      <p className="muted">{stepLabel}</p>
      <h1>Which letter is this?</h1>
      <Suspense fallback={<div className="hand3d empty">Loading 3D hand…</div>}>
        <HandModel3D pose={pose} letter="?" />
      </Suspense>
      <div className="choices big-choices" role="group" aria-label="Answer choices">
        {item.options.map((l) => (
          <button key={l} type="button" className={`secondary ${done && l === item.letter ? "answer-right" : picked.includes(l) ? "answer-wrong" : ""}`} disabled={done || picked.includes(l)} onClick={() => pick(l)}>
            {l}{picked.includes(l) && l !== item.letter ? " (not this one)" : ""}{done && l === item.letter ? " ✓" : ""}
          </button>
        ))}
      </div>
      <p role="status" aria-live="polite">{status}</p>
      <p>
        <button type="button" className="cta" disabled={!done} onClick={onNext}>Continue</button>{" "}
        {!done && <button type="button" className="secondary" onClick={onNext}>Skip</button>}
      </p>
    </div>
  );
}
