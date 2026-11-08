import { apiUrl } from "./apiBase";
import type { FingerFeedback } from "../cv";
import type { NotifyReason, NotifyState } from "./notifyMessages";
import { requestPraise, type PraiseKind } from "./praise";

// Frontend → backend. Keep these shapes in sync with CLAUDE.md and backend/index.mjs.

async function post<T>(url: string, body: unknown, timeoutMs = 14000): Promise<T> {
  const res = await fetch(apiUrl(url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs), // a stalled Gemini call rejects, so every caller's fallback runs
  });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json();
}

export type Cached = { cached?: boolean };

/** Set to true ONLY if the H4 snapshot test passes (Group 3). Then a hand photo is sent to Google's API. */
export const SEND_SNAPSHOT = false;

/** repeat = how many times this learner has made this mistake on this letter (from mistakes.ts).
 *  The snapshot is dropped here unless SEND_SNAPSHOT is on, so no caller can leak a photo. */
export const getCoachTip = (target: string, feedback: FingerFeedback[], repeat: number, snapshot?: string) =>
  post<{ tip: string } & Cached>("/api/coach", { target, feedback, repeat, ...(SEND_SNAPSHOT && snapshot ? { snapshot } : {}) });

/** How to form a letter, from Gemini's general ASL knowledge. text is "" when Gemini is unsure or unavailable. */
export const getHowTo = (target: string) => post<{ text: string } & Cached>("/api/explain", { target });

/** One varied praise line AFTER the app confirmed a match. Never throws; a slow or failed call gives a local line marked cached. */
export const praise = (kind: PraiseKind, target: string, opts: { streak?: number; tries?: number } = {}) =>
  requestPraise(kind, target, opts, (body) => post("/api/praise", body, 3000));

export const getPracticeWords = (knownLetters: string[], weakLetters: string[]) =>
  post<{ words: string[] } & Cached>("/api/words", { knownLetters, weakLetters });

async function get<T>(url: string): Promise<T> {
  const res = await fetch(apiUrl(url), { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json();
}

export type { NotifyReason, NotifyState };
export type Features = { stats: boolean; notify: boolean; notifyStatus?: boolean; agent: boolean };
export type Stats = {
  daily: { day: string; attempts: number; accuracy: number }[];
  items: { item: string; attempts: number; accuracy: number }[];
};
export type Plan = { lessonId: string; focus: string[]; words: string[]; tip: string; source: "agent" | "local" };

export const getFeatures = () => get<Features>("/api/features");
export const getStats = (learnerId: string) => get<Stats>(`/api/stats/${learnerId}`);
export const planToday = (req: import("./planInput").PlanRequest) => post<Plan>("/api/plan", req);

export type SubscribeBody =
  | { action: "subscribe"; learnerId: string; consent: true; userName?: string; theirName?: string; learnerEmail?: string; contactEmail?: string }
  | { action: "unsubscribe"; learnerId: string };
export const subscribe = (body: SubscribeBody) => post<{ ok: boolean; reason?: NotifyReason }>("/api/subscribe", body);

/** One request per call, never polled. A network failure or non-JSON answer resolves to automation_unavailable. */
export async function notifyStatus(learnerId: string): Promise<({ ok: true } & NotifyState) | { ok: false; reason: NotifyReason }> {
  try {
    const res = await fetch(apiUrl(`/api/notify-status?learnerId=${encodeURIComponent(learnerId)}`), { signal: AbortSignal.timeout(10000) });
    const j = await res.json();
    if (j && j.ok === true) return j;
    return { ok: false, reason: j?.reason ?? "automation_unavailable" };
  } catch {
    return { ok: false, reason: "automation_unavailable" };
  }
}
