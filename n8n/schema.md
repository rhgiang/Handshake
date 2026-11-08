# Notification persistence v1

Install `schema.sql`, then `lesson.sql`, `recap.sql`, and `migrations/002-learner-confirmation.sql`, in a **dedicated PostgreSQL database**, as a dedicated notification role that owns the `handshake` schema. Give that role no access to the app's attempts database. This is an explicit additional prerequisite; the workflows use a separately configured n8n Postgres credential, never the app's `DATABASE_URL`. Do not install over an older schema without a reviewed migration: `CREATE TABLE IF NOT EXISTS` does not add columns to an existing table.

Why PostgreSQL rather than Data Tables: transaction advisory locks atomically reserve a global/hour and normalized-address/day confirmation budget across n8n workers. A Data Table read/count/write sequence cannot guarantee those caps. Functions are SECURITY INVOKER, with a fixed trusted search_path; PUBLIC has no schema, table or function access. Execute migrations as the same role selected in n8n (or grant only the required objects to a dedicated runtime role). Never grant this database to the public app or anonymous users. Protect backups; names, addresses and bearer tokens are personal/secret data.

## `handshake.learners`

| Column | PostgreSQL type | Absent/meaning |
| --- | --- | --- |
| learner_id | text PRIMARY KEY | Anonymous app ID, 1–100 characters |
| user_name, their_name | text NOT NULL | Empty string; max 80 characters |
| learner_email, contact_email | text NOT NULL | Empty string; normalized lowercase email |
| contact_token | text UNIQUE nullable | 64 hex, confirmation only; consumed on confirmation |
| contact_token_created_at | timestamptz nullable | UTC creation; expires after seven days |
| contact_confirmed_at | timestamptz nullable | Null means no lesson delivery |
| unsubscribe_token | text UNIQUE nullable | Separate contact-only stop token, retained after confirm |
| learner_unsubscribe_token | text NOT NULL UNIQUE | Stops **all** delivery by deleting learner; rotates if learner email changes |
| confirmation_delivery_pending | boolean NOT NULL | SMTP reservation not yet acknowledged; confirm also clears it |
| requested_at | timestamptz NOT NULL | Trusted API timestamp ordering consent changes |
| generation | uuid NOT NULL | Changes on subscription update/contact revocation; queued tasks must recheck |
| last_sent_at | timestamptz nullable | Last successful lesson send only |
| lesson_lease | uuid nullable | Exclusive expiring lesson delivery reservation |
| lesson_lease_until | timestamptz nullable | Lease expiry |

`handshake.revoked_learners(learner_id text PK, revoked_at timestamptz)` retains only an anonymous ID and ordering watermark after full Stop; no name, address or token survives deletion. `confirmation_reservations(address text, reserved_at timestamptz)` reserves attempts before SMTP; failed sends consume the budget too. Retain at least 24 hours; operationally delete older reservations after 48 hours. Never delete revocation watermarks while older requests could still run.

## Mutation contract

`handshake.subscribe(jsonb)` accepts existing body plus **required server-generated** `requestedAt` ISO timestamp. The app proxy, authenticated by Header Auth, supplies it and ignores a client-provided timestamp. Never expose the shared secret to clients. Response JSON: `{ok,status,send,email?,token?}` is internal and includes secrets; the HTTP response exposes only `{ok,reason?}`. `400` malformed, `409` stale ordering, `429` reserved budget, `503` earlier SMTP attempt not acknowledged. Equal timestamps reject; a later explicit Save can subscribe after Stop.

`handshake.contact_action(action,token)` returns `{changed}`. Actions: `confirm` consumes a current token younger than seven days; `unsubscribe` clears only contact delivery and rotates generation; `learner-unsubscribe` deletes learner and saves a revocation watermark. Unknown/expired/replayed tokens change nothing. Link revocation preserves `greatest(existing requested_at,clock_timestamp())`.

`handshake.confirmation_sent(token)` clears pending only for the same current token after SMTP success. An unacknowledged unchanged contact returns 503 on retry until 24 hours have elapsed, then gets a fresh token and budget reservation. If SMTP succeeded but acknowledgement failed, clicking the delivered confirmation clears pending safely. This favors bounded confirmation attempts over immediate retry. Success is SMTP acceptance, never proof of inbox delivery.

All subscription and link mutations take transaction advisory lock **48151623**. Lesson claim/recheck/finish operations must use this same lock, match `generation`/lease, require a confirmed nonempty contact, and update `last_sent_at` only after successful SMTP. A transaction cannot make SMTP atomic: an unsubscribe after final check but before SMTP acceptance may still receive one in-flight email. Do not claim exactly-once delivery.

Ordering assumes the trusted API and PostgreSQL clocks are synchronized, with one API clock authority; values more than five minutes in the future are rejected. It suppresses previously accepted/replayed requests across Stop and blocks older timestamped requests, but does not provide a distributed sequence number for every in-flight request across clock-skewed hosts. Stronger guarantees require a versioned consent protocol.

## Learner confirmation migration (002)

`subscribe_verified(jsonb)` is the workflow entry point. It calls the original subscription function inside a transaction exception block, then reserves learner confirmation delivery under the same advisory lock and budgets. A learner budget/pending failure rolls back the whole save, including any new contact reservation. Its internal result also contains `learnerSend`, `learnerIncluded`, `learnerEmail` and `learnerToken`; never expose these tokens in the app response or execution logs.

The migration adds `learner_token`, `learner_token_created_at`, `learner_confirmed_at` and `learner_confirmation_pending`. `learner_confirm(token)` consumes a current token after explicit POST; `learner_confirmation_sent(token)` acknowledges SMTP acceptance without granting consent. `confirmed_recap_claim()` and `confirmed_recap_recheck(id,lease)` select only confirmed learner addresses. The migration is repeatable and does not backfill consent. Apply it to existing installations rather than rerunning fresh-install scripts. Roll forward for future changes; disable the workflows to stop delivery without deleting data.
