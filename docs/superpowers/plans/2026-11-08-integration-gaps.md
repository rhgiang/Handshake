# Integration gaps implementation plan

**Goal:** Deliver the seven fixes requested after the integration audit, with evidence separating local implementation from live service verification.

**Architecture:** Keep Express, n8n/PostgreSQL and the existing Databricks/MLflow training pipeline. Add learner double opt-in before enabling general recap delivery. Preserve contact opt-in, unsubscribe ordering, SMTP failure handling, and anonymous analytics. Lead implements changes; read-only specialists review security, SQL and code.

**Authorized scope:** User requested all seven audited gaps resolved. No commits or pushes requested. Preserve concurrent frontend changes. Do not send real emails without an explicitly designated consenting test inbox.

- [x] Add regression tests proving eligible lesson events reach SMTP; restore graph and replace placeholders.
- [x] Add a forward notification migration for learner confirmation, acknowledgement, expiry, address changes and shared confirmation budgets. Test migration preservation and replay, failure, unsubscribe and throttling paths.
- [x] Add learner GET landing / explicit POST confirmation workflows and sequential confirmation delivery for both addresses. Remove operator-only recap restriction only for confirmed learners; update notification UI copy and deployment docs.
- [x] Verify available n8n, Tiger Data and Gemini access without logging credentials or contact data. Apply changes only after reviewed tests, preserving existing configuration.
- [x] Check Databricks and Vultr access; run training/deployment verification if available. Add reproducible evidence scripts for any missing checks; never label a local run as a Databricks run.
- [x] Run project tests/build, notification tests and training tests; run specialist reviews and resolve findings. Record actual live results and exact blockers.

**Review focus:** Workflow reachability, stale token/address replacement, failed SMTP returning success, concurrent confirmation budgets and subscriptions, and safe upgrade of existing notification rows.

Execution results and remaining external requirements: [integration evidence](../../evidence/2026-11-08-integration-gaps.md). Cloud checks are marked complete as investigations, not as claims that every external dependency is resolved. Databricks access, a consenting inbox, provider quota and repository administration remain pending.
