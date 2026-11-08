# Gemini usage (audit, 2026-11-08)

All Gemini calls go through the backend (`backend/app.mjs`, key from `.env` via `backend/index.mjs`). No key → every endpoint answers from local fallbacks, labelled `cached`. Model: `GEMINI_MODEL` or `gemini-3.6-flash`.

**Shared plumbing** (`askJson` in app.mjs, `generateWithRetry` in gemini.mjs): JSON mode + `responseSchema`; temperature 0.7 (praise: 1.0). Retries transient 5xx/timeouts, at most 4 attempts, 6 s per attempt, 12 s total (praise: 2.5 s total). **Global budget:** at most 4 calls in flight and 30 per minute for the whole server, shared by all endpoints. Over budget means the local fallback. Logs hold status codes only, no prompts. In-memory cache: 256 entries, seeded from `backend/precache.json` (5 mock entries, never refreshed from a live run). A cache hit returns `cached: true`.

| Endpoint | Input that reaches Gemini | responseSchema | Cache | Fallback | UI |
|---|---|---|---|---|---|
| `POST /api/coach` | target letter, measured issues (regex allowlisted to feedback.ts wording), repeat 1–3; JPEG snapshot only if `SNAPSHOT_ENABLED=1` (client `SEND_SNAPSHOT=false`) | `tip` enum of 2 server-built cues, so Gemini **chooses** a cue and writes nothing free | keyed by target+issues+repeat; photo replies not cached | first landmark cue, `cached:true` | LessonPlayer (via coachQueue), CameraDemo, LessonDemo → `CoachTip` shows "Coach (cached)" |
| `POST /api/explain` | target letter only | `{text, confident}` | keyed by letter | empty text (UI hides it) | LessonView "How to form X" with a "not checked by a fluent signer (cached)" note; requested only for the displayed letter |
| `POST /api/words` | known + weak letters | `words`: arrays of letters, enum = known letters | keyed by letter sets | `MOCK_WORDS` filtered, `cached:true` | `profile.ts` stores practice words (Onboarding, Complete). The words are not shown with a cached label. |
| `POST /api/praise` (new) | kind, target id (letter / sign allowlist / lesson id), streak 0–50, tries 1–20, and `recent` lines **only if the server issued them** | `{message: string}` | none by design (so lines don't repeat) | ≥25 canned lines, random, avoid `recent`, `cached:true` | `RewardLine` in LessonView, SceneView, Complete, LessonDemo; "(cached)" in small text |
| Maritime agent (`agent/plan.mjs`, behind `/api/plan`) | lesson ids + letters, known letters; tools fetch stats/words by learner id | **none** (function calling, then parses `{…}` from text) | none | backend `localPlan` after an 8 s timeout or a failed guard | PlanCard; `source: "agent"/"local"` |

**Gaps (honest):**
- Rate limiting: only the praise and plan routes have a per-IP limit. Coach, explain and words rely on the global 30/min budget, so one busy client can push everyone onto fallbacks.
- `precache.json` is mock data. The Devpost must not call it Gemini output.
- Words returned from cache are not labelled cached in the UI, because `profile.ts` drops the flag.
- The agent has no `responseSchema`, so the target "3 endpoints with responseSchema" counts coach, explain, words and praise, not the agent.
- CLAUDE.md says Gemini picks the relationship word pack. No endpoint does that: `curriculum.ts` uses the local `PACK_WORDS`.
- Coach `tip` is an enum of server cues. That is safe, but it means Gemini's "rewording" is a choice between two strings.
- Praise quality and variety from real Gemini are untested (no key in CI). The tests use fakes.

**Quota/preload update:** HTTP 429 immediately stops retries and starts an
in-memory cooldown shared across endpoints for the affected AI client/model.
Provider RetryInfo is used when available, bounded to 60 seconds–24 hours;
missing/invalid metadata defaults to 60 seconds. During cooldown the existing
local fallbacks and cached replies remain available without outbound calls.
Lesson-wide explanation prewarming was removed. Practice-word refresh updates
only the next incomplete alphabet lesson, preserving saved words for others.
