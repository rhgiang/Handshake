# Notification status (read-only)

NOTHING here has been applied or run against a live database or n8n Cloud. Tests use PGlite only.

1. Apply `n8n/status.sql` after `schema.sql`, to the same dedicated notification database and role. It only creates `handshake.notification_status(text)` (STABLE, read-only; safe to re-run).
2. Import `n8n/status.json` into n8n Cloud. Attach the same Header Auth credential (`X-Handshake-Secret`) to the Status webhook and the same Postgres credential to Read status (credentials are not stored in the export). Activate it.
3. Set the production webhook URL (`.../webhook/handshake-status`) as `N8N_STATUS_URL` on the Vultr API and restart. `/api/features` then reports `notifyStatus: true`.

Any error in the workflow makes n8n answer non-2xx; the API turns that into `automation_unavailable` or `delivery_failed`. No error text is returned.

## States
- `contact`: `none` (no contact email), `awaiting_confirmation` (email saved, link not clicked), `confirmed`, `stopped` (full Stop).
- `recap`: `none`, `requested` (learner recap email saved), `stopped` (full Stop).
- `expired`: contact awaiting and the confirmation link is older than 7 days.
- `delivery`: `pending` while a confirmation email was queued but SMTP never acknowledged it.

## Known limits
Only a full Stop (learner row gone, `revoked_learners` row present) is reported as `stopped`. A contact who used their own unsubscribe link clears the contact email, which looks like `none`. Status is not guessed beyond that.
- A contact-only unsubscribe (the contact's own link) reads as `none`, the same as never having added a contact.
- `pending` means the confirmation send was started and not yet acknowledged. It can stay true after a failed send until the next changed save, or until 24 hours pass. It is only reported while the contact is awaiting confirmation.

## Execution quota
Each status call runs one n8n Cloud execution. The API caps this with a per-IP limit (10 per minute) and a global limit (60 per minute for all callers); keep the Settings page from polling faster than that.
