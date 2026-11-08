# Integration gap results — 2026-11-08

## Implemented and deployed

The notification migration and all four updated n8n workflows are live. Existing workflow IDs, credential references and existing webhook IDs were retained. Production workflows were paused for the coordinated update, backed up privately, updated, activated and read back. Every deployed node's type/parameters matches the repository export; connection graphs and execution privacy settings were also verified. No source commits or pushes were made by this task.

- Eligible confirmed-contact lesson events now reach the email node instead of `Skip notify`. Placeholder lesson copy was replaced.
- Learner email addresses now require explicit confirmation before recaps. GET renders a form; only POST consumes a valid, unexpired token. Changing the address or unsubscribing invalidates eligibility.
- Existing saved learner addresses remain unconfirmed after migration. Save again to request confirmation.
- If both roles use the same inbox, a single email contains two independent consent links and consumes one confirmation reservation. Each purpose must be confirmed separately.
- Required SMTP failures do not reach Saved. Contact and learner delivery acknowledgements are token-scoped. Retry of an unacknowledged learner confirmation returns 503 within the retry window.
- Recap claims/rechecks require confirmed learner state, current subscription generation and an active lease. The old operator-only SQL functions remain for backwards compatibility; production exports use the new confirmed-learner functions.
- New migration: `n8n/migrations/002-learner-confirmation.sql`. The VM copy's SHA-256 matched the reviewed local file before application. Existing subscription data was preserved.
- Notification UI explanatory copy was updated locally. Publishing that frontend source change is separate from the completed live n8n deployment.

The existing deployment has both `public.attempts` and the `handshake` notification schema on the configured Tiger Data database. This run explicitly inspected and upgraded that existing notification installation; it did not silently create or substitute a database. The README's dedicated notification database/role remains the recommended deployment isolation, rather than a claim that this live installation already has separate databases.

## Live n8n verification

Temporary authenticated workflows used the real n8n runtime, existing PostgreSQL credential and actual application statistics API. SMTP nodes were replaced only in the temporary copies with controlled email sinks that rendered the original recipient, HTML and text expressions. Production SMTP nodes retain their existing credential and real email node type.

Passed:

- Wrong webhook secret rejected.
- Separate learner/contact inboxes: subscription persisted; both confirmation templates rendered and acknowledgements cleared their pending states.
- Shared inbox: one email rendered both independent confirmation links.
- Production learner GET landing did not grant consent; form-urlencoded POST granted it. Production contact POST confirmation also succeeded.
- Confirmed lesson path reached the email sink and updated `last_sent_at`.
- Controlled lesson SMTP failure reached the error branch, returned 503 and did not record successful delivery.
- Two-learner recap path fetched actual API statistics, preserved item linking, rendered both email sinks and acknowledged both deliveries. The temporary claim query selected only the test learners; it did not claim real users' recaps.
- Controlled subscription SMTP failure failed the request and left pending state; retry returned 503.
- Separate real PostgreSQL connections raced for one confirmation address: exactly one returned 200 and the other 429.
- All temporary workflows and test-only notification rows/reservations were removed. Final API inventory showed only the four production workflows, all active, with success/error execution-payload retention disabled.

No real email was sent. SMTP acceptance and inbox delivery remain unverified until the user designates a consenting test inbox. The cloud briefly returned 404 immediately after registering a temporary webhook; the smoke harness used bounded readiness retries for those temporary paths. The final complete run passed.

## Tiger Data and Vultr verification

- Remote Tiger Data connection succeeded; TimescaleDB version was `2.31.0` and the attempts table exists.
- Existing database smoke test passed with three anonymous test attempts.
- Public HTTPS API accepted three attempts for a fresh anonymous learner ID, then returned three attempts and a match fraction of `2/3` from the statistics endpoint. These anonymous analytics test rows remain as smoke-test evidence.
- `/api/features` returned `{stats:true,notify:true,agent:false}` over public HTTPS.
- Port 8787 was not externally reachable.
- `handshake.service` was active. Latest observed release symlink was `/opt/handshake-releases/4e0a991aeda5f8d8e740b74f8d482e23aff0fd0a/backend`.
- GitHub Actions [run 42479922418](https://github.com/rhgiang/Handshake/actions/runs/42479922418) successfully tested and deployed that production release. Earlier [run 42470711437](https://github.com/rhgiang/Handshake/actions/runs/42470711437) also passed; [run 42470534756](https://github.com/rhgiang/Handshake/actions/runs/42470534756) failed its test job and skipped deployment.
- Failure/rollback behavior passed the local deployment fixture suite. No deliberate production outage or live rollback was induced during this task.
- The production branch currently reports `protected:false`. The authenticated GitHub account has push access but `admin:false`; branch protection requires a repository administrator. Deployment secrets/helper were already operational and were not replaced.

## Gemini verification and external quota

The public API returned live (not cached) coaching and practice-word responses. Subsequent explanations and praise used the designed fallbacks. A direct provider probe returned HTTP 429 `RESOURCE_EXHAUSTED` for `generativelanguage.googleapis.com/generate_content_free_tier_requests`, with a retry delay of approximately 19.6 hours for the configured `gemini-3.6-flash` model.

Alternative model checks did not provide a reliable replacement: `gemini-3.5-flash-lite` had availability/timeouts and exceeded the praise deadline; `gemini-2.5-flash-lite` returned 404 despite appearing in the model-list response. No production model or billing setting was changed. Full live explanation/praise proof needs quota reset or an appropriately configured key/project. Local failure/fallback tests passed.

## Databricks

The existing notebook and MLflow sweep are implemented; 36 training/Databricks regression tests passed locally. The frontend includes a trained model with recorded random-split evaluation metadata, but no artifact establishes that it was trained in Databricks. No Databricks CLI profile or workspace configuration was found, and browser access was unavailable.

A real workspace run and same-evaluation baseline comparison remain required before claiming Databricks usage or an accuracy improvement. Requested from the user: workspace URL or an existing secure credential/config location. No cloud account, billable compute, synthetic cloud evidence or replacement production model was created.

## Fresh local verification

- `npm test`: passed frontend, 120 backend/deployment tests and 7 agent tests.
- `npm test --prefix n8n`: 31 passed, 0 failed.
- `.venv/bin/python -m pytest training/test_train_smoke.py training/test_databricks.py -q`: 36 passed, one MLflow/SQLAlchemy deprecation warning.
- `npm run build`: passed; Vite reported existing large-bundle warnings.
- `git diff --check`: passed.
- Independent code and security/SQL reviews found two issues during implementation (an ambiguous SQL identifier and shared-inbox budget handling); both were corrected and independently rechecked. Final reviewed notification changes had no remaining findings.

## Remaining external requirements

1. Databricks workspace access to run the notebook and capture actual MLflow results/comparison.
2. An explicitly designated user-controlled inbox for real confirmation, lesson and recap email delivery tests.
3. Gemini quota reset or an appropriately provisioned key/project for reliable live explanations and praise.
4. Repository administrator access to protect `production`.
5. Publish the local frontend notification copy when the source changes are committed/deployed through the project's normal release process.
