Latest verification: [2026-11-08 integration gap results](2026-11-08-integration-gaps.md). Updated workflows are active; real SMTP/inbox proof remains pending. The older record below is historical.

# n8n live verification

Current status: updated workflows are active and passed live n8n runtime checks with a controlled email sink. Real SMTP acceptance/inbox delivery is still pending. See the linked integration results for passed checks; the remaining list below is the original delivery-evidence checklist.

Required inputs: n8n HTTPS editor/webhook origin and access, SMTP credential configured in n8n, dedicated subscription database access, final public APP_URL, and consenting operator-controlled learner/contact inboxes. Provide credentials through a secret manager or protected local file; never commit them.

Record the n8n version, deployed workflow revisions and app commit, then attach redacted evidence for:

- Missing/wrong webhook secret rejected.
- Consent unchecked sends nothing.
- Subscribe sends confirmation only; no lesson email before confirmation.
- Explicit confirmation permits delivery; expired/reused/rotated confirmation token does not.
- Confirmed contact receives a real lesson email with unsubscribe link.
- Duplicate events inside ten minutes send nothing extra.
- Changing contact address requires a new confirmation.
- Contact unsubscribe works without the app and suppresses subsequent updates.
- App Stop deletes the subscription; queued recap does not send.
- One real recap shows weighted counts and the actual data window.
- SMTP/webhook outage is reported as failure.
- Confirmation budgets verified with a test sink, not repeated unsolicited real mail.

Prize evidence still needed: workflow canvas screenshots, execution screenshots, redacted confirmation email, delivered lesson email, recap email, and unsubscribe/suppression evidence. No screenshots or delivered messages are supplied by this file.
