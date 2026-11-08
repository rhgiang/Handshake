import { CONFUSABLE } from "../cv/recognizer";
import { SIGNS, PACK_WORDS } from "../cv/signs";

// The whole lesson plan as data. Screens render whatever this returns, so adding a lesson
// is adding data, not code. `scope` says what we build for the demo vs. later:
//   "demo"    → must work on stage (Unit 1, the easy letter groups, their name, HELLO/intro, Scene 1)
//   "stretch" → same engine, only built/tested if time allows
//
// Unit 1  Your name                the letters of YOUR name → spell it → checkpoint
// Unit 2  The alphabet            handshape families, easiest first; same ids for everyone, their name after the demo families
// Unit 3  Greetings + sentences   whole signs (assisted: handshape + location + movement), ASL word order
// Unit 4  Conversation            scripted scenes; Gemini fills small talk from the word pack

export type Grading = "auto" | "assisted" | "self";

/** A token in a sentence: a sign id from SIGNS, or "fs:WORD" for fingerspelling. */
export type Token = string;

export type Step =
  | { kind: "learn"; letter: string } //            see it (3D hand + photo), no grading
  | { kind: "practice"; letter: string; reps: number } // sign it N times in a row
  | { kind: "identify"; letter: string; options: string[] } // "which letter is this?": 3D hand + multiple choice, no camera
  | { kind: "mix"; letters: string[] } //            sign these again from memory, shuffled
  | { kind: "contrast"; letters: string[] } //      look-alikes in random order
  | { kind: "spell"; word: string; showReference: boolean }
  | { kind: "sign"; sign: string } //              a whole sign (SignChecker)
  | { kind: "sentence"; tokens: Token[]; english: string }
  | { kind: "review" } //                          weak / due items from progress.ts
  | { kind: "scene"; turns: Turn[] };

export type Turn = { them: { tokens: Token[]; english: string }; you: { tokens: Token[]; english: string } };

export type Lesson = {
  id: string;
  title: string;
  summary: string;
  scope: "demo" | "stretch";
  grading: Grading;
  xp: number;
  steps: Step[];
  /** Letters this lesson introduces (for unlocking "spell their name"). */
  teaches?: string[];
};

export type Unit = { id: string; title: string; goal: string; lessons: Lesson[] };

export type Personalization = {
  userName: string;
  theirName: string;
  relationship?: "coworker" | "friend" | "family" | "classmate" | "partner";
  /** Sign ids picked for the relationship (from /api/path; falls back to PACK_WORDS). */
  wordPack?: string[];
  /** Real words from letters the learner knows (from /api/words); keyed by lesson id. */
  practiceWords?: Record<string, string[]>;
};

const MOVING = ["J", "Z"];

/** Static letter families, easiest first. Same for every learner: Unit 1 letters are simply practiced again. */
const FAMILIES: { id: string; title: string; letters: string[]; scope: "demo" | "stretch" }[] = [
  { id: "flat", title: "Flat and curved", letters: ["B", "C", "O"], scope: "demo" },
  { id: "point", title: "Point and pinky", letters: ["D", "I", "L", "Y"], scope: "demo" },
  { id: "fingers", title: "Two and three fingers", letters: ["V", "W", "F"], scope: "demo" },
  { id: "fist", title: "The fist", letters: ["A"], scope: "demo" },
  { id: "fingers2", title: "More finger shapes", letters: ["U", "K", "R"], scope: "demo" },
  { id: "fist2", title: "The fist family", letters: ["S", "E", "T", "M", "N"], scope: "demo" },
  { id: "sideways", title: "Sideways shapes", letters: ["G", "H", "P", "Q", "X"], scope: "demo" },
];

const clean = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, "");
const unique = (xs: string[]) => [...new Set(xs)];

/** Answer choices for "which letter is this?": the letter, look-alikes first, then other known letters. Order is fixed per letter. */
function optionsFor(letter: string, pool: string[]): string[] {
  const alike = (CONFUSABLE[letter] ?? []).filter((c) => pool.includes(c));
  const others = pool.filter((c) => c !== letter && !alike.includes(c)).sort((a, b) => ((a.charCodeAt(0) * 7 + letter.charCodeAt(0)) % 13) - ((b.charCodeAt(0) * 7 + letter.charCodeAt(0)) % 13));
  const opts = [letter, ...alike, ...others].slice(0, 3).sort();
  const r = letter.charCodeAt(0) % opts.length;
  return [...opts.slice(r), ...opts.slice(0, r)];
}

