# Consent-gated n8n notifications

Workflow exports, a forward learner-confirmation migration and PostgreSQL tests are included. The four updated workflows were deployed and activated on 2026-11-08; live n8n runtime checks used a controlled email sink, not real SMTP delivery. See [integration evidence](../docs/evidence/2026-11-08-integration-gaps.md). The target is n8n Cloud (workflows run in the n8n Cloud workspace; emails go through a Gmail SMTP credential configured inside n8n Cloud). The n8n Cloud version is unknown; `npm view n8n version` reported 2.46.6 on 2026-11-07, which is discovery only. Do not present that as a tested version.

The app's `#/stats` consent box starts unchecked. Only successful Save enables local event forwarding. Stop must delete the remote subscription before clearing local reporting. Browser storage deletion alone does not stop scheduled email. Contact lesson updates and learner recaps each require explicit double opt-in. A shared inbox receives one confirmation email containing two independent confirmation links. Confirming one purpose does not authorize the other.

## Prerequisites and import

1. An authenticated n8n Cloud editor (public HTTPS origin provided by n8n Cloud), an SMTP credential created inside n8n Cloud for a dedicated Gmail account (Gmail app password; never stored in this repo) and a verified sender. [NEEDS: verify Gmail SMTP sending limits and that n8n Cloud accepts the credential]; a **separate notification PostgreSQL database/role**. See [schema.md](schema.md). Never reuse the app's analytics database or `DATABASE_URL` silently. Apply `schema.sql`, `lesson.sql`, `recap.sql`, then `migrations/002-learner-confirmation.sql` as that role in that order. On an existing installation apply only the new migration; it preserves subscriptions and leaves existing learner addresses unconfirmed. These are fresh-install scripts, not upgrades from an older schema.
2. Install test-only dependencies: `npm ci --prefix n8n`. Generate subscription exports with `node n8n/lib/build-workflows.mjs`; delivery exports with `node n8n/build-delivery.mjs`. Run `npm test --prefix n8n`. Tests execute actual migration/functions in PGlite (PostgreSQL WASM), plus exported code/graph checks; they do **not** execute n8n nodes or deliver mail. A real multi-connection PostgreSQL concurrency test remains necessary.
3. Import `subscribe.json`, `contact-links.json`, `lesson-complete.json`, `weekly-recap.json`. All are inactive, credential references removed. Select your dedicated Postgres credential on every database node; select SMTP on send nodes. Configure Header Auth credential `X-Handshake-Secret` matching the server secret on both authenticated POST webhook nodes. Do not activate a webhook without confirming that auth is selected and tested.
4. Set n8n variables `HANDSHAKE_LINK_ORIGIN` to the public HTTPS n8n origin with **no trailing slash**, and `HANDSHAKE_FROM_EMAIL` to the verified sender. These exports require n8n's `$vars` feature; if unavailable on your plan, replace these nonsecret expressions with fixed deployment values during import. Set `HANDSHAKE_APP_ORIGIN` to the HTTPS API origin (no trailing slash) that serves `/api/stats/:learnerId`. The current workflow uses confirmed learner subscriptions; `HANDSHAKE_RECAP_TEST_EMAIL` is no longer used. The recap workflow runs Mondays at 17:00 UTC and describes the last 14 days, weighted by attempt counts. Its manual test trigger is disabled in the export. Never put secrets or real inboxes in committed exports. Disable workflow execution payload storage (exports set success/error retention to none and manual saving false); also disable reverse-proxy URL query logging and execution progress saving globally. Never pin token/email data or share executions unredacted.
5. Validate every node on the actual version, exercise with controlled SMTP sink credentials, then activate production webhooks. Record version, redacted executions and delivered-email evidence in the release evidence file. Missing/wrong secret must fail before any query or email. Default node failures must stop execution; do not enable Continue On Fail. A failed node before Respond to Webhook returns 500, while intentional 400/409/429/503 mutations return their status.
6. Set only on the backend API (Vultr VM, repo-root `.env`): `N8N_SUBSCRIBE_URL=https://<n8n-origin>/webhook/handshake-subscribe`, `N8N_EVENT_URL=https://<n8n-origin>/webhook/handshake-lesson-complete` (confirm delivery export path), and `N8N_SECRET` securely. Missing any disables notifications. Proxy deadline is five seconds: persistence + required SMTP + acknowledgement must finish in that window or UI reports failure. A timed-out request can finish remotely; subsequent Save reconciles state, never assume delivery from timeout or saved row.

Official references checked: [Postgres parameters](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.postgres/), [Respond to Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/). n8n 1.103+ wraps HTML in an iframe, so the confirmation form uses an **absolute** HTTPS action.

## Subscription and contact flows

Note (2026-11-07 review): the backend no longer sends `userName`, `theirName` or `lessonTitle`; the name columns may stay unused, and n8n derives lesson titles from `lessonId`. Lesson events carry only `learnerId`, `lessonId` and `xp`; the backend validates emails as plain `local@domain.tld`.

