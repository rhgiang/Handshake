# Coach backend

Tiger Data setup, API contracts and the frontend handoff are in [DATABASE.md](./DATABASE.md).

From the repo root run `npm run install:all`, copy `.env.example` to `.env` (repo root), and run `npm run dev` (web :5173 + API :8787).
The client uses `/api/coach` and `/api/words` through Vite's proxy. Without
`GEMINI_API_KEY`, both return local fallback JSON. `/api/path` was removed:
names belong only in the browser. The model is configurable with `GEMINI_MODEL`.

## CV integration contract

- POST `/api/coach`: `{ target, feedback: [{ finger, code, issue }], repeat }`.
  Returns `{ tip, cached? }`. Use `getCoachTip` from `frontend/src/lib/api.ts`.
- `code` and `issue` must match the combinations emitted by `getHandFeedback`.
  Unknown fields and invalid feedback are discarded before constructing prompts.
- Show the landmark tip immediately; the asynchronous coach tip supplements it.
- `repeat` is the count for the same letter/error, from mistake memory. It selects
  a short cue, a different cue, then a reference-comparison cue. The player must
  show the reference beside the camera on repeat 3; the backend cannot do that.
- Gemini selects from enum-constrained, landmark-derived wording. The server
  rejects arbitrary output, including contradictory instructions. This bounds
  expressive coaching to preserve the CV measurement as the source of truth.
- `cached: true` labels cached and local fallback responses. Display that label.
- Snapshots remain off in the client (`SEND_SNAPSHOT = false`) and server by
  default. Enabling them requires the documented human H4 evaluation first.
- Recognition thresholds, dominant-hand selection, out-of-frame behavior and
  live-letter eligibility remain CV responsibilities. No letters were validated
  or promoted by this implementation. See `docs/test-log.md` for human evidence.

POST `/api/words` accepts `{ knownLetters, weakLetters }` and returns
`{ words, cached? }`. Words contain only the supplied known letters, and words
with more weak-letter occurrences come first. Errors return local words or `[]`.
Both endpoints fall back after twelve seconds, before the client's fourteen-second
request deadline. Generation is capped at four concurrent requests and thirty
requests per minute per server process. The response cache holds 256 entries.

## Demo cache

`backend/precache.json` is read once at startup, relative to the server module
(independent of the working directory). It includes a few mock responses to edit
or replace; they are not live Gemini output. Hits on both endpoints work without
a key and return `cached: true`, which the client displays as "cached". Missing
files use an empty cache; malformed files warn and fall back safely.

The file is a JSON object mapping request keys to `{ "tip": "..." }` or
`{ "words": ["..."] }`. Coach keys are
`coach:<target>:<code>:<issue>:<repeat>` (repeat is capped at 3; no feedback uses
`coach:<target>:none::<repeat>`). Additional feedback is appended as JSON by the
server, so use an export for those keys. Tips must match the server's grounded
cues. Word keys are `words:<knownLetters joined>:<weakLetters joined>`; letters
are uppercased and deduplicated in request order. Words are filtered against
known letters and sorted with weak letters first.

Once a key is set, move the mock file aside and restart to generate fresh replies.
Set `CACHE_EXPORT_ENABLED=1` only for local demo preparation, run the demo, then
save `curl --fail http://localhost:8787/api/cache -o backend/precache.json`.
Review every cue before using it and restart the API to load the file. Unusable
cache entries are discarded. Cache export is disabled by default.

## Complete screen handoff

The lesson player must call `completeLesson` once when its final step succeeds,
then navigate to `#/complete/<id>`. The screen reads saved completion and XP;
visiting or reloading it never awards XP. Unknown and unfinished lessons have
separate states. Next-lesson links stay within Units 1–2.

Run `npm test` for API behavior and completion rendering tests; `npm run build`
checks TypeScript and the production bundle. Real-key generation and webcam
recognition require separate human verification.

The lesson-player integration now handles Unit 1–2 steps and records completion
once per lesson. All letters currently remain reference-only because the human
accuracy log is empty. After human testing, add only qualifying letters to
`PRACTICEABLE` in `frontend/src/cv/practiceable.ts`. Check `RIGHT_HAND_LABEL` on the demo
camera before enabling live grading. Changing the candidate list or recording
templates must never bypass this gate.

## Gemini retries

The default model is `gemini-3.6-flash`, selected from the key's model-list
response with `generateContent` support. `GEMINI_MODEL` can override it.
`backend/gemini.mjs` retries HTTP 500, 502, 503 and 504, plus local attempt
timeouts: at most three retries after the first request. Full jitter uses
exponentially growing 200/400/800 ms delay caps. Each attempt has a local 6 s
abort timer; the entire operation, including delays, is capped at 12 s so the
client's 14 s deadline still allows the local fallback to arrive. The total
budget can shorten the number of retries on slow failures. SDK retries are
disabled, and each attempted generation counts toward the 30/minute limit.
Logs contain only HTTP status, attempt number, retry decision, and a fixed
failure category. They exclude raw provider messages, URLs, prompts and keys.

A provider HTTP 429 stops retries immediately and pauses outbound calls for that
AI client/model across all endpoints. Google RetryInfo supplies the cooldown
when available; the delay is at least 60 seconds and at most 24 hours, with a
60-second default when metadata is missing or malformed. Paused calls use the
existing local fallbacks without consuming provider-call budget. Successful
cache hits are still served. Cooldown state is in memory and resets on restart;
requests already in flight are not cancelled by another request's quota error.

The frontend fetches explanations only for the displayed letter and refreshes
practice words for at most the next incomplete alphabet lesson. Other saved
practice words are preserved; completing the alphabet stops background word
refresh requests.
