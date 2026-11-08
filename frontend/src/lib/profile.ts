import { buildCurriculum, flatLessons, type Personalization } from "./curriculum";
import { loadProgress, weakItems } from "./progress";
import { getPracticeWords } from "./api";
import { isPracticeable } from "../cv/practiceable";

// The learner profile lives ONLY in this browser. Names are sent only to n8n through the explicit notification consent flow.
// Onboarding asks names + signing hand only; everyone starts at lesson 1.1.
export type Profile = Personalization & { leftHanded: boolean };

/** Home welcome line, same for everyone; names are filled in on the device with fillNames(). */
export const WELCOME = "Let's start with your name, {you}. In a few lessons you'll be saying hello to {them}.";

const KEY = "handshake.profile.v1";
let memory: Profile | null = null; // fallback when localStorage is blocked

export const DEMO_PROFILE: Profile = {
  userName: "Ryan",
  theirName: "Lily",
  leftHanded: false,
};

export function loadProfile(): Profile | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? JSON.parse(s) : memory;
  } catch {
    return memory;
  }
}

export function saveProfile(p: Profile) {
  memory = p;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* session only */
  }
  try { dispatchEvent(new Event("handshake:state")); } catch { /* not in a browser */ }
}

/** Fills {you}/{them} on the device. */
export const fillNames = (text: string, p: Pick<Profile, "userName" | "theirName">) =>
  text.replaceAll("{you}", p.userName).replaceAll("{them}", p.theirName);

/** Only eligible letters, never names, are sent for per-lesson word selection. */
export async function fetchPracticeWords(p: Profile, weak: string[] = []): Promise<Record<string, string[]>> {
  const known = new Set<string>();
  const out: Record<string, string[]> = { ...p.practiceWords };
  const completed = new Set(loadProgress().completed);
  for (const lesson of flatLessons(buildCurriculum(p))) {
    (lesson.teaches ?? []).filter(isPracticeable).forEach((letter) => known.add(letter));
    if (!lesson.id.startsWith("2.") || lesson.scope !== "demo" || completed.has(lesson.id)) continue;
    if (known.size < 2) { out[lesson.id] = []; continue; }
    // Refresh only the next alphabet lesson; preserve saved words for every other lesson.
    const knownNow = [...known];
    try {
      const result = await getPracticeWords(knownNow, weak.filter((letter) => knownNow.includes(letter)));
      out[lesson.id] = result.words;
    } catch {
      out[lesson.id] = p.practiceWords?.[lesson.id] ?? [];
    }
    break;
  }
  return out;
}

let refreshVersion = 0;
/** Refresh after onboarding or completion, without overwriting a newer profile. */
export async function refreshPracticeWords(): Promise<void> {
  const version = ++refreshVersion;
  const profile = loadProfile();
  if (!profile) return;
  const before = JSON.stringify(profile);
  const weak = weakItems(loadProgress(), 5).filter((item) => /^[A-Z]$/.test(item));
  const practiceWords = await fetchPracticeWords(profile, weak);
  if (version !== refreshVersion || JSON.stringify(loadProfile()) !== before) return;
  saveProfile({ ...profile, practiceWords });
}