Authenticated `POST /webhook/handshake-subscribe` calls `handshake.subscribe_verified` and accepts `{action:"subscribe",learnerId,userName?,theirName?,learnerEmail?,contactEmail?,requestedAt}`. The API adds `requestedAt` itself, ignoring client input; timestamps order concurrent Save/Stop requests. Omitted email/name fields replace stored fields with empty strings. Changed contact clears confirmation and rotates separate cryptographically random confirmation and unsubscribe tokens. No user-supplied subject/title/body is used. Response is deferred until persistence and any required confirmation SMTP attempt/acknowledgement finish.

The fixed plain-text confirmation says: “Someone entered your address to get updates when they finish ASL lessons. Confirm: <link>. Ignore this email to receive nothing.” At most one attempt per normalized address per 24 hours and twenty attempts globally in a rolling hour are atomically reserved under the shared PostgreSQL transaction lock. Failed SMTP consumes a reservation; unchanged unacknowledged Save returns 503 until the 24-hour retry window, then generates a fresh token. This prevents false success after SMTP failure, at the cost of delayed retry. Once SMTP is acknowledged, repeated Save can succeed without another email; it reports settings saved, not inbox delivery.

`GET /webhook/handshake-confirm?token=...` is a landing page only. **Refinement of the old GET-confirm contract:** the recipient must submit its explicit POST form to confirm; passive GET scanners cannot create consent. Tokens expire after seven days, are consumed on successful consent and are rejected after address changes. Some aggressive scanners can submit forms; this is a practical opt-in guard, not identity authentication.

`GET /webhook/handshake-unsubscribe?token=...` clears contact address, consent, both contact tokens and pending delivery leases; learner recap remains independent. `GET /webhook/handshake-learner-unsubscribe?token=...` deletes the complete learner subscription and stops recaps and contact lessons. **GET unsubscribe links may be followed by email scanners and stop delivery.** That conservative behavior is intentional. Neither requires the app. Tokens are distinct so confirmation consumption does not break stop links. App `{action:"unsubscribe",learnerId,requestedAt}` also deletes the complete subscription and preserves an anonymous ordering watermark to reject older requests. A later explicit Save can resubscribe.

See schema.md for timestamp ordering/clock assumptions and unavoidable already-in-flight SMTP races. A crash/timeout after SMTP acceptance but before success persistence can also create retry ambiguity. Do not claim hard distributed revocation or exactly-once delivery. Contact-only unsubscribe cannot be represented as stopping learner recaps.

## Learner confirmation and recaps

The migration adds learner confirmation tokens, creation/confirmation timestamps and SMTP acknowledgement state. A learner email must be explicitly confirmed using `GET /webhook/handshake-learner-confirm?token=...` followed by its POST form. GET alone never enables delivery. Tokens expire after seven days, are single-use and are invalidated by address changes or Stop. Existing saved addresses do not acquire consent during migration; Save again to request confirmation.

Learner and contact confirmation requests share the address/day and global/hour budgets. If both addresses are the same, one email contains two separate consent links and consumes one reservation. For different addresses the workflow sends and acknowledges contact and learner confirmations sequentially. A failed required send cannot reach the Saved response; retries of an unacknowledged request return 503 until the documented retry window.

The weekly workflow calls `confirmed_recap_claim()` and `confirmed_recap_recheck(id,lease)`. Both require a confirmed, current learner address. Existing lease, generation, seven-day delivery throttle and unsubscribe protections remain. The older operator-only SQL functions remain for compatibility but are not called by the updated workflow.

## Required remote verification

Use two consenting operator-owned inboxes and a controlled SMTP sink for caps/concurrency tests. Verify missing/wrong secret, unchecked consent, Save sends only confirmation, lesson before confirmation sends nothing, explicit POST confirm enables one lesson, duplicate within ten minutes sends none, changed address revokes old tokens, replay/expiry changes nothing, both unsubscribe variants and app Stop suppress subsequent queued sends. Test SMTP outage and webhook failure return non-2xx without UI enabling reporting; check timeout/retry behavior. Verify weighted 14-day recap figures, zero/malformed/unavailable stats, and queued recap after Stop. Record actual n8n version, node validity, sink concurrency results and redacted delivered mail. Local tests alone prove none of those remote steps.

Known prototype limitation: anonymous learner UUIDs are bearer identifiers, not accounts. Anyone holding an ID can alter its subscription, trigger an event or read its aggregate stats. Names/emails go only to this opt-in notification store; never to Gemini, Maritime or attempts analytics. Never use sensitive contacts or claim identity verification. Consent stays in the browser; remote data stays until Stop succeeds (address budget reservations last at least 24h, anonymous revocation watermarks remain).

## Open follow-ups from the 2026-11-07 review

Not done yet:

- Purge job for unconfirmed contacts, expired tokens and old reservations.
- Suppression list for addresses that unsubscribed.
- Per-learner (or per-IP) cap so one caller cannot use up the global 20 confirmations per hour.
- Unsubscribe links should use a landing page plus POST like confirm (mail scanners can trigger GET), and add List-Unsubscribe headers.
- Hash contact confirmation tokens at rest.
- Strip `+tag` when keying the per-address throttle.
- Move the token format check above the advisory lock.
- Dedupe lesson emails per (learner, lessonId).
- Pin the NodeSource apt repo instead of a piped download-to-shell install in `setup.sh`.
- Pin the agent Docker base image by digest.
- Add CSP and Permissions-Policy (`camera=(self)`) headers for the Vercel frontend.
