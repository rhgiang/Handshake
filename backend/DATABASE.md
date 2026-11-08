# Tiger Data integration

Implements the database portion of the sponsor-tracks spec: U0 (attempt validators
and per-IP rate limits), U1 (TimescaleDB storage), U2 (attempts/stats routes),
the database portion of U5 (startup/features), and the attempt-reporting portion
of U7/Task 13. Existing Gemini endpoints and local progress rules stay intact.
The stats chart (U8), Maritime, n8n, hosting and Databricks are separate tasks.

## Setup

1. Create a Tiger Cloud service with TimescaleDB 2.13+ available. Copy its
   PostgreSQL connection string into the gitignored `.env` as `DATABASE_URL`,
   including `sslmode=require`. Never use a `VITE_` variable for this secret.
2. Run `npm run install:all`, then `npm run db:migrate` (prints `schema applied`).
3. Run `npm run db:smoke` (prints stats with `"attempts":3`, then `db smoke ok`).
4. Run `npm run dev`. `GET /api/features` returns
   `{ "stats": true, "notify": false, "agent": false }` when the URL is configured.
   This flag indicates configuration, not a database health check.

Migrations are explicit, not part of API startup. The initial schema is applied
in one transaction and is repeatable without deleting rows. Once deployed,
future schema changes should use a new migration rather than editing this one.
No automatic destructive rollback is supplied: to disable collection, unset
`DATABASE_URL` and restart the API; existing rows remain. The smoke check writes
three anonymous test rows under a fresh UUID and leaves them as test evidence.

## Data and API

`POST /api/attempts` accepts:

```json
{
  "learnerId": "11111111-1111-4111-8111-111111111111",
  "attempts": [
    { "item": "L", "correct": true },
    { "item": "I", "correct": false, "codes": ["thumb:placement"] }
  ]
}
```

- Batch size: 1–50; UUID required; item is an uppercase letter or sign id matching
  the spec. `fs:*` word items are rejected because they may contain names.
- `correct` must be a boolean. Optional `codes` is an array of at most five
  lowercase `finger:issue` strings. Optional `ts` is Unix milliseconds; only the
  last 24 hours are accepted, otherwise the server supplies its current time.
- Validation is atomic: an invalid row rejects the whole batch with
  `400 { "error": "bad_request" }`. Extra fields are never passed to storage.
- Valid requests return 204 even if the database is disabled or unavailable.
  There is no retry queue or delivery guarantee; local progress remains authoritative.
- Rate limit: 120 requests/minute/IP, before JSON parsing. Oversized bodies
  return 413; malformed JSON returns 400; rate-limited requests return
  `429 { "error": "rate_limited" }`.

`GET /api/stats/:learnerId` returns:

```json
{
  "daily": [{ "day": "2026-11-07", "attempts": 3, "accuracy": 0.6666666666666666 }],
  "items": [{ "item": "L", "attempts": 3, "accuracy": 0.6666666666666666 }]
}
```

Daily buckets are UTC, ordered oldest first, for attempts within the rolling
last 14 days. Empty days are omitted. Items require at least three attempts,
ordered by lowest match fraction, then most attempts, with a five-item limit.
Fractions are 0–1. An unconfigured database or a successful query with no history
returns `200 { "daily": [], "items": [] }`. A configured database query failure
returns `503 { "error": "stats_unavailable" }`; the stats page shows an outage
message rather than the empty-history prompt. Invalid UUID returns 400.
Limit: 60/minute/IP. Attempt ingestion remains best effort and does not block
local practice during an outage.

## Frontend handoff and privacy

The two measured callbacks in `LessonPlayer` call `reportAttempt` only after
saving local progress. Skips, reference-only/self-check actions and lesson
completion do not create measured attempts. `frontend/src/lib/learner.ts` persists a
random UUID at `handshake.learner.v1`, with page-session memory if storage is
blocked. Requests are fire-and-forget with an eight-second timeout.

The frontend owner can read that same `learnerId()` and request
`/api/stats/<id>` for the chart; use `/api/features` for availability. Follow
the spec's accessible text-table equivalent and say "matches the reference"
in UI copy. The database/API's `accuracy` and `correct` field names are contract
fields, not learner-facing judgments. The chart is not implemented by this task.

The database contains only timestamps, UUIDs, item ids, match booleans and error
codes. No names, emails, images or landmark coordinates. SQL values are
parameterized; connection/query timeouts and pool size are bounded; error logs
omit driver messages and credentials. No accounts/auth were added: as accepted
by the spec, anyone holding a learner UUID can read or submit their stats.

By default Express does not trust forwarded IP headers. In production set
`HOST=127.0.0.1` (bind to loopback behind Caddy) and `TRUST_PROXY_HOPS=1` (Caddy
only; the browser calls the API directly) so the rate limiter keys on the visitor's IP.
`ALLOWED_ORIGIN` lists the exact origins (e.g. the Vercel URL) allowed by CORS. The API serves
no static files: the frontend is hosted on Vercel.

## Verification

Run `npm test` and `npm run build`. Tests cover validation, timestamp clamping,
PII field exclusion, rate-limit ordering, disabled/unreachable databases,
parameterized SQL and aggregate contracts, anonymous ids, offline reporting and
script failure paths. Database unit tests replace only the network query layer;
they do not prove SQL execution on TimescaleDB. Run both database commands
against a real Tiger Cloud service before claiming the sponsor integration is
verified. Then play a live-graded letter lesson and confirm the same learner's
stats change. Live grading still requires the separate human letter gate.

## Accounts (removed)

Guest-only. Account/auth tables and routes were removed. Profile and progress stay in the browser (`localStorage`). Tiger Data still stores anonymous `attempts` rows only (letter/sign id, pass/fail, error codes, random `learner_id`) — never names or emails.