// Duolingo-style: sign each new letter once, then mixed practice (identify from the 3D hand, then sign from memory in random order).
function letterSteps(letters: string[], known: Set<string>): Step[] {
  const steps: Step[] = [];
  const fresh = letters.filter((l) => !known.has(l)); // letters met earlier (Unit 1) skip "which letter is this?"
  for (const l of letters) {
    steps.push({ kind: "learn", letter: l }, { kind: "practice", letter: l, reps: 1 });
    known.add(l);
  }
  const pool = [...known];
  if (pool.length > 1) for (const l of fresh.slice(0, 2)) steps.push({ kind: "identify", letter: l, options: optionsFor(l, pool) });
  if (letters.length > 1) steps.push({ kind: "mix", letters });
  // Look-alike drills only between letters the learner already knows.
  const pairs = unique(letters.flatMap((l) => (CONFUSABLE[l] ?? []).filter((c) => known.has(c)).map((c) => [l, c].sort().join(""))));
  for (const p of pairs.slice(0, 1)) steps.push({ kind: "contrast", letters: p.split("") });
  return steps;
}

export function buildCurriculum(p: Personalization): Unit[] {
  const me = clean(p.userName) || "SAM";
  const them = clean(p.theirName) || "LILY";
  const solo = !clean(p.theirName); // learning for yourself: no "their name" lesson and no named conversation
  const known = new Set<string>();
  const words = (id: string) => p.practiceWords?.[id] ?? [];
  // One practice word per lesson, never the same word twice in the path.
  const usedWords = new Set<string>();
  const freshWord = (id: string) => { const w = words(id).find((x) => !usedWords.has(x)); if (w) usedWords.add(w); return w ? [w] : []; };

  // ---------- Unit 1: your name ----------
  const myLetters = unique([...me]).filter((l) => !MOVING.includes(l));
  const unit1: Unit = {
    id: "u1",
    title: "Your name",
    goal: `Spell ${me} without help`,
    lessons: [
      { id: "1.1", title: "Your letters", summary: myLetters.join(" "), scope: "demo", grading: "auto", xp: 10 * myLetters.length, teaches: myLetters, steps: letterSteps(myLetters, known) },
      { id: "1.2", title: `Spell ${me}`, summary: "Your name, with the reference", scope: "demo", grading: "auto", xp: 20, steps: [{ kind: "spell", word: me, showReference: true }] },
      { id: "1.3", title: "Checkpoint", summary: "Spell your name from memory", scope: "demo", grading: "auto", xp: 30, steps: [{ kind: "spell", word: me, showReference: false }] },
    ],
  };
  // Letters of the name that move (J/Z) are taught later; flag them in the summary.
  if ([...me].some((l) => MOVING.includes(l))) unit1.lessons[0].summary += " (J/Z later)";

  // ---------- Unit 2: the alphabet ----------
  const unit2Lessons: Lesson[] = [];
  let n = 1;
  for (const fam of FAMILIES) {
    const letters = fam.letters;
    const id = `2.${n++}`;
    unit2Lessons.push({
      id,
      title: fam.title,
      summary: letters.join(" "),
      scope: fam.scope,
      grading: "auto",
      xp: 10 * letters.length,
      teaches: letters,
      steps: [...letterSteps(letters, known), ...freshWord(id).map((w) => ({ kind: "spell", word: w, showReference: false }) as Step)],
    });
    // Their name: one fixed place for everyone, right after the last demo family.
    if (fam.id === "fist" && !solo) {
      const nid = `2.${n++}`;
      unit2Lessons.push({
        id: nid,
        title: `Spell ${them}`,
        summary: "Their name, plus one word drill",
        scope: "demo",
        grading: "auto",
        xp: 30,
        steps: [{ kind: "spell", word: them, showReference: true }, ...freshWord(nid).map((w) => ({ kind: "spell", word: w, showReference: false }) as Step)],
      });
    }
  }
  unit2Lessons.push({ id: `2.${n++}`, title: "Moving letters", summary: "J Z · watch and copy", scope: "stretch", grading: "self", xp: 20, teaches: MOVING, steps: MOVING.map((l) => ({ kind: "learn", letter: l }) as Step) });
  unit2Lessons.push({ id: `2.${n++}`, title: "Alphabet checkpoint", summary: "Speed round, all letters", scope: "stretch", grading: "auto", xp: 50, steps: [{ kind: "review" }] });
  const unit2: Unit = { id: "u2", title: "The alphabet", goal: "Fingerspell any word", lessons: unit2Lessons };

  // ---------- Unit 3: greetings and sentences ----------
  const pack = (p.wordPack?.length ? p.wordPack : PACK_WORDS(p.relationship ?? "friend")).filter((w) => SIGNS[w]).slice(0, 4);
  const signLesson = (id: string, title: string, signs: string[], scope: "demo" | "stretch", extra: Step[] = []): Lesson => ({
    id,
    title,
    summary: signs.join(" · "),
    scope,
    grading: signs.every((s) => SIGNS[s]?.grading === "assisted") ? "assisted" : "self",
    xp: 15 * signs.length,
    steps: [...signs.map((s) => ({ kind: "sign", sign: s }) as Step), ...extra],
  });
  const unit3: Unit = {
    id: "u3",
    title: "Introduce yourself",
    goal: "Sign hello, nice to meet you, my name is…",
    lessons: [
      // Demo path: learn each sign of the introduction, then say it all in order: "Hello. Nice to meet you. My name is <you>."
      signLesson("3.1", "The signs", ["HELLO", "NICE", "MEET", "YOU", "MY", "NAME"], "demo"),
      { id: "3.2", title: "Introduce yourself", summary: `HELLO · NICE MEET YOU · MY NAME ${me}`, scope: "demo", grading: "assisted", xp: 60, steps: [{ kind: "sentence", tokens: ["HELLO", "NICE", "MEET", "YOU", "MY", "NAME", `fs:${me}`], english: `Hello, nice to meet you. My name is ${p.userName || me}.` }] },
      signLesson("3.3", "Being polite", ["PLEASE", "THANK-YOU", "SORRY"], "stretch"),
      signLesson("3.4", "Asking questions", ["YOUR", "HOW", "WHAT"], "stretch", [{ kind: "sentence", tokens: ["YOUR", "NAME", "WHAT"], english: "What's your name? (eyebrows down)" }]),
      signLesson("3.5", "Answering", ["YES", "NO", "GOOD", "FINE"], "stretch"),
      signLesson("3.6", p.relationship ? `Words for your ${p.relationship}` : "Everyday words", pack, "stretch"),
    ],
  };

  // ---------- Unit 4: conversation ----------
  const T = (tokens: Token[], english: string) => ({ tokens, english });
  const smallTalk = pack.includes("COFFEE") ? "COFFEE" : (pack[0] ?? "COFFEE");
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const unit4: Unit = {
    id: "u4",
    title: solo ? "A conversation" : `A conversation with ${p.theirName || them}`,
    goal: "Hold a short conversation",
    lessons: [
      { id: "4.1", title: "First hello", summary: "Greet and introduce yourself", scope: "demo", grading: "assisted", xp: 60, steps: [{ kind: "scene", turns: [
        { them: T(["HELLO"], "Hi!"), you: T(["HELLO"], "Hi!") },
        { them: T(["YOUR", "NAME", "WHAT"], "What's your name?"), you: T(["MY", "NAME", `fs:${me}`], `My name is ${p.userName || me}.`) },
        { them: T(["NICE", "MEET", "YOU"], "Nice to meet you."), you: T(["NICE", "MEET", "YOU"], "Nice to meet you too.") },
      ] }] },
      { id: "4.2", title: "How are you?", summary: "Ask and answer", scope: "stretch", grading: "assisted", xp: 60, steps: [{ kind: "scene", turns: [
        { them: T(["HOW", "YOU"], "How are you?"), you: T(["FINE", "YOU"], "Fine, and you?") },
        { them: T(["GOOD"], "Good!"), you: T(["GOOD"], "Good.") },
      ] }] },
      { id: "4.3", title: `${cap(SIGNS[smallTalk]?.english ?? "coffee")} break`, summary: "Small talk with your word pack", scope: "stretch", grading: "assisted", xp: 60, steps: [{ kind: "scene", turns: [
        { them: T([smallTalk, "YOU"], `${SIGNS[smallTalk]?.english ?? "coffee"}?`), you: T(["YES", "PLEASE"], "Yes please.") },
        { them: T(["GOOD"], "Great."), you: T(["THANK-YOU"], "Thank you!") },
      ] }] },
      { id: "4.4", title: "The real conversation", summary: "Everything together", scope: "stretch", grading: "assisted", xp: 100, steps: [{ kind: "scene", turns: [
        { them: T(["HELLO"], "Hi!"), you: solo ? T(["HELLO"], "Hi!") : T(["HELLO", `fs:${them}`], `Hi ${p.theirName || them}!`) },
        { them: T(["HOW", "YOU"], "How are you?"), you: T(["GOOD", "YOU"], "Good, you?") },
        { them: T(["FINE"], "Fine."), you: T(["BYE"], "Bye!") },
      ] }] },
    ],
  };

  return [unit1, unit2, unit3, unit4];
}

/** All lessons in path order. */
export const flatLessons = (units: Unit[]) => units.flatMap((u) => u.lessons);

/** Every sign id the curriculum uses (to know which handshapes must be recorded, e.g. "5"). */
export function requiredHandshapes(units: Unit[]): string[] {
  const shapes = new Set<string>();
  for (const l of flatLessons(units))
    for (const s of l.steps) {
      if (s.kind === "learn" || s.kind === "practice") shapes.add(s.letter);
      if (s.kind === "contrast") s.letters.forEach((x) => shapes.add(x));
      if (s.kind === "spell") [...s.word].forEach((x) => shapes.add(x));
      const tokens = s.kind === "sign" ? [s.sign] : s.kind === "sentence" ? s.tokens : s.kind === "scene" ? s.turns.flatMap((t) => t.you.tokens) : [];
      for (const t of tokens) {
        if (t.startsWith("fs:")) [...t.slice(3)].forEach((x) => shapes.add(x));
        else if (SIGNS[t]?.grading === "assisted") shapes.add(SIGNS[t].handshape);
      }
    }
  return [...shapes].filter((x) => !MOVING.includes(x)).sort();
}
